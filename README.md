# web-search-brave-deepseek-harness

A Brave Search backend for the DeepSeek Harness `web_search` tool. It replaces the default DeepSeek-native search route with the Brave Search API, so deployments whose model traffic does not run through DeepSeek can still search the web.

## What is

DeepSeek Harness ships its web capability as a capability seam: a Service Definition owns the `ctx.web` service, Service Providers implement retrieval backends, and a Consumer exposes the `web_search` tool to the model. Out of the box, the only shipped search provider talks to DeepSeek's native search, which ties search availability to a DeepSeek credential.

This project is that missing second provider. It registers a `brave` provider on `ctx.web`, calls Brave's Web Search API (`GET {baseURL}/res/v1/web/search`, authenticated with the `X-Subscription-Token` header), and maps Brave's `web.results[]` cluster into the seam's normalized result shape. A settings section named `web-search-brave` publishes every configurable value so the harness Plugins page can edit it from the running product.

The key resolves per operation: literal configuration first, then the credentials domain under the configured reference (`BRAVE_API_KEY` by default), then the launch environment when no credentials service exists. Writing or rotating a key from any surface therefore serves the very next search without re-registering anything.

## Key features

- **Independent of DeepSeek credentials.** Any deployment with a Brave subscription token reaches the same model-facing `web_search` tool, schema, and result cap.
- **Per-operation credential resolution.** Keys stored through the credentials service are read on every search, so storing or rotating a key never requires a restart.
- **Plugins page card.** The published settings section drives a client card with a secret key field plus base URL, result count, region (`country`), search language, SafeSearch mode, and freshness window.
- **Faithful wire mapping.** Descriptions become snippets (requested with `text_decorations=false` so markup never travels), `page_age` falls back to Brave's relative `age` for `publishedAt`, and URL-less entries are dropped.
- **Bounds enforced locally.** Request counts are clamped to Brave's inclusive `[1, 20]` wire bound before dispatch; invalid enum values make the provider report unavailable instead of dispatching a request Brave would answer with 422.
- **Cancellation-safe.** Caller aborts surface as the seam's stable cancellation error at every stage, including while a slow credential store is still pending; late resolver settlements stay observed so they cannot become unhandled rejections.
- **Redirect rejection.** Credential-bearing requests set `redirect: 'error'`, following the harness rule that prevents automatic forwarding of credentials to another origin.

## Installation

### 1. Get a Brave Search API key

Create a subscription at [brave.com/search/api](https://brave.com/search/api/) and copy the API key. The free plan is sufficient for trying the provider out.

### 2. Add the package to the harness workspace

Copy this repository into `packages/web/web-search-brave` inside your DeepSeek Harness checkout:

```sh
git clone https://github.com/<your-account>/web-search-brave-deepseek-harness.git \
  <harness-checkout>/packages/web/web-search-brave
```

Then register it in the workspace aggregates:

- Add `{ "path": "./packages/web/web-search-brave" }` to `tsconfig.host.json`.
- Add `"packages/web/web-search-brave"` to `knip.json`.

Run `pnpm install` so the workspace links the new package's peers (`cordis`, schemastery, and the `dsh-web`, `dsh-settings`, `dsh-credentials`, `dsh-launch-environment`, and `dsh-invariants` packages).

### 3. Mount the plugin

Insert a row into the base bundle patch (`packages/bundle/base/cordis.patch.yml`), next to the other search providers:

```yaml
    - id: web-search-brave
      name: '@deepseek-ai/dsh-web-search-brave'
```

and add the workspace dependency to `packages/bundle/base/package.json`:

```json
"@deepseek-ai/dsh-web-search-brave": "workspace:^"
```

### 4. Select it

Pin the selection in your profile overlay (`~/.dsh/profiles/<profile>/cordis.patch.yml`):

```yaml
- id: web
  config:
    searchProvider: brave
```

### 5. Store the key and restart

Restart the harness server, open the web GUI, go to **Plugins**, and paste the key into the **Brave search** card. The key is stored in the credentials domain (`$DSH_HOME/.credentials.yaml`) and picked up by the next search.

As an alternative for headless setups, export `BRAVE_API_KEY` in the launch environment before starting the server; the provider reads it when no literal key is configured.

## Source layout

```
src/
  index.ts      Plugin entry: Config schema, settings section, provider registration
  provider.ts   BraveSearchProvider: request mapping, error/abort handling, credential resolution
  types.ts      Wire types for Brave's JSON responses (types only)
  invariant.ts  Package-owned invariant companion
tests/
  brave.spec.ts     Request mapping, availability, errors, credentials, plugin registration
  settings.spec.ts  Settings-section lifecycle against a memory settings service
  brave.e2e.ts      Live-API test; self-skips without BRAVE_API_KEY
integrations/
  settings-card/    Client files that render the Plugins page card upstream
```
