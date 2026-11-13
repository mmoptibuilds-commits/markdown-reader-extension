import { memo, useEffect, useRef, type ReactElement } from 'react';
import type { RenderedMarkdown } from '../../core/markdown';
import type { Appearance } from '../../core/themes';
import { addCodeLines, clearSearchMarks, markSearchMatches, renderDiagram, runCodeAction } from './article-dom';

export interface DocumentArticleProps {
  rendered: RenderedMarkdown;
  label: string;
  appearance: Appearance;
  showLineNumbers: boolean;
  searchTerm: string;
  searchIndex: number;
  wordCount: number;
  onSearchResults: (count: number) => void;
  onActiveHeading: (id: string) => void;
  onOpenImage: (images: HTMLImageElement[], index: number) => void;
  onLocalLink: (path: string, hash: string) => void;
  notify: (message: string) => void;
}

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/**
 * The rendered document. The sanitized HTML lives in its own container; every imperative
 * enhancement (diagrams, code lines and actions, search marks, image viewer) is confined
 * to that container and attached once the container exists.
 */
export const DocumentArticle = memo(function DocumentArticle(props: DocumentArticleProps): ReactElement {
  const { rendered, appearance, showLineNumbers, searchTerm, searchIndex } = props;
  const contentRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const matches = useRef<HTMLElement[]>([]);

  // Diagrams render when they come near the viewport, and again if the appearance changes.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
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
  }, [rendered, appearance]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || !showLineNumbers) return;
    content.querySelectorAll<HTMLElement>('.code-block code').forEach(addCodeLines);
  }, [rendered, showLineNumbers]);

  // The heading nearest the top of the viewport is the "current" one for outline and bookmarks.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const headings = [...content.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
    headings.forEach((heading) => { heading.tabIndex = -1; });
    if (headings.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) callbacks.current.onActiveHeading((visible.target as HTMLElement).id);
    }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [rendered]);

  // Images open in the viewer by click or keyboard.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const images = (): HTMLImageElement[] => [...content.querySelectorAll<HTMLImageElement>('img.reader-image')];
    for (const image of images()) {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', `View image${image.alt ? `: ${image.alt}` : ''}`);
    }
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
      if (anchor.dataset.localPath) {
        event.preventDefault();
        callbacks.current.onLocalLink(anchor.dataset.localPath, new URL(anchor.href).hash);
      } else if (anchor.getAttribute('href') === '#invalid-link') {
        event.preventDefault();
        callbacks.current.notify('This link points to a file next to the document. Open the folder that contains it to follow relative links.');
      } else if (anchor.hash && anchor.getAttribute('href')?.startsWith('#')) {
        const heading = content.querySelector<HTMLElement>(`[id="${CSS.escape(decodeURIComponent(anchor.hash.slice(1)))}"]`);
        if (heading) {
          event.preventDefault();
          heading.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
          heading.focus({ preventScroll: true });
          history.replaceState(null, '', anchor.hash);
        }
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if ((event.key === 'Enter' || event.key === ' ') && open(event.target)) event.preventDefault();
    };
    content.addEventListener('click', onClick);
    content.addEventListener('keydown', onKey);
    return () => { content.removeEventListener('click', onClick); content.removeEventListener('keydown', onKey); };
  }, [rendered]);

  // Marking runs when the term or document changes; moving between matches only moves a class.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const timer = window.setTimeout(() => {
      matches.current = markSearchMatches(content, searchTerm);
      callbacks.current.onSearchResults(matches.current.length);
    }, searchTerm.length > 2 ? 0 : 120);
    return () => window.clearTimeout(timer);
  }, [rendered, searchTerm]);

  useEffect(() => () => { if (contentRef.current) clearSearchMarks(contentRef.current); }, []);

  useEffect(() => {
    const list = matches.current;
    list.forEach((mark, index) => {
      const current = index === searchIndex;
      mark.classList.toggle('is-current', current);
      if (current) mark.setAttribute('aria-current', 'true'); else mark.removeAttribute('aria-current');
    });
    list[searchIndex]?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  }, [searchIndex, searchTerm, rendered]);

  const metadata = Object.entries(rendered.metadata);
  return <article className={`markdown-body ${showLineNumbers ? 'has-line-numbers' : ''}`} aria-label={props.label}>
    {metadata.length > 0 && <details className="frontmatter"><summary>Document details</summary><dl>{metadata.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl></details>}
    {rendered.frontmatterError && <p className="inline-notice" role="note">{rendered.frontmatterError}</p>}
    <div ref={contentRef} className="document-content" dangerouslySetInnerHTML={{ __html: rendered.html }} />
    <footer className="document-end"><span>End of document</span><span>{props.wordCount.toLocaleString()} words</span></footer>
  </article>;
});
