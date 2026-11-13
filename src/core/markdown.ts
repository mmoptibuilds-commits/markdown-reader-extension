import MarkdownIt, { type Env, type MarkdownIt as MarkdownItInstance, type Token } from 'markdown-it';
import type { StateBlock, StateInline } from 'markdown-it';
import DOMPurify from 'dompurify';
import markdownItAbbr from 'markdown-it-abbr';
import markdownItContainer from 'markdown-it-container';
import markdownItDeflist from 'markdown-it-deflist';
import { full as markdownItEmoji } from 'markdown-it-emoji';
import markdownItFootnote from 'markdown-it-footnote';
import MarkdownItGitHubAlerts from 'markdown-it-github-alerts';
import markdownItIns from 'markdown-it-ins';
import markdownItMark from 'markdown-it-mark';
import multimdTable from 'markdown-it-multimd-table';
import markdownItSub from 'markdown-it-sub';
import markdownItSup from 'markdown-it-sup';
import markdownItTaskLists from 'markdown-it-task-lists';
import type { HLJSApi, LanguageFn } from 'highlight.js';
import {
  buildHeadingIndex,
  isSafeLink,
  parseFrontmatter,
  resolveFolderTarget,
  slugifyHeadingText,
  type Heading,
  type HeadingDraft,
} from './document';
import { cssCanFetch } from './css-safety';

export interface RenderMarkdownOptions {
  sourceUrl?: string;
  documentPath?: string;
  assetUrls?: ReadonlyMap<string, string>;
  documentPaths?: ReadonlySet<string>;
  allowRemoteImages?: boolean;
}

export interface RenderedMarkdown {
  source: string;
  body: string;
  html: string;
  headings: Heading[];
  metadata: Record<string, unknown>;
  frontmatterError?: string;
}

interface MarkdownEnvironment extends Env {
  renderOptions: RenderMarkdownOptions;
  headings: Heading[];
  headingAliases: Map<string, string>;
  highlighter?: HLJSApi;
  katex?: typeof import('katex').default;
}

interface HeadingMeta {
  heading?: Heading;
}

type LanguageLoader = () => Promise<{ default: LanguageFn }>;

const languageLoaders: Record<string, LanguageLoader> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  css: () => import('highlight.js/lib/languages/css'),
  go: () => import('highlight.js/lib/languages/go'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  php: () => import('highlight.js/lib/languages/php'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  python: () => import('highlight.js/lib/languages/python'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};

const languageAliases: Record<string, string> = {
  csharp: 'csharp',
  'c++': 'cpp',
  cs: 'csharp',
  h: 'c',
  hpp: 'cpp',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
};

let coreHighlighter: Promise<HLJSApi> | undefined;
const languagePromises = new Map<string, Promise<void>>();

function normalizeLanguage(value: string): string {
  const key = value.trim().toLowerCase();
  return languageAliases[key] ?? key;
}

function fencedLanguages(source: string): Set<string> {
  const languages = new Set<string>();
  for (const match of source.matchAll(/^ {0,3}(?:`{3,}|~{3,})\s*([^\s`~]+)/gmu)) {
    const language = normalizeLanguage(match[1] ?? '');
    if (language && language !== 'mermaid' && language !== 'dot' && language !== 'graphviz') {
      languages.add(language);
    }
  }
  return languages;
}

async function getHighlighter(languages: ReadonlySet<string>): Promise<HLJSApi | undefined> {
  const supported = [...languages].filter((language) => languageLoaders[language]);
  if (supported.length === 0) return undefined;

  coreHighlighter ??= import('highlight.js/lib/core').then((module) => module.default);
  const highlighter = await coreHighlighter;
  await Promise.all(
    supported.map(async (language) => {
      if (highlighter.getLanguage(language)) return;
      let load = languagePromises.get(language);
      if (!load) {
        const loader = languageLoaders[language];
        if (!loader) return;
        load = loader().then(({ default: definition }) => {
          highlighter.registerLanguage(language, definition);
        });
        languagePromises.set(language, load);
      }
      await load;
    }),
  );
  return highlighter;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function safeDocumentPath(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 1024);
}

function languageLabel(value: string): string {
  const label = value.replace(/[^\w.+#-]/gu, '').slice(0, 40);
  return label || 'Text';
}

function highlightCode(code: string, language: string, highlighter?: HLJSApi): string {
  const canonical = normalizeLanguage(language);
  if (highlighter?.getLanguage(canonical)) {
    try {
      return highlighter.highlight(code, { language: canonical, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(code);
    }
  }
  return escapeHtml(code);
}

function diagramPlaceholder(kind: 'mermaid' | 'graphviz', source: string): string {
  const label = kind === 'mermaid' ? 'Mermaid' : 'Graphviz';
  return `<div class="diagram-placeholder" role="status" aria-label="${label} diagram loading" data-diagram="${kind}" data-source="${encodeURIComponent(source)}"><span>${label} diagram</span><span class="diagram-loading">Preparing…</span></div>`;
}

function tableWrapPlugin(markdown: MarkdownItInstance): void {
  markdown.renderer.rules.table_open = () =>
    '<div class="table-scroll" role="region" tabindex="0" aria-label="Scrollable Markdown table">\n<table>\n';
  markdown.renderer.rules.table_close = () => '</table>\n</div>\n';
}

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const source = state.src;
  const start = state.pos;
  const isDollar = source[start] === '$' && source[start + 1] !== '$';
  const isParen = source.startsWith('\\(', start);
  if (!isDollar && !isParen) return false;
  const openerLength = isDollar ? 1 : 2;
  const closer = isDollar ? '$' : '\\)';
  const contentStart = start + openerLength;
  if (contentStart >= source.length || /\s/u.test(source[contentStart] ?? '')) return false;

  let close = source.indexOf(closer, contentStart);
  while (close >= 0 && (source[close - 1] === '\\' || /\s/u.test(source[close - 1] ?? ''))) {
    close = source.indexOf(closer, close + closer.length);
  }
  if (close < 0) return false;
  const content = source.slice(contentStart, close);
  if (!content || content.length > 100_000 || content.includes('\n')) return false;
  if (silent) return true;

  const token = state.push('math_inline', 'math', 0);
  token.content = content;
  token.markup = isDollar ? '$' : '\\(';
  state.pos = close + closer.length;
  return true;
}

function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const openingLine = state.getLines(startLine, startLine + 1, state.blkIndent, false).trim();
  const opener = openingLine.startsWith('$$') ? '$$' : openingLine === '\\[' ? '\\[' : '';
  if (!opener) return false;
  const closer = opener === '$$' ? '$$' : '\\]';
  const inlineRemainder = openingLine.slice(opener.length).trim();
  let content = '';
  let nextLine = startLine + 1;
  const inlineClose = inlineRemainder.lastIndexOf(closer);
  if (inlineClose >= 0 && inlineRemainder.slice(inlineClose + closer.length).trim() === '') {
    content = inlineRemainder.slice(0, inlineClose).trim();
  } else {
    const lines: string[] = inlineRemainder ? [inlineRemainder] : [];
    let found = false;
    for (let line = startLine + 1; line < endLine; line += 1) {
      const value = state.getLines(line, line + 1, state.blkIndent, false).trim();
      const closeAt = value.lastIndexOf(closer);
      if (closeAt >= 0 && value.slice(closeAt + closer.length).trim() === '') {
        if (value.slice(0, closeAt).trim()) lines.push(value.slice(0, closeAt));
        nextLine = line + 1;
        found = true;
        break;
      }
      lines.push(value);
    }
    if (!found) return false;
    content = lines.join('\n').trim();
  }
  if (content.length > 100_000) return false;
  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = content;
  token.markup = opener;
  token.map = [startLine, nextLine];
  state.line = nextLine;
  return true;
}

function registerMath(markdown: MarkdownItInstance, environment: MarkdownEnvironment): void {
  markdown.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  markdown.block.ruler.before('fence', 'math_block', mathBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  markdown.renderer.rules.math_inline = (tokens, index, _options, rawEnvironment) => {
    const token = tokens[index];
    const math = (rawEnvironment as unknown as MarkdownEnvironment).katex ?? environment.katex;
    if (!token || !math) return token ? `<code>${escapeHtml(token.content)}</code>` : '';
    return math.renderToString(token.content, { displayMode: false, throwOnError: false, trust: false, output: 'htmlAndMathml' });
  };
  markdown.renderer.rules.math_block = (tokens, index, _options, rawEnvironment) => {
    const token = tokens[index];
    const math = (rawEnvironment as unknown as MarkdownEnvironment).katex ?? environment.katex;
    if (!token || !math) return token ? `<pre class="math-fallback"><code>${escapeHtml(token.content)}</code></pre>\n` : '';
    return `<div class="math-block">${math.renderToString(token.content, { displayMode: true, throwOnError: false, trust: false, output: 'htmlAndMathml' })}</div>\n`;
  };
}

function headingText(token: Token): string {
  const children = token.children ?? [];
  return children
    .map((child) => {
      if (child.type === 'text' || child.type === 'code_inline' || child.type === 'emoji') return child.content;
      if (child.type === 'image') return String(child.attrGet('alt') ?? child.content);
      return '';
    })
    .join('')
    .trim();
}

function extractHeadingDrafts(tokens: Token[]): HeadingDraft[] {
  const headings: HeadingDraft[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index]?.type !== 'heading_open') continue;
    const inline = tokens[index + 1];
    if (!inline || inline.type !== 'inline') continue;
    const level = Number(tokens[index]?.tag?.slice(1)) || 1;
    headings.push({ level, text: headingText(inline) });
  }
  return headings;
}

function createMarkdownIt(environment: MarkdownEnvironment): MarkdownItInstance {
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
    xhtmlOut: false,
  });
  markdown.validateLink = isSafeLink;

  const utilities = markdown.utils as unknown as Record<string, unknown>;
  if (typeof utilities.assign !== 'function') {
    Object.defineProperty(utilities, 'assign', {
      configurable: true,
      value: Object.assign,
    });
  }

  markdown
    .use(markdownItTaskLists, { enabled: false, label: true })
    .use(markdownItEmoji)
    .use(markdownItFootnote)
    .use(markdownItSup)
    .use(markdownItSub)
    .use(markdownItIns)
    .use(markdownItMark)
    .use(markdownItAbbr)
    .use(markdownItDeflist)
    .use(MarkdownItGitHubAlerts)
    .use(multimdTable, { multiline: true, rowspan: true, headerless: true, multibody: true, autolabel: true });

  registerMath(markdown, environment);

  // The alerts plugin writes the title text into HTML without escaping it, so raw HTML in
  // an alert title could add images or styles. Escape the title before the plugin renders it.
  const renderAlertOpen = markdown.renderer.rules.alert_open;
  markdown.renderer.rules.alert_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token && typeof token.meta?.title === 'string') {
      token.meta = { ...token.meta, title: markdown.utils.escapeHtml(token.meta.title) };
    }
    return renderAlertOpen ? renderAlertOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
  };

  for (const name of ['note', 'tip', 'warning', 'details']) {
    markdown.use(markdownItContainer, name, {
      render(tokens, index) {
        const token = tokens[index];
        if (!token) return '';
        if (token.nesting === 1) {
          const tag = name === 'details' ? 'details' : 'aside';
          const role = name === 'warning' ? 'alert' : 'note';
          const rawInfo = token.info.trim().replace(/^:+\s*/u, '');
          const detailsTitle = rawInfo.replace(/^details\b\s*/iu, '').trim();
          const summary = name === 'details' ? escapeHtml(detailsTitle || 'Details') : '';
          if (name === 'details') return `<details class="markdown-container markdown-container-details"><summary>${summary}</summary>\n`;
          return `<${tag} class="markdown-container markdown-container-${name}" role="${role}">\n`;
        }
        return `</${name === 'details' ? 'details' : 'aside'}>\n`;
      },
    });
  }

  tableWrapPlugin(markdown);

  markdown.renderer.rules.fence = (tokens, index, _options, rawEnvironment) => {
    const token = tokens[index];
    if (!token) return '';
    const info = token.info.trim().split(/\s+/u)[0] ?? '';
    const kind = info.toLowerCase();
    if (kind === 'mermaid') return diagramPlaceholder('mermaid', token.content);
    if (kind === 'dot' || kind === 'graphviz') return diagramPlaceholder('graphviz', token.content);

    const language = kind ? languageLabel(info) : 'Text';
    const className = kind ? `language-${languageLabel(normalizeLanguage(info))}` : 'language-plaintext';
    const code = highlightCode(token.content, info, (rawEnvironment as unknown as MarkdownEnvironment).highlighter);
    const escapedLabel = escapeHtml(language);
    const encodedCode = encodeURIComponent(token.content);
    return `<figure class="code-block" data-code-block><figcaption class="code-toolbar"><span class="code-language">${escapedLabel}</span><span class="code-actions"><button type="button" data-action="copy-code" data-code="${encodedCode}" aria-label="Copy ${escapedLabel} code">Copy</button><button type="button" data-action="wrap-code" aria-pressed="false">Wrap</button><button type="button" data-action="collapse-code" aria-expanded="true">Collapse</button><button type="button" data-action="download-code" data-language="${escapeHtml(languageLabel(kind || 'txt'))}" data-code="${encodedCode}" aria-label="Download ${escapedLabel} code">Download</button></span></figcaption><pre><code class="hljs ${escapeHtml(className)}">${code}</code></pre></figure>\n`;
  };

  markdown.renderer.rules.code_block = (tokens, index) => {
    const token = tokens[index];
    if (!token) return '';
    const code = escapeHtml(token.content);
    return `<figure class="code-block" data-code-block><figcaption class="code-toolbar"><span class="code-language">Text</span><span class="code-actions"><button type="button" data-action="copy-code" data-code="${encodeURIComponent(token.content)}" aria-label="Copy code">Copy</button><button type="button" data-action="wrap-code" aria-pressed="false">Wrap</button><button type="button" data-action="collapse-code" aria-expanded="true">Collapse</button><button type="button" data-action="download-code" data-language="txt" data-code="${encodeURIComponent(token.content)}" aria-label="Download code">Download</button></span></figcaption><pre><code class="hljs language-plaintext">${code}</code></pre></figure>\n`;
  };

  markdown.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    if (!token) return '';
    const env = environment;
    const rawSource = String(token.attrGet('src') ?? '');
    const assetSource = resolveImageSource(rawSource, env.renderOptions);
    if (assetSource.blocked) {
      const alt = token.content.trim() || 'External image';
      return `<span class="remote-image-placeholder" role="img" aria-label="${escapeHtml(alt)}; remote image blocked"><span aria-hidden="true">◫</span><span>${escapeHtml(alt)}</span><small>Remote image blocked</small></span>`;
    }
    if (!assetSource.src) return '';

    const title = String(token.attrGet('title') ?? '');
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
    return `<figure class="reader-figure"><img src="${escapeHtml(assetSource.src)}" alt="${escapeHtml(token.content)}" class="reader-image" loading="lazy" decoding="async" referrerpolicy="no-referrer"${titleAttribute}>${token.content ? `<figcaption>${escapeHtml(token.content)}</figcaption>` : ''}</figure>`;
  };

  markdown.renderer.rules.link_open = (tokens, index, _options, rawEnvironment, self) => {
    const token = tokens[index];
    if (!token) return '';
    const href = String(token.attrGet('href') ?? '');
    const env = rawEnvironment as unknown as MarkdownEnvironment;
    if (href.startsWith('#')) {
      let anchor = href.slice(1).toLowerCase();
      try {
        anchor = decodeURIComponent(anchor);
      } catch {
        anchor = href.slice(1).toLowerCase();
      }
      const mapped = env.headingAliases.get(anchor);
      if (mapped) token.attrSet('href', `#${mapped}`);
    } else if (env.renderOptions.documentPath && !env.renderOptions.sourceUrl) {
      const target = resolveFolderTarget(env.renderOptions.documentPath, href);
      if (target) {
        const localPath = safeDocumentPath(target.path);
        token.attrSet('href', `#document/${encodeURIComponent(localPath)}${target.hash}`);
        token.attrSet('data-local-path', localPath);
        if (env.renderOptions.documentPaths?.has(localPath)) token.attrSet('data-local-available', 'true');
      }
    } else if (env.renderOptions.sourceUrl && !/^[a-z][a-z\d+.-]*:/iu.test(href) && !href.startsWith('//')) {
      try {
        const resolved = new URL(href, env.renderOptions.sourceUrl);
        token.attrSet('href', isSafeLink(resolved.href) ? resolved.href : '#invalid-link');
      } catch {
        token.attrSet('href', '#invalid-link');
      }
    } else if (!/^[a-z][a-z\d+.-]*:/iu.test(href) && !href.startsWith('#')) {
      // With no base address, a relative link would resolve inside the extension.
      token.attrSet('href', '#invalid-link');
    }

    const safeHref = String(token.attrGet('href') ?? '');
    if (/^https?:/iu.test(safeHref)) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return self.renderToken(tokens, index, _options);
  };

  markdown.renderer.rules.heading_close = (tokens, index) => {
    const token = tokens[index];
    if (!token) return '';
    const heading = (token.meta as HeadingMeta | null)?.heading;
    if (!heading) return `</${token.tag}>\n`;
    return `<a class="heading-anchor" href="#${escapeHtml(heading.id)}" aria-label="Link to ${escapeHtml(heading.text)}"><span aria-hidden="true">#</span></a></${token.tag}>\n`;
  };

  return markdown;
}

function resolveImageSource(
  source: string,
  options: RenderMarkdownOptions,
): { src?: string; blocked: boolean } {
  const raw = source.trim();
  if (!raw) return { blocked: false };

  if (options.documentPath && options.assetUrls) {
    const target = resolveFolderTarget(options.documentPath, raw);
    const direct = options.assetUrls.get(raw) ?? (target ? options.assetUrls.get(target.path) : undefined);
    if (direct) return { src: direct, blocked: false };
  }

  try {
    const resolved = options.sourceUrl ? new URL(raw, options.sourceUrl) : new URL(raw);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return { blocked: true };
    if (options.allowRemoteImages !== true) return { blocked: true };
    return { src: resolved.href, blocked: false };
  } catch {
    return { blocked: true };
  }
}

function addHeadingsToTokens(tokens: Token[], headings: Heading[]): Map<string, string> {
  const aliases = new Map<string, string>();
  let cursor = 0;
  let active: Heading | undefined;

  for (const token of tokens) {
    if (token.type === 'heading_open') {
      active = headings[cursor];
      cursor += 1;
      if (active) {
        token.attrSet('id', active.id);
        aliases.set(active.id.toLowerCase(), active.id);
        const headingSlug = slugifyHeadingText(active.text);
        if (!aliases.has(headingSlug)) aliases.set(headingSlug, active.id);
      }
    } else if (token.type === 'heading_close') {
      if (active) token.meta = { ...(token.meta as object | null), heading: active } satisfies HeadingMeta;
      active = undefined;
    }
  }
  return aliases;
}

function buildRenderedHtml(rawHtml: string): string {
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|(?:[^a-z+.-]|[a-z+.-]+(?:[^a-z+.\-:]|$)))/iu,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    ADD_ATTR: ['referrerpolicy'],
  });
}

/**
 * Sanitizes diagram SVG and returns the parsed root, ready to insert without reparsing.
 * Event handlers, scripts, foreign content, external references, and any CSS that could
 * fetch a resource are removed.
 */
export function sanitizeSvgElement(svg: string): SVGSVGElement | undefined {
  if (svg.length > 4_000_000) return undefined;
  const safeSvg = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
  });
  const parsed = new DOMParser().parseFromString(safeSvg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.querySelector('parsererror')) return undefined;

  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const externalReference = (name === 'href' || name.endsWith(':href')) && value !== '' && !value.startsWith('#');
      if (name === 'xml:base' || externalReference || ((name === 'style' || /url\s*\(/iu.test(value)) && cssCanFetch(value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const style of root.querySelectorAll('style')) {
    if (cssCanFetch(style.textContent ?? '')) style.remove();
  }
  return root as unknown as SVGSVGElement;
}

export function sanitizeSvg(svg: string): string {
  const element = sanitizeSvgElement(svg);
  return element ? new XMLSerializer().serializeToString(element) : '';
}

export async function renderMarkdown(source: string, options: RenderMarkdownOptions = {}): Promise<RenderedMarkdown> {
  const frontmatter = parseFrontmatter(source);
  const languages = fencedLanguages(frontmatter.body);
  const needsMath = /\$(?:[^\s$][^$\n]*[^\s$]|[^\s$])\$|^\s*(?:\$\$|\\\[)/mu.test(frontmatter.body);
  const [highlighter, katex] = await Promise.all([
    getHighlighter(languages),
    needsMath ? import('katex').then((module) => module.default) : Promise.resolve(undefined),
  ]);

  const environment: MarkdownEnvironment = {
    renderOptions: options,
    headings: [],
    headingAliases: new Map(),
    ...(highlighter ? { highlighter } : {}),
    ...(katex ? { katex } : {}),
  };
  const markdown = createMarkdownIt(environment);
  const tokens = markdown.parse(frontmatter.body, environment);
  const headings = buildHeadingIndex(extractHeadingDrafts(tokens));
  const headingAliases = addHeadingsToTokens(tokens, headings);
  environment.headings = headings;
  environment.headingAliases = headingAliases;

  const rendered = markdown.renderer.render(tokens, markdown.options, environment);
  const html = buildRenderedHtml(rendered);
  const base = {
    source,
    body: frontmatter.body,
    html,
    headings,
    metadata: frontmatter.metadata,
  };
  return frontmatter.error ? { ...base, frontmatterError: frontmatter.error } : base;
}

