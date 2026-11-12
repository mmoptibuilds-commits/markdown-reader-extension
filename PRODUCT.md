# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated by the user: WXT, React, strict TypeScript, Vite, npm, and the locally bundled Markdown and browser-test tools named in the project brief.

## Users

The user brief identifies developers, students, researchers, technical writers, maintainers of Markdown knowledge bases, and anyone opening local Markdown files. Their primary job is to read technical or study documents comfortably, follow related material, and move through long documents without editing or uploading their source.

## Product Purpose

Markdown Reader is a browser extension that turns local and directly opened online Markdown into a focused, navigable reading space. Success means that common and advanced documents remain readable, safe, private by default, and usable across desktop and small screens.

## Positioning

The extension combines local file and folder reading, browser URL rendering, and a long-form reading workspace while keeping document parsing in the browser and avoiding a backend or document upload.

## Operating Context

People use it inside Chromium-based browsers and Firefox to read README files, technical documentation, research notes, study material, and larger Markdown folders. Local files may be selected through browser file pickers; browser file URL restrictions cannot be bypassed. Remote URLs may need a narrow, user-granted origin permission. Documents and diagram definitions are untrusted input.

## Capabilities and Constraints

The explicit brief requires CommonMark and GFM, extended Markdown, local math and diagram rendering, syntax highlighting, navigation, search, themes, reading controls, recent metadata, bookmarks, raw-source reading, printing, settings, keyboard shortcuts, and Chromium and Firefox packages. Local document contents and file handles must not be persisted by default. Remote images must have a privacy control. Raw HTML and MDX code must not execute. Extension permissions must be narrow and user-initiated where possible. No telemetry, analytics, accounts, sync, ads, backend, or remote AI services are allowed.

## Evidence on Hand

The user supplied the product, security, platform, accessibility, testing, and delivery requirements in the master mission attachment. The official legacy repository identifies its source as unmaintained 2.x code; its published README lists Markdown plugins, themes, hot reload, a directory sidebar, source preview, and image support. The current product site describes a browser-based viewer for local and online files. No original brand assets or approved product screenshots were provided. `src/core/fixtures/showcase.md` is project-created QA content, not user-supplied evidence.

## Product Principles

- Render locally and keep files under the user's control.
- Protect the reader from code and markup embedded in documents.
- Ask for only the browser access required by an intentional feature.
- Prioritize sustained reading, navigation, and clear failure states.
- Keep reading and source browsing read-only.

## Accessibility & Inclusion

The user requires WCAG 2.2 AA principles, keyboard access, screen-reader labels, visible focus, reduced-motion support, responsive layouts, and automated and manual checks where available.
