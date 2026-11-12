# Contributing

## Set up

Use Node.js 22 or newer with npm. Install the lockfile dependencies and run the checks before opening a change:

```sh
npm ci
npm run typecheck
npm test
npm run test:e2e
```

For local UI work, start `npm run dev` and load WXT's generated Chromium extension build. Use `npm run dev:firefox` to build for Firefox.

## Project conventions

- Keep parsing, format detection, URL policy, settings validation, and other browser-independent behavior in `src/core`.
- Keep extension API access in entrypoints or `src/shared/storage.ts`.
- Treat all document text, frontmatter, URLs, images, SVG, and diagram definitions as untrusted input.
- Keep remote scripts and CDNs out of the runtime. Add expensive renderers as local dynamic imports where practical.
- Preserve strict TypeScript checks. Avoid `any`; make runtime validation explicit for data crossing browser storage or document boundaries.
- Keep local document contents out of persistent storage by default. Update [SECURITY.md](SECURITY.md) if a change alters data handling or permissions.
- Add or update unit and browser-preview coverage for behavior changes. Do not describe mocked browser APIs as real extension testing.
- Keep screenshots and feature claims aligned with the actual UI.

## Claude Code and Codex

The root `CLAUDE.md` is the shared Claude Code operating guide; `CLAUDE_HANDOFF.md` records the current verified baseline. Codex skill sources remain in `.agents/skills/`, with complete Claude Code mirrors in `.claude/skills/`. Consult `.agents/skills/skills-manifest.md` before changing or updating either tree; do not reinstall or overwrite skill directories blindly, and do not regenerate `skills-lock.json` as part of ordinary development. No shared Claude settings or permission approvals are required by this repository.

Record significant decisions, architecture changes, and open engineering issues using the convention in [`docs/development/README.md`](docs/development/README.md).

## Pull request notes

Explain the user-visible behavior, security or permission impact, and browser targets. Include the exact checks run and any manual browser checks still needed. Do not commit build output from `.output/`, Playwright artifacts, or local secrets.
