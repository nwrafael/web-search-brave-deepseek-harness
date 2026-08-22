/**
 * `BraveSearchProvider`: a `WebSearchProvider` backed by the Brave Search API
 * (`GET /res/v1/web/search` with the `X-Subscription-Token` header). It maps
 * each `web.results[]` entry to a source — `description` becomes the snippet,
 * `page_age` (falling back to Brave's human-readable `age`) becomes
 * `publishedAt` — and omits `content` because Brave returns no generated
 * answer. HTTP redirects fail before their target is contacted.
 * @module @deepseek-ai/dsh-web-search-brave/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { BraveError, BraveSearchResponse, BraveWebResult } from './types.ts'

/** Stable id this provider registers under. */
export const BRAVE_PROVIDER_ID = 'brave'

/**
 * Default endpoint base; `/res/v1/web/search` is appended. This is NOT a chat
 * or summarizer endpoint — Brave serves those from separate subscriptions.
 */
export const BRAVE_DEFAULT_BASE_URL = 'https://api.search.brave.com'

/** Search operation path appended to {@link BRAVE_DEFAULT_BASE_URL}. */
export const BRAVE_SEARCH_PATH = '/res/v1/web/search'

/** SafeSearch modes Brave's `safesearch` parameter accepts. */
export const BRAVE_SAFE_SEARCH_MODES = ['off', 'moderate', 'strict'] as const

/** Recency windows Brave's `freshness` parameter accepts. */
export const BRAVE_FRESHNESS_WINDOWS = ['pd', 'pw', 'pm', 'py'] as const

/** A Brave SafeSearch mode. */
export type BraveSafeSearch = (typeof BRAVE_SAFE_SEARCH_MODES)[number]

/** A Brave freshness window. */
export type BraveFreshness = (typeof BRAVE_FRESHNESS_WINDOWS)[number]

/** Inclusive result-count bounds Brave's `count` parameter accepts. */
const MIN_COUNT = 1
const MAX_COUNT = 20

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface BraveSearchProviderOptions {
  /** Literal Brave API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Brave API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef | string
  /** Endpoint base; `/res/v1/web/search` is appended. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. */
  numResults?: number
  /** Two-letter country bias sent as `country`; absent sends none (Brave defaults to `us`). */
  country?: string
  /** Search language sent as `search_lang` (for example `pt`, `en`); absent sends none. */
  searchLang?: string
  /** SafeSearch mode sent as `safesearch`; absent sends none (Brave defaults to moderate). */
  safeSearch?: BraveSafeSearch
  /** Recency window sent as `freshness`; absent sends none. */
  freshness?: BraveFreshness
}

/**
 * Map one Brave web result to a normalized source, or `undefined` when it
 * carries no URL. Unlike Exa, a missing description is not a reason to drop:
 * the seam treats `snippet` as optional, so the URL and title still travel.
 *
 * @param result - one entry of Brave's `web.results[]`.
 * @returns the normalized source, or `undefined` when the entry has no usable URL.
 */
export function mapBraveResult(result: BraveWebResult): WebSearchSource | undefined {
  const url = nonBlank(result.url)
  if (url === undefined) return undefined
  const title = nonBlank(result.title)
  const snippet = nonBlank(result.description)
  const publishedAt = nonBlank(result.page_age) ?? nonBlank(result.age)
  return {
    url,
    ...title !== undefined ? { title } : {},
    ...snippet !== undefined ? { snippet } : {},
    ...publishedAt !== undefined ? { publishedAt } : {},
  }
}

/**
 * Map a Brave response envelope to a normalized search result.
 *
 * @param response - the parsed search response body.
 * @returns the normalized result; URL-less entries are dropped
 *   ({@link mapBraveResult}).
 */
export function mapBraveResponse(response: BraveSearchResponse): WebSearchResult {
  const sources = (response.web?.results ?? [])
    .map(mapBraveResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // Brave returns no generated answer on this endpoint, so `content` is omitted.
  // The web service owns the final `maxResults` truncation, so this provider
  // reports `truncated: false`.
  return { sources, truncated: false }
}

/** The Brave-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class BraveSearchProvider implements WebSearchProvider {
  readonly id = BRAVE_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between searches, and re-registering the provider to carry new values
   * would make the seam's selection observable to the user as a flicker.
   */
  constructor(private readonly resolveOptions: () => BraveSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && (options.numResults === undefined || isPositiveInteger(options.numResults))
      && (options.safeSearch === undefined || safeSearchModeSet.has(options.safeSearch))
      && (options.freshness === undefined || freshnessWindowSet.has(options.freshness))
      && isFreeTextOption(options.country)
      && isFreeTextOption(options.searchLang)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section alongside parameters named by the new one.
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    const params = new URLSearchParams({
      q: request.query,
      // Descriptions carry `<b>`-style markup unless decorations are declined;
      // the seam's snippet is plain text.
      text_decorations: 'false',
    })
    // A per-request bound wins over the configured default; either may be absent.
    const count = request.maxResults ?? options.numResults
    if (count !== undefined) params.set('count', String(clampCount(count)))
    const country = nonBlank(options.country)
    const searchLang = nonBlank(options.searchLang)
    if (country !== undefined) params.set('country', country)
    if (searchLang !== undefined) params.set('search_lang', searchLang)
    if (options.safeSearch !== undefined) params.set('safesearch', options.safeSearch)
    if (options.freshness !== undefined) params.set('freshness', options.freshness)

    let response: Response
    try {
      response = await fetch(`${options.baseURL}${BRAVE_SEARCH_PATH}?${params.toString()}`, {
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'x-subscription-token': apiKey,
          'user-agent': USER_AGENT,
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal?.reason ?? error)
      throw new WebError(`Brave search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Brave API error (HTTP ${status})`
      try {
        const parsed = await response.json() as BraveError
        const detail = errorDetail(parsed.error)
        if (detail !== undefined) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal?.reason ?? error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as BraveSearchResponse
      return mapBraveResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal?.reason ?? error)
      throw new WebError(`Brave returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the parameters it travels with come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  private async apiKey(options: BraveSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal?.reason ?? error)
      throw new WebError(
        `Brave search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    // A blank key behaves like an absent one: the diagnostic names the ref.
    const key = resolved ?? ''
    if (key.length > 0) return key
    const ref = options.apiKeyEnv ?? 'BRAVE_API_KEY'
    throw new WebError(
      `Brave search has no API key for "${ref}"; store it through the credentials service`
      + ' (the web Plugins page writes it), export it in the launching environment, or set a literal'
      + ' "apiKey" in the web-search-brave config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/**
 * Clamp a requested count into the range Brave accepts, so an oversized
 * model-facing bound costs fewer results rather than a 422 rejection; the seam
 * still enforces the unclamped bound on the way back.
 * @param count - the requested result count.
 * @returns the count clamped to Brave's inclusive `[${MIN_COUNT}, ${MAX_COUNT}]` wire range.
 */
function clampCount(count: number): number {
  return Math.min(Math.max(Math.trunc(count), MIN_COUNT), MAX_COUNT)
}

/**
 * Pick the message Brave's error envelope names, accepting both the documented
 * detail-object form and a bare-string `error`.
 * @param error - the envelope's `error` member.
 * @returns the most specific non-blank message, or `undefined` when none carries text.
 */
function errorDetail(error: BraveError['error']): string | undefined {
  if (typeof error === 'string') return nonBlank(error)
  if (error === null || typeof error !== 'object') return undefined
  return nonBlank(error.detail) ?? nonBlank(error.code) ?? nonBlank(error.message)
}

/** The trimmed value when it carries at least one non-whitespace character. */
function nonBlank(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined
}

/**
 * Accept a free-text option only when it is a sendable string: values that
 * reach the provider through the durable settings layer can carry any JSON
 * type, and a non-string cannot ride a query parameter.
 */
function isFreeTextOption(value: string | undefined): boolean {
  return value === undefined || typeof value === 'string'
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a request limit Brave can act on (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** Build the provider's stable cancellation error while retaining the abort reason. */
function searchAborted(fallback?: unknown): WebError {
  return new WebError('Brave search aborted', 'WEB_ABORTED', { cause: fallback })
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  /* v8 ignore next -- the pre-aborted rejection is covered by
     "does not start resolution or dispatch for a pre-aborted call", but v8
     block coverage cannot attribute this range's taken arm through the
     transform's segments; the pending path is attributed normally. */
  if (signal.aborted) return Promise.reject(searchAborted(signal.reason))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal.reason)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal.reason)
}

const safeSearchModeSet: ReadonlySet<string> = new Set<string>(BRAVE_SAFE_SEARCH_MODES)
const freshnessWindowSet: ReadonlySet<string> = new Set<string>(BRAVE_FRESHNESS_WINDOWS)
