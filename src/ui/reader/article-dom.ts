import { sanitizeSvgElement } from '../../core/markdown';
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
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'look', 'htmlLabels', 'flowchart', 'darkMode', 'dompurifyConfig'],
      theme: appearance === 'dark' ? 'dark' : 'neutral',
      look: 'classic',
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

/** Highlights every match of `term` and returns the marks in document order. */
export function markSearchMatches(container: HTMLElement, term: string): HTMLElement[] {
  clearSearchMarks(container);
  const needle = term.trim().toLocaleLowerCase();
  if (!needle) return [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('button, script, style, .diagram-placeholder, .code-toolbar')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) if (walker.currentNode instanceof Text) nodes.push(walker.currentNode);
  const matches: HTMLElement[] = [];
  for (const node of nodes) {
    const value = node.data;
    const lower = value.toLocaleLowerCase();
    let offset = 0;
    let index = lower.indexOf(needle);
    if (index < 0) continue;
    const fragment = document.createDocumentFragment();
    while (index >= 0) {
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

/** Wraps each code line in a span so CSS can number lines without changing copied text. */
export function addCodeLines(code: HTMLElement): void {
  if (code.dataset.lineMarkup === 'true') return;
  const lines: Node[][] = [[]];
  for (const child of [...code.childNodes]) {
    splitHighlightedNode(child).forEach((part, index) => {
      if (index > 0) lines.push([]);
      lines[lines.length - 1]?.push(...part);
    });
  }
  if (code.textContent?.endsWith('\n') && lines.length > 1 && lines.at(-1)?.every((node) => !node.textContent)) lines.pop();
  code.replaceChildren(...lines.map((nodes, index) => {
    const line = document.createElement('span');
    line.className = 'code-line';
    line.dataset.line = String(index + 1);
    nodes.forEach((node) => line.append(node));
    return line;
  }));
  code.dataset.lineMarkup = 'true';
}

function decodedCode(button: HTMLElement, pre: HTMLElement): string {
  try {
    return decodeURIComponent(button.dataset.code ?? '');
  } catch {
    return pre.querySelector('code')?.textContent ?? '';
  }
}

/** Handles the copy, wrap, collapse, and download buttons of a code block. */
export function runCodeAction(button: HTMLButtonElement, notify: (message: string) => void): void {
  const block = button.closest<HTMLElement>('[data-code-block]');
  const pre = block?.querySelector('pre');
  const action = button.dataset.action;
  if (!block || !pre || !action) return;
  if (action === 'copy-code') {
    void navigator.clipboard.writeText(decodedCode(button, pre)).then(() => {
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
    const url = URL.createObjectURL(new Blob([decodedCode(button, pre)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `code.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
