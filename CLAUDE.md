# Markdown Reader — Claude Code Instructions

## Project

Markdown Reader is a local-first Markdown reading browser extension for developers, students, researchers, technical writers, knowledge-base maintainers, and people who read local files. It renders documents in the browser without a backend or document upload.

The application uses WXT, React 19, strict TypeScript, Vite, npm, and Manifest V3. Chromium browsers (Chrome, Edge, Vivaldi) are the primary target; Firefox is also built. Read [PRODUCT.md](PRODUCT.md) for product requirements and [ARCHITECTURE.md](ARCHITECTURE.md) before structural changes.

Current capabilities include CommonMark/GFM and extended Markdown, local math and diagrams, syntax highlighting, local files and folders, optional per-origin remote Markdown, user-invoked page capture, navigation and search, themes, source views, bookmarks, reading controls, print/PDF, settings, and a popup. See [README.md](README.md) for the feature list and limitations.

## Architecture and repository map

- `entrypoints/` — WXT reader, popup, settings/options pages, and background service worker.
- `src/core/` — browser-independent document classification, Markdown rendering, settings validation, and their unit tests.
- `src/shared/` — browser storage adapter and metadata types.
- `src/ui/` — React applications, theme tokens, and responsive component styles.
- `public/` — static extension assets and the automatic-render content script.
- `e2e/` — Playwright browser-page preview tests; extension APIs are mocked.
- `design-system/` — approved visual direction and tokens. Preserve `design-system/fieldnote-markdown-reader/MASTER.md`.
- `.agents/skills/` — canonical installed engineering skill sources for Codex.
- `.claude/skills/` — complete project-level mirrors Claude Code discovers; see `.agents/skills/skills-manifest.md` before changing either copy.
- `docs/development/` — concise dated records for significant decisions, progress, architecture changes, and open issues.

The reader, popup, and options are separate extension entrypoints. Browser-independent parsing and policy live in `src/core/`; browser storage access is isolated in `src/shared/`. The background worker registers the user-enabled site renderer. The manifest is generated from `wxt.config.ts` for Chromium and Firefox.

## Development commands

Use Node.js 22 or newer and npm. `npm ci` installs the exact lockfile dependency set.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install dependencies from `package-lock.json`. |
| `npm run dev` | Start the WXT Chromium development build. |
| `npm run dev:firefox` | Start the WXT Firefox development build. |
| `npm run typecheck` | Run strict TypeScript checks without emitting files. |
| `npm test` | Run the Vitest unit suite. |
| `npm run test:e2e` | Build the Chrome bundle, then run Playwright against its local preview with mocked extension APIs. This is not a native extension installation test. |
| `npm run build` | Build the production Chromium extension under `.output/chrome-mv3/`. |
| `npm run build:firefox` | Build the production Firefox extension under `.output/firefox-mv3/`. |
| `npm run zip` | Build and package the Chromium extension under `.output/`. |
| `npm run zip:firefox` | Build and package the Firefox extension under `.output/`. |

Do not commit `.output/`, `node_modules/`, Playwright reports/results, or other generated build artifacts.

## Engineering rules

- Preserve the existing architecture unless a concrete architectural problem justifies a change. Read the current implementation before replacing or abstracting it.
- Use strict TypeScript and the existing naming, component, and error-handling patterns. Avoid `any`, unnecessary dependencies, and unnecessary abstraction.
- Use test-driven development for meaningful behavior changes and add regression coverage for meaningful bug fixes. Do not add tests for trivial or generated configuration.
- Keep Chromium and Firefox compatibility in view. Verify actual browser behavior when a suitable browser is available; clearly distinguish Playwright page-preview coverage from extension runtime coverage.
- Never claim a check passed unless it was run. Report environmental limits and relevant warnings.
- Do not silently remove existing functionality or include unrelated changes in a requested feature.
- For security-sensitive changes, read `SECURITY.md` first and update it when behavior, data handling, or permissions change.

## Security and privacy invariants

These are product requirements, not optional implementation preferences:

- No backend, analytics, telemetry, accounts/authentication, remote AI services, advertising, or cloud synchronization.
- Process documents locally. Never execute document-provided JavaScript, JSX, or MDX; keep raw HTML disabled.
- Sanitize generated SVG and validate URL protocols.
- Keep extension permissions narrow and user-initiated. Remote images stay disabled by default.
- Do not persist document contents or local file handles by default.

Treat documents, URLs, filenames, HTML, code fences, frontmatter, images, and diagram definitions as untrusted input. Follow `SECURITY.md` for the full threat model and data boundaries.

## Design and accessibility

Use the existing visual system in `design-system/fieldnote-markdown-reader/MASTER.md`. Preserve its direction and the implemented tokens; do not introduce a new design language arbitrarily. Maintain responsive behavior, keyboard navigation, visible focus, reduced-motion support, and WCAG 2.2 AA principles. Check accessibility and actual viewport behavior for UI changes.

## Documentation priority

Resolve conflicts in this order:

1. Explicit user requirements.
2. `PRODUCT.md`.
3. `SECURITY.md` for security decisions.
4. `ARCHITECTURE.md`.
5. Existing implementation and conventions.
6. Relevant specialized skills.
7. General recommendations.

If documentation disagrees with the implementation, inspect the relevant code and tests, then record and explain the discrepancy instead of blindly following either source.

## Skills and continuing context

Use only the skills relevant to the current task; do not load all 18 for every change. Their task-to-skill map, external-tool requirements, provenance, and mirror-maintenance procedure are in `.agents/skills/skills-manifest.md`. `CLAUDE_HANDOFF.md` records the verified project baseline and the recommended new-task startup procedure.
