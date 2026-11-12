# Architecture

Markdown Reader is a Manifest V3 extension with separate reader, popup, settings, and background entrypoints. The Markdown engine lives under `src/core` and has no React or browser-extension dependency, so document parsing and policy decisions can be tested independently from the UI.

## Runtime shape

```text
Browser action ──> Popup ──> Reader tab
                         ├─> session handoff for file/page text
                         └─> origin permission for remote Markdown

Reader ──> src/core document + Markdown modules
       ├─> lazy local Mermaid / Graphviz / KaTeX / language chunks
       └─> local storage adapter for preferences and reader metadata

Background service worker ──> sync registered auto-render content script
```

## Main areas

- `entrypoints/reader`: the full reading application.
- `entrypoints/popup`: file opening, folder handoff to the reader, URL opening, current-page capture, per-site auto-render control, recents, and quick theme selection.
- `entrypoints/options`: persistent appearance, reading, Markdown, code, diagram, file, online, privacy, shortcut, and advanced settings.
- `entrypoints/background.ts`: small service worker that registers or removes the user-selected automatic-render content script when installed, started, permissions change, or settings are updated.
- `public/auto-render.js`: checks the current URL path or content type for Markdown and redirects matching pages into the reader.
- `src/core/document.ts`: extension and MIME classification, safe link protocols, headings, frontmatter, relative paths, and search helpers.
- `src/core/markdown.ts`: Markdown-it setup, plugins, frontmatter preprocessing, highlighting, math tokens, diagram placeholders, and folder-relative URL handling.
- `src/core/settings.ts`: defaults, validation, custom theme handling, settings import/export, and CSS scoping.
- `src/shared/storage.ts`: the adapter around the browser storage APIs and metadata models.
- `src/ui`: React applications, shared theme tokens, and responsive styles.

## Document flow

The popup can create a reader tab after the user opens a file or captures the current page. The content is passed once through `browser.storage.session`; the reader consumes and removes that handoff. Folder mode stays in reader memory and keeps `File` objects and image object URLs available while navigating. A remote document is fetched directly from its HTTP(S) origin only after the user grants that origin. Redirects are followed only when the final origin is also permitted.

Documents are normalized to an internal model containing an ID, name, source, text, and kind. The core renderer parses Markdown into safe HTML plus heading and frontmatter metadata. React writes rendered output into the reader's document area. Raw HTML is disabled in Markdown-it, links are protocol-checked, generated SVG is sanitized, and user-authored JSX is not evaluated.

## Lazy rendering

The renderer first creates placeholders for Mermaid and Graphviz fences. An observer loads the matching renderer only when the placeholder is near the viewport. KaTeX and the Highlight.js core and language definitions are dynamically imported only when math or supported fenced languages are present. All code and fonts are packaged locally.

## Persistence boundaries

`browser.storage.local` stores user preferences and non-content metadata: up to 12 recent items, optional normalized scroll positions, bookmarks, and automatic-render origin preferences. Remote recents include their URL so they can be reopened. Local file paths and document source text are omitted from persistent recents. `browser.storage.session` is used only for a pending file or page handoff and is removed on consumption. Folder `File` objects and blob URLs remain in memory until the workspace changes or the reader closes.

## Manifest and permissions

The manifest is generated from `wxt.config.ts` for Chromium and Firefox. Both builds use Manifest V3. Required permissions are limited to active-tab access, scripting, local/session storage, and clipboard writes. Host access is optional and requested for a specific HTTP(S) origin at the point of use. Firefox metadata includes a stable add-on ID, minimum version, and a declaration that no user data is collected or transmitted.
