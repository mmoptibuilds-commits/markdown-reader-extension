# 2026-11-13: automatic opening of local Markdown files

## Context

Automatic opening worked for granted websites but not for `file://` addresses: the content script passed `fileAccessAllowed: false`, the sync accepted only HTTP(S) origins, the manifest had no file host permission, `reader.html` was not web-accessible to file pages, and the reader refused `file:` URLs.

## Verified browser behavior

Throwaway experiments in Chrome for Testing 158 and Firefox 160 (scratch extensions, not committed):

- Chromium injects a dynamic `file:///*` content script only with the `file:///*` host permission and "Allow access to file URLs" on. The permission has no install warning. Unpacked extensions loaded from the command line start with file access on. Toggling it reloads the extension, and Chromium disables the reloaded unpacked extension unless developer mode is on.
- Chromium extension pages can `fetch()` `file://` URLs once file access is on. Firefox 160 refuses it (`NetworkError`).
- Firefox 160 grants `file:///*` from `host_permissions` at install but injects only after the about:addons switch "Access local files on your computer" (internal `fileSchemeAllowed`). `isAllowedFileSchemeAccess()` reports it, because `extensions.webextensions.fileSchemeAccess.requireOptIn` is true. Before Firefox 153 that API always returns false.
- Both browsers navigate from a file page to the reader once `reader.html` is web-accessible to `file:///*`.
- With Chromium's `use_dynamic_url`, reloading a reader entry created by that redirect is blocked (`ERR_BLOCKED_BY_CLIENT`). A one-time `location.replace` from the reader itself fixes reload and forward navigation. The same problem affects remote automatic opening; that is recorded, not fixed.

## Decisions

- **Two grants, checked three times.** The user's opt-in (default off) and the browser's file access. The background registers `file:///*` only on opt-in, without checking access (the browser gates injection, so grants and revocations take effect without a re-sync). The content script re-reads the opt-in; the reader re-checks both.
- **Text handoff plus direct read.** The content script sends the plain-text view's text (≤ 4 MB) to the background, which validates the sender and stores it in `storage.session` under a random token. The reader reads the file directly when it can (Chromium; fresh on reload) and falls back to the handoff (Firefox). Entries are removed when the tab closes and capped at six.
- **One permission adapter.** `src/shared/file-access.ts` is the only place that asks the browser. The four states are a pure function in `src/core/local-file.ts`.
- **No new web-accessible resources.** `reader.html` gains a `file:///*` match; nothing else is exposed.
- **Firefox runtime tests without a dependency.** `e2e/firefox/` talks WebDriver BiDi through Node's WebSocket. It flips the real about:addons switch with system access enabled for that Firefox process only.

## Files

Core: `src/core/local-file.ts` (new), `src/core/auto-open.ts`, `src/core/settings.ts`. Shared: `src/shared/file-access.ts` (new), `src/shared/auto-render-sync.ts`, `src/shared/storage.ts`. Entrypoints: `auto-render.content.ts`, `background.ts`, `reader/main.tsx`. UI: `ReaderApp.tsx`, `SettingsApp.tsx`, `settings.css`. Config: `wxt.config.ts`, `package.json`. Tests: unit tests beside each module, `e2e/preview/reader-preview.spec.ts`, `e2e/runtime/local-files.spec.ts` and fixture, `e2e/firefox/`.

## Commands and results

See TESTING.md "Local file automatic opening (2026-11-13)": 169 unit tests, 27 Playwright tests, 21 Firefox checks, both builds and ZIPs, lint unchanged, 0 audit findings.

## Open issues

- Remote automatic opening: reload of the reader shows a "blocked" page in Chromium. Resolved 2026-11-13: the `settled` replace now covers HTTP(S) launches.
- Firefox: files over 4 MB and files reopened after a browser restart need Open file.
- `.mdx` is downloaded rather than displayed by Chromium on the test machine (OS MIME database).
- Not tested: Edge, Vivaldi, branded Chrome, macOS, Windows, Firefox before 153, signed Firefox installs.
