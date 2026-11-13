import { sanitizeSvgElement } from '../../core/sanitize';
import type { Appearance } from '../../core/themes';

/**
 * Imperative enhancements of the rendered Markdown. They operate only inside the
 * container that holds the sanitized document HTML, never on React-rendered nodes.
 */

let mermaidLoader: Promise<typeof import('mermaid').default> | undefined;
let mermaidAppearance: Appearance | undefined;

async function loadMermaid(appearance: Appearance): Promise<typeof import('mermaid').default> {
  mermaidLoader ??= import('mermaid').then((module) => module.default);
  const mermaid = await mermaidLoader;
  if (mermaidAppearance !== appearance) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // Documents can carry %%{init}%% directives; none of these may be changed by them.
      secure: ['secure', 'layout', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'look', 'htmlLabels', 'flowchart', 'darkMode', 'dompurifyConfig'],
      theme: appearance === 'dark' ? 'dark' : 'neutral',
      look: 'classic',
      // Mermaid 12 defaults to the ELK layout, a 1.4 MB download per first flowchart.
      layout: 'dagre',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
    });
    mermaidAppearance = appearance;
  }
  return mermaid;
}

let graphvizLoader: Promise<{ renderString(source: string, options: { engine: string; format: string }): string }> | undefined;

/** Renders one diagram placeholder. Output SVG is sanitized before it is inserted. */
export async function renderDiagram(element: HTMLElement, appearance: Appearance, signal: AbortSignal): Promise<void> {
  const kind = element.dataset.diagram;
  let source = '';
  try {
    source = decodeURIComponent(element.dataset.source ?? '');
  } catch {
    element.textContent = 'The diagram source could not be decoded.';
    return;
  }
  try {
    let svg = '';
    if (kind === 'mermaid') {
      const mermaid = await loadMermaid(appearance);
      svg = (await mermaid.render(`reader-diagram-${crypto.randomUUID()}`, source)).svg;
    } else if (kind === 'graphviz') {
      graphvizLoader ??= import('@viz-js/viz').then((module) => module.instance());
      svg = (await graphvizLoader).renderString(source, { engine: 'dot', format: 'svg' });
    }
    if (signal.aborted) return;
    const safe = sanitizeSvgElement(svg);
    // The parsed element is inserted directly, so the markup is never reparsed as HTML.
    element.replaceChildren(...(safe ? [document.importNode(safe, true)] : []));
    element.dataset.rendered = 'true';
    if (element.firstElementChild) {
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', `${kind === 'mermaid' ? 'Mermaid' : 'Graphviz'} diagram`);
    } else {
      element.textContent = 'The diagram returned no visible output.';
    }
  } catch (error) {
    if (signal.aborted) return;
    const message = document.createElement('p');
    message.className = 'diagram-error';
    message.textContent = `This diagram could not be drawn. ${error instanceof Error ? error.message.slice(0, 240) : 'Check its syntax.'}`;
    element.replaceChildren(message);
  }
}

/** Search stops after this many matches so a one-letter query stays fast in large documents. */
export const SEARCH_LIMIT = 1000;

export interface DocumentSearch {
  count: number;
  /** True when the document has more matches than {@link SEARCH_LIMIT}. */
  capped: boolean;
  select(index: number): void;
  clear(): void;
}

const searchableText = (container: HTMLElement): TreeWalker => document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
  acceptNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest('button, script, style, .diagram-placeholder, .code-toolbar, .heading-anchor')) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  },
});

const highlightsSupported = (): boolean =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function';

function reveal(element: Element | null): void {
  element?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/**
 * Finds `term` in the document. Where the CSS Custom Highlight API exists, matches are
 * painted without touching the DOM; elsewhere they are wrapped in <mark> elements.
 */
export function searchDocument(container: HTMLElement, term: string): DocumentSearch {
  clearSearchMarks(container);
  const registry = highlightsSupported() ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights : undefined;
  registry?.delete('reader-search');
  registry?.delete('reader-search-current');
  const needle = term.trim().toLocaleLowerCase();
  const empty: DocumentSearch = { count: 0, capped: false, select: () => undefined, clear: () => undefined };
  if (!needle) return empty;

  if (registry) {
    const HighlightClass = (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
    const ranges: Range[] = [];
    let capped = false;
    const walker = searchableText(container);
    outer: while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const lower = node.data.toLocaleLowerCase();
      for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + needle.length)) {
        if (ranges.length >= SEARCH_LIMIT) { capped = true; break outer; }
        const range = new Range();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        ranges.push(range);
      }
    }
    registry.set('reader-search', new HighlightClass(...ranges));
    return {
      count: ranges.length,
      capped,
      select(index) {
        const range = ranges[index];
        if (!range) return;
        registry.set('reader-search-current', new HighlightClass(range));
        reveal(range.startContainer.parentElement);
      },
      clear() { registry.delete('reader-search'); registry.delete('reader-search-current'); },
    };
  }

  const marks = markSearchMatches(container, needle);
  return {
    count: Math.min(marks.length, SEARCH_LIMIT),
    capped: marks.length > SEARCH_LIMIT,
    select(index) {
      marks.forEach((mark, position) => {
        mark.classList.toggle('is-current', position === index);
        if (position === index) mark.setAttribute('aria-current', 'true'); else mark.removeAttribute('aria-current');
      });
      reveal(marks[index] ?? null);
    },
    clear() { clearSearchMarks(container); },
  };
}

/** Fallback for browsers without highlights: wraps up to SEARCH_LIMIT + 1 matches in marks. */
export function markSearchMatches(container: HTMLElement, needle: string): HTMLElement[] {
  const nodes: Text[] = [];
  const walker = searchableText(container);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const matches: HTMLElement[] = [];
  for (const node of nodes) {
    if (matches.length > SEARCH_LIMIT) break;
    const value = node.data;
    const lower = value.toLocaleLowerCase();
    let index = lower.indexOf(needle);
    if (index < 0) continue;
    let offset = 0;
    const fragment = document.createDocumentFragment();
    while (index >= 0 && matches.length <= SEARCH_LIMIT) {
      if (index > offset) fragment.append(value.slice(offset, index));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = value.slice(index, index + needle.length);
      fragment.append(mark);
      matches.push(mark);
      offset = index + needle.length;
      index = lower.indexOf(needle, offset);
    }
    if (offset < value.length) fragment.append(value.slice(offset));
    node.replaceWith(fragment);
  }
  return matches;
}

export function clearSearchMarks(container: HTMLElement): void {
  const marks = container.querySelectorAll('mark.search-hit');
  if (marks.length === 0) return;
  marks.forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent ?? '')));
  // Rejoin the text nodes, or a later search would miss matches split across them.
  container.normalize();
}

function splitHighlightedNode(node: Node): Node[][] {
  if (node instanceof Text) return node.data.split('\n').map((line) => line ? [document.createTextNode(line)] : []);
  if (!(node instanceof Element)) return [[node.cloneNode(true)]];
  const lines: Node[][] = [[]];
  for (const child of [...node.childNodes]) {
    splitHighlightedNode(child).forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part.length) {
        const clone = node.cloneNode(false) as Element;
        part.forEach((childNode) => clone.append(childNode));
        lines[lines.length - 1]?.push(clone);
      }
    });
  }
  return lines;
}

/** Wraps each code line in a span so CSS can number lines; the code's text, newlines included, is unchanged. */
export function addCodeLines(code: HTMLElement): void {
  if (code.dataset.lineMarkup === 'true') return;
  const lines: Node[][] = [[]];
  for (const child of [...code.childNodes]) {
    splitHighlightedNode(child).forEach((part, index) => {
      if (index > 0) lines.push([]);
      lines[lines.length - 1]?.push(...part);
    });
  }
  const endsWithNewline = code.textContent?.endsWith('\n') ?? false;
  if (endsWithNewline && lines.length > 1 && lines.at(-1)?.every((node) => !node.textContent)) lines.pop();
  code.replaceChildren(...lines.map((nodes, index) => {
    const line = document.createElement('span');
    line.className = 'code-line';
    line.dataset.line = String(index + 1);
    nodes.forEach((node) => line.append(node));
    // Each line keeps its newline so the code's text is unchanged; a block-level line shows no extra gap.
    if (index < lines.length - 1 || endsWithNewline) line.append(document.createTextNode('\n'));
    return line;
  }));
  code.dataset.lineMarkup = 'true';
}

/** The code exactly as written: line-number markup adds no text. */
const codeText = (pre: HTMLElement): string => pre.querySelector('code')?.textContent ?? '';

/** Handles the copy, wrap, collapse, and download buttons of a code block. */
export function runCodeAction(button: HTMLButtonElement, notify: (message: string) => void): void {
  const block = button.closest<HTMLElement>('[data-code-block]');
  const pre = block?.querySelector('pre');
  const action = button.dataset.action;
  if (!block || !pre || !action) return;
  if (action === 'copy-code') {
    void navigator.clipboard.writeText(codeText(pre)).then(() => {
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = 'Copy'; }, 1400);
    }).catch(() => notify('The clipboard is unavailable. Select the code and copy it with your browser.'));
  } else if (action === 'wrap-code') {
    const wrapped = button.getAttribute('aria-pressed') !== 'true';
    pre.classList.toggle('is-wrapped', wrapped);
    button.setAttribute('aria-pressed', String(wrapped));
  } else if (action === 'collapse-code') {
    const expanded = button.getAttribute('aria-expanded') !== 'false';
    block.classList.toggle('is-collapsed', expanded);
    button.setAttribute('aria-expanded', String(!expanded));
    button.textContent = expanded ? 'Expand' : 'Collapse';
  } else if (action === 'download-code') {
    const extension = (button.dataset.language || 'txt').toLowerCase().replace(/[^a-z0-9]+/gu, '').slice(0, 10) || 'txt';
    const url = URL.createObjectURL(new Blob([codeText(pre)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `code.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
