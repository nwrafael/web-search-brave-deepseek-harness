import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import { BraveSearchProvider, BRAVE_PROVIDER_ID, BRAVE_SEARCH_PATH } from '@deepseek-ai/dsh-web-search-brave'
import * as bravePlugin from '@deepseek-ai/dsh-web-search-brave'
import { mapBraveResponse, mapBraveResult } from '../src/provider.ts'
import type { BraveSearchProviderOptions } from '../src/provider.ts'

const options = { apiKey: 'brave-key', baseURL: 'https://api.brave.test' }

/** The options without a literal key, for resolver-driven availability paths. */
function withoutKey(): Omit<typeof options, 'apiKey'> {
  const { apiKey: _omitted, ...rest } = options
  return rest
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Brave result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapBraveResult({
      url: 'https://a.test',
      title: 'A',
      description: 'a plain summary',
      page_age: '2026-01-01',
      age: 'January 1',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'a plain summary', publishedAt: '2026-01-01' })
  })

  it('prefers the machine-readable page_age over the human-readable age', () => {
    expect(mapBraveResult({ url: 'https://a.test', page_age: '', age: '2 days ago' }))
      .toEqual({ url: 'https://a.test', publishedAt: '2 days ago' })
  })

  it('drops a result with no usable URL but keeps one with no description', () => {
    expect(mapBraveResult({ url: '' , title: 'A' })).toBeUndefined()
    expect(mapBraveResult({})).toBeUndefined()
    expect(mapBraveResult({ url: '   ' })).toBeUndefined()
    expect(mapBraveResult({ url: 'https://a.test' })).toEqual({ url: 'https://a.test' })
  })

  it('omits null/blank optional fields rather than emitting them', () => {
    expect(mapBraveResult({ url: 'https://a.test', title: null, description: null, age: null }))
      .toEqual({ url: 'https://a.test' })
    expect(mapBraveResult({ url: 'https://a.test', title: '', description: '  ', page_age: '' }))
      .toEqual({ url: 'https://a.test' })
  })

  it('maps a response to a content-less result with filtered sources', () => {
    const result = mapBraveResponse({
      web: { results: [
        { url: 'https://a.test', description: 'one' },
        { url: 'https://b.test' },
        { url: 'https://c.test', title: 'C', description: 'three' },
      ] },
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', snippet: 'one' },
        { url: 'https://b.test' },
        { url: 'https://c.test', title: 'C', snippet: 'three' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a missing web cluster and a missing results array', () => {
    expect(mapBraveResponse({}).sources).toEqual([])
    expect(mapBraveResponse({ web: {} }).sources).toEqual([])
  })
})

describe('BraveSearchProvider availability', () => {
  it('is available with a literal key or a resolver', () => {
    expect(new BraveSearchProvider(() => ({ ...options })).available()).toBe(true)
    expect(new BraveSearchProvider(() => ({ ...withoutKey(), resolveApiKey: async () => 'k' })).available()).toBe(true)
  })

  it('is unavailable without any credential path or with an unparseable base URL', () => {
    expect(new BraveSearchProvider(() => ({ ...withoutKey() })).available()).toBe(false)
    expect(new BraveSearchProvider(() => ({ ...options, baseURL: 'not a url' })).available()).toBe(false)
  })

  it('is misconfigured when numResults is set but not a positive integer', () => {
    const provider = (numResults: number): BraveSearchProvider =>
      new BraveSearchProvider(() => ({ ...options, numResults }))
    expect(provider(0).available()).toBe(false)
    expect(provider(1.5).available()).toBe(false)
    expect(provider(-3).available()).toBe(false)
  })

  it('is misconfigured when safeSearch or freshness carry values Brave does not define', () => {
    // The durable settings layer can deliver any JSON string; availability
    // must fail rather than dispatch a request Brave answers with 422.
    const badSafeSearch = new BraveSearchProvider(
      () => ({ ...options, safeSearch: 'sometimes' }) as unknown as BraveSearchProviderOptions,
    )
    const badFreshness = new BraveSearchProvider(
      () => ({ ...options, freshness: 'hourly' }) as unknown as BraveSearchProviderOptions,
    )
    expect(badSafeSearch.available()).toBe(false)
    expect(badFreshness.available()).toBe(false)
  })

  it('accepts blank country/searchLang as absent but rejects non-string junk from the settings layer', () => {
    const blank = new BraveSearchProvider(() => ({ ...options, country: '  ', searchLang: '' }))
    expect(blank.available()).toBe(true)
    // The durable settings layer can deliver any JSON value; availability must
    // fail rather than dispatch a request Brave answers with 422.
    const junk = new BraveSearchProvider(
      () => ({ ...options, country: 42, searchLang: true }) as unknown as BraveSearchProviderOptions,
    )
    expect(junk.available()).toBe(false)
  })
})

describe('BraveSearchProvider request mapping', () => {
  it('sends the query, plain-text decorations, and the subscription token on the search path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    await new BraveSearchProvider(() => ({ ...options })).search({ query: 'hello world' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.brave.test${BRAVE_SEARCH_PATH}?q=hello+world&text_decorations=false`)
    expect(init.redirect).toBe('error')
    expect((init.headers as Record<string, string>)['x-subscription-token']).toBe('brave-key')
    expect((init.headers as Record<string, string>)['accept']).toBe('application/json')
  })

  it('lets a request maxResults win over the configured numResults and clamps to Brave bounds', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new BraveSearchProvider(() => ({ ...options, numResults: 7 }))

    await provider.search({ query: 'q' })
    expect(searchCount(fetchMock)).toBe(7)

    await provider.search({ query: 'q', maxResults: 2 })
    expect(searchCount(fetchMock)).toBe(2)

    await provider.search({ query: 'q', maxResults: 50 })
    expect(searchCount(fetchMock)).toBe(20)

    await provider.search({ query: 'q', maxResults: 0 })
    expect(searchCount(fetchMock)).toBe(1)

    await provider.search({ query: 'q', maxResults: 4.6 })
    expect(searchCount(fetchMock)).toBe(4)
  })

  it('sends no count when neither maxResults nor a configured default exists', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' })
    const url = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]![0]
    expect(url).not.toContain('count=')
  })

  it('threads country, search language, SafeSearch, and freshness into the query string', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new BraveSearchProvider(() => ({
      ...options,
      country: 'br',
      searchLang: 'pt',
      safeSearch: 'off',
      freshness: 'pw',
    })).search({ query: 'q' })
    const url = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]![0]
    expect(url).toContain('country=br')
    expect(url).toContain('search_lang=pt')
    expect(url).toContain('safesearch=off')
    expect(url).toContain('freshness=pw')
  })

  it('treats blank country and searchLang as absent rather than sending empty parameters', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new BraveSearchProvider(() => ({ ...options, country: '  ', searchLang: '' })).search({ query: 'q' })
    const url = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]![0]
    expect(url).not.toContain('country=')
    expect(url).not.toContain('search_lang=')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

/** Read the `count` parameter off the most recent captured request URL. */
function searchCount(fetchMock: ReturnType<typeof vi.fn>): number | undefined {
  const last = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).at(-1)
  if (last === undefined) return undefined
  const url = new URL(last[0])
  return url.searchParams.has('count') ? Number(url.searchParams.get('count')) : undefined
}

describe('BraveSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the Brave detail message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { code: 'SUBSCRIPTION_TOKEN_INVALID', detail: 'The provided subscription token is invalid.' } },
      { status: 422 },
    )))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_ERROR',
        message: 'The provided subscription token is invalid.',
      }))
  })

  it('falls back to the error code and then the status line when no detail carries text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'QUOTA' } }, { status: 429 })))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'QUOTA' }))

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Brave API error (HTTP 500)' }))
  })

  it('accepts a bare-string error member and keeps the status line for non-JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'rate limited' }, { status: 429 })))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'rate limited' }))

    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Brave API error (HTTP 502)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort during dispatch to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED', message: 'Brave search aborted' }))
  })

  it('maps an unparseable success body and a wrong-shape body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ web: { results: {} } }, { status: 200 })))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('BraveSearchProvider credentials', () => {
  it('resolves the key per operation when no literal is set', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    let turn = 0
    const provider = new BraveSearchProvider(() => ({
      ...withoutKey(),
      resolveApiKey: async () => turn++ === 0 ? 'first-key' : 'second-key',
    }))

    await provider.search({ query: 'q' })
    expect(headerToken(fetchMock, 0)).toBe('first-key')

    await provider.search({ query: 'q' })
    expect(headerToken(fetchMock, 1)).toBe('second-key')
  })

  it('names the credential reference in the missing-key diagnostic', async () => {
    const provider = new BraveSearchProvider(() => ({
      baseURL: options.baseURL,
      apiKeyEnv: 'BRAVE_API_KEY',
    }))
    let caught: unknown
    try {
      await provider.search({ query: 'q' })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    if (!(caught instanceof Error)) throw new Error('search did not throw an Error')
    expect(caught.message).toMatch(/BRAVE_API_KEY/)
  })

  it('wraps resolver failures as WEB_PROVIDER_ERROR, not cancellation', async () => {
    const provider = new BraveSearchProvider(() => ({
      ...withoutKey(),
      resolveApiKey: () => Promise.reject(new Error('store offline')),
    }))
    let caught: unknown
    try {
      await provider.search({ query: 'q' })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    if (!(caught instanceof Error)) throw new Error('search did not throw an Error')
    expect(caught.message).toMatch(/credential resolution failed/)
  })

  it('does not start resolution or dispatch for a pre-aborted call', async () => {
    const resolveApiKey = vi.fn(async () => 'late-key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    const provider = new BraveSearchProvider(() => ({ ...withoutKey(), resolveApiKey }))

    await expect(provider.search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts while an uncooperative credential resolver remains pending', async () => {
    const resolveApiKey = vi.fn(() => new Promise<string>(() => {}))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const provider = new BraveSearchProvider(() => ({ ...withoutKey(), resolveApiKey }))

    const pending = provider.search({ query: 'q' }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps observing a resolver that rejects only after the caller aborted', async () => {
    let rejectResolver: (error: Error) => void = () => {}
    const resolveApiKey = vi.fn(() => new Promise<string>((_resolve, reject) => { rejectResolver = reject }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const provider = new BraveSearchProvider(() => ({ ...withoutKey(), resolveApiKey }))

    const pending = provider.search({ query: 'q' }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    // The late rejection is still observed through the attached handler, so it
    // cannot surface as an unhandled rejection after the search already failed.
    rejectResolver(new Error('late store failure'))
    // Give the attached settlement handler its microtask before the worker
    // finishes so the rejection cannot race process teardown.
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps observing a resolver that fulfills only after the caller aborted', async () => {
    let resolveResolver: (value: string) => void = () => {}
    const resolveApiKey = vi.fn(() => new Promise<string>((resolve) => { resolveResolver = resolve }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const provider = new BraveSearchProvider(() => ({ ...withoutKey(), resolveApiKey }))

    const pending = provider.search({ query: 'q' }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    // The late fulfillment is still observed through the attached handler, so
    // the settled search cannot be revived by a straggler credential store.
    resolveResolver('late-key')
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves one search from one section even when settings land during credential resolution', async () => {
    const before = { baseURL: 'https://before.test', country: 'us' }
    const after = { baseURL: 'https://after.test', country: 'jp' }
    let current = before
    let commitSettings = () => {}
    const resolveApiKey = () => new Promise<string>((resolve) => {
      commitSettings = () => { current = after; resolve('key-from-before') }
    })
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new BraveSearchProvider(() => ({ ...current, resolveApiKey }))
    const search = provider.search({ query: 'q' })
    await vi.waitFor(() => { expect(typeof commitSettings).toBe('function') })
    commitSettings()
    await search

    // The key resolved from `before` must never travel to `after`'s origin.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://before.test')
    expect((init.headers as Record<string, string>)['x-subscription-token']).toBe('key-from-before')
    expect(url).toContain('country=us')
  })
})

function headerToken(fetchMock: ReturnType<typeof vi.fn>, call: number): string | undefined {
  const [, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit]
  return (init.headers as Record<string, string>)['x-subscription-token']
}

describe('BraveSearchProvider cancellation and credential edge cases', () => {
  it('maps an AbortError from the resolver without a caller signal to WEB_ABORTED', async () => {
    const provider = new BraveSearchProvider(() => ({
      ...withoutKey(),
      resolveApiKey: () => Promise.reject(new DOMException('store aborted', 'AbortError')),
    }))
    await expect(provider.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED', message: 'Brave search aborted' }))
  })

  it('treats an empty resolved key as missing and names the reference', async () => {
    const provider = new BraveSearchProvider(() => ({
      baseURL: options.baseURL,
      resolveApiKey: async () => '',
    }))
    let caught: unknown
    try {
      await provider.search({ query: 'q' })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    if (!(caught instanceof Error)) throw new Error('search did not throw an Error')
    expect(caught.message).toMatch(/BRAVE_API_KEY/)
  })

  it('prefers a plain error message when Brave sends neither code nor detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'plain failure' } }, { status: 500 })))
    let caught: unknown
    try {
      await new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    if (!(caught instanceof Error)) throw new Error('search did not throw an Error')
    expect(caught.message).toMatch(/plain failure/)
  })

  it('surfaces an abort signaled during a slow error-body read as WEB_ABORTED', async () => {
    const controller = new AbortController()
    const body: { ok: boolean; status: number; json: () => Promise<never> } = {
      ok: false,
      status: 500,
      json: () => new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => { reject(new TypeError('interrupted')) }, { once: true })
      }),
    }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    const pending = new BraveSearchProvider(() => ({ ...options })).search({ query: 'q' }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

})

describe('web-search-brave plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ web: { results: [] } })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
    const fiber = await ctx.plugin(bravePlugin, { apiKey: 'brave-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in bravePlugin).toBe(false)
  })

  it('threads config filters into the request and serves the public default base URL', async () => {
    const prev = process.env.BRAVE_API_KEY
    process.env.BRAVE_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [{ url: 'https://a.test', description: 'd' }] } }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      const fiber = await ctx.plugin(bravePlugin, { numResults: 9, country: 'br', searchLang: 'pt', safeSearch: 'strict', freshness: 'pm' })
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toContain('https://api.search.brave.com/res/v1/web/search')
      expect(url).toContain('count=9')
      expect(url).toContain('country=br')
      expect(url).toContain('search_lang=pt')
      expect(url).toContain('safesearch=strict')
      expect(url).toContain('freshness=pm')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.BRAVE_API_KEY
      else process.env.BRAVE_API_KEY = prev
    }
  })

  it('fails the search with the missing-credential code when neither config nor env supplies a key', async () => {
    const prev = process.env.BRAVE_API_KEY
    delete process.env.BRAVE_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      await ctx.plugin(bravePlugin, {})
      // A resolver is present even without a key, so availability holds and
      // the credential surface fails per operation (the deepseek contract).
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    } finally {
      if (prev !== undefined) process.env.BRAVE_API_KEY = prev
    }
  })

  it('resolves the stored key per search so rotating it needs no restart', async () => {
    const previous = process.env.BRAVE_API_KEY
    delete process.env.BRAVE_API_KEY
    const dir = await mkdtemp(join(tmpdir(), 'dsh-web-search-brave-credentials-'))
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(bravePlugin, {})

      await expect(ctx.web.search({ query: 'missing' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))

      const ref = credentialRef('BRAVE_API_KEY')
      await ctx.credentials.set(ref, 'stored-key')
      await ctx.web.search({ query: 'stored' })
      await ctx.credentials.set(ref, 'rotated-key')
      await ctx.web.search({ query: 'rotated' })

      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
      expect(calls.map(([, init]) => (init.headers as Record<string, string>)['x-subscription-token']))
        .toEqual(['stored-key', 'rotated-key'])
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.BRAVE_API_KEY
      else process.env.BRAVE_API_KEY = previous
    }
  })

  it('falls through an empty literal key to resolution and sends no blank region filters', async () => {
    const prev = process.env.BRAVE_API_KEY
    process.env.BRAVE_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      const fiber = await ctx.plugin(bravePlugin, { apiKey: '', country: '', searchLang: '' })
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toContain('https://api.search.brave.com')
      expect(url).not.toContain('country=')
      expect(url).not.toContain('search_lang=')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.BRAVE_API_KEY
      else process.env.BRAVE_API_KEY = prev
    }
  })
})
