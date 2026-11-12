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

## Pull request notes

Explain the user-visible behavior, security or permission impact, and browser targets. Include the exact checks run and any manual browser checks still needed. Do not commit build output from `.output/`, Playwright artifacts, or local secrets.
