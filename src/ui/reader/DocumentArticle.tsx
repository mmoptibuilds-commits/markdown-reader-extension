import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { PreparedMarkdown } from '../../core/markdown';
import { sanitizeBlockToFragment } from '../../core/sanitize';
import type { Appearance } from '../../core/themes';
import { addCodeLines, renderDiagram, runCodeAction, searchDocument, type DocumentSearch } from './article-dom';

export interface DocumentArticleProps {
  prepared: PreparedMarkdown;
  label: string;
  appearance: Appearance;
  showLineNumbers: boolean;
  searchTerm: string;
  searchIndex: number;
  wordCount: number;
  onSearchResults: (count: number, capped: boolean, term: string) => void;
  onActiveHeading: (id: string) => void;
  onOpenImage: (images: HTMLImageElement[], index: number) => void;
  onLocalLink: (path: string, hash: string) => void;
  /** Called once every slice of the document is in the page. */
  onComplete: () => void;
  notify: (message: string) => void;
}

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/**
 * Yields to the browser between slices so input and painting are handled. A message
 * channel is used rather than idle callbacks or timers, which background tabs throttle.
 */
const nextIdle = (run: () => void): (() => void) => {
  const channel = new MessageChannel();
  let cancelled = false;
  channel.port1.onmessage = () => { channel.port1.close(); if (!cancelled) run(); };
  channel.port2.postMessage(undefined);
  return () => { cancelled = true; channel.port1.close(); };
};

/**
 * The rendered document. Slices are sanitized and inserted one after another, so the
 * first screen appears at once even for very large files. Every imperative enhancement
 * (diagrams, code lines and actions, search, image viewer) is confined to the container
 * that holds the sanitized HTML, and attached once the whole document is present.
 */
export const DocumentArticle = memo(function DocumentArticle(props: DocumentArticleProps): ReactElement {
  const { prepared, appearance, showLineNumbers, searchTerm, searchIndex } = props;
  const contentRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [complete, setComplete] = useState(false);
  const search = useRef<DocumentSearch | undefined>(undefined);

  // Insert the first slice before paint, the rest when the browser is idle.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    setComplete(false);
    content.replaceChildren();
    let index = 0;
    let cancel: (() => void) | undefined;
    // Slices are sanitized in short idle steps but added to the page in batches that double
    // in size, so the growing document is laid out a logarithmic number of times.
    let pending = document.createDocumentFragment();
    let pendingSlices = 0;
    let insertedSlices = 0;
    const flush = (): void => {
      content.append(pending);
      insertedSlices += pendingSlices;
      pending = document.createDocumentFragment();
      pendingSlices = 0;
    };
    const insert = (budgetMs: number): void => {
      const started = performance.now();
      do {
        const block = prepared.blocks[index];
        if (block !== undefined) { pending.append(sanitizeBlockToFragment(block)); pendingSlices += 1; }
        index += 1;
      } while (index < prepared.blocks.length && performance.now() - started < budgetMs);
      const done = index >= prepared.blocks.length;
      if (done || insertedSlices === 0 || pendingSlices >= Math.max(4, insertedSlices)) flush();
      if (!done) cancel = nextIdle(() => insert(40));
      else {
        performance.mark('markdown-reader:document-complete');
        setComplete(true);
        callbacks.current.onComplete();
      }
    };
    performance.mark('markdown-reader:document-start');
    insert(30);
    return () => cancel?.();
  }, [prepared]);

  // Diagrams render when they come near the viewport, and again if the appearance changes.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !complete) return;
    const nodes = [...content.querySelectorAll<HTMLElement>('[data-diagram]')];
    if (nodes.length === 0) return;
    const controller = new AbortController();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        void renderDiagram(entry.target as HTMLElement, appearance, controller.signal);
      }
    }, { rootMargin: '320px 0px' });
    nodes.forEach((node) => observer.observe(node));
    return () => { controller.abort(); observer.disconnect(); };
  }, [complete, prepared, appearance]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || !complete || !showLineNumbers) return;
    content.querySelectorAll<HTMLElement>('.code-block code').forEach(addCodeLines);
  }, [complete, prepared, showLineNumbers]);

  // The heading nearest the top of the viewport is the "current" one for outline and bookmarks.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !complete) return;
    const headings = [...content.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
    headings.forEach((heading) => { heading.tabIndex = -1; });
    if (headings.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) callbacks.current.onActiveHeading((visible.target as HTMLElement).id);
    }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [complete, prepared]);

  // One delegated listener handles images, code actions, and links, even before the last slice.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const images = (): HTMLImageElement[] => [...content.querySelectorAll<HTMLImageElement>('img.reader-image')];
    const open = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLImageElement) || !target.matches('.reader-image')) return false;
      const list = images();
      callbacks.current.onOpenImage(list, Math.max(0, list.indexOf(target)));
      return true;
    };
    const onClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (open(target)) return;
      const button = target.closest<HTMLButtonElement>('button[data-action]');
      if (button) { runCodeAction(button, callbacks.current.notify); return; }
      const anchor = target.closest<HTMLAnchorElement>('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (anchor.dataset.localPath) {
        event.preventDefault();
        callbacks.current.onLocalLink(anchor.dataset.localPath, new URL(anchor.href).hash);
      } else if (href === '#invalid-link') {
        event.preventDefault();
        callbacks.current.notify('This link points to a file next to the document. Open the folder that contains it to follow relative links.');
      } else if (href.startsWith('#')) {
        let id = href.slice(1);
        try { id = decodeURIComponent(id); } catch { /* Keep the raw fragment. */ }
        const heading = content.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
        if (heading) {
          event.preventDefault();
          heading.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
          heading.focus({ preventScroll: true });
          history.replaceState(history.state, '', `${location.pathname}${location.search}${href}`);
        }
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if ((event.key === 'Enter' || event.key === ' ') && open(event.target)) event.preventDefault();
    };
    content.addEventListener('click', onClick);
    content.addEventListener('keydown', onKey);
    return () => { content.removeEventListener('click', onClick); content.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || !complete) return;
    for (const image of content.querySelectorAll<HTMLImageElement>('img.reader-image')) {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', `View image${image.alt ? `: ${image.alt}` : ''}`);
    }
  }, [complete, prepared]);

  // Searching runs when the term or document changes; moving between matches only repaints.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !complete) return;
    const timer = window.setTimeout(() => {
      search.current?.clear();
      search.current = searchDocument(content, searchTerm);
      if (search.current.count) search.current.select(Math.min(callbacks.current.searchIndex, search.current.count - 1));
      callbacks.current.onSearchResults(search.current.count, search.current.capped, searchTerm);
    }, searchTerm.trim().length > 2 ? 60 : 180);
    return () => window.clearTimeout(timer);
  }, [complete, prepared, searchTerm]);

  useEffect(() => { search.current?.select(searchIndex); }, [searchIndex, searchTerm, complete]);
  useEffect(() => () => search.current?.clear(), []);

  const metadata = Object.entries(prepared.metadata);
  return <article className={`markdown-body ${showLineNumbers ? 'has-line-numbers' : ''}`} aria-label={props.label} aria-busy={!complete}>
    {metadata.length > 0 && <details className="frontmatter"><summary>Document details</summary><dl>{metadata.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl></details>}
    {prepared.frontmatterError && <p className="inline-notice" role="note">{prepared.frontmatterError}</p>}
    <div ref={contentRef} className="document-content" />
    {complete && <footer className="document-end"><span>End of document</span><span>{props.wordCount.toLocaleString()} words</span></footer>}
  </article>;
});
