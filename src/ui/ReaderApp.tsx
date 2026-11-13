import { browser } from 'wxt/browser';
import {
  AlignJustify,
  ArrowDownToLine,
  BookMarked,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  FilePlus2,
  FolderOpen,
  Maximize,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Search,
  Settings2,
  Sun,
  Type,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type ReactElement,
  type KeyboardEvent,
} from 'react';
import { renderMarkdown, sanitizeSvg, type RenderedMarkdown } from '../core/markdown';
import { localAutoOpenState, localFileNameFromUrl, LocalFileError, parseLocalMarkdownUrl, readLocalMarkdown, type LocalAutoOpenState } from '../core/local-file';
import { documentNameFromUrl, readRemoteMarkdown } from '../core/remote';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../core/settings';
import {
  addRecent,
  getBookmarks,
  getLocalHandoff,
  getReadingPosition,
  loadSettings,
  saveReadingPosition,
  saveSettings,
  takePendingDocument,
  toggleBookmark,
  type Bookmark,
} from '../shared/storage';
import { getLocalFileAccess } from '../shared/file-access';
import { themeClass, themeStyle } from './theme';

interface ReaderDocument {
  id: string;
  name: string;
  source: string;
  text: string;
  kind: 'local' | 'remote' | 'page';
  sourceUrl?: string;
  documentPath?: string;
  lastModified?: number;
  size?: number;
  explicitText?: boolean;
}

interface FolderWorkspace {
  name: string;
  files: Map<string, File>;
  assets: Map<string, string>;
  expanded: Set<string>;
}

interface DirectoryHandleLike {
  name: string;
  entries(): AsyncIterable<[string, FileHandleLike | DirectoryHandleLike]>;
}

interface FileHandleLike {
  kind: 'file';
  getFile(): Promise<File>;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isFile: boolean;
}

interface ReaderCommand {
  label: string;
  hint: string;
  run: () => void;
}

const imagePathPattern = /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu;
const markdownFilePattern = /\.(?:md|markdown|mdx|mkd|mdown|txt)$/iu;

function buildFolderTree(paths: Iterable<string>): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of [...paths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))) {
    const parts = path.split('/').filter(Boolean);
    let branch = root;
    let current = '';
    parts.forEach((part, index) => {
      current = current ? `${current}/${part}` : part;
      let node = branch.find((item) => item.name === part);
      if (!node) {
        node = { name: part, path: current, children: [], isFile: index === parts.length - 1 };
        branch.push(node);
      }
      branch = node.children;
    });
  }
  return root;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function stableIdentifier(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ (value.charCodeAt(index) ?? 0), 0x01000193);
  return (hash >>> 0).toString(36);
}

const localAccessMessages: Record<Exclude<LocalAutoOpenState, 'active'>, string> = {
  disabled: 'Automatic opening of local files is off. Turn it on in Settings › File handling, or use Open file.',
  'permission-required': 'The browser has not given Markdown Reader access to local files. Settings › File handling explains how to allow it.',
  unavailable: 'This browser cannot report local file access for extensions. Use Open file instead.',
};

function fileDocumentId(identity: string, size: number, lastModified: number): string {
  return `local:${size.toString(36)}:${lastModified.toString(36)}:${stableIdentifier(identity)}`;
}

async function renderDiagram(element: HTMLElement): Promise<void> {
  const kind = element.dataset.diagram;
  const encoded = element.dataset.source ?? '';
  let source = '';
  try {
    source = decodeURIComponent(encoded);
  } catch {
    element.textContent = 'The diagram source could not be decoded.';
    return;
  }

  try {
    if (kind === 'mermaid') {
      const module = await import('mermaid');
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        look: 'classic',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        suppressErrorRendering: true,
      });
      const result = await mermaid.render(`reader-diagram-${crypto.randomUUID()}`, source);
      element.innerHTML = sanitizeSvg(result.svg);
    } else if (kind === 'graphviz') {
      const module = await import('@viz-js/viz');
      const graphviz = await module.instance();
      const svg = graphviz.renderString(source, { engine: 'dot', format: 'svg' });
      element.innerHTML = sanitizeSvg(svg);
    }
    if (element.firstElementChild) element.setAttribute('aria-label', `${kind === 'mermaid' ? 'Mermaid' : 'Graphviz'} diagram`);
    else element.textContent = 'The diagram returned no visible output.';
  } catch (error) {
    const details = error instanceof Error ? error.message.slice(0, 240) : 'Diagram syntax is not valid.';
    const message = document.createElement('p');
    message.className = 'diagram-error';
    message.textContent = `Diagram could not be rendered. ${details}`;
    element.replaceChildren(message);
    element.setAttribute('role', 'alert');
  }
}

function markSearchMatches(container: HTMLElement, term: string): HTMLElement[] {
  container.querySelectorAll('mark.search-hit').forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent ?? '')));
  if (!term.trim()) return [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('button, pre, code, script, style, .diagram-placeholder')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) if (walker.currentNode instanceof Text) nodes.push(walker.currentNode);
  const matches: HTMLElement[] = [];
  const needle = term.toLocaleLowerCase();
  for (const node of nodes) {
    const value = node.data;
    const lower = value.toLocaleLowerCase();
    let offset = 0;
    const fragment = document.createDocumentFragment();
    let changed = false;
    while (offset < value.length) {
      const index = lower.indexOf(needle, offset);
      if (index < 0) break;
      if (index > offset) fragment.append(value.slice(offset, index));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = value.slice(index, index + term.length);
      fragment.append(mark);
      matches.push(mark);
      offset = index + term.length;
      changed = true;
    }
    if (changed) {
      if (offset < value.length) fragment.append(value.slice(offset));
      node.replaceWith(fragment);
    }
  }
  return matches;
}

function splitHighlightedNode(node: Node): Node[][] {
  if (node instanceof Text) return node.data.split('\n').map((line) => line ? [document.createTextNode(line)] : []);
  if (!(node instanceof Element)) return [[node.cloneNode(true)]];
  const lines: Node[][] = [[]];
  for (const child of [...node.childNodes]) {
    const parts = splitHighlightedNode(child);
    parts.forEach((part, index) => {
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

function addCodeLines(code: HTMLElement): void {
  if (code.dataset.lineMarkup === 'true') return;
  const lines: Node[][] = [[]];
  for (const child of [...code.childNodes]) {
    const parts = splitHighlightedNode(child);
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      lines[lines.length - 1]?.push(...part);
    });
  }
  if (code.textContent?.endsWith('\n') && lines.at(-1)?.every((node) => !node.textContent) && lines.length > 1) lines.pop();
  code.replaceChildren(...lines.map((nodes, index) => {
    const line = document.createElement('span');
    line.className = 'code-line';
    line.dataset.line = String(index + 1);
    nodes.forEach((node) => line.append(node));
    return line;
  }));
  code.dataset.lineMarkup = 'true';
}

/** Smooth scrolling unless the user asked the system to reduce motion. */
const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

export function ReaderApp(): ReactElement {
  const [settings, setSettings] = useState<ReaderSettings>({ ...DEFAULT_SETTINGS });
  const [activeDocument, setActiveDocument] = useState<ReaderDocument>();
  const [folder, setFolder] = useState<FolderWorkspace>();
  const [rendered, setRendered] = useState<RenderedMarkdown>();
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeHeading, setActiveHeading] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 760px)').matches);
  const [sidebarTab, setSidebarTab] = useState<'outline' | 'files' | 'bookmarks'>('outline');
  const [folderFilter, setFolderFilter] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const [wideMode, setWideMode] = useState(false);
  const [sourceMode, setSourceMode] = useState<'rendered' | 'source' | 'split'>('rendered');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchMatches, setSearchMatches] = useState<HTMLElement[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxScale, setLightboxScale] = useState(1);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [remoteInput, setRemoteInput] = useState(() => { const launch = new URLSearchParams(window.location.search).get('url') ?? ''; return launch.startsWith('file:') ? '' : launch; });
  const [loadingRemote, setLoadingRemote] = useState(false);

  const articleRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const commandDialogRef = useRef<HTMLDialogElement>(null);
  const remoteDialogRef = useRef<HTMLDialogElement>(null);
  const shortcutDialogRef = useRef<HTMLDialogElement>(null);
  const lightboxDialogRef = useRef<HTMLDialogElement>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const imageListRef = useRef<HTMLImageElement[]>([]);
  const currentLoadRef = useRef(0);

  const style = useMemo(() => themeStyle(settings), [settings]);
  const tree = useMemo(() => buildFolderTree([...(folder?.files.keys() ?? [])].filter((path) => markdownFilePattern.test(path))), [folder]);
  const currentBookmark = activeDocument && rendered?.headings.find((heading) => heading.id === activeHeading);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSettings(), getBookmarks(), takePendingDocument()]).then(([saved, savedBookmarks, pending]) => {
      if (cancelled) return;
      setSettings(saved);
      setBookmarks(savedBookmarks);
      if (pending) {
        const doc: ReaderDocument = {
          id: pending.kind === 'page' ? `page:${stableIdentifier(pending.source)}` : fileDocumentId(pending.name, pending.size ?? pending.text.length, pending.lastModified ?? 0),
          name: pending.name,
          source: pending.source,
          text: pending.text,
          kind: pending.kind,
          ...(pending.lastModified !== undefined ? { lastModified: pending.lastModified } : {}),
          ...(pending.size !== undefined ? { size: pending.size } : {}),
        };
        setActiveDocument(doc);
        void addRecent({ id: doc.id, name: doc.name, kind: doc.kind }).catch(() => undefined);
      }
    }).catch(() => setError('Reader preferences could not be loaded. You can still open a document.'));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!activeDocument) {
      setRendered(undefined);
      return;
    }
    const loadId = ++currentLoadRef.current;
    setRendering(true);
    setRendered(undefined);
    setError('');
    void renderMarkdown(activeDocument.text, {
      ...(activeDocument.sourceUrl ? { sourceUrl: activeDocument.sourceUrl } : {}),
      ...(activeDocument.documentPath ? { documentPath: activeDocument.documentPath } : {}),
      ...(folder ? { assetUrls: folder.assets, documentPaths: new Set(folder.files.keys()) } : {}),
      allowRemoteImages: settings.allowRemoteImages,
    }).then((result) => {
      if (loadId === currentLoadRef.current) setRendered(result);
    }).catch((reason: unknown) => {
      if (loadId === currentLoadRef.current) setError(reason instanceof Error ? reason.message : 'This document could not be rendered.');
    }).finally(() => {
      if (loadId === currentLoadRef.current) setRendering(false);
    });
  }, [activeDocument, folder, settings.allowRemoteImages]);

  useEffect(() => {
    if (!rendered || sourceMode === 'source') return;
    const article = articleRef.current;
    if (!article) return;
    const nodes = [...article.querySelectorAll<HTMLElement>('[data-diagram]')];
    if (nodes.length === 0) return;
    const active = new WeakSet<HTMLElement>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (!entry.isIntersecting || active.has(element)) continue;
        active.add(element);
        observer.unobserve(element);
        void renderDiagram(element);
      }
    }, { rootMargin: '240px 0px' });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [rendered, sourceMode]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const headings = [...article.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
    if (headings.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveHeading((visible.target as HTMLElement).id);
    }, { rootMargin: '-8% 0px -72% 0px', threshold: 0 });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [rendered, sourceMode]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || sourceMode === 'source') return;
    const matches = markSearchMatches(article, searchOpen ? searchTerm : '');
    setSearchMatches(matches);
    if (matches.length > 0) {
      const nextIndex = Math.min(searchIndex, matches.length - 1);
      setSearchIndex(nextIndex);
      matches[nextIndex]?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    }
  }, [rendered, searchOpen, searchTerm, searchIndex, sourceMode]);

  useEffect(() => {
    const dialog = commandDialogRef.current;
    if (commandOpen && dialog && !dialog.open) dialog.showModal();
    if (!commandOpen && dialog?.open) dialog.close();
    if (commandOpen) window.setTimeout(() => commandInputRef.current?.focus(), 25);
  }, [commandOpen]);

  useEffect(() => {
    const dialog = shortcutDialogRef.current;
    if (shortcutHelpOpen && dialog && !dialog.open) dialog.showModal();
    if (!shortcutHelpOpen && dialog?.open) dialog.close();
  }, [shortcutHelpOpen]);

  useEffect(() => {
    const dialog = remoteDialogRef.current;
    if (remoteDialogOpen && dialog && !dialog.open) dialog.showModal();
    if (!remoteDialogOpen && dialog?.open) dialog.close();
    if (remoteDialogOpen) window.setTimeout(() => document.getElementById('remote-url-dialog')?.focus(), 25);
  }, [remoteDialogOpen]);

  useEffect(() => {
    const dialog = lightboxDialogRef.current;
    if (lightboxIndex !== null && dialog && !dialog.open) dialog.showModal();
    if (lightboxIndex === null && dialog?.open) dialog.close();
  }, [lightboxIndex]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || sourceMode === 'source') return;
    imageListRef.current = [...article.querySelectorAll<HTMLImageElement>('img.reader-image')];
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !target.matches('.reader-image')) return;
      const index = imageListRef.current.indexOf(target);
      if (index >= 0) {
        setLightboxScale(1);
        setLightboxIndex(index);
      }
    };
    article.addEventListener('click', handleClick);
    return () => article.removeEventListener('click', handleClick);
  }, [rendered, sourceMode]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || sourceMode === 'source') return;
    article.querySelectorAll<HTMLElement>('.code-block code').forEach(addCodeLines);
    article.classList.toggle('has-line-numbers', settings.showLineNumbers);
  }, [rendered, sourceMode, settings.showLineNumbers]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || sourceMode === 'source') return;
    const handleCodeAction = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>('button[data-action]');
      const action = button?.dataset.action;
      const block = button?.closest<HTMLElement>('[data-code-block]');
      const pre = block?.querySelector('pre');
      if (!button || !block || !pre || !action) return;
      if (action === 'copy-code') {
        let code = pre.querySelector('code')?.textContent ?? '';
        try { code = decodeURIComponent(button.dataset.code ?? ''); } catch { /* Use rendered code if old markup lacks its source. */ }
        void navigator.clipboard.writeText(code).then(() => {
          button.textContent = 'Copied';
          window.setTimeout(() => { button.textContent = 'Copy'; }, 1400);
        }).catch(() => setNotice('Clipboard access was unavailable. Select the code and use your browser’s copy command.'));
      } else if (action === 'wrap-code') {
        const wrapped = button.getAttribute('aria-pressed') !== 'true';
        pre.classList.toggle('is-wrapped', wrapped);
        button.setAttribute('aria-pressed', String(wrapped));
        button.textContent = wrapped ? 'Unwrap' : 'Wrap';
      } else if (action === 'collapse-code') {
        const expanded = button.getAttribute('aria-expanded') !== 'false';
        block.classList.toggle('is-collapsed', expanded);
        button.setAttribute('aria-expanded', String(!expanded));
        button.textContent = expanded ? 'Expand' : 'Collapse';
      } else if (action === 'download-code') {
        const encoded = button.dataset.code ?? '';
        let code = '';
        try { code = decodeURIComponent(encoded); } catch { setNotice('This code block could not be prepared for download.'); return; }
        const extension = (button.dataset.language || 'txt').toLowerCase().replace(/[^a-z0-9]+/gu, '').slice(0, 10) || 'txt';
        const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `code.${extension}`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    };
    article.addEventListener('click', handleCodeAction);
    return () => article.removeEventListener('click', handleCodeAction);
  }, [rendered, sourceMode]);

  useEffect(() => {
    // Coalesce scroll events into one state update per frame instead of re-rendering per event.
    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeDocument, rendered]);

  const wordCount = useMemo(() => (rendered ? rendered.body.trim().split(/\s+/u).filter(Boolean).length : 0), [rendered]);

  useEffect(() => {
    if (!activeDocument || !settings.restorePosition) return;
    let cancelled = false;
    void getReadingPosition(activeDocument.id).then((position) => {
      if (!cancelled && position !== undefined && position > 0.01) {
        window.scrollTo({ top: position * (document.documentElement.scrollHeight - window.innerHeight), behavior: 'instant' });
      }
    });
    return () => { cancelled = true; };
  }, [activeDocument, rendered, settings.restorePosition]);

  useEffect(() => {
    if (!activeDocument || !settings.restorePosition) return;
    let timer = 0;
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0) void saveReadingPosition(activeDocument.id, window.scrollY / max);
      }, 450);
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => { window.clearTimeout(timer); window.removeEventListener('scroll', save); };
  }, [activeDocument, settings.restorePosition]);

  useEffect(() => {
    const currentDocument = activeDocument;
    const remoteUrl = currentDocument?.kind === 'remote' ? currentDocument.sourceUrl : undefined;
    if (!currentDocument || !remoteUrl || !settings.liveReloadEnabled) return;
    let cancelled = false;
    let timer = 0;
    const refresh = () => {
      if (timer) window.clearInterval(timer);
      if (document.visibilityState !== 'visible') return;
      timer = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
      void fetchRemoteDocument(remoteUrl, false).then((doc) => {
        if (!cancelled && doc && doc.text !== currentDocument.text) {
          setActiveDocument((current) => current?.sourceUrl === remoteUrl && current.text !== doc.text ? doc : current);
          setNotice('The remote document changed and was refreshed.');
          window.setTimeout(() => setNotice(''), 2400);
        }
      }).catch(() => undefined);
      }, settings.liveReloadSeconds * 1000);
    };
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [activeDocument, settings.liveReloadEnabled, settings.liveReloadSeconds]);

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const targetIsEditable = isEditableTarget(event.target);
      if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); return; }
      if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); window.setTimeout(() => searchInputRef.current?.focus(), 0); return; }
      if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (event.shiftKey) folderInputRef.current?.click(); else fileInputRef.current?.click();
        return;
      }
      if (mod && (event.key === '+' || event.key === '=')) { event.preventDefault(); updateSettings({ fontSize: Math.min(28, settings.fontSize + 1) }); return; }
      if (mod && event.key === '-') { event.preventDefault(); updateSettings({ fontSize: Math.max(14, settings.fontSize - 1) }); return; }
      if (mod && event.key === '0') { event.preventDefault(); updateSettings({ fontSize: DEFAULT_SETTINGS.fontSize }); return; }
      if (event.key === '?' && !targetIsEditable) { event.preventDefault(); setShortcutHelpOpen(true); return; }
      if (targetIsEditable || event.altKey || mod) return;
      if (event.key.toLowerCase() === 't') cycleTheme();
      else if (event.key.toLowerCase() === 'f') setFocusMode((value) => !value);
      else if (event.key === 'Escape') {
        setSearchOpen(false);
        setCommandOpen(false);
        setShortcutHelpOpen(false);
        setLightboxIndex(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [settings]);

  const updateSettings = useCallback((change: Partial<ReaderSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...change };
      void saveSettings(next).catch(() => setError('Settings could not be saved.'));
      return next;
    });
  }, []);

  const cycleTheme = useCallback(() => {
    const themes: ReaderSettings['theme'][] = ['paper', 'snow', 'sepia', 'graphite', 'midnight', 'system'];
    const next = themes[(themes.indexOf(settings.theme) + 1) % themes.length] ?? 'paper';
    updateSettings({ theme: next, customThemeId: null });
  }, [settings.theme, updateSettings]);

  const makeLocalDocument = useCallback(async (file: File, path: string, currentFolder?: FolderWorkspace): Promise<void> => {
    if (file.size > 16_000_000) {
      setError('This file is larger than the 16 MB reading limit. Split it into smaller Markdown files for this session.');
      return;
    }
    const id = currentFolder ? fileDocumentId(`${currentFolder.name}/${path}`, file.size, file.lastModified) : fileDocumentId(file.name, file.size, file.lastModified);
    const text = await file.text();
    setActiveDocument({
      id,
      name: path.split('/').at(-1) ?? file.name,
      source: path,
      text,
      kind: 'local',
      documentPath: path,
      lastModified: file.lastModified,
      size: file.size,
      explicitText: /\.txt$/iu.test(file.name),
    });
    setSourceMode('rendered');
    setActiveHeading('');
    setSearchOpen(false);
    setScrollProgress(0);
    await addRecent({ id, name: path.split('/').at(-1) ?? file.name, kind: 'local' });
  }, []);

  const loadOneFile = useCallback(async (file: File) => {
    if (!markdownFilePattern.test(file.name) && file.type !== 'text/markdown' && file.type !== 'text/plain') {
      setError('Choose a Markdown file, or a .txt file you opened intentionally.');
      return;
    }
    setFolder(undefined);
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    await makeLocalDocument(file, file.name);
    setError('');
  }, [makeLocalDocument]);

  const openFolderFiles = useCallback(async (files: File[], folderName: string) => {
    if (files.length > 2500) {
      setError('This folder contains more than 2,500 files. Choose a smaller folder to keep the reader responsive.');
      return;
    }
    const entries = new Map<string, File>();
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      entries.set(path.replace(/^.*?\//u, ''), file);
    }
    const assetUrls = new Map<string, string>();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    for (const [path, file] of entries) {
      if (!imagePathPattern.test(path)) continue;
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      assetUrls.set(path, url);
    }
    const workspace: FolderWorkspace = { name: folderName, files: entries, assets: assetUrls, expanded: new Set() };
    setFolder(workspace);
    setSidebarOpen(true);
    setSidebarTab('files');
    setError('');
    const markdownPaths = [...entries.keys()].filter((path) => markdownFilePattern.test(path));
    const first = markdownPaths.find((path) => /(?:^|\/)readme\.md$/iu.test(path)) ?? markdownPaths[0];
    if (!first) {
      setActiveDocument(undefined);
      setError('This folder has no Markdown files. Choose a folder that contains .md, .markdown, or .mdx documents.');
      return;
    }
    const file = entries.get(first);
    if (file) await makeLocalDocument(file, first, workspace);
  }, [makeLocalDocument]);

  const openDirectoryPicker = useCallback(async () => {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandleLike> }).showDirectoryPicker;
    if (!picker) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const root = await picker();
      const files: File[] = [];
      let truncated = false;
      const walk = async (handle: DirectoryHandleLike, prefix: string): Promise<void> => {
        for await (const [name, entry] of handle.entries()) {
          if (files.length >= 2500) { truncated = true; return; }
          const path = prefix ? `${prefix}/${name}` : name;
          if ('kind' in entry && entry.kind === 'file') {
            const file = await entry.getFile();
            Object.defineProperty(file, 'webkitRelativePath', { value: path });
            files.push(file);
          } else {
            await walk(entry as DirectoryHandleLike, path);
          }
        }
      };
      await walk(root, '');
      await openFolderFiles(files, root.name);
      if (truncated) setError('Only the first 2,500 files were loaded. Choose a smaller folder to see every file.');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError('The folder could not be read. Check that the browser can access it, then try again.');
    }
  }, [openFolderFiles]);

  const onFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) void loadOneFile(file);
    event.currentTarget.value = '';
  }, [loadOneFile]);

  const onFolderChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    const firstPath = files[0]?.webkitRelativePath ?? '';
    const folderName = firstPath.split('/')[0] || 'Selected folder';
    if (files.length > 0) void openFolderFiles(files, folderName);
    event.currentTarget.value = '';
  }, [openFolderFiles]);

  const fetchRemoteDocument = useCallback(async (rawUrl: string, reportErrors = true): Promise<ReaderDocument | undefined> => {
    let url: URL;
    try { url = new URL(rawUrl); } catch { if (reportErrors) setError('Enter a complete Markdown URL beginning with https:// or http://.'); return undefined; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      if (reportErrors) setError('Only public HTTP and HTTPS URLs without embedded credentials are supported.');
      return undefined;
    }
    const granted = await browser.permissions.contains({ origins: [`${url.origin}/*`] });
    if (!granted) {
      if (reportErrors) setError(`Allow access to ${url.origin} in the popup, then open this address again.`);
      return undefined;
    }
    setLoadingRemote(reportErrors);
    try {
      const { text, finalUrl } = await readRemoteMarkdown(url, fetch, {
        isOriginAllowed: async (origin) => browser.permissions.contains({ origins: [`${origin}/*`] }),
      });
      const name = documentNameFromUrl(url);
      const id = `remote:${url.href}`;
      const doc: ReaderDocument = { id, name, source: url.href, sourceUrl: finalUrl, text, kind: 'remote' };
      if (reportErrors) {
        setActiveDocument(doc);
        setSourceMode('rendered');
        setRemoteInput(url.href);
        setRemoteDialogOpen(false);
        setError('');
        setScrollProgress(0);
        void addRecent({ id, name, kind: 'remote', url: url.href }).catch(() => undefined);
      }
      return doc;
    } catch (reason) {
      if (reportErrors) setError(reason instanceof Error ? reason.message : 'The Markdown URL could not be loaded. Check the address and try again.');
      return undefined;
    } finally {
      setLoadingRemote(false);
    }
  }, []);

  const loadRemoteFromInput = useCallback(async () => {
    let url: URL;
    try { url = new URL(remoteInput); } catch { setError('Enter a complete Markdown URL beginning with https:// or http://.'); return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      setError('Only public HTTP and HTTPS URLs without embedded credentials are supported.');
      return;
    }
    const granted = await browser.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) { setError(`Access to ${url.origin} was not granted. You can still read a local file or folder.`); return; }
    await fetchRemoteDocument(url.href, true);
  }, [fetchRemoteDocument, remoteInput]);

  /** Opens a local file sent by automatic opening: read it directly, or use the handoff copy. */
  const openLocalUrl = useCallback(async (rawUrl: string, token: string | null): Promise<void> => {
    const url = parseLocalMarkdownUrl(rawUrl);
    if (!url) { setError('This local address is not a Markdown file the reader can open.'); return; }
    const [saved, access] = await Promise.all([loadSettings(), getLocalFileAccess()]);
    const state = localAutoOpenState(saved.autoOpenLocalFiles, access);
    if (state !== 'active') { setError(localAccessMessages[state]); return; }
    let text: string | undefined;
    try {
      text = await readLocalMarkdown(url, fetch);
    } catch (reason) {
      if (reason instanceof LocalFileError && reason.kind === 'size') { setError(reason.message); return; }
      // Firefox does not let extension pages read file URLs; the content script's copy is used there.
      text = token ? (await getLocalHandoff(token, url.href).catch(() => undefined))?.text : undefined;
      if (text === undefined) {
        setError(import.meta.env.FIREFOX
          ? 'This local file could not be opened automatically. Files larger than 4 MB, and files reopened after the browser restarts, need Open file in Firefox.'
          : reason instanceof Error ? reason.message : 'This local file could not be read.');
        return;
      }
    }
    const name = localFileNameFromUrl(url);
    const id = `local-url:${stableIdentifier(url.href)}`;
    setActiveDocument({ id, name, source: name, text, kind: 'local' });
    setSourceMode('rendered');
    setScrollProgress(0);
    setError('');
    void addRecent({ id, name, kind: 'local' }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const launchUrl = params.get('url');
    if (!launchUrl) return;
    if (launchUrl.startsWith('file:')) {
      void openLocalUrl(launchUrl, params.get('local')).catch(() => setError('This local file could not be opened.'));
      return;
    }
    let launchOrigin: string;
    try { launchOrigin = `${new URL(launchUrl).origin}/*`; } catch { setError('The link is not a valid HTTP or HTTPS URL.'); return; }
    let cancelled = false;
    void browser.permissions.contains({ origins: [launchOrigin] }).then((granted) => {
      if (cancelled) return;
      if (granted) void fetchRemoteDocument(launchUrl, true);
      else setError('Allow access to this URL’s site in the popup, then open the link again.');
    }).catch(() => setError('This URL could not be checked for permission.'));
    return () => { cancelled = true; };
  }, [fetchRemoteDocument, openLocalUrl]);

  const updateFolderExpansion = useCallback((path: string) => {
    setFolder((current) => {
      if (!current) return current;
      const expanded = new Set(current.expanded);
      if (expanded.has(path)) expanded.delete(path); else expanded.add(path);
      return { ...current, expanded };
    });
  }, []);

  const openFolderPath = useCallback(async (path: string, hash = '') => {
    const file = folder?.files.get(path);
    if (!file) {
      setError(`“${path}” is not in the selected folder.`);
      return;
    }
    await makeLocalDocument(file, path, folder);
    if (hash) window.setTimeout(() => document.getElementById(decodeURIComponent(hash.replace(/^#/u, '')))?.scrollIntoView({ behavior: scrollBehavior() }), 150);
  }, [folder, makeLocalDocument]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || sourceMode === 'source') return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[data-local-path]');
      if (!anchor) return;
      event.preventDefault();
      void openFolderPath(anchor.dataset.localPath ?? '', new URL(anchor.href).hash);
    };
    article.addEventListener('click', handleClick);
    return () => article.removeEventListener('click', handleClick);
  }, [rendered, sourceMode, openFolderPath]);

  const saveCurrentBookmark = useCallback(async () => {
    if (!activeDocument || !rendered || !activeHeading) return;
    const heading = rendered.headings.find((item) => item.id === activeHeading);
    if (!heading) return;
    const added = await toggleBookmark({ id: activeDocument.id, documentName: activeDocument.name, headingId: heading.id, headingText: heading.text, createdAt: Date.now() });
    setBookmarks(await getBookmarks());
    setNotice(added ? 'Section bookmarked.' : 'Bookmark removed.');
    window.setTimeout(() => setNotice(''), 2200);
  }, [activeDocument, activeHeading, rendered]);

  const toggleSourceMode = useCallback(() => {
    setSourceMode((mode) => mode === 'rendered' ? 'source' : mode === 'source' ? 'split' : 'rendered');
  }, []);

  const openRemoteUrl = useCallback(() => {
    const input = document.getElementById('remote-url');
    if (input instanceof HTMLInputElement) input.focus();
    else { setError(''); setRemoteDialogOpen(true); }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => setNotice('Fullscreen is not available in this browser window.'));
  }, []);

  const openImageAt = useCallback((direction: -1 | 1) => {
    if (lightboxIndex === null || imageListRef.current.length < 2) return;
    const next = (lightboxIndex + direction + imageListRef.current.length) % imageListRef.current.length;
    setLightboxScale(1);
    setLightboxIndex(next);
  }, [lightboxIndex]);

  const commands = useMemo<ReaderCommand[]>(() => [
    { label: 'Open Markdown file', hint: 'Ctrl/⌘ O', run: () => fileInputRef.current?.click() },
    { label: 'Open folder workspace', hint: 'Ctrl/⌘ Shift O', run: () => void openDirectoryPicker() },
    { label: 'Open Markdown URL', hint: 'Permission required', run: openRemoteUrl },
    { label: 'Search this document', hint: 'Ctrl/⌘ F', run: () => { setSearchOpen(true); window.setTimeout(() => searchInputRef.current?.focus(), 0); } },
    { label: 'Change reading theme', hint: 'T', run: cycleTheme },
    { label: 'Toggle navigation sidebar', hint: '', run: () => setSidebarOpen((value) => !value) },
    { label: 'Enter or leave focus mode', hint: 'F', run: () => setFocusMode((value) => !value) },
    { label: 'Toggle raw source / rendered view', hint: '', run: toggleSourceMode },
    { label: 'Print or save as PDF', hint: 'Ctrl/⌘ P', run: () => window.print() },
    { label: 'Keyboard shortcuts', hint: '?', run: () => setShortcutHelpOpen(true) },
    { label: 'Open settings', hint: '', run: () => void browser.tabs.create({ url: new URL('/options.html', window.location.href).href }) },
  ], [cycleTheme, openDirectoryPicker, openRemoteUrl, toggleSourceMode]);

  const runCommand = useCallback((command: ReaderCommand) => {
    setCommandOpen(false);
    command.run();
  }, []);

  const filteredCommands = commands.filter((command) => command.label.toLocaleLowerCase().includes(commandFilter.toLocaleLowerCase()));

  const onReaderDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find((item) => markdownFilePattern.test(item.name) || item.type === 'text/markdown');
    if (file) void loadOneFile(file);
    else setError('Drop a Markdown file to open it. For a folder, use Open folder.');
  }, [loadOneFile]);

  const onReaderKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && lightboxIndex !== null) setLightboxIndex(null);
  }, [lightboxIndex]);

  const folderRows = (nodes: TreeNode[], depth = 0): ReactElement[] => nodes.flatMap((node) => {
    const shown = !folderFilter || node.name.toLocaleLowerCase().includes(folderFilter.toLocaleLowerCase()) || node.path.toLocaleLowerCase().includes(folderFilter.toLocaleLowerCase());
    const childRows = node.isFile || (folder && !folderFilter && !folder.expanded.has(node.path)) ? [] : folderRows(node.children, depth + 1);
    if (!shown && childRows.length === 0) return [];
    if (node.isFile) {
      const selected = activeDocument?.documentPath === node.path;
      return [<button key={node.path} className={`tree-row tree-file ${selected ? 'is-current' : ''}`} style={{ '--tree-depth': depth } as CSSProperties} type="button" onClick={() => void openFolderPath(node.path)} title={node.path}>
        <FilePlus2 size={15} aria-hidden="true" /><span>{node.name}</span>
      </button>];
    }
    return [<div className="tree-group" key={node.path}>
      <button className="tree-row tree-folder" style={{ '--tree-depth': depth } as CSSProperties} type="button" aria-expanded={folder?.expanded.has(node.path) ?? false} onClick={() => updateFolderExpansion(node.path)}>
        <ChevronDown className={folder?.expanded.has(node.path) ? '' : 'is-collapsed'} size={14} aria-hidden="true" /><FolderOpen size={15} aria-hidden="true" /><span>{node.name}</span>
      </button>
      {childRows}
    </div>];
  });

  const currentImage = lightboxIndex === null ? undefined : imageListRef.current[lightboxIndex];
  const isDark = settings.theme === 'graphite' || settings.theme === 'midnight' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return <div id="reader" className={`reader-shell ${themeClass(settings)} font-${settings.fontFamily} code-${settings.codeTheme} ${focusMode ? 'is-focus' : ''} ${wideMode ? 'is-wide' : ''} ${sidebarOpen ? 'sidebar-visible' : 'sidebar-hidden'}`} style={style} onKeyDown={onReaderKeyDown} onDragOver={(event) => event.preventDefault()} onDrop={onReaderDrop}>
    <a className="skip-link" href="#reader-main">Skip to document</a>
    <header className="reader-toolbar">
      <a className="brand-mark" href={new URL('/reader.html', window.location.href).href} aria-label="Markdown Reader home"><BookOpen size={18} aria-hidden="true" /></a>
      <div className="toolbar-document" title={activeDocument?.source ?? 'Open a Markdown document'}>
        <span className="toolbar-title">{activeDocument?.name ?? 'Markdown Reader'}</span>
        <span className="toolbar-source">{activeDocument ? `${activeDocument.kind === 'remote' ? 'Online document' : activeDocument.kind === 'page' ? 'Current page' : 'Local document'} · ${activeDocument.source}` : 'A quiet place for technical reading'}</span>
      </div>
      <div className="toolbar-actions">
        <button className="icon-button" type="button" title="Search this document (Ctrl/⌘ F)" aria-label="Search this document" onClick={() => { setSearchOpen((value) => !value); window.setTimeout(() => searchInputRef.current?.focus(), 0); }}><Search size={17} /></button>
        {currentBookmark && <button className="icon-button" type="button" title="Bookmark current section" aria-label="Bookmark current section" onClick={() => void saveCurrentBookmark()}><BookMarked size={17} /></button>}
        <button className="icon-button" type="button" title="Change theme (T)" aria-label="Change theme" onClick={cycleTheme}>{isDark ? <Sun size={17} /> : <Moon size={17} />}</button>
        <button className="icon-button" type="button" title="Open command palette (Ctrl/⌘ K)" aria-label="Open command palette" onClick={() => setCommandOpen(true)}><Command size={17} /></button>
        <button className="icon-button" type="button" title="Settings" aria-label="Open settings" onClick={() => void browser.tabs.create({ url: new URL('/options.html', window.location.href).href })}><Settings2 size={17} /></button>
      </div>
    </header>

    <main id="reader-main" className="reader-layout" tabIndex={-1}>
      <div className="reading-progress" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(scrollProgress * 100)} style={{ transform: `scaleX(${scrollProgress})` }} />
      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".md,.markdown,.mdx,.mkd,.mdown,.txt,text/markdown,text/plain" aria-label="Choose a Markdown file" tabIndex={-1} onChange={onFileChange} />
      <input ref={folderInputRef} className="visually-hidden" type="file" multiple aria-label="Choose a folder of Markdown files" tabIndex={-1} onChange={onFolderChange} {...{ webkitdirectory: '', directory: '' }} />
      <aside className={`reader-sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="Document navigation" aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
        <div className="sidebar-topline">
          <div className="sidebar-tabs" role="tablist" aria-label="Navigation views">
            <button type="button" role="tab" aria-selected={sidebarTab === 'outline'} className={sidebarTab === 'outline' ? 'is-selected' : ''} onClick={() => setSidebarTab('outline')}>Outline</button>
            <button type="button" role="tab" aria-selected={sidebarTab === 'files'} className={sidebarTab === 'files' ? 'is-selected' : ''} onClick={() => setSidebarTab('files')}>Files</button>
            <button type="button" role="tab" aria-selected={sidebarTab === 'bookmarks'} className={sidebarTab === 'bookmarks' ? 'is-selected' : ''} onClick={() => setSidebarTab('bookmarks')}>Saved</button>
          </div>
          <button className="icon-button sidebar-dismiss" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={16} /></button>
        </div>
        {sidebarTab === 'outline' && <nav className="outline-nav" aria-label="Table of contents">
          {!rendered?.headings.length && <p className="sidebar-empty">Headings appear here as you read.</p>}
          {rendered?.headings.map((heading) => <a key={heading.id} href={`#${heading.id}`} className={`outline-link ${activeHeading === heading.id ? 'is-active' : ''}`} style={{ '--heading-level': heading.level } as CSSProperties} onClick={(event) => { event.preventDefault(); document.getElementById(heading.id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }); setSidebarOpen(false); }}>{heading.text}</a>)}
        </nav>}
        {sidebarTab === 'files' && <div className="file-navigation">
          <div className="sidebar-section-head"><span>{folder?.name ?? 'Folder workspace'}</span><button className="text-button" type="button" onClick={() => void openDirectoryPicker()}>{folder ? 'Change' : 'Open'}</button></div>
          {folder && <label className="folder-filter"><Search size={14} /><input value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} placeholder="Filter files" aria-label="Filter folder files" /></label>}
          {folder ? <div className="file-tree" role="tree" aria-label={`${folder.name} files`}>{folderRows(tree)}</div> : <div className="sidebar-empty"><p>Open a folder to read linked documents and images together.</p><button className="text-button" type="button" onClick={() => void openDirectoryPicker()}>Choose folder</button></div>}
        </div>}
        {sidebarTab === 'bookmarks' && <div className="bookmark-list">
          {!bookmarks.length && <p className="sidebar-empty">Save a section with the bookmark control in the toolbar.</p>}
          {bookmarks.map((bookmark) => <button key={`${bookmark.id}:${bookmark.headingId}`} className={`bookmark-row ${bookmark.id === activeDocument?.id ? 'is-current' : ''}`} type="button" onClick={() => {
            if (bookmark.id === activeDocument?.id) document.getElementById(bookmark.headingId)?.scrollIntoView({ behavior: scrollBehavior() });
            else setNotice(`“${bookmark.headingText}” is saved for ${bookmark.documentName}. Reopen that document to jump to it.`);
          }}><BookMarked size={15} /><span><strong>{bookmark.headingText}</strong><small>{bookmark.documentName}</small></span></button>)}
        </div>}
        <div className="sidebar-bottom"><span>{rendered?.headings.length ?? 0} sections</span><button className="icon-button" type="button" aria-label={sidebarOpen ? 'Hide navigation' : 'Show navigation'} onClick={() => setSidebarOpen((value) => !value)}>{sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button></div>
      </aside>

      <section className="reader-workspace" aria-label="Markdown document">
        {error && <div className="reader-error" role="alert"><strong>Something went wrong.</strong><span>{error}</span><button className="text-button" type="button" onClick={() => setError('')}>Dismiss</button></div>}
        {!activeDocument && <div className="welcome-screen">
          <div className="welcome-intro"><span className="welcome-icon"><BookOpen size={22} /></span><h1>Make room to read.</h1><p>Open a local file, bring in a folder, or read a Markdown URL. Your documents stay in this browser.</p></div>
          <div className="welcome-actions">
            <button type="button" className="welcome-action" onClick={() => fileInputRef.current?.click()}><FilePlus2 size={19} /><span><strong>Open a file</strong><small>Markdown or plain text, chosen locally</small></span><ChevronRight size={17} /></button>
            <button type="button" className="welcome-action" onClick={() => void openDirectoryPicker()}><FolderOpen size={19} /><span><strong>Open a folder</strong><small>Read documents and relative images together</small></span><ChevronRight size={17} /></button>
          </div>
          <form className="welcome-url" onSubmit={(event) => { event.preventDefault(); loadRemoteFromInput(); }}>
            <label htmlFor="remote-url">Read a Markdown URL</label>
            <div className="url-field"><input id="remote-url" name="markdownUrl" type="url" value={remoteInput} onChange={(event) => setRemoteInput(event.target.value)} placeholder="https://example.com/README.md" autoComplete="url" /><button type="submit" disabled={!remoteInput || loadingRemote}>{loadingRemote ? 'Loading…' : 'Open URL'}</button></div>
            <small>Access is requested for that site only. Remote images are blocked unless you enable them.</small>
          </form>
        </div>}

        {activeDocument && <>
          <div className="document-controls">
            <div className="document-actions-left">
              <button className="icon-button sidebar-toggle" type="button" aria-label="Toggle navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}>{sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>
              <span className="document-kind">{activeDocument.kind === 'remote' ? 'ONLINE' : activeDocument.kind === 'page' ? 'PAGE SNAPSHOT' : 'LOCAL FILE'}</span>
            </div>
            <div className="document-actions-right">
              <button className={`text-control ${wideMode ? 'is-active' : ''}`} type="button" aria-label="Wide reading width" aria-pressed={wideMode} onClick={() => setWideMode((value) => !value)}><AlignJustify size={15} /><span>{wideMode ? 'Comfort' : 'Wide'}</span></button>
              <button className={`text-control focus-mode-control ${focusMode ? 'is-active' : ''}`} type="button" aria-label={focusMode ? 'Leave focus mode' : 'Enter focus mode'} title="Toggle focus mode (F)" onClick={() => setFocusMode((value) => !value)}><Type size={15} /><span>{focusMode ? 'Leave focus' : 'Focus'}</span></button>
              <div className="view-switch" role="group" aria-label="Document view">
                <button type="button" aria-pressed={sourceMode === 'rendered'} className={sourceMode === 'rendered' ? 'is-selected' : ''} onClick={() => setSourceMode('rendered')}>Read</button>
                <button type="button" aria-pressed={sourceMode === 'source'} className={sourceMode === 'source' ? 'is-selected' : ''} onClick={() => setSourceMode('source')}>Source</button>
                <button type="button" aria-pressed={sourceMode === 'split'} className={sourceMode === 'split' ? 'is-selected' : ''} onClick={() => setSourceMode('split')}>Split</button>
              </div>
              {activeDocument.kind === 'remote' && <button className="icon-button" type="button" title="Reload document" aria-label="Reload document" onClick={() => void fetchRemoteDocument(activeDocument.source, true)}><ArrowDownToLine size={16} /></button>}
              <button className="icon-button" type="button" title="Print or save to PDF" aria-label="Print or save to PDF" onClick={() => window.print()}><Printer size={16} /></button>
              <button className="icon-button fullscreen-toggle" type="button" title="Toggle fullscreen" aria-label="Toggle fullscreen" onClick={toggleFullscreen}><Maximize size={16} /></button>
            </div>
          </div>
          {searchOpen && <div className="document-search" role="search">
            <Search size={16} aria-hidden="true" /><input ref={searchInputRef} type="search" value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setSearchIndex(0); }} placeholder="Find in this document" aria-label="Find in this document" onKeyDown={(event) => { if (event.key === 'Enter') setSearchIndex((index) => searchMatches.length ? (index + 1) % searchMatches.length : 0); if (event.key === 'Escape') setSearchOpen(false); }} />
            <span className="search-count" role="status" aria-live="polite">{searchMatches.length ? `${searchIndex + 1} of ${searchMatches.length}` : searchTerm ? 'No matches' : ''}</span>
            <button className="icon-button" type="button" aria-label="Previous match" disabled={!searchMatches.length} onClick={() => setSearchIndex((index) => (index - 1 + searchMatches.length) % searchMatches.length)}><ChevronLeft size={16} /></button>
            <button className="icon-button" type="button" aria-label="Next match" disabled={!searchMatches.length} onClick={() => setSearchIndex((index) => (index + 1) % searchMatches.length)}><ChevronRight size={16} /></button>
            <button className="icon-button" type="button" aria-label="Close search" onClick={() => { setSearchOpen(false); setSearchTerm(''); }}><X size={16} /></button>
          </div>}

          {notice && <div className="reader-notice" role="status">{notice}<button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></button></div>}
          {rendering && <div className="rendering-state" role="status">Preparing your document…</div>}
          {rendered && !rendering && <div className={`document-panes ${sourceMode === 'split' ? 'is-split' : ''}`}>
            {(sourceMode === 'rendered' || sourceMode === 'split') && <article ref={articleRef} className="markdown-body" aria-label={activeDocument.name}>
              {Object.keys(rendered.metadata).length > 0 && <details className="frontmatter"><summary>Document details</summary><dl>{Object.entries(rendered.metadata).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl></details>}
              {rendered.frontmatterError && <p className="reader-error inline-error" role="status">{rendered.frontmatterError}</p>}
              <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
              <footer className="document-end"><span>End of document</span><span>{wordCount.toLocaleString()} words</span></footer>
            </article>}
            {(sourceMode === 'source' || sourceMode === 'split') && <pre className="raw-source" aria-label="Read-only Markdown source"><code>{activeDocument.text}</code></pre>}
          </div>}
        </>}
      </section>
    </main>

    {settings.customCss && <style>{settings.customCss}</style>}

    <dialog ref={commandDialogRef} className="reader-dialog command-dialog" aria-labelledby="command-title" onCancel={() => setCommandOpen(false)} onClose={() => setCommandOpen(false)}>
      <div className="dialog-heading"><div><h2 id="command-title">Jump to an action</h2><p>Search the reader's commands.</p></div><button className="icon-button" type="button" aria-label="Close command palette" onClick={() => setCommandOpen(false)}><X size={17} /></button></div>
      <label className="command-search"><Search size={16} /><input ref={commandInputRef} value={commandFilter} onChange={(event) => setCommandFilter(event.target.value)} placeholder="Type a command…" aria-label="Filter commands" /></label>
      <div className="command-list" role="listbox" aria-label="Commands">{filteredCommands.map((command) => <button key={command.label} type="button" role="option" aria-selected="false" className="command-row" onClick={() => runCommand(command)}><span>{command.label}</span><small>{command.hint}</small></button>)}{filteredCommands.length === 0 && <p className="sidebar-empty">No commands match that search.</p>}</div>
    </dialog>

    {remoteDialogOpen && <dialog ref={remoteDialogRef} className="reader-dialog remote-dialog" aria-labelledby="remote-dialog-title" onCancel={() => setRemoteDialogOpen(false)} onClose={() => setRemoteDialogOpen(false)}>
      <div className="dialog-heading"><div><h2 id="remote-dialog-title">Open a Markdown URL</h2><p>Fetch the document directly from its source.</p></div><button className="icon-button" type="button" aria-label="Close URL dialog" onClick={() => setRemoteDialogOpen(false)}><X size={17} /></button></div>
      <form className="remote-dialog-form" onSubmit={(event) => { event.preventDefault(); void loadRemoteFromInput(); }}>
        <label htmlFor="remote-url-dialog">Document address</label>
        <div className="url-field"><input id="remote-url-dialog" name="markdownUrl" type="url" value={remoteInput} onChange={(event) => setRemoteInput(event.target.value)} placeholder="https://example.com/README.md" autoComplete="url" /><button type="submit" disabled={!remoteInput || loadingRemote}>{loadingRemote ? 'Loading…' : 'Request access & open'}</button></div>
        {error && <small className="remote-url-error" role="alert">{error}</small>}
        <small>Access is requested for that site only. Remote images remain blocked unless enabled in settings.</small>
      </form>
    </dialog>}

    <dialog ref={shortcutDialogRef} className="reader-dialog shortcut-dialog" aria-labelledby="shortcut-title" onCancel={() => setShortcutHelpOpen(false)} onClose={() => setShortcutHelpOpen(false)}>
      <div className="dialog-heading"><div><h2 id="shortcut-title">Keyboard shortcuts</h2><p>Use Control on Windows and Linux, or Command on macOS.</p></div><button className="icon-button" type="button" aria-label="Close shortcuts" onClick={() => setShortcutHelpOpen(false)}><X size={17} /></button></div>
      <dl className="shortcut-list"><div><dt>Search document</dt><dd><kbd>Ctrl</kbd> <kbd>F</kbd></dd></div><div><dt>Command palette</dt><dd><kbd>Ctrl</kbd> <kbd>K</kbd></dd></div><div><dt>Open file</dt><dd><kbd>Ctrl</kbd> <kbd>O</kbd></dd></div><div><dt>Open folder</dt><dd><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd></dd></div><div><dt>Increase / decrease text</dt><dd><kbd>Ctrl</kbd> <kbd>+</kbd> / <kbd>−</kbd></dd></div><div><dt>Change theme / focus</dt><dd><kbd>T</kbd> / <kbd>F</kbd></dd></div><div><dt>Show shortcuts</dt><dd><kbd>?</kbd></dd></div><div><dt>Close a dialog</dt><dd><kbd>Esc</kbd></dd></div></dl>
    </dialog>

    <dialog ref={lightboxDialogRef} className="reader-dialog lightbox-dialog" aria-label="Image viewer" onCancel={() => setLightboxIndex(null)} onClose={() => setLightboxIndex(null)} onKeyDown={(event) => { if (event.key === 'ArrowRight') openImageAt(1); if (event.key === 'ArrowLeft') openImageAt(-1); }}>
      <div className="lightbox-top"><span>{currentImage?.alt || 'Document image'}{imageListRef.current.length > 1 ? ` · ${(lightboxIndex ?? 0) + 1} / ${imageListRef.current.length}` : ''}</span><div><button className="icon-button" type="button" aria-label="Zoom out" onClick={() => setLightboxScale((scale) => Math.max(0.5, scale - 0.25))}>−</button><button className="icon-button" type="button" aria-label="Zoom in" onClick={() => setLightboxScale((scale) => Math.min(3, scale + 0.25))}>+</button><button className="icon-button" type="button" aria-label="Close image viewer" onClick={() => setLightboxIndex(null)}><X size={18} /></button></div></div>
      <div className="lightbox-stage">{imageListRef.current.length > 1 && <button className="lightbox-arrow lightbox-prev" type="button" aria-label="Previous image" onClick={() => openImageAt(-1)}><ChevronLeft size={24} /></button>}{currentImage && <figure><img src={currentImage.currentSrc || currentImage.src} alt={currentImage.alt} style={{ transform: `scale(${lightboxScale})` }} />{currentImage.title && <figcaption>{currentImage.title}</figcaption>}</figure>}{imageListRef.current.length > 1 && <button className="lightbox-arrow lightbox-next" type="button" aria-label="Next image" onClick={() => openImageAt(1)}><ChevronRight size={24} /></button>}</div>
    </dialog>

    <section className="reader-bottom-controls" aria-label="Reading controls"><label><span>Text size</span><input type="range" min="14" max="28" step="1" value={settings.fontSize} aria-label="Text size" onChange={(event) => updateSettings({ fontSize: Number(event.target.value) })} /></label><button type="button" className="icon-button" aria-label="Decrease text size" onClick={() => updateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })}>−</button><button type="button" className="icon-button" aria-label="Increase text size" onClick={() => updateSettings({ fontSize: Math.min(28, settings.fontSize + 1) })}>+</button><span className="reader-bottom-spacer" /><button type="button" className="text-control" onClick={() => setShortcutHelpOpen(true)}>Shortcuts</button></section>
  </div>;
}
