# Changelog

## Unreleased

### Added

- Automatic opening of local Markdown files (`file://`). Opt in under Settings › File handling; the browser must also grant file access (Chromium: **Allow access to file URLs**; Firefox 153+: **Access local files on your computer**). Settings shows the current state and, in Chromium browsers, links to the extension's details page. Only `.md`, `.markdown`, `.mdx`, `.mkd`, `.mkdn`, `.mdown`, and `.mdwn` files that the browser displays as text are redirected.
- `npm run test:firefox`: a real-Firefox check of local automatic opening over WebDriver BiDi, with no new dependency.

### Fixed

- Automatic opening did not work in Chromium: a web page could not navigate to `reader.html` because the page was not web-accessible. It is now declared web-accessible (with a dynamic URL in Chromium), and an end-to-end test in an installed Chrome build covers the redirect.
- Reloading the reader after a website opened it automatically showed a "blocked" page in Chromium (`ERR_BLOCKED_BY_CLIENT`). The reader now replaces its own history entry once, as it does for local files, so reload, back, and forward work.
- Automatic opening redirected any page whose path ended in `.md`, including HTML pages and rendered GitHub Markdown pages. It now redirects only Markdown media types and plain text at a Markdown path.
- A stored site with a bad or stale match pattern could remove automatic opening for every site. Registration is now updated in place, and overlapping sync requests run in order.
- Raw HTML in GitHub-style alert titles could add a remote image or a style element. Titles are now escaped.
- Custom CSS could load resources through `image-set()`, `src()`, `image()`, or `cross-fade()` without `url()`. These are rejected.
- Remote documents could hang indefinitely, were size-checked only after download and in characters, and could be HTML pages at a `.md` address. Remote loads now have a timeout, a byte limit enforced while reading, and a refusal for web pages, with a specific message for each failure.
- Remote recent-file names could throw on malformed percent-escapes.
- The popup could overwrite settings changed on the options page while it was open. Theme changes now patch only the theme.
- Clearing history and site access could leave an unhandled error. It now asks for confirmation and reports failures.
- Reload on a remote document loaded whatever was typed in the URL field instead of the open document.
- A folder of more than 2,500 files was truncated without a message.
- The popup could fail to render when a stored recent item had a malformed URL.
- Smooth scrolling ignored the reduced-motion preference.
- Settings and the reader said that `file://` addresses open directly. They do not.

### Changed

- The error banner no longer says "Could not open this document" for every failure.
- The popup's automatic-opening switch has a fixed accessible name and a 24 px target. The popup no longer has a duplicate Settings link.
- Popup labels: "Read this page" replaces "Render current page"; "Open reader" replaces "Open reader & choose folder".
- Clearing data now uses one storage key list.
- Scroll progress updates once per animation frame, and the word count is computed once per document.
- Removed the unused `@testing-library` development dependencies.

### Testing and tooling

- `npm install` now runs `wxt prepare`, so a fresh clone can typecheck.
- New Playwright `extension-runtime` project: loads the unpacked test build into a real Chromium profile and covers the service worker, popup, options, reader, automatic opening, and in-extension diagrams under the extension CSP.
- The browser-page tests moved to `e2e/preview/`. They write screenshots to `test-results/`, not the tracked `screenshots/` folder.
- A GitHub Actions workflow runs typecheck, unit tests, both builds, the Playwright suites, packaging, and a Firefox lint.
- Unit tests added for automatic-opening decisions, registration sync, remote loading, alert and CSS security, and settings patches.

### Known gaps

- In Firefox, local files over 4 MB do not open automatically.
- Firefox runtime is checked for local automatic opening only; other Firefox behavior is checked by build, packaging, and `web-ext lint`.
- Native permission prompts and the file picker dialog are not automated.
- Single-key shortcuts cannot be turned off yet.


## 1.0.0 — Initial implementation

- Built a Manifest V3 Markdown reader for Chromium browsers and Firefox using WXT, React, and strict TypeScript.
- Added local file and folder reading, drag and drop, direct remote Markdown loading with per-origin permission, and user-invoked current-page text capture.
- Added CommonMark/GFM-style plugins, frontmatter, KaTeX, Mermaid, Graphviz, lazy syntax languages, safe SVG handling, and protocol-checked links.
- Added a responsive reading workspace with outline and file navigation, search, command palette, bookmarks, optional reading-position restore, themes, raw/split source, code controls, image lightbox, fullscreen, print, and PDF support.
- Added a popup, preferences application, settings import/export, privacy controls, automated tests, screenshots, and project documentation.

This is a new implementation; it does not reuse legacy MD Reader source code.
