# Client wiring snapshots

The harness update to `dsh-0.1.1-rc.2` rewrote the composition seams this
integration touches, so the in-tree copies here are versioned against that
release:

- `settings-card/` — the two files a deployment copies into
  `packages/client/ui-settings-plugins/src/client/`.
- `client-wiring/index.ts` and `client-wiring/locales.ts` — full snapshots of
  the wired `ui-settings-plugins` client entry and dictionary after the three
  brave edits (imports + controller instance + shared credential
  invalidation handler; the 18-key locale union plus en/zh copy blocks).

Registration surfaces outside these files: `knip.json` workspace entry,
`tsconfig.host.json` path reference, `packages/bundle/base/cordis.patch.yml`
row, `packages/bundle/base/package.json` dependency, and the README/doc
touch points listed in the root README.
