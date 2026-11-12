# Engineering Skill Stack Manifest

Prepared 2026-11-12 for the upcoming Markdown Reader project. Skills were installed with `skills@1.8.1` using Codex as the target. The CLI copied them into this repository’s `.agents/skills/` directory and recorded local content hashes in [`skills-lock.json`](../../skills-lock.json). GitHub commit IDs and star counts below were checked on 2026-11-12; each installed `SKILL.md` was byte-compared against its listed source commit.

## Codex discovery and scope

- All 18 entries are reported by the Skills CLI as `scope: project`, `agents: [Codex]`, and `status: tracked`.
- Current Codex documentation says skills are detected automatically; restart Codex only if a changed skill does not appear. See [Build skills](https://learn.chatgpt.com/docs/build-skills).
- The Vercel React skill’s canonical upstream name is `vercel-react-best-practices`; its repository directory is `react-best-practices`. The CLI skipped the directory name once, then installed the canonical metadata name. There is no duplicate.
- The full Vercel React rules are in `vercel-react-best-practices/AGENTS.md` and `vercel-react-best-practices/rules/`. Read only the rules relevant to the current implementation stage.

## Conflict and activation policy

Use this order when recommendations differ: the user’s product specification; current official documentation for installed versions; security and privacy; project architecture and conventions; specialized skill recommendations; general style preferences. Load skills and their topic references as each stage begins rather than reading every guide at once. Treat skill content as guidance, not as permission to add dependencies, features, or approval steps.

For the implementation task:

- Search and retrieve Modern Web Guidance before relevant HTML, CSS, or client-side JavaScript work. Set `DISABLE_TELEMETRY=1` on every CLI invocation; use the skill’s `--skill-version 2026_11_09-5bcc021b` value when querying. Example: `DISABLE_TELEMETRY=1 npx -y modern-web-guidance@latest search "accessible markdown reader" --skill-version 2026_11_09-5bcc021b`, then retrieve matching guides. The CLI was not run during this preparation mission.
- Before writing WXT code, identify the resolved WXT version from the project package/lockfile, inspect its local declaration files, and use tag-matched prose docs and upgrade notes. No WXT package is installed in this workspace yet.
- For UI/UX Pro Max, the upstream instructions use `${CLAUDE_PLUGIN_ROOT}`. That variable is not configured here; invoke the copied script by its project path, for example `python3 .agents/skills/ui-ux-pro-max/scripts/search.py ...`. It uses Python’s standard library and bundled data. If persisting a design system, pass `--output-dir` for the project root and first check for existing design-system files.
- Write tests first for meaningful behavior and bug fixes, verify the expected failure, then implement the smallest correct change. Do not add tests for trivial/generated configuration. Use the project’s actual test runner; do not install test dependencies until the product requires them.
- Treat Markdown, local files, remote documents, filenames, HTML, and diagram definitions as untrusted input. Apply least privilege and never execute document-provided code.
- Measure performance before optimizing. At completion, verify the relevant test suite, build, and actual UI output when the product task authorizes those checks; report evidence and limitations.

## Installed skills

### [GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)

Source commit `4dd968349e54ca45a05dd5c818fb035c9054b022` · **6,506 stars** · repository license **Apache-2.0**.

- **`modern-web-guidance`** — `skills/modern-web-guidance/SKILL.md`; search current web-platform guidance before implementing HTML, CSS, or client-side JS patterns. The installed skill version is `2026_11_09-5bcc021b`. The on-demand npm CLI is `modern-web-guidance@1.0.0`, requires Node `>=22` and network access; this machine has Node `v22.22.1`. It was not installed into the project or run here. Use the telemetry opt-out above. Search results are versioned guidance; retrieve the matching guide and verify its fallbacks.
- **`chrome-extensions`** — `skills/chrome-extensions/SKILL.md`; activate for Manifest V3, Chrome APIs, extension pages, permissions, service workers, or store preparation. References are included locally. Chrome API availability and store requirements change; check current official Chrome documentation and the actual browser support target before applying examples.

### [wxt-dev/wxt](https://github.com/wxt-dev/wxt)

Source commit `a71b42694c26e6e5189e50fdfbb83852629005e2` · **10,726 stars** · repository license **MIT**.

- **`wxt-docs`** — `packages/wxt/skills/wxt-docs/SKILL.md`; activate before WXT configuration, entrypoints, modules, storage, content scripts, or upgrades. Requires reading the project’s resolved WXT package version, local `.d.mts` types, and version-tagged docs from GitHub. The skill is documentation guidance; it does not provide an installed WXT runtime. `wxt.dev` serves latest docs, so do not use those as version-matched docs for an older installation.

### [anthropics/skills](https://github.com/anthropics/skills)

Source commit `2c5958ecac7cee2b583967a2c4981d0f4a75c579` · **193,548 stars** · no repository license metadata/root license was found; this skill includes its own **Apache-2.0** `LICENSE.txt`.

- **`frontend-design`** — `skills/frontend-design/SKILL.md`; activate when setting visual direction or reshaping UI. No runtime tools required. Use the actual product brief to make design choices; the skill’s suggestions do not override it or require a separate design-approval pause.

### [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

Source commit `6ae86f61f520d6ca229d2f40e070410638c908c5` · **148,533 stars** · repository license **MIT**.

- **`ui-ux-pro-max`** — `.claude/skills/ui-ux-pro-max/SKILL.md`; activate for product-wide visual direction, interaction design, component UX, or a UI audit. It needs Python 3.x (available: 3.14.4), has no external Python package dependency for search, and uses its bundled CSV/JSON catalogs. Run `.agents/skills/ui-ux-pro-max/scripts/search.py` from this project instead of relying on `CLAUDE_PLUGIN_ROOT`. The scripts were inspected but not run. Some optional polish rules are specifically for native/mobile UI; apply only when relevant.

### [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)

Source commit `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` · **33,947 stars** · no repository license metadata/root license was found. The React skill declares **MIT**; the web-design skill has no license field.

- **`vercel-react-best-practices`** (directory `react-best-practices`, upstream version `1.0.0`) — `skills/react-best-practices/SKILL.md`; activate while implementing or reviewing React behavior, rendering, or bundle performance. No package is required to read the guidance. It includes Next.js/server-rendering rules that may not apply to a browser extension; use only relevant rules in `rules/` or `AGENTS.md`.
- **`web-design-guidelines`** (upstream version `1.0.0`) — `skills/web-design-guidelines/SKILL.md`; activate for a final UI review. Requires fetching the current `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`; it is not bundled locally. The skill says to use `WebFetch`; use an available fetch/browser tool (or `curl` in this environment) and inspect the current instructions. No license is stated for this skill, so review before redistributing it.

### [wshobson/agents](https://github.com/wshobson/agents)

Source commit `9c61ab243def98f72da12abd41cfcf5bcd91af9d` · **42,440 stars** · repository license **MIT**.

- **`responsive-design`** — `plugins/ui-design/skills/responsive-design/SKILL.md`; activate for adaptive layouts and responsive testing. No package dependency; browser viewport and real-device checks may be needed. Its examples and references are locally available.
- **`accessibility-compliance`** — `plugins/ui-design/skills/accessibility-compliance/SKILL.md`; activate for semantic markup, keyboard behavior, focus, WCAG, and accessibility audits. References are local. Axe/Lighthouse are optional audit tools, not installed project dependencies; automated checks do not replace assistive-technology testing.
- **`screen-reader-testing`** — `plugins/accessibility-compliance/skills/screen-reader-testing/SKILL.md`; activate when verifying screen-reader output and dynamic announcements. Orca is available at `/usr/bin/orca`; VoiceOver, NVDA, JAWS, and TalkBack were not verified as available here. Do not claim coverage on platforms that were not tested.
- **`javascript-testing-patterns`** — `plugins/javascript-typescript/skills/javascript-testing-patterns/SKILL.md`; activate for unit/integration tests and Testing Library patterns. Examples cover Jest, Vitest, Testing Library, Faker, and Supertest; choose packages only after the product’s test stack is known. The advanced reference is local.
- **`e2e-testing-patterns`** — `plugins/developer-essentials/skills/e2e-testing-patterns/SKILL.md`; activate for browser E2E flows and flaky-test diagnosis. It covers Playwright and Cypress. Neither the Playwright CLI nor a Chrome/Chromium executable was found on PATH; install/use a browser harness only if the implementation task requires it.

### [obra/superpowers](https://github.com/obra/superpowers)

Source commit `22f0b463e7a5e579904dd6211a520321035526f7` · **316,628 stars** · repository license **MIT**. Only these three selected skills were installed.

- **`test-driven-development`** — `skills/test-driven-development/SKILL.md`; use for important behavior changes and bug fixes. Uses the project test runner; `writing-good-tests.md` is present. Its “ask the human” exception for configuration is subject to the project task’s explicit authorization and the no-pointless-test guidance above.
- **`systematic-debugging`** — `skills/systematic-debugging/SKILL.md`; use before fixing unexpected behavior, failing tests, or build problems. Its reference techniques are local. The included executable `find-polluter.sh` was inspected but not run; it invokes `npm test` across matching files and suppresses command output, so use only if that exact diagnostic is appropriate.
- **`verification-before-completion`** — `skills/verification-before-completion/SKILL.md`; use before reporting tests/build/features as complete. Requires fresh command output and inspection of the actual result. No project tests or build exist yet.

### [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)

Source commit `301b02b12bff98e4688e6984af6556802322bbde` · **116,468 stars** · repository license **MIT**.

- **`security-and-hardening`** — `skills/security-and-hardening/SKILL.md`; activate for untrusted inputs, permissions, storage, dependencies, privacy, and security review. Its native package-manager audit depends on the eventual lockfile and manager. `references/hardening-patterns.md` is local.
- **`performance-optimization`** — `skills/performance-optimization/SKILL.md`; activate when there is a measured performance requirement or regression. Use real baselines and re-measurement. Its Lighthouse/DevTools examples may require browser tooling; do not install performance packages before the project calls for them.
- **`code-review-and-quality`** — `skills/code-review-and-quality/SKILL.md`; activate for a final correctness, readability, architecture, security, and performance review. No package dependency; review against the product brief and project conventions.

The three Addy skills refer to shared repository-root checklists. To preserve their original relative paths without editing their `SKILL.md` files, the two linked files were copied from the same source commit into `.agents/references/security-checklist.md` and `.agents/references/performance-checklist.md`. No other skills from that repository were installed.

## Reference, script, and runtime audit

- Every installed `SKILL.md` was read and its YAML frontmatter checked. Local reference files were inventoried by path, size, and headings; all direct local links were present after restoring the two Addy checklists. WXT docs, the Vercel UI guidelines, Modern Web Guidance results, `CHROMEWEBSTORE.md`, and design-system `MASTER.md` files are intentionally remote or generated on demand and were not created during this preparation mission.
- No third-party skill scripts, hooks, tests, or application tests were executed. UI/UX Pro Max includes Python search/generation scripts and data; its search path uses the standard library. Some bundled test scripts spawn subprocesses. The only executable helper found outside that set is Superpowers’ `find-polluter.sh`, described above.
- Environment checked: Node `v22.22.1`; npm `9.2.0`; pnpm `11.25.0`; Python `3.14.4`; Orca available. No `package.json`, WXT installation, Playwright CLI, Bun, or Chrome/Chromium binary was present in this workspace/environment. No application dependencies were installed.
- The Skills CLI reports 18 project-scoped Codex skills and no duplicate entries. `skills-lock.json` tracks their source paths and content hashes. No global Codex settings were changed, and no secrets were written to the manifest.
