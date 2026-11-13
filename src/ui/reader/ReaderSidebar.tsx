import { BookMarked, ChevronDown, FileText, Folder, Search, Trash2, X } from 'lucide-react';
import { memo, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import { isOpenableFileName } from '../../core/document';
import type { Heading } from '../../core/document';
import type { Bookmark } from '../../shared/storage';
import type { FolderWorkspace } from './types';

export type SidebarTab = 'outline' | 'files' | 'bookmarks';

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isFile: boolean;
}

function buildFolderTree(paths: Iterable<string>): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of [...paths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))) {
    let branch = root;
    let current = '';
    const parts = path.split('/').filter(Boolean);
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
  // Folders first, then files, each alphabetically.
  const sort = (nodes: TreeNode[]): TreeNode[] => nodes
    .sort((a, b) => Number(a.isFile) - Number(b.isFile) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map((node) => ({ ...node, children: sort(node.children) }));
  return sort(root);
}

const ancestorsOf = (path: string): string[] => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'));

export interface ReaderSidebarProps {
  open: boolean;
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  onClose: () => void;
  headings: readonly Heading[];
  activeHeading: string;
  onHeading: (id: string) => void;
  folder: FolderWorkspace | undefined;
  currentPath: string | undefined;
  onOpenPath: (path: string) => void;
  onOpenFolder: () => void;
  bookmarks: readonly Bookmark[];
  currentDocumentId: string | undefined;
  onBookmark: (bookmark: Bookmark) => void;
  onRemoveBookmark: (bookmark: Bookmark) => void;
}

const tabs: Array<{ id: SidebarTab; label: string }> = [
  { id: 'outline', label: 'Outline' },
  { id: 'files', label: 'Files' },
  { id: 'bookmarks', label: 'Bookmarks' },
];

/** Moves focus between the visible rows of a list with the arrow keys. */
function arrowNavigation(event: KeyboardEvent<HTMLElement>, selector: string): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
  const target = rows[Math.max(0, Math.min(rows.length - 1, next))];
  if (target) { event.preventDefault(); target.focus(); }
}

export const ReaderSidebar = memo(function ReaderSidebar(props: ReaderSidebarProps): ReactElement {
  const { open, tab, onTab } = props;
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = tabs.findIndex((item) => item.id === tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next];
    if (target) { onTab(target.id); tabRefs.current[next]?.focus(); }
  };

  return <aside className={`reader-sidebar ${open ? 'is-open' : ''}`} aria-label="Document navigation" inert={!open}>
    <div className="sidebar-topline">
      <div className="sidebar-tabs" role="tablist" aria-label="Navigation" onKeyDown={onTabKey}>
        {tabs.map((item, index) => <button
          key={item.id}
          ref={(element) => { tabRefs.current[index] = element; }}
          id={`${baseId}-tab-${item.id}`}
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          aria-controls={`${baseId}-panel`}
          tabIndex={tab === item.id ? 0 : -1}
          onClick={() => onTab(item.id)}
        >{item.label}{item.id === 'bookmarks' && props.bookmarks.length > 0 && <span className="tab-count" aria-label={`, ${props.bookmarks.length}`}>{props.bookmarks.length}</span>}</button>)}
      </div>
      <button className="icon-button sidebar-dismiss" type="button" aria-label="Close navigation" onClick={props.onClose}><X size={18} aria-hidden="true" /></button>
    </div>
    <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="sidebar-panel">
      {tab === 'outline' && <Outline {...props} />}
      {tab === 'files' && <FileTree {...props} />}
      {tab === 'bookmarks' && <Bookmarks {...props} />}
    </div>
  </aside>;
});

function Outline({ headings, activeHeading, onHeading, currentDocumentId }: ReaderSidebarProps): ReactElement {
  if (headings.length === 0) return <p className="sidebar-empty">{currentDocumentId ? 'This document has no headings.' : 'The outline of an open document appears here.'}</p>;
  return <nav aria-label="Table of contents"><ol className="outline-list" onKeyDown={(event) => arrowNavigation(event, 'a')}>
    {headings.map((heading) => <li key={heading.id} style={{ '--heading-level': heading.level } as CSSProperties}>
      <a href={`#${heading.id}`} className={`outline-link ${activeHeading === heading.id ? 'is-active' : ''}`} aria-current={activeHeading === heading.id ? 'location' : undefined} onClick={(event) => { event.preventDefault(); onHeading(heading.id); }}>{heading.text}</a>
    </li>)}
  </ol></nav>;
}

function FileTree({ folder, currentPath, onOpenPath, onOpenFolder }: ReaderSidebarProps): ReactElement {
  const [filter, setFilter] = useState('');
  // Folders the user opened or closed; others follow the default (top level and the current file's folders open).
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const tree = useMemo(() => buildFolderTree([...(folder?.files.keys() ?? [])].filter(isOpenableFileName)), [folder]);
  const expandedForCurrent = useMemo(() => new Set(currentPath ? ancestorsOf(currentPath) : []), [currentPath]);

  if (!folder) {
    return <div className="sidebar-empty"><p>Open a folder to browse its Markdown files and follow links between them.</p><button className="text-button" type="button" onClick={onOpenFolder}>Open folder…</button></div>;
  }
  const needle = filter.trim().toLocaleLowerCase();
  const isOpen = (path: string, depth: number): boolean => needle !== '' || (toggled.get(path) ?? (depth === 0 || expandedForCurrent.has(path)));
  const toggle = (path: string, depth: number): void => setToggled((current) => new Map(current).set(path, !isOpen(path, depth)));

  const rows = (nodes: TreeNode[], depth: number): ReactElement[] => nodes.flatMap((node) => {
    if (node.isFile) {
      if (needle && !node.path.toLocaleLowerCase().includes(needle)) return [];
      const current = currentPath === node.path;
      return [<li key={node.path}><button type="button" className={`tree-row ${current ? 'is-current' : ''}`} style={{ '--tree-depth': depth } as CSSProperties} aria-current={current ? 'page' : undefined} title={node.path} onClick={() => onOpenPath(node.path)}>
        <FileText size={16} aria-hidden="true" /><span>{node.name}</span>
      </button></li>];
    }
    const children = rows(node.children, depth + 1);
    if (needle && children.length === 0) return [];
    const expanded = isOpen(node.path, depth);
    return [<li key={node.path}>
      <button type="button" className="tree-row tree-folder" style={{ '--tree-depth': depth } as CSSProperties} aria-expanded={expanded} onClick={() => toggle(node.path, depth)}>
        <ChevronDown className="tree-chevron" size={15} aria-hidden="true" /><Folder size={16} aria-hidden="true" /><span>{node.name}</span>
      </button>
      {expanded && <ul>{children}</ul>}
    </li>];
  });
  const items = rows(tree, 0);

  return <div className="file-navigation">
    <div className="sidebar-section-head"><span title={folder.name}>{folder.name}</span><button className="text-button" type="button" onClick={onOpenFolder}>Change…</button></div>
    <label className="sidebar-filter"><Search size={15} aria-hidden="true" /><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter files" aria-label="Filter files" /></label>
    {items.length ? <ul className="file-tree" aria-label={`Files in ${folder.name}`} onKeyDown={(event) => arrowNavigation(event, 'button.tree-row')}>{items}</ul> : <p className="sidebar-empty">No files match “{filter.trim()}”.</p>}
  </div>;
}

function Bookmarks({ bookmarks, currentDocumentId, onBookmark, onRemoveBookmark }: ReaderSidebarProps): ReactElement {
  if (bookmarks.length === 0) return <p className="sidebar-empty">Bookmark the section you are reading with the bookmark button above the document. Bookmarks stay on this device.</p>;
  const sorted = [...bookmarks].sort((a, b) => Number(b.id === currentDocumentId) - Number(a.id === currentDocumentId));
  return <ul className="bookmark-list" onKeyDown={(event) => arrowNavigation(event, 'button.bookmark-row')}>
    {sorted.map((bookmark) => {
      const here = bookmark.id === currentDocumentId;
      return <li key={`${bookmark.id}:${bookmark.headingId}`} className={here ? 'is-current' : ''}>
        <button type="button" className="bookmark-row" onClick={() => onBookmark(bookmark)}>
          <BookMarked size={16} aria-hidden="true" />
          <span><strong>{bookmark.headingText}</strong><small>{here ? 'This document' : bookmark.documentName}</small></span>
        </button>
        <button type="button" className="icon-button bookmark-remove" aria-label={`Remove bookmark ${bookmark.headingText}`} onClick={() => onRemoveBookmark(bookmark)}><Trash2 size={15} aria-hidden="true" /></button>
      </li>;
    })}
  </ul>;
}
