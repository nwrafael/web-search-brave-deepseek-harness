/**
 * Wire types for the Brave Search API (`GET https://api.search.brave.com/res/v1/web/search`).
 * Types only — no runtime code. Brave clusters verticals under top-level keys;
 * web results live in `web.results[]`, each carrying a URL, title, plain-text
 * description (when `text_decorations=false`), and optional age fields.
 *
 * @module @deepseek-ai/dsh-web-search-brave/types
 */

/** One entry of Brave's `web.results[]`. */
export interface BraveWebResult {
  url?: string | null
  title?: string | null
  /** Result summary; carries `<b>`-style markup unless requested without decorations. */
  description?: string | null
  /** Human-readable relative age (for example `2 days ago`). */
  age?: string | null
  /** Machine-readable result date (for example `2026-02-02`). */
  page_age?: string | null
}

/** Brave's `web` result cluster. */
export interface BraveWebCluster {
  results?: BraveWebResult[]
}

/** Brave's search response envelope; unrelated verticals (`news`, `videos`, …) are ignored. */
export interface BraveSearchResponse {
  web?: BraveWebCluster
}

/** Brave's error detail object (best-effort; fields vary by failure). */
export interface BraveErrorDetail {
  code?: string
  detail?: string
  message?: string
}

/** Brave's error response envelope (`"type": "ErrorResponse"`). */
export interface BraveError {
  /** Wire reality can deliver a JSON `null` here even though docs omit it. */
  error?: string | BraveErrorDetail | null
}
