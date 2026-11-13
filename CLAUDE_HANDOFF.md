# Markdown Reader — Claude Code Handoff

Updated 2026-11-13. This is a compact status snapshot; `CLAUDE.md` is the primary instruction file.

## Project and implementation

Markdown Reader is a local-first Manifest V3 extension for reading Markdown from web URLs, local files/folders, or user-invoked current-page capture. The implementation uses WXT 0.21.5, React 19, strict TypeScript, Vite, and npm. Chromium is the primary target; Firefox builds are also produced.

Implemented features include CommonMark/GFM and extended Markdown, local KaTeX/Mermaid/Graphviz/highlighting, safe link and SVG handling, file/folder navigation, per-origin remote Markdown access, automatic opening for granted sites and (opt-in) local `file://` Markdown, page capture, outline/search/command palette, themes, reading controls, bookmarks, source/split views, print/PDF, preferences, and privacy controls. See `README.md`, `PRODUCT.md`, `ARCHITECTURE.md`, and `CHANGELOG.md` for detail.

## Architecture

- `entrypoints/` contains the reader, popup, options, the background worker, and `auto-render.content.ts` (the automatic-opening content script, registered at runtime).
- `src/core/` contains browser-independent document, Markdown, settings, remote-loading, and automatic-opening logic.
- `src/shared/` contains the storage adapter and the automatic-opening registration sync.
- `src/ui/` contains the React apps, shared theme code, and styles.
- `e2e/preview/` tests built pages with mocked extension APIs. `e2e/runtime/` loads the unpacked test build into a real Chromium profile.

## Verified state (2026-11-12)

Environment: Node 22.22+, npm 10.9.9 in this shell, Linux, Chrome for Testing 153 at `/opt/pw-browsers/chromium-1243`. Firefox is not installed.

| Check | Result |
| --- | --- |
| `npm ci` from a deleted `node_modules` and `.wxt` | Passed; 0 vulnerabilities. |
| `npm run typecheck` on a cold tree | Passed. |
| `npm test` | Passed: 10 files, 85 tests. |
| `npm run build` / `build:firefox` / `build:e2e` / `zip` / `zip:firefox` | Passed. Unpacked builds are 8.8 MB each. |
| `npm run test:e2e` | Passed: 13 tests (5 preview, 8 extension-runtime). |
| `web-ext lint` (Firefox build) | 0 errors, 17 warnings (see TESTING.md). |

Before this work, the baseline failed on a cold clone (`typecheck` and `test` needed `.wxt/`), and `test:e2e` could not launch its browser. Both are fixed. The earlier claim that the baseline passed everything was true only on a warm checkout.

## Local file automatic opening (2026-11-13, branch `feat/local-file-auto-open`)

Environment: Node 22.22.1, npm 9.2.0, Chrome for Testing 158 (Playwright bundled, `~/.cache/ms-playwright/chromium-1254`), Firefox 160.0 in `~/.local/opt/firefox` (official tarball, no system install).

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm test` | Passed: 11 files, 169 tests. |
| `npm run test:e2e` | Passed: 27 tests (6 preview, 21 extension-runtime, 13 of them local-file). |
| `FIREFOX_BIN=~/.local/opt/firefox/firefox npm run test:firefox` | Passed: 21 checks in Firefox 160. |
| Builds, ZIPs, `web-ext lint`, `npm audit` | Passed; lint unchanged at 0 errors and 17 warnings; 0 vulnerabilities. |

Design: user opt-in (`autoOpenLocalFiles`) plus browser file access, checked in the content script, background, and reader. `file:///*` host permission and web-accessible match. The content script hands the page text to the background (`storage.session`, token) because Firefox extension pages cannot fetch `file://`. Chromium reads the file directly. See `docs/development/2026-11-13-local-file-auto-open.md`.

## Verified fixes in the 2026-11-12 pass

- Automatic opening was broken in Chromium: a web page could not navigate to `reader.html`. Verified in Chrome for Testing 153, then fixed with a web-accessible `reader.html` (dynamic URL in Chromium).
- Automatic opening redirected HTML pages at `.md` paths. It now redirects only Markdown media types and plain text at Markdown paths.
- HTML was accepted as Markdown when the address ended in `.md`. `classifyDocument` now refuses it.
- Raw HTML in GitHub alert titles could load remote images or add styles. Titles are escaped.
- Custom CSS could load resources through `image-set()`, `src()`, `image()`, and `cross-fade()`. Rejected.
- Remote loading had no timeout and checked size after download. It now has a 20-second timeout, a streaming 8 MB byte limit, and specific error messages.
- Background registration could drop all automatic opening after one bad pattern. Registration is updated in place, and overlapping requests run in order.
- The production manifest briefly requested all-sites host permissions because of runtime-registered `matches`. Fixed: the production manifest has no `host_permissions`.
- Settings writes from the popup could overwrite options-page changes. Patches now merge.
- Reader Reload loaded the URL-field text instead of the open document.
- Reloading the reader after remote automatic opening showed a "blocked" page in Chromium. The reader's one-time `settled` replace now covers HTTP(S) launches as well as local files.

## Open items

- Local automatic opening in Firefox: files over 4 MB, and files reopened after a browser restart, need Open file. Chromium on Linux downloads `.mdx` rather than displaying it.
- A redirect to another site sends that site one request before the origin check. See SECURITY.md.
- `reader.html` is reachable from web pages by design (for automatic opening). See SECURITY.md.
- Firefox runtime is verified only for local automatic opening (`npm run test:firefox`).
- Native permission prompts and file picker dialogs are not automated.
- Accessibility items from the UX audit that were not fixed: single-key shortcuts have no off switch; the bookmark button appears only while a heading is current; command palette has no arrow-key navigation; the tab and tree roles are incomplete; Ctrl/Cmd shortcuts override browser zoom and find.
- Performance: no before/after comparison on a real browser. Large-document rendering should be measured in a browser.
- The GitHub Actions workflow has been written but not yet run.
- The Chrome DevTools MCP server is configured in `.mcp.json` but needs project-level approval in an interactive Claude Code session.

## Security constraints

Keep document processing local; do not add a backend, telemetry, accounts, remote AI, ads, or sync. Never execute JavaScript/JSX/MDX from documents. Keep raw HTML disabled, sanitize SVG, validate URL protocols, preserve narrow user-granted permissions, keep remote images off by default, and do not persist document contents or local file handles. Read `SECURITY.md` before security-sensitive changes.

## Skills and Claude Code configuration

Eighteen full skill directories are mirrored under `.claude/skills/`. The Modern Web Guidance and Chrome Extensions packs were checked against upstream commit `4dd968349e54ca45a05dd5c818fb035c9054b022` on 2026-11-12; their `.claude/` and `.agents/` copies are identical to that commit. See `.agents/skills/skills-manifest.md`. `.mcp.json` declares the project-level `chrome-devtools` MCP server. No permission bypass, hook, or global Claude configuration was added.

Anthropic's [Claude Code model configuration](https://code.claude.com/docs/en/model-config) maps the Anthropic API `haiku` alias to Haiku 5.5 and lists the model ID `claude-haiku-5-5`; Haiku 5.5 requires Claude Code 2.1.293 or later.

## Starting a new task

1. Open the repository root and read `CLAUDE.md` plus this handoff.
2. Check `git status --short --branch`; preserve any user changes already present.
3. Read the task-relevant product, architecture, security, design, and testing docs before editing.
4. Inspect existing code/tests and load only the relevant skill(s) from `.claude/skills/` (skill mapping is in the manifest).
5. For meaningful behavior work, write regression tests first, then run the relevant test/build checks. Verify browser behavior in the extension runtime suite when the change touches the service worker, permissions, or manifest.
6. Record significant decisions, architecture changes, progress, or unresolved issues using the convention in `docs/development/README.md`.

To continue with the requested model from this checkout:

```bash
# From the repository root:
claude --model claude-haiku-5-5
```

In an active Claude Code session, `/model claude-haiku-5-5` selects it.
