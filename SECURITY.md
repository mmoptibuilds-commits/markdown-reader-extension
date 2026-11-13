# Security and privacy

## Threat model

Markdown documents, URLs, frontmatter, code fences, remote servers, linked images, and diagram syntax are untrusted input. The extension aims to display the content as data without granting it execution in the extension page or access to unrelated browsing activity.

The extension has no backend, account, telemetry, analytics, advertising, remote AI call, or cloud synchronization. Rendering libraries and fonts are bundled. Network requests occur only when the user opens a remote Markdown URL, enables automatic opening for a site, or opts into remote images. Local automatic opening makes no network request.

## Rendering safeguards

- Markdown-it runs with raw HTML disabled. `.mdx` is parsed as Markdown-compatible text; JSX and JavaScript imports are not evaluated.
- Links are validated against HTTP, HTTPS, mailto, and tel protocols. Unsupported schemes such as `javascript:` are rejected.
- GitHub-style alert titles are escaped before rendering. The alerts plugin writes its title text without escaping, so raw HTML in a title could otherwise add an image (a remote request that bypasses the remote-image setting) or a style element.
- Frontmatter is parsed as YAML data with alias and size limits, then dangerous object keys are removed.
- Mermaid is configured with strict security and plain labels. Graphviz and Mermaid SVG output is sanitized, including external references and CSS resource loads.
- KaTeX runs with `trust: false` and renders locally. Invalid math and diagram syntax fall back to readable text or a local error message.
- Highlighted code is escaped when a language is unavailable or highlighting fails.
- Custom CSS is constrained to simple rules scoped below the rendered Markdown area. Global selectors, at-rules, remote resources, and fixed overlays are rejected. Functions that load resources are rejected even without `url()`: `image()`, `image-set()`, `src()`, and `cross-fade()`, along with any function whose first argument is a quoted string.
- Document content is inserted only after the renderer's security policies have run. No document-provided scripts are executed.

## Remote content and permissions

Remote URLs must use HTTP or HTTPS and cannot contain embedded credentials. The user grants access to a single origin before the reader fetches a Markdown document or enables automatic opening there.

The fetch has these limits:

- A 20-second timeout that covers the whole download.
- An 8 MB byte limit. A declared `Content-Length` over the limit is refused before the body is read. An undeclared body is cancelled once it passes the limit.
- Responses that are web pages (`text/html`, `application/xhtml+xml`) are refused, even at a `.md` address.
- Fetches send no credentials and use `cache: no-store`.

Redirects: the reader calls `fetch` with the browser's default redirect handling. Extension fetch does not expose the redirect target, so the browser may send one request to a target site before the reader can compare origins. The reader then refuses to read the response unless that site is also granted. Treat a redirecting address as sharing your IP address and request time with the target. Blocking redirects entirely would also block same-site redirects, so it is not the current default. This is an open trade-off; see "Open items" below.

Remote images are disabled by default because requesting them can reveal the user's IP address and visit timing to the image host. Turning on remote images permits those image requests. Folder-local images use in-memory object URLs instead.

Current-page rendering is an explicit popup action using `activeTab` and `scripting`; it captures only the page title, URL, and visible text (`innerText`) and transfers the result through session storage. It does not scrape pages in the background.

## Automatic opening

Automatic opening sends a top-level Markdown document to the reader. It works as follows:

1. The user enables a site from the popup, or from Settings. The browser asks for that one origin's permission. Disabling the site removes the permission.
2. The background worker registers one content script, `content-scripts/auto-render.js`, for the granted origins only. It re-syncs on install, startup, and permission removal, and it never registers an origin the browser no longer grants.
3. The content script runs at `document_start` in the top frame only. It redirects only when the document's media type is a Markdown type, or when it is `text/plain` and the path names a Markdown extension. HTML pages, URLs with embedded credentials, and frames are never redirected.
4. The redirect uses `location.replace()`, so the original URL is not kept in history. The reader receives the original URL, including query and fragment, and fetches it again under the same permission and limits as any remote document.
5. The reader replaces its own history entry once, adding `settled=1`, because Chromium blocks reloading an entry created by a page's redirect to the dynamic web-accessible URL. The replacement keeps the same address and parameters and loads nothing new.

The redirect requires `reader.html` to be web-accessible. Chromium blocks a page from navigating to an extension page that is not web-accessible. This was verified against Chrome for Testing 153: navigation to `chrome-extension://…/reader.html` was blocked with `ERR_BLOCKED_BY_CLIENT`, and after the change the same navigation opens the reader. The manifest therefore declares:

- `reader.html` as a web-accessible resource, matched to HTTP and HTTPS pages.
- Chromium only: `use_dynamic_url: true`, so the address is randomized and cannot be predicted from the extension ID. Firefox does not support that key and receives the plain resource declaration.

What this exposes: any website can open the reader page, and can ask it to load a Markdown address. The reader fetches only origins the user has granted, and it cannot return document contents to the website that opened it. Opening the reader page from a site also shows the reader UI in that tab. Removing the web-accessible declaration would break automatic opening, so the trade-off is kept and documented here.

## Local file automatic opening

Local documents are untrusted input and are rendered by the same Markdown pipeline as every other document. The feature needs two independent grants, and both are checked on every use:

1. **The user's opt-in**, `autoOpenLocalFiles` in settings, off by default.
2. **The browser's file access for the extension.** Chromium: "Allow access to file URLs" (`extension.isAllowedFileSchemeAccess()`). Firefox 153+: "Access local files on your computer" (the internal `fileSchemeAllowed` grant, reported by the same API). The `file:///*` host permission must also be held.

How it works:

1. When the opt-in is on, the background worker adds `file:///*` to the single dynamic content-script registration. It does not check file access first: the browser itself refuses to inject without it, so a later grant or revocation takes effect without a re-sync. Turning the opt-in off removes the pattern.
2. The content script re-reads the opt-in (the registration can lag a settings change). It redirects only a top-level document whose URL is a local file (no network-share host) with a Markdown extension, shown as a Markdown media type or `text/plain`, and whose body is a browser plain-text view (one `pre`, or empty). HTML, PDF, images, `.txt`, directories, and downloads are never redirected.
3. The content script sends the page's text to the background worker, which accepts it only when the sender is the top frame of a tab, the sender's browser-reported URL is that same Markdown file, the opt-in is on, and the text is at most 4 MB. The worker stores it in `storage.session` under a random token and returns the token.
4. The page is replaced (`location.replace`) with `reader.html?url=<file URL>&local=<token>`. The reader replaces its own history entry once (adding `settled=1`) because Chromium blocks reloading an entry created by the web-accessible redirect.
5. The reader checks the opt-in and file access again, then reads the file with `fetch` (works in Chromium). If that fails (always in Firefox, or if the file was deleted), it uses the token's handoff copy, which must name the same file URL.

Data handling:

- Document text is held only in `storage.session`, which both browsers keep in memory. Entries are capped at six, evicted oldest first on quota errors, removed when their tab closes, and gone after a browser restart. Content scripts cannot read session storage.
- Persistent recents and bookmarks use a hash of the file URL as the document ID. The path and the text are not stored. The reader URL contains the file path, so the browser's own history records it, as it already records the `file://` address.
- The reader page is web-accessible to `file:///*` pages as well as HTTP(S) pages. A local HTML file, like a website, could open the reader and ask it for a local Markdown address. The reader loads it only when both grants are on, and the opener cannot read the result. In Chromium the address is a dynamic URL; Firefox's extension UUID is random per install.
- Relative images in a local file are not resolved: the extension page CSP does not allow `file:` images.

In Firefox before version 153, `isAllowedFileSchemeAccess()` always returns false, so local automatic opening reports "permission required" or "unavailable" and does not run.

## Required extension permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Temporary access to the current tab after the user invokes page rendering. |
| `scripting` | Read the current page's visible text after that invocation, and register the user-enabled automatic-opening content script. |
| `storage` | Store preferences and local reader metadata, including a one-time session handoff. |
| `clipboardWrite` | Copy code blocks when requested. |

`file:///*` is a required host pattern used only for local automatic opening. It produces no install warning in Chromium (checked with `management.getPermissionWarningsByManifest`), and neither browser uses it until the user grants file access in the browser's own settings.

`http://*/*` and `https://*/*` are optional host patterns only. The extension requests a specific origin through the browser permission prompt. It never requests unrestricted access in the background. The production manifest's only `host_permissions` entry is `file:///*`: declaring the automatic-opening content script's patterns as runtime-registered content scripts would have made WXT add them as install-time host permissions, so the script's `matches` is empty and the origin list is supplied at runtime.

The `web_accessible_resources` declaration for `reader.html` is described in "Automatic opening" and "Local file automatic opening" above. It does not add a permission prompt.

The extension page CSP permits local scripts and local WebAssembly for the offline Graphviz renderer. It does not permit remote scripts or runtime code downloads. The limited `unsafe-inline` style source is used for generated and inline presentation styles; it does not enable inline scripts.

Test builds: `MARKDOWN_READER_E2E=1` builds a test variant into `.output-e2e/`. It adds `http://127.0.0.1/*` to `host_permissions`, beside `file:///*`, so the runtime suite can run automatic opening without a native permission prompt. Production builds never set that variable, and the release ZIPs are produced only from `.output/`.

## Stored data and deletion

- Preferences and custom themes are kept in browser local storage.
- Recent history stores document names, type, and last-opened time. Remote recent entries also retain the URL so they can be reopened. Local file paths and captured page text are excluded.
- Reading positions are stored only when the user enables restoration.
- Bookmarks store a document identifier and heading metadata.
- Automatic-opening site grants and their origin list persist until removed.
- Selected file and current-page text is handed through session storage and removed when the reader consumes it. Folder files are not persisted.
- Local automatic-opening text stays in session storage until its tab closes or the browser restarts (see "Local file automatic opening").

The Privacy section of Settings can clear recent documents, bookmarks, reading positions, and automatic-opening sites. Resetting preferences is available separately in Advanced settings. Browser uninstall may not immediately erase data already managed by the browser profile; users can also clear extension storage through browser controls.

## Open items

These are known and not yet fixed:

- Redirect exposure: a redirect to another site sends that site one request before the origin check (see "Remote content and permissions").
- `reader.html` is reachable from web pages (see "Automatic opening").
- Custom CSS: `image-set()` and `src()` are now rejected. Other CSS escape forms have not been exhaustively tested.
- SVG output is filtered with literal patterns for `url(`. CSS escape sequences such as `u\72l(` are not decoded before that check. Browser effect not verified; treat as a hardening item.
- YAML frontmatter aliases are bounded by count and depth, but shared anchors are not memoized, so a crafted document could still cost more time than its size suggests.
- Firefox runtime behavior of the remote permission, redirect, and web-accessible paths has not been tested in Firefox. The local-file path has been (Firefox 160).

## Reporting a security issue

Do not attach private documents or credentials to an issue. Report a concise reproduction and affected browser/build privately to the project maintainer before public disclosure. This repository has no configured security contact yet.
