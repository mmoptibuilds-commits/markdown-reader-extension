# Security and privacy

## Threat model

Markdown documents, URLs, frontmatter, code fences, remote servers, linked images, and diagram syntax are untrusted input. The extension aims to display the content as data without granting it execution in the extension page or access to unrelated browsing activity.

The extension has no backend, account, telemetry, analytics, advertising, remote AI call, or cloud synchronization. Rendering libraries and fonts are bundled. Network requests occur only when the user opens a remote Markdown URL, enables automatic rendering for a site, or opts into remote images.

## Rendering safeguards

- Markdown-it runs with raw HTML disabled. `.mdx` is parsed as Markdown-compatible text; JSX and JavaScript imports are not evaluated.
- Links are validated against HTTP, HTTPS, mailto, and tel protocols. Unsupported schemes such as `javascript:` are rejected.
- Frontmatter is parsed as YAML data with alias and size limits, then dangerous object keys are removed.
- Mermaid is configured with strict security and plain labels. Graphviz and Mermaid SVG output is sanitized, including external references and CSS resource loads.
- KaTeX runs with `trust: false` and renders locally. Invalid math and diagram syntax fall back to readable text or a local error message.
- Highlighted code is escaped when a language is unavailable or highlighting fails.
- Custom CSS is constrained to simple rules scoped below the rendered Markdown area. Global selectors, at-rules, remote resources, and fixed overlays are rejected.
- Document content is inserted only after the renderer's security policies have run. No document-provided scripts are executed.

## Remote content and permissions

Remote URLs must use HTTP or HTTPS and cannot contain embedded credentials. The user grants access to a single origin before the reader fetches a Markdown document or enables automatic rendering there. Redirects to another origin are stopped until that destination is separately permitted. Fetches omit credentials and disable the browser cache. A failed or unsupported response is reported in the reader.

Remote images are disabled by default because requesting them can reveal the user's IP address and visit timing to the image host. Turning on remote images permits those image requests. Folder-local images use in-memory object URLs instead.

Current-page rendering is an explicit popup action using `activeTab` and `scripting`; it captures only the page title, URL, and visible text (`innerText`) and transfers the result through session storage. It does not scrape pages in the background.

Required extension permissions:

| Permission | Purpose |
| --- | --- |
| `activeTab` | Temporary access to the current tab after the user invokes page rendering. |
| `scripting` | Read the current page's visible text after that invocation and register the user-enabled renderer. |
| `storage` | Store preferences and local reader metadata, including a one-time session handoff. |
| `clipboardWrite` | Copy code blocks when requested. |

`http://*/*` and `https://*/*` are optional host patterns only. The extension requests a specific origin through the browser permission prompt. It never requests unrestricted access in the background.

The extension page CSP permits local scripts and local WebAssembly for the offline Graphviz renderer. It does not permit remote scripts or runtime code downloads. The limited `unsafe-inline` style source is used for generated and inline presentation styles; it does not enable inline scripts.

## Stored data and deletion

- Preferences and custom themes are kept in browser local storage.
- Recent history stores document names, type, and last-opened time. Remote recent entries also retain the URL so they can be reopened. Local file paths and captured page text are excluded.
- Reading positions are stored only when the user enables restoration.
- Bookmarks store a document identifier and heading metadata.
- Automatic-render site grants and their origin list persist until removed.
- Selected file and current-page text is handed through session storage and removed when the reader consumes it. Folder files are not persisted.

The Privacy section can clear recents, bookmarks, positions, and site grants. Resetting preferences is available separately in Advanced settings. Browser uninstall may not immediately erase data already managed by the browser profile; users can also clear extension storage through browser controls.

## Reporting a security issue

Do not attach private documents or credentials to an issue. Report a concise reproduction and affected browser/build privately to the project maintainer before public disclosure. This repository has no configured security contact yet.
