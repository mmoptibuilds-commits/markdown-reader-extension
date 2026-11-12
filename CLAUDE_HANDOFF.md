# Markdown Reader — Claude Code Handoff

Prepared 2026-11-13. This is a compact status snapshot; `CLAUDE.md` is the primary instruction file.

## Project and implementation

Markdown Reader is a local-first Manifest V3 extension for reading Markdown from web URLs, local files/folders, or user-invoked current-page capture. The implementation uses WXT 0.21.5, React 19, strict TypeScript, Vite, and npm. Chromium is the primary target; Firefox builds are also produced.

Implemented features include CommonMark/GFM and extended Markdown, local KaTeX/Mermaid/Graphviz/highlighting, safe link and SVG handling, file/folder navigation, per-origin remote Markdown access, page capture, outline/search/command palette, themes, reading controls, bookmarks, source/split views, print/PDF, preferences, and privacy controls. See `README.md`, `PRODUCT.md`, `ARCHITECTURE.md`, and `CHANGELOG.md` for detail.

## Architecture

- `entrypoints/` contains the reader, popup, options, and background worker.
- `src/core/` contains browser-independent document, Markdown, and settings logic.
- `src/shared/storage.ts` wraps browser storage and metadata.
- `src/ui/` contains the React apps, shared theme code, and styles.
- `public/auto-render.js` is the opt-in site renderer; other `public/` files are static assets.
- `e2e/extension.spec.ts` tests the built UI in a local page preview with mocked extension APIs.

## Verified baseline

**Verified on 2026-11-13:** the repository was clean on branch `main` at product baseline commit `74e1681d2bad7249965287c22608777ed8fdf718`, with `origin` pointing to the private GitHub repository. This Claude Code handoff is prepared as a new commit on top of that baseline. Use `git status --short --branch` and `git log -1` for the current checkout state.

Environment used: Node `v22.22.1`, npm `9.2.0`, WXT `0.21.5`, Vite `8.3.8`, and Claude Code `2.1.322`. `npm ci` completed and reported zero vulnerabilities. It emitted repeated `npm WARN reify invalid or damaged lockfile detected` warnings, but exited successfully and did not change `package-lock.json`; investigate if those warnings recur or installation fails.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm test` | Passed: 4 files, 38 tests. |
| `npm run build` | Passed for Chromium. |
| `npm run build:firefox` | Passed for Firefox. |
| `npm run test:e2e` | Passed: 5 tests in Playwright's bundled headless Chromium. |
| `npm run zip` | Passed; Chromium ZIP was produced under ignored `.output/`. |
| `npm run zip:firefox` | Passed; Firefox ZIP and a sources ZIP were produced under ignored `.output/`. |

Both builds emit Vite's advisory that some chunks exceed 500 kB; the unpacked bundle is about 8.68 MB. The generated manifests are MV3 and request `activeTab`, `scripting`, `storage`, and `clipboardWrite`; HTTP/HTTPS host patterns are optional. Firefox declares `data_collection_permissions.required: ["none"]` and a Gecko minimum version of 128.

## Coverage limits and open concerns

- Playwright tests a local preview with mocked extension APIs and an intercepted remote fetch. It does not test the real service worker, native permission prompts, or native file/directory pickers.
- No desktop Chrome/Chromium or Firefox executable was available on `PATH`. The Playwright-bundled Chromium ran the preview tests, but neither browser's installed-extension runtime was verified. Firefox has build/package verification only.
- The `SECURITY.md` reporting section says no security contact is configured.
- `README.md` lists equation numbering and an in-reader shortcut editor as not implemented. Folder contents are session-only and limited to 2,500 files; a single-file picker cannot grant access to neighboring assets.
- The test/package runs generated `.output/` and Playwright report artifacts; they are ignored and are not part of this handoff commit. The tracked screenshot files were restored after Playwright rewrote two captures.

## Security constraints

Keep document processing local; do not add a backend, telemetry, accounts, remote AI, ads, or sync. Never execute JavaScript/JSX/MDX from documents. Keep raw HTML disabled, sanitize SVG, validate URL protocols, preserve narrow user-granted permissions, keep remote images off by default, and do not persist document contents or local file handles. Read `SECURITY.md` before security-sensitive changes.

## Skills and Claude Code configuration

Eighteen full skill directories are mirrored under `.claude/skills/`; Claude Code 2.1.322's `claude plugin validate .claude/skills` passed. `.agents/skills/` remains the Codex source of truth. See `.agents/skills/skills-manifest.md` for provenance, compatibility details, and maintenance steps. No `.claude/settings.json`, permission bypass, hook, or global Claude configuration was added.

Three pre-existing Python bytecode cache files in the Codex UI/UX skill were not duplicated into the Claude mirror; the Python source and bundled data are present. The original `.agents/` directory is unchanged, and `.gitignore` excludes new Python cache artifacts.

Anthropic's [Claude Code model configuration](https://code.claude.com/docs/en/model-config) maps the Anthropic API `haiku` alias to Haiku 5.5 and lists the model ID `claude-haiku-5-5`; Haiku 5.5 requires Claude Code 2.1.293 or later. The installed CLI is 2.1.322.

## Starting a new task

1. Open the repository root and read `CLAUDE.md` plus this handoff.
2. Check `git status --short --branch`; preserve any user changes already present.
3. Read the task-relevant product, architecture, security, design, and testing docs before editing.
4. Inspect existing code/tests and load only the relevant skill(s) from `.claude/skills/` (skill mapping is in the manifest).
5. For meaningful behavior work, write regression tests first, then run the relevant test/build checks. Verify browser behavior in a real browser when available.
6. Record significant decisions, architecture changes, progress, or unresolved issues using the convention in `docs/development/README.md`.

To continue with the requested model from this checkout:

```bash
# From the repository root:
claude --model claude-haiku-5-5
```

In an active Claude Code session, `/model claude-haiku-5-5` selects it. If cloning elsewhere, use the repository URL in `README.md`, install with `npm ci`, then run the same `claude --model` command from the cloned root.
