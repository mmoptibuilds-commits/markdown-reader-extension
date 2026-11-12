# 2026-11-12: quality overhaul, real-extension testing, and automatic opening

## Context

A broad audit (runtime, QA, security and performance, UX and accessibility) found that the existing checks did not exercise an installed extension, and that automatic opening did not work in Chromium. The baseline also failed on a cold clone.

## Decisions

- **Automatic opening uses a web-accessible `reader.html`.** Chromium blocks a page from navigating to a non-web-accessible extension page (verified in Chrome for Testing 153). The alternative, routing through the background worker with `tabs.update`, leaves a back-button loop because each Back re-triggers the redirect. The web-accessible route is kept, with `use_dynamic_url` on Chromium. The exposure is documented in SECURITY.md.
- **The content script has an empty static `matches`.** WXT adds runtime-registered `matches` to install-time `host_permissions`, which would request all sites. The real origins are supplied at runtime.
- **Registration is updated in place, with coalesced sync passes.** A bad pattern no longer removes all registrations, and a change during a sync is never lost.
- **The E2E build is separate and uses a test-only host grant.** `MARKDOWN_READER_E2E=1` writes to `.output-e2e/` and adds `http://127.0.0.1/*`. Native prompts cannot be answered by automation, so the grant step is replaced in that build only.
- **Remote redirects keep the browser's default handling.** Manual redirect handling is not available in extension fetch, because the Location header is hidden. Blocking all redirects would also block same-site redirects. The trade-off is documented as open.
- **HTML is never Markdown.** `classifyDocument` refuses HTML media types before it looks at the extension.

## Files affected

Manifest and build: `wxt.config.ts`, `package.json`, `package-lock.json` (three unused `@testing-library` devDependencies removed, with a lock-only update), `tsconfig.json`, `.gitignore`, `.mcp.json`, `.github/workflows/ci.yml`.

Extension: `entrypoints/background.ts`, `entrypoints/auto-render.content.ts` (replaces `public/auto-render.js`), `src/shared/auto-render-sync.ts`, `src/shared/storage.ts`, `src/core/auto-open.ts`, `src/core/remote.ts`, `src/core/document.ts`, `src/core/markdown.ts`, `src/core/settings.ts`, `src/ui/ReaderApp.tsx`, `src/ui/PopupApp.tsx`, `src/ui/SettingsApp.tsx`, `src/ui/popup.css`.

Tests: `src/core/*.test.ts` (new and changed), `src/shared/auto-render-sync.test.ts`, `e2e/preview/` (moved), `e2e/runtime/` (new), `playwright.config.ts`.

Documentation: README, ARCHITECTURE, SECURITY, TESTING, CHANGELOG, CONTRIBUTING, CLAUDE.md, CLAUDE_HANDOFF, `.agents/skills/skills-manifest.md`, this record.

## Commands and results

Results are in TESTING.md. In summary: a cold `npm ci` and typecheck passed; 85 unit tests passed; both builds, the test build, and both packages succeeded; 13 browser tests passed (5 preview, 8 extension-runtime); `web-ext lint` reported 0 errors and 17 warnings.

## Open issues

- `file://` automatic opening is not implemented.
- A redirect to another site sends it one request before the origin check.
- Accessibility items from the UX audit are partly done: see CHANGELOG "Known gaps" and CLAUDE_HANDOFF.
- Firefox runtime is unverified.
- The GitHub Actions workflow has not run.
- Large-document performance has not been measured in a browser.
