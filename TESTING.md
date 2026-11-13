# Testing and quality assurance

## Commands

Run from the repository root with Node.js 22 or newer:

```sh
npm ci                 # also runs `wxt prepare`, which generates .wxt/tsconfig.json
npm run typecheck      # strict TypeScript over src, entrypoints, e2e, and config
npm test               # Vitest unit tests (jsdom)
npm run test:e2e       # builds both bundles, then runs the preview and extension-runtime projects
npm run test:e2e:runtime   # only the real-extension project (builds the test bundle first)
npm run build          # production Chromium build in .output/chrome-mv3
npm run build:firefox  # production Firefox build in .output/firefox-mv3
npm run build:e2e      # test-only Chromium build in .output-e2e/chrome-mv3
npm run test:firefox   # builds the Firefox bundle, then checks local automatic opening in a real Firefox
npm run zip            # Chromium package
npm run zip:firefox    # Firefox package
```

Browser binary: Playwright's bundled Chromium is used when `MARKDOWN_READER_CHROME_PATH` is unset. The extension-runtime project uses Playwright's `chromium` channel, which loads unpacked extensions; the preview project uses its headless shell. If the bundled browser is not installed, run `npx playwright install --with-deps chromium`. A pinned Chrome or Chromium binary can be used instead by setting `MARKDOWN_READER_CHROME_PATH` to its path. Branded Google Chrome 137 and later ignores `--load-extension`, so the runtime project needs Chromium or Chrome for Testing.

Firefox: `npm run test:firefox` needs a Firefox 153 or later binary, named by `FIREFOX_BIN` (default: `firefox` on `PATH`). It was run with the official Mozilla release tarball extracted to `~/.local/opt/firefox` (no system install). It drives Firefox over WebDriver BiDi with Node's built-in WebSocket, so no package is added. It sets `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` for that Firefox process only, which lets it open extension pages in tabs and flip the real about:addons switch.

## Layers

| Layer | Where | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Unit | `src/**/*.test.ts` (169 tests, 11 files) | Document classification, the Markdown renderer and its security rules, remote loading (timeouts, size, types, origins), automatic-opening decisions for web pages and local files (extensions, unsupported types, malformed URLs, encoding, network shares, frames), the four local states, handoff validation and limits, plain-text extraction, registration sync with and without the local opt-in, settings validation and patching, CSS filtering, and theme handling. | Browser APIs. Services are injected or stubbed. |
| Preview | `e2e/preview/` (6 tests) | The built reader, popup, and settings pages render and behave correctly at several viewports. Includes axe scans, search, folder navigation with relative links, diagram output, settings persistence, and the local-file Settings states, link, and 360 px layout. | Extension runtime. The `window.chrome` object is a hand-written stub, and remote fetch is intercepted. |
| Extension runtime | `e2e/runtime/` (22 tests) | The unpacked test build loads into a real persistent Chromium profile. The service worker starts; the popup, options, and reader load without console or page errors; the popup opens a picked file in the reader; Mermaid and Graphviz draw under the extension CSP; automatic opening redirects Markdown and leaves HTML alone, and the reader survives reload, back, and forward; removing a site stops it. Local files (`local-files.spec.ts`, 13 tests): nested, Unicode, and spaced names; six extensions and uppercase; HTML, text, and images left alone; opt-in off and on; reload, back, and forward; handoff fallback and cleanup when the tab closes; a stopped service worker; the real **Allow access to file URLs** switch off and on; direct reader links refused; missing and malformed addresses; empty and hostile files without script execution or network requests; a 3 MB file. | Native permission prompts and the file picker dialog (see below). Branded Chrome. |
| Firefox runtime | `e2e/firefox/local-files.mjs` (21 checks) | The production Firefox build installed as a temporary add-on in Firefox 160: no access before the grant; opt-in without access stays put and Settings asks for permission; the real about:addons "Access local files on your computer" switch turns it on and off; nested and Unicode names; all seven extensions; HTML and text left alone; reload, back, and forward; a terminated background page; a hostile document; a 3 MB file; the 4 MB handoff message; opt-out with access still granted. | Remote automatic opening and other Firefox features. The install-time permission prompt of a signed build. |
| Packaging | `build`, `build:firefox`, `zip`, `zip:firefox`, `web-ext lint` | Both browsers build, the manifests are valid, and the packages are produced. | Runtime behavior. |

## What the extension-runtime suite does

- Loads `.output-e2e/chrome-mv3` with `--load-extension` into a fresh profile per test, then reads the service worker URL to find the extension ID.
- Starts a loopback HTTP server on a random port. It serves plain text, HTML at a `.md` address, a declared Markdown media type, and an empty file.
- Enables a site by writing the stored origin list from an extension page and sending the same runtime message the popup sends. That exercises the real background sync.
- Grants that site through the test build's `host_permissions` (`http://127.0.0.1/*`). The browser's own permission prompt cannot be answered by automation, so the grant step is replaced in this suite only.
- For local files, writes fixtures to `test-results/local-docs/` and opens them by `file://` URL. Unpacked extensions loaded with `--load-extension` start with file access on. The file-access test turns developer mode on in the test profile, then clicks the real switch on `chrome://extensions` (Chromium disables a reloaded unpacked extension without developer mode).

The suite has been run in headless Chrome for Testing 153 on this machine. The GitHub Actions workflow in `.github/workflows/ci.yml` runs the same commands on a Linux runner with Playwright's bundled Chromium, but it has not run yet. Desktop Chrome on macOS or Windows has not been tested.

## Verified results

Recorded on 2026-11-12 on Linux with Node 22, Chrome for Testing 153 at `/opt/pw-browsers/chromium-1243`.

| Check | Result |
| --- | --- |
| `npm ci` from a deleted `node_modules` and `.wxt` | Passed; 0 vulnerabilities. |
| `npm run typecheck` on a cold tree | Passed. |
| `npm test` | Passed: 10 files, 85 tests. |
| `npm run build` / `build:firefox` / `build:e2e` | Passed. Each unpacked Chromium or Firefox build is 8.8 MB. |
| `npm run zip` / `zip:firefox` | Passed. |
| `npm run test:e2e` | Passed: 13 tests (5 preview, 8 extension-runtime). |
| `web-ext lint` on the Firefox build | 0 errors, 17 warnings. Warnings: `data_collection_permissions` needs a newer Firefox than the declared minimum (2); third-party `innerHTML` assignments in Mermaid and d3 chunks (12); `new Function` in a graphlib chunk (3). The Mermaid rendering test passes under the Chromium extension CSP. |
| `npm audit` | 0 vulnerabilities, production and full tree. |

Before this work, the baseline did not pass on a cold clone: `typecheck` and `test` failed until `.wxt/` existed, and `test:e2e` could not launch its browser in this environment. Both are fixed.

## Automatic opening: before and after

The baseline script redirected to `chrome-extension://…/reader.html` without declaring that page web-accessible. In Chrome for Testing 153, that navigation is blocked (`ERR_BLOCKED_BY_CLIENT`), so automatic opening did not work. A throwaway experiment against the baseline build showed the block; the runtime suite covers the fixed behavior.

## Local file automatic opening (2026-11-13)

Environment: Linux (Ubuntu 26.04), Node 22.22.1, npm 9.2.0, Chrome for Testing 158.0.8127.18 (Playwright 1.65 bundled), Firefox 160.0 (official release tarball).

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm test` | Passed: 11 files, 169 tests. |
| `npm run test:e2e` | Passed: 27 tests (6 preview, 21 extension-runtime). |
| `npm run test:firefox` | Passed: 21 of 21 checks in Firefox 160.0. A 3 MB file was shown about 2 s after navigation. |
| `npm run build` / `build:firefox` / `zip` / `zip:firefox` | Passed. Unpacked builds are 8.9 MB each. |
| `web-ext@10.8.0 lint` (Firefox build) | 0 errors, 17 warnings, the same codes and counts as before this change. |
| `npm audit` | 0 vulnerabilities. |

Browser findings, verified by experiment:

- Chromium injects a dynamically registered `file:///*` content script only when the manifest holds the `file:///*` host permission and file access is on. The permission has no install warning.
- Chromium extension pages can `fetch()` a `file://` URL once file access is on. Firefox 160 refuses it (`NetworkError`), which is why the content script hands the text over.
- Firefox 160 grants `file:///*` from `host_permissions` at install, but injects only after "Access local files on your computer" is on.
- With `use_dynamic_url`, Chromium blocks reloading a reader entry created by a redirect from a page. The reader replaces its own entry once, after which reload, back, and forward work. Remote automatic opening uses the same replace.
- On this Linux machine, Chromium downloads `.mdx` instead of displaying it, so it never reaches the reader. Firefox displays all seven extensions. Zero-byte files render with an empty body rather than an empty `pre`.

## Performance

Measured with `renderMarkdown` under Vitest's jsdom environment, which runs DOMPurify in a DOM emulation and is slower than a browser. These are scaling checks, not browser timings:

| Source size (combined constructs) | Time |
| --- | --- |
| 1 KB | 154 ms |
| 5 KB | 173 ms |
| 16 KB | 300 ms |
| 41 KB | 654 ms |
| 81 KB | 1.5 s |
| 162 KB | 2.4 s |

Growth is close to linear over this range. In one run, a single jsdom worker that rendered several large documents in sequence aborted when its heap ran out. That was not reproduced in isolation, so treat it as an open question and measure large documents in a browser before relying on any number here. No before-and-after comparison of the render path was run. The changes that touch the reader's per-scroll work are a frame-throttled scroll handler and a memoized word count. Neither was profiled.

The unpacked Chromium bundle is 8.8 MB, the same as the baseline. Mermaid, d3, and graphviz remain the largest chunks, and the build still emits Vite's chunk-size advisory.

## Not yet verified

- **Native permission prompts.** The browser's prompt for an optional host permission, and its revocation in `chrome://extensions`, are not automated. The runtime suite replaces the grant step in its test build only.
- **Firefox local-file grant outside about:addons.** The runtime check flips the real about:addons switch. A signed, store-installed build and Firefox versions before 153 were not tested.
- **Edge, Vivaldi, and macOS or Windows.** The **Open extension settings** button opens `chrome://extensions/?id=…`; the runtime suite checks it only in Chrome for Testing on Linux.
- **Firefox runtime.** Local automatic opening is verified in Firefox 160. Remote automatic opening, origin permissions, and other features are still checked only by build, packaging, and `web-ext lint`.
- **Screen readers.** Orca and other screen readers were not run. Accessibility checks are axe scans plus keyboard and focus review.
- **Branded Chrome, Edge, and Vivaldi.** Only Chrome for Testing 153 was run.
- **Responsive matrix.** The preview suite covers mobile, tablet, desktop, and wide viewports. The 360 px width named in the product brief is not in the matrix yet.

## Manual installation checks

These need a real browser profile and are not automated:

1. Load `.output/chrome-mv3` as an unpacked extension. Open the popup and check that the file picker, folder picker, page reading, and an online URL all work.
2. Enable automatic opening on a test site from the popup. Confirm that Chrome shows the origin's permission prompt, open a `.md` page on that site, and confirm it opens in the reader. Disable it and confirm the permission is removed.
3. Local files, Chromium: in Settings › File handling, turn on **Automatically open local Markdown files**. Confirm the status says it is waiting for browser permission, use **Open extension settings**, and turn on **Allow access to file URLs**. Open a local `.md` file by dragging it onto the tab bar and confirm it opens in the reader; reload, go back, and go forward. Turn the browser switch off and confirm the file stays as plain text.
4. Load `.output/firefox-mv3/manifest.json` through `about:debugging` and repeat the popup and automatic-opening checks. For local files, turn on the Settings switch, then in about:addons › Markdown Reader › **Permissions and data** turn on **Access local files on your computer**, and open a local `.md` file.
