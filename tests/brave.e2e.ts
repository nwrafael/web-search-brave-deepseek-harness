import { describe, expect, it } from 'vitest'
import {
  BraveSearchProvider,
  BRAVE_DEFAULT_BASE_URL,
} from '@deepseek-ai/dsh-web-search-brave'

/**
 * Real-API smoke for the Brave search provider. Self-skips without `$BRAVE_API_KEY`
 * (CI has no secrets), per the with-key e2e policy in docs/testing.md.
 */
const apiKey = process.env.BRAVE_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('BraveSearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new BraveSearchProvider(() => ({
      apiKey: apiKey!,
      baseURL: BRAVE_DEFAULT_BASE_URL,
      numResults: 5,
    }))
    const result = await provider.search({ query: 'DeepSeek Harness' })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
