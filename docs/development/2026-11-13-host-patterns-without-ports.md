# 2026-11-13: host permission patterns never include a port

## Context

Site access was requested, checked, and removed with `${origin}/*`. Firefox reports a pattern that names a port as not granted even when its host is, so loopback and other non-default-port origins looked ungranted.

## Decision

`hostPattern()` in `src/core/origins.ts` (new, unit-tested) returns `protocol//hostname/*`. Browsers match host patterns on any port, so this is the single pattern used by the popup, reader, settings, `useDocumentSource`, and `originToMatchPattern`. Stored origins are unchanged.

## Tests

- Unit: `src/core/origins.test.ts`.
- Firefox runtime: `e2e/firefox/surfaces.mjs` (new; popup, settings, themes, diagrams, remote documents) and `e2e/firefox/harness.mjs` (shared reporter and loopback server). `npm run test:firefox` now builds the Firefox test bundle and runs both scripts.

## Verified 2026-11-13

`npm run typecheck`, `npm test` (282 passed), `npm run build`, `npm run test:e2e` (35 passed). The Firefox runner was not run: no Firefox on this machine.

## Open

Granting a host now covers every port on it. Record this in SECURITY.md if the site-access wording should say so.
