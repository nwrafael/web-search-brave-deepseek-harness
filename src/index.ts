/**
 * Register a Brave-backed provider in `ctx.web`. It calls Brave's Web Search
 * API (`GET /res/v1/web/search`, `X-Subscription-Token` auth). The key resolves
 * through the credentials service each search, and the plugin publishes a
 * `web-search-brave` settings section so the web Plugins page can edit every
 * value the provider serves its next search with.
 * @module @deepseek-ai/dsh-web-search-brave
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  BRAVE_DEFAULT_BASE_URL,
  BraveSearchProvider,
  BRAVE_SAFE_SEARCH_MODES,
  BRAVE_FRESHNESS_WINDOWS,
} from './provider.ts'
import type { BraveFreshness, BraveSafeSearch, BraveSearchProviderOptions } from './provider.ts'

export {
  BRAVE_DEFAULT_BASE_URL,
  BRAVE_FRESHNESS_WINDOWS,
  BRAVE_PROVIDER_ID,
  BRAVE_SAFE_SEARCH_MODES,
  BRAVE_SEARCH_PATH,
  BraveSearchProvider,
} from './provider.ts'
export type { BraveFreshness, BraveSafeSearch, BraveSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-brave'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'BRAVE_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Brave API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `BRAVE_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/res/v1/web/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. Omitted sends no count. */
  numResults?: number
  /** Two-letter country bias sent as `country`. Omitted sends none (Brave defaults to `us`). */
  country?: string
  /** Search language sent as `search_lang` (for example `pt`, `en`). Omitted sends none. */
  searchLang?: string
  /** SafeSearch mode sent as `safesearch`. Omitted sends none (Brave defaults to moderate). */
  safeSearch?: BraveSafeSearch
  /** Recency window sent as `freshness`. Omitted sends none. */
  freshness?: BraveFreshness
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  numResults: z.number().step(1).min(1),
  country: z.string(),
  searchLang: z.string(),
  safeSearch: z.union(BRAVE_SAFE_SEARCH_MODES),
  freshness: z.union(BRAVE_FRESHNESS_WINDOWS),
})

/** Settings namespace carrying this provider's endpoint, filters, and key reference. */
export const WEB_SEARCH_BRAVE_SETTINGS_NAMESPACE = settingsNamespace('web-search-brave')

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
/** Blank region values behave like absent ones rather than empty query parameters. */
function countryFilter(country: string | undefined): { country: string } | Record<string, never> {
  const value = country ?? ''
  return value.length > 0 ? { country: value } : {}
}

/** Blank language values behave like absent ones rather than empty query parameters. */
function searchLangFilter(searchLang: string | undefined): { searchLang: string } | Record<string, never> {
  const value = searchLang ?? ''
  return value.length > 0 ? { searchLang: value } : {}
}

function resolveOptions(ctx: Context, config: Config): BraveSearchProviderOptions {
  /* v8 ignore next -- the section schema defaults this reference, so the
     fallback exists for the optional pre-validation type only. */
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const rawApiKey = config.apiKey ?? ''
  const literalApiKey = rawApiKey.length > 0 ? rawApiKey : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? BRAVE_DEFAULT_BASE_URL,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
    ...countryFilter(config.country),
    ...searchLangFilter(config.searchLang),
    ...config.safeSearch !== undefined ? { safeSearch: config.safeSearch } : {},
    ...config.freshness !== undefined ? { freshness: config.freshness } : {},
  }
}

/** Register the Brave search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_BRAVE_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new BraveSearchProvider(() => resolveOptions(ctx, current())))
}
