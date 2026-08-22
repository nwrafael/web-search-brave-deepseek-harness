# web-search-brave-deepseek-harness

Use Brave Search as the web search backend of DeepSeek Harness. Search works without a DeepSeek API key.

## What is

DeepSeek Harness ships a web search tool, but its default backend requires a DeepSeek credential. This project adds a second backend that talks to the Brave Search API instead. You paste your Brave key once in the Plugins page and search just works.

## Installation

### 1. Get a key

Create one at [brave.com/search/api](https://brave.com/search/api/). The free plan is enough to try.

### 2. Copy the plugin into your harness checkout

Clone this repository as `packages/web/web-search-brave` inside your DeepSeek Harness checkout and register it in `tsconfig.host.json` and `knip.json`. Then run `pnpm install`.

### 3. Mount the plugin

Add to `packages/bundle/base/cordis.patch.yml`:

```yaml
    - id: web-search-brave
      name: '@deepseek-ai/dsh-web-search-brave'
```

### 4. Select it

Edit `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: web
  config:
    searchProvider: brave
```

### 5. Store your key and restart

Restart the harness server, open **Plugins**, paste your key into the **Brave search** card, and save. Done.
