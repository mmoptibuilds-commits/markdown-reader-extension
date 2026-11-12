# Architecture

Markdown Reader is a Manifest V3 extension with separate reader, popup, settings, background, and automatic-opening entrypoints. The Markdown engine lives under `src/core` and has no React or browser-extension dependency, so document parsing and policy decisions can be tested independently from the UI.

## Runtime shape

```text
Browser action ──> Popup ──> Reader tab
                         ├─> session handoff for file/page text
                         └─> origin permission for remote Markdown

Web page (granted origin) ──> content-scripts/auto-render.js
                              └─> location.replace() ──> Reader tab (?url=…)

Reader ──> src/core document, remote, and Markdown modules
       ├─> lazy local Mermaid / Graphviz / KaTeX / language chunks
       └─> local storage adapter for preferences and reader metadata

Background service worker ──> src/shared/auto-render-sync ──> scripting.registerContentScripts
                                                              (one script, granted origins only)
```

## Main areas

- `entrypoints/reader`: the full reading application.
- `entrypoints/popup`: file opening, folder handoff to the reader, URL opening, current-page reading, per-site automatic opening, recents, and quick theme selection.
- `entrypoints/options`: persistent appearance, reading, Markdown, code, diagram, file, online, privacy, shortcut, and advanced settings.
- `entrypoints/background.ts`: the service worker. It keeps the automatic-opening registration in step with stored sites and browser permissions, on install, startup, permission removal, and each settings change.
- `entrypoints/auto-render.content.ts`: the automatic-opening content script. It is registered at runtime, never statically, and its `matches` list is empty on purpose (see Manifest and permissions).
- `src/core/auto-open.ts`: the pure decision of whether a loaded page is Markdown that should move to the reader, and the reader URL builder.
- `src/core/remote.ts`: the remote document loader. Timeout, byte limit, content-type checks, origin checks, and user-facing error kinds live here, with tests.
- `src/shared/auto-render-sync.ts`: converts stored origins into host patterns, checks each against browser permission, and updates the single registration. Overlapping requests are coalesced into one follow-up pass.
- `src/core/document.ts`: extension and MIME classification, safe link protocols, headings, frontmatter, relative paths, and search helpers. `classifyDocument` refuses HTML even at a `.md` address.
- `src/core/markdown.ts`: Markdown-it setup, plugins, frontmatter preprocessing, highlighting, math tokens, diagram placeholders, alert escaping, and folder-relative URL handling.
- `src/core/settings.ts`: defaults, validation, custom theme handling, settings import/export, CSS scoping, and partial updates.
- `src/shared/storage.ts`: the adapter around the browser storage APIs and metadata models.
- `src/ui`: React applications, shared theme tokens, and responsive styles.

## Document flow

The popup can create a reader tab after the user opens a file or reads the current page. The content is passed once through `browser.storage.session`; the reader consumes and removes that handoff. Folder mode stays in reader memory and keeps `File` objects and image object URLs available while navigating. A remote document is fetched directly from its HTTP(S) origin only after the user grants that origin. The fetch has a 20-second timeout and an 8 MB byte limit, and it refuses web pages. Redirects are followed by the browser; see SECURITY.md for the redirect trade-off.

Automatic opening takes the same path, starting from the page itself. The content script decides whether the top-level document is Markdown and, if it is, replaces the page with the reader URL. The reader then fetches the document as a remote document, so every limit and origin check applies to it as well.

Documents are normalized to an internal model containing an ID, name, source, text, and kind. The core renderer parses Markdown into safe HTML plus heading and frontmatter metadata. React writes rendered output into the reader's document area. Raw HTML is disabled in Markdown-it, links are protocol-checked, alert titles are escaped, generated SVG is sanitized, and user-authored JSX is not evaluated.

## Lazy rendering

The renderer first creates placeholders for Mermaid and Graphviz fences. An observer loads the matching renderer only when the placeholder is near the viewport. KaTeX and the Highlight.js core and language definitions are dynamically imported only when math or supported fenced languages are present. All code and fonts are packaged locally.

## Automatic opening registration

The registration is a single dynamic content script with id `markdown-reader-auto-render`. The background worker computes the list of origins that are both stored as enabled and still granted by the browser, then:

- registers the script if none exists,
- updates the existing registration in place when the list changes, so a rejected update leaves the previous registration active,
- unregisters it when no enabled origin remains.

Stored origins are accepted only as plain `http(s)` origins with no credentials and no path. Origins with ports are supported; the runtime suite verifies that Chromium registers and matches them.

## Persistence boundaries

`browser.storage.local` stores user preferences and non-content metadata: up to 12 recent items, optional normalized scroll positions, bookmarks, and automatic-opening origin preferences. Remote recents include their URL so they can be reopened. Local file paths and document source text are omitted from persistent recents. `browser.storage.session` is used only for a pending file or page handoff and is removed on consumption. Folder `File` objects and blob URLs remain in memory until the workspace changes or the reader closes.

Settings are changed through `updateSettings`, a read-modify-write patch. The popup uses it for theme changes, so a font change made elsewhere while the popup is open is not overwritten.

## Manifest and permissions

The manifest is generated from `wxt.config.ts` for Chromium and Firefox. Both builds use Manifest V3. Required permissions are limited to active-tab access, scripting, local/session storage, and clipboard writes. Host access is optional and requested for a specific HTTP(S) origin at the point of use. The production manifest has no `host_permissions`.

Two details are easy to get wrong:

- WXT adds the `matches` of runtime-registered content scripts to `host_permissions`. The automatic-opening entrypoint therefore declares an empty `matches`, and its real origins come from the runtime registration. Without this, every install would request all sites.
- `reader.html` is a `web_accessible_resource` so that a web page can navigate to it. Chromium adds `use_dynamic_url`; Firefox receives the plain declaration. See SECURITY.md.

The test variant (`MARKDOWN_READER_E2E=1`) builds into `.output-e2e/` and adds one test origin to `host_permissions`. It is never packaged.

Firefox metadata includes a stable add-on ID, minimum version 128, and a declaration that no user data is collected or transmitted. `data_collection_permissions` requires a newer Firefox than the declared minimum; `web-ext lint` reports that as a warning.
