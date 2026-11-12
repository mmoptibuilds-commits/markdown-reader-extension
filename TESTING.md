# Testing and quality assurance

## Automated checks

Run from the repository root with Node.js 22 or newer:

```sh
npm ci
npm run typecheck
npm test
npm run test:e2e
```

- `typecheck` runs TypeScript with strict options.
- `test` runs Vitest unit tests for document classification and utilities, Markdown and sanitization, settings, and theme behavior.
- `test:e2e` first creates the production Chrome build, then runs Playwright against a local Vite preview of that bundle in bundled headless Chromium.
- The Playwright suite uses mocked extension APIs and an intercepted sample remote fetch. It covers local file rendering, controls, Mermaid and Graphviz output geometry, site permission requests, responsive overflow, axe accessibility checks, folder navigation and relative links, settings persistence, and popup actions.

The integration suite is a browser-page preview of the production bundle, not a browser extension installation test. It does not exercise the real extension service worker, browser permission UI, or native file and directory pickers. No desktop Chrome, Edge, Vivaldi, or Firefox executable was available in this environment. Firefox build output is verified, but Firefox runtime behavior is not claimed as tested.

## Visual review

Playwright captures the reader at desktop, mobile, tablet, and wide-desktop sizes, the settings page at desktop and mobile sizes, and the popup. Current captures are in [`screenshots/`](screenshots/). The reader and settings mobile views were checked for horizontal overflow. The automated axe check runs on the populated mobile reader.

To review locally, load the Chromium unpacked build and open the included fixture at `src/core/fixtures/showcase.md` or choose it from the file picker. Inspect the Markdown examples, math, Mermaid, DOT, code controls, lightbox, print preview, themes, sidebar, and both raw-source modes. Use the installation steps in [README.md](README.md).

## Browser installation checks to perform

After loading `.output/chrome-mv3` in Chrome, Edge, or Vivaldi:

1. Open the popup and try a local file, folder, current-page capture, and a remote Markdown URL. Confirm the browser grants only the requested site origin.
2. Open a folder with nested Markdown and image files, follow a relative Markdown link, and verify a relative image is displayed.
3. Enable automatic Markdown rendering on a test origin, open a `.md` page, then disable the feature and verify the permission is removed.
4. Check remote-image settings, local history clearing, settings export/import, and print-to-PDF.
5. If testing a `file://` URL, separately enable **Allow access to file URLs** in the extension details page. The file picker should work without it.

For Firefox, load the built `.output/firefox-mv3/manifest.json` temporarily through `about:debugging#/runtime/this-firefox`, then repeat the same flows. Temporary installs are removed when Firefox exits.

## Build and package verification

```sh
npm run build
npm run build:firefox
npm run zip
npm run zip:firefox
```

WXT emits unpacked extension directories and ZIP packages under `.output/`. Inspect each generated manifest and package listing after changing entrypoints, permissions, or bundled assets.

## Bundle notes

The measured unpacked Chromium and Firefox builds are about 8.68 MB each. Mermaid and Graphviz include substantial diagram engines; the largest chunks exceed Vite's 500 kB advisory threshold (the Graphviz renderer is about 1.36 MB and the Mermaid ELK engine about 1.50 MB). These are local chunks and are loaded only for diagram rendering, but they remain part of the offline package. Current builds complete successfully with this advisory warning.
