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
npm run zip            # Chromium package
npm run zip:firefox    # Firefox package
```

Browser binary: Playwright's bundled Chromium is used when `MARKDOWN_READER_CHROME_PATH` is unset. The extension-runtime project uses Playwright's `chromium` channel, which loads unpacked extensions; the preview project uses its headless shell. If the bundled browser is not installed, run `npx playwright install --with-deps chromium`. A pinned Chrome or Chromium binary can be used instead by setting `MARKDOWN_READER_CHROME_PATH` to its path. Branded Google Chrome 137 and later ignores `--load-extension`, so the runtime project needs Chromium or Chrome for Testing.

## Layers

| Layer | Where | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Unit | `src/**/*.test.ts` (85 tests, 10 files) | Document classification, the Markdown renderer and its security rules, remote loading (timeouts, size, types, origins), automatic-opening decisions, registration sync, settings validation and patching, CSS filtering, and theme handling. | Browser APIs. Services are injected or stubbed. |
| Preview | `e2e/preview/` (5 tests) | The built reader, popup, and settings pages render and behave correctly at several viewports. Includes axe scans, search, folder navigation with relative links, diagram output, and settings persistence. | Extension runtime. The `window.chrome` object is a hand-written stub, and remote fetch is intercepted. |
| Extension runtime | `e2e/runtime/` (8 tests) | The unpacked test build loads into a real persistent Chromium profile. The service worker starts; the popup, options, and reader load without console or page errors; the popup opens a picked file in the reader; Mermaid and Graphviz draw under the extension CSP; automatic opening redirects Markdown and leaves HTML alone; removing a site stops it. | Native permission prompts and the file picker dialog (see below). Firefox. Branded Chrome. |
| Packaging | `build`, `build:firefox`, `zip`, `zip:firefox`, `web-ext lint` | Both browsers build, the manifests are valid, and the packages are produced. | Runtime behavior. |

## What the extension-runtime suite does

- Loads `.output-e2e/chrome-mv3` with `--load-extension` into a fresh profile per test, then reads the service worker URL to find the extension ID.
- Starts a loopback HTTP server on a random port. It serves plain text, HTML at a `.md` address, a declared Markdown media type, and an empty file.
- Enables a site by writing the stored origin list from an extension page and sending the same runtime message the popup sends. That exercises the real background sync.
- Grants that site through the test build's `host_permissions` (`http://127.0.0.1/*`). The browser's own permission prompt cannot be answered by automation, so the grant step is replaced in this suite only.

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
- **File URL access.** Chrome's "Allow access to file URLs" toggle is not automated, and automatic opening does not cover `file://` addresses.
- **Firefox runtime.** No Firefox binary was available, so Firefox was checked only by build, packaging, and `web-ext lint`. The Firefox behavior of automatic opening, origin permissions, and storage is unverified.
- **Screen readers.** Orca and other screen readers were not run. Accessibility checks are axe scans plus keyboard and focus review.
- **Branded Chrome, Edge, and Vivaldi.** Only Chrome for Testing 153 was run.
- **Responsive matrix.** The preview suite covers mobile, tablet, desktop, and wide viewports. The 360 px width named in the product brief is not in the matrix yet.

## Manual installation checks

These need a real browser profile and are not automated:

1. Load `.output/chrome-mv3` as an unpacked extension. Open the popup and check that the file picker, folder picker, page reading, and an online URL all work.
2. Enable automatic opening on a test site from the popup. Confirm that Chrome shows the origin's permission prompt, open a `.md` page on that site, and confirm it opens in the reader. Disable it and confirm the permission is removed.
3. Turn on **Allow access to file URLs** in the extension's details page. Confirm the file picker still works and that a `file://` address is not opened by the reader.
4. Load `.output/firefox-mv3/manifest.json` through `about:debugging` and repeat the popup and automatic-opening checks.
