import { browser } from 'wxt/browser';
import {
  BookMarked,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Command,
  FilePlus2,
  FolderOpen,
  Maximize,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  RotateCw,
  Search,
  Settings2,
  Type,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from 'react';
import { OPENABLE_FILE_ACCEPT, isOpenableFileName } from '../core/document';
import { renderMarkdown, type RenderedMarkdown } from '../core/markdown';
import { THEME_IDS } from '../core/settings';
import { getBookmarks, getReadingPosition, saveReadingPosition, toggleBookmark, type Bookmark } from '../shared/storage';
import { useSettings } from './hooks/useSettings';
import { CommandPalette, ReaderDialog, ImageViewer, type ReaderCommand } from './reader/dialogs';
import { DocumentArticle } from './reader/DocumentArticle';
import { ReaderSidebar, type SidebarTab } from './reader/ReaderSidebar';
import { ReadingPanel } from './reader/ReadingPanel';
import { shortcutFor, SINGLE_KEY_SHORTCUTS } from './reader/shortcuts';
import { useDocumentSource } from './reader/useDocumentSource';
import { readingStyle, useAppliedTheme } from './theme';

type ViewMode = 'rendered' | 'source' | 'split';
const narrowQuery = '(max-width: 760px)';
const isNarrow = (): boolean => window.matchMedia?.(narrowQuery).matches ?? false;
const scrollBehavior = (): ScrollBehavior => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const openSettingsPage = (): void => { void browser.runtime.openOptionsPage(); };

export function ReaderApp(): ReactElement {
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef(0);
  const notify = useCallback((message: string, timeout = 3200) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(message);
    if (timeout) noticeTimer.current = window.setTimeout(() => setNotice(''), timeout);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const { settings, change, changeSoon } = useSettings((message) => notify(message, 6000));
  const theme = useAppliedTheme(settings);
  const source = useDocumentSource();
  const { document: activeDocument, folder, problem, setProblem } = source;

  const [rendered, setRendered] = useState<RenderedMarkdown>();
  const [rendering, setRendering] = useState(false);
  const [activeHeading, setActiveHeading] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrow());
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('outline');
  const [focusMode, setFocusMode] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('rendered');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [progress, setProgress] = useState(0);
  const [remoteInput, setRemoteInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const dialogOpen = commandsOpen || helpOpen || urlDialogOpen || imageIndex !== null;

  useEffect(() => { void getBookmarks().then(setBookmarks).catch(() => undefined); }, []);

  // Rendering depends only on the document, the folder's assets, and the remote-image choice.
  useEffect(() => {
    if (!activeDocument) { setRendered(undefined); return; }
    let cancelled = false;
    setRendering(true);
    void renderMarkdown(activeDocument.text, {
      ...(activeDocument.sourceUrl ? { sourceUrl: activeDocument.sourceUrl } : {}),
      ...(activeDocument.documentPath ? { documentPath: activeDocument.documentPath } : {}),
      ...(folder ? { assetUrls: folder.assets, documentPaths: new Set(folder.files.keys()) } : {}),
      allowRemoteImages: settings.allowRemoteImages,
    }).then((result) => {
      if (cancelled) return;
      setRendered(result);
      setActiveHeading('');
    }).catch((reason: unknown) => {
      if (!cancelled) setProblem({ message: reason instanceof Error ? `This document could not be displayed. ${reason.message}` : 'This document could not be displayed.' });
    }).finally(() => { if (!cancelled) setRendering(false); });
    return () => { cancelled = true; };
  }, [activeDocument, folder, settings.allowRemoteImages, setProblem]);

  // The sidebar overlays narrow windows, so it closes when the window becomes narrow.
  useEffect(() => {
    const query = window.matchMedia?.(narrowQuery);
    if (!query) return;
    const onChange = (): void => { if (query.matches) setSidebarOpen(false); };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // A newly opened folder shows its files.
  useEffect(() => {
    if (!folder) return;
    setSidebarTab('files');
    if (!isNarrow()) setSidebarOpen(true);
  }, [folder]);

  // A new document starts at the top, in reading view, with search closed.
  const documentId = activeDocument?.id;
  useEffect(() => {
    setViewMode('rendered');
    setSearchOpen(false);
    setSearchTerm('');
    setImageIndex(null);
    window.scrollTo({ top: 0 });
  }, [documentId]);

  const wordCount = useMemo(() => rendered ? rendered.body.trim().split(/\s+/u).filter(Boolean).length : 0, [rendered]);
  const minutes = Math.max(1, Math.round(wordCount / 230));

  // Reading progress: one state update per frame at most.
  useEffect(() => {
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    const onScroll = (): void => { if (!frame) frame = window.requestAnimationFrame(measure); };
    window.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => { window.removeEventListener('scroll', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, [rendered]);

  // Restore the saved position once per document, after it has rendered.
  const restoredFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeDocument || !rendered || !settings.restorePosition || restoredFor.current === activeDocument.id) return;
    restoredFor.current = activeDocument.id;
    let cancelled = false;
    void getReadingPosition(activeDocument.id).then((position) => {
      if (!cancelled && position !== undefined && position > 0.01) {
        window.scrollTo({ top: position * (document.documentElement.scrollHeight - window.innerHeight), behavior: 'instant' });
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeDocument, rendered, settings.restorePosition]);

  useEffect(() => {
    if (!documentId || !settings.restorePosition) return;
    let timer = 0;
    const save = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0) void saveReadingPosition(documentId, window.scrollY / max).catch(() => undefined);
      }, 500);
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => { window.clearTimeout(timer); window.removeEventListener('scroll', save); };
  }, [documentId, settings.restorePosition]);

  // Live reload: poll only while this tab is visible, and never overlap two checks.
  const { refreshRemote } = source;
  const isRemote = activeDocument?.kind === 'remote';
  useEffect(() => {
    if (!isRemote || !settings.liveReloadEnabled) return;
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      void refreshRemote(true).then((changed) => { if (changed) notify('The document changed on the server and was refreshed.'); }).finally(() => { busy = false; });
    }, settings.liveReloadSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [isRemote, documentId, settings.liveReloadEnabled, settings.liveReloadSeconds, refreshRemote, notify]);

  const openSearch = useCallback(() => {
    if (!rendered || viewMode === 'source') { notify('Search works in Read and Split views. Your browser’s Find (Ctrl or ⌘ F) works everywhere.'); return; }
    setSearchOpen(true);
    window.setTimeout(() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); }, 0);
  }, [notify, rendered, viewMode]);
  const closeSearch = useCallback(() => { setSearchOpen(false); setSearchTerm(''); }, []);

  const cycleTheme = useCallback(() => {
    const index = settings.customThemeId ? -1 : THEME_IDS.indexOf(settings.theme);
    const next = THEME_IDS[(index + 1) % THEME_IDS.length] ?? 'paper';
    void change({ kind: 'patch', patch: { theme: next, customThemeId: null } });
  }, [change, settings.customThemeId, settings.theme]);

  const goToHeading = useCallback((id: string) => {
    const heading = document.getElementById(id);
    if (!heading) return;
    heading.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    heading.focus({ preventScroll: true });
    setActiveHeading(id);
    if (isNarrow()) setSidebarOpen(false);
  }, []);

  const currentHeading = rendered?.headings.find((heading) => heading.id === activeHeading) ?? rendered?.headings[0];
  const currentBookmarked = Boolean(activeDocument && currentHeading && bookmarks.some((item) => item.id === activeDocument.id && item.headingId === currentHeading.id));
  const toggleCurrentBookmark = useCallback(async () => {
    if (!activeDocument || !currentHeading) return;
    try {
      const added = await toggleBookmark({ id: activeDocument.id, documentName: activeDocument.name, headingId: currentHeading.id, headingText: currentHeading.text, createdAt: Date.now() });
      setBookmarks(await getBookmarks());
      notify(added ? `Bookmarked “${currentHeading.text}”.` : `Removed the bookmark for “${currentHeading.text}”.`);
    } catch { notify('The bookmark could not be saved.'); }
  }, [activeDocument, currentHeading, notify]);
  const removeBookmark = useCallback(async (bookmark: Bookmark) => {
    try { await toggleBookmark(bookmark); setBookmarks(await getBookmarks()); notify(`Removed the bookmark for “${bookmark.headingText}”.`); }
    catch { notify('The bookmark could not be removed.'); }
  }, [notify]);
  const openBookmark = useCallback((bookmark: Bookmark) => {
    if (bookmark.id === activeDocument?.id) goToHeading(bookmark.headingId);
    else notify(`Open “${bookmark.documentName}” to go to this bookmark.`, 5000);
  }, [activeDocument?.id, goToHeading, notify]);

  const chooseFile = useCallback(() => fileInputRef.current?.click(), []);
  const chooseFolder = useCallback(() => { void source.openDirectoryPicker(() => folderInputRef.current?.click()); }, [source]);
  const openUrlDialog = useCallback(() => { setRemoteInput(activeDocument?.kind === 'remote' ? activeDocument.source : ''); setUrlDialogOpen(true); }, [activeDocument]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => notify('Fullscreen is not available in this window.'));
  }, [notify]);

  const commands = useMemo<ReaderCommand[]>(() => {
    const list: ReaderCommand[] = [
      { id: 'open-file', label: 'Open file…', keywords: 'markdown local', run: chooseFile },
      { id: 'open-folder', label: 'Open folder…', keywords: 'workspace directory', run: chooseFolder },
      { id: 'open-url', label: 'Open online document…', keywords: 'url web remote address', run: openUrlDialog },
    ];
    if (rendered) {
      list.push(
        { id: 'search', label: 'Search this document', hint: settings.singleKeyShortcuts ? '/' : '', keywords: 'find', run: openSearch },
        { id: 'bookmark', label: currentBookmarked ? 'Remove bookmark for this section' : 'Bookmark this section', keywords: 'save', run: () => void toggleCurrentBookmark() },
        { id: 'view-read', label: 'Read view', keywords: 'rendered', run: () => setViewMode('rendered') },
        { id: 'view-source', label: 'Source view', keywords: 'raw markdown', run: () => setViewMode('source') },
        { id: 'view-split', label: 'Split view', keywords: 'side by side source', run: () => setViewMode('split') },
        { id: 'print', label: 'Print or save as PDF', keywords: 'pdf', run: () => window.print() },
      );
      if (activeDocument?.kind === 'remote') list.push({ id: 'reload', label: 'Reload from the server', keywords: 'refresh', run: () => void source.refreshRemote(false).then((changed) => notify(changed ? 'The document was updated.' : 'The document is up to date.')) });
    }
    list.push(
      { id: 'theme', label: 'Next theme', hint: settings.singleKeyShortcuts ? 'T' : '', keywords: 'appearance colour color dark light', run: cycleTheme },
      { id: 'focus', label: focusMode ? 'Leave focus mode' : 'Focus mode', hint: settings.singleKeyShortcuts ? 'F' : '', keywords: 'distraction', run: () => setFocusMode((value) => !value) },
      { id: 'sidebar', label: sidebarOpen ? 'Hide navigation' : 'Show navigation', hint: settings.singleKeyShortcuts ? '[' : '', keywords: 'sidebar outline files', run: () => setSidebarOpen((value) => !value) },
      { id: 'wide', label: settings.readingWidth >= 1000 ? 'Comfortable line width' : 'Wide line width', keywords: 'width measure', run: () => void change({ kind: 'patch', patch: { readingWidth: settings.readingWidth >= 1000 ? 760 : 1120 } }) },
      { id: 'fullscreen', label: 'Full screen', keywords: 'fullscreen', run: toggleFullscreen },
      { id: 'shortcuts', label: 'Keyboard shortcuts', hint: settings.singleKeyShortcuts ? '?' : '', keywords: 'help keys', run: () => setHelpOpen(true) },
      { id: 'settings', label: 'Settings', keywords: 'preferences options', run: openSettingsPage },
    );
    return list;
  }, [activeDocument?.kind, change, chooseFile, chooseFolder, currentBookmarked, cycleTheme, focusMode, notify, openSearch, openUrlDialog, rendered, settings.readingWidth, settings.singleKeyShortcuts, sidebarOpen, source, toggleCurrentBookmark, toggleFullscreen]);

  // One listener; the latest handlers are read from a ref so it never re-subscribes.
  const handlers = useRef({ openSearch, cycleTheme, closeSearch, searchOpen, focusMode, settings, dialogOpen });
  handlers.current = { openSearch, cycleTheme, closeSearch, searchOpen, focusMode, settings, dialogOpen };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const current = handlers.current;
      const action = shortcutFor(event, { singleKeys: current.settings.singleKeyShortcuts, dialogOpen: current.dialogOpen });
      if (!action) return;
      if (action === 'escape') {
        if (current.searchOpen) { current.closeSearch(); event.preventDefault(); }
        else if (current.focusMode) { setFocusMode(false); event.preventDefault(); }
        return;
      }
      event.preventDefault();
      if (action === 'commands') setCommandsOpen(true);
      else if (action === 'search') current.openSearch();
      else if (action === 'theme') current.cycleTheme();
      else if (action === 'focus') setFocusMode((value) => !value);
      else if (action === 'sidebar') setSidebarOpen((value) => !value);
      else if (action === 'help') setHelpOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void source.openFile(file);
  };
  const onFolderChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    const folderName = files[0]?.webkitRelativePath.split('/')[0] || 'Folder';
    if (files.length) void source.openFolderFiles(files, folderName, true);
  };
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find((item) => isOpenableFileName(item.name) || item.type === 'text/markdown');
    if (file) void source.openFile(file);
    else setProblem({ message: 'Drop a Markdown file to open it. To read a folder, use Open folder.' });
  };
  const submitUrl = async (): Promise<void> => {
    let url: URL;
    try { url = new URL(remoteInput.trim()); } catch { setProblem({ message: 'Enter a complete address that begins with https:// or http://.' }); return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') { setProblem({ message: 'Only http:// and https:// addresses can be opened.' }); return; }
    // The permission request must come straight from the click, before any other await.
    const granted = await browser.permissions.request({ origins: [`${url.origin}/*`] }).catch(() => false);
    if (!granted) { setProblem({ message: `Access to ${url.host} was not granted, so the document was not loaded.` }); return; }
    if (await source.openRemote(url.href)) setUrlDialogOpen(false);
  };
  const grantAndRetry = async (): Promise<void> => {
    if (!problem?.origin || !problem.url) return;
    const url = problem.url;
    const granted = await browser.permissions.request({ origins: [`${problem.origin}/*`] }).catch(() => false);
    if (granted) await source.openRemote(url);
    else setProblem({ message: 'Access was not granted, so the document was not loaded.' });
  };

  const kindLabel = activeDocument?.kind === 'remote' ? 'Online' : activeDocument?.kind === 'page' ? 'Page capture' : 'Local file';
  const showRendered = viewMode !== 'source';
  const showSource = viewMode !== 'rendered';

  return <div id="reader" className={`reader-shell font-${settings.fontFamily} code-${settings.codeTheme} ${focusMode ? 'is-focus' : ''} ${sidebarOpen ? 'sidebar-visible' : 'sidebar-hidden'}`} data-appearance={theme.appearance} style={readingStyle(settings)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <a className="skip-link" href="#reader-main">Skip to document</a>
    <div className="reading-progress" aria-hidden="true" style={{ transform: `scaleX(${progress})` }} />
    <header className="reader-toolbar">
      <button className="icon-button" type="button" aria-label={sidebarOpen ? 'Hide navigation' : 'Show navigation'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}>{sidebarOpen ? <PanelLeftClose size={19} aria-hidden="true" /> : <PanelLeftOpen size={19} aria-hidden="true" />}</button>
      <div className="toolbar-document">
        {activeDocument
          ? <><span className="toolbar-title" title={activeDocument.name}>{activeDocument.name}</span><span className="toolbar-source" title={activeDocument.source}><span className="document-kind">{kindLabel}</span>{activeDocument.kind !== 'local' || activeDocument.documentPath?.includes('/') ? ` · ${activeDocument.source}` : ''}</span></>
          : <span className="toolbar-title toolbar-brand"><BookOpen size={18} aria-hidden="true" />Markdown Reader</span>}
      </div>
      <div className="toolbar-actions">
        {rendered && <button className={`icon-button ${searchOpen ? 'is-active' : ''}`} type="button" aria-label="Search this document" aria-expanded={searchOpen} title="Search this document" onClick={() => (searchOpen ? closeSearch() : openSearch())}><Search size={19} aria-hidden="true" /></button>}
        {rendered && currentHeading && <button className={`icon-button ${currentBookmarked ? 'is-active' : ''}`} type="button" aria-pressed={currentBookmarked} aria-label={`Bookmark this section: ${currentHeading.text}`} title={currentBookmarked ? 'Remove bookmark' : 'Bookmark this section'} onClick={() => void toggleCurrentBookmark()}><BookMarked size={19} aria-hidden="true" /></button>}
        <button className="icon-button" type="button" popoverTarget={panelId} aria-label="Reading settings: theme and text" title="Theme and text"><Type size={19} aria-hidden="true" /></button>
        <button className="icon-button" type="button" aria-label="Commands" title="Commands (Ctrl or ⌘ K)" onClick={() => setCommandsOpen(true)}><Command size={19} aria-hidden="true" /></button>
        <button className="icon-button toolbar-settings" type="button" aria-label="Settings" title="Settings" onClick={openSettingsPage}><Settings2 size={19} aria-hidden="true" /></button>
      </div>
    </header>
    <ReadingPanel id={panelId} settings={settings} change={(next) => void change(next)} changeSoon={changeSoon} />

    <input ref={fileInputRef} className="visually-hidden" type="file" accept={OPENABLE_FILE_ACCEPT} tabIndex={-1} aria-hidden="true" onChange={onFileChange} />
    <input ref={folderInputRef} className="visually-hidden" type="file" multiple tabIndex={-1} aria-hidden="true" onChange={onFolderChange} {...{ webkitdirectory: '', directory: '' }} />

    <div className="reader-layout">
      <ReaderSidebar
        open={sidebarOpen}
        tab={sidebarTab}
        onTab={setSidebarTab}
        onClose={() => setSidebarOpen(false)}
        headings={rendered?.headings ?? []}
        activeHeading={activeHeading}
        onHeading={goToHeading}
        folder={folder}
        currentPath={activeDocument?.documentPath}
        onOpenPath={(path) => { void source.openFolderPath(path); if (isNarrow()) setSidebarOpen(false); }}
        onOpenFolder={chooseFolder}
        bookmarks={bookmarks}
        currentDocumentId={activeDocument?.id}
        onBookmark={openBookmark}
        onRemoveBookmark={(bookmark) => void removeBookmark(bookmark)}
      />
      {sidebarOpen && <button className="sidebar-scrim" type="button" tabIndex={-1} aria-hidden="true" onClick={() => setSidebarOpen(false)} />}

      <main id="reader-main" className="reader-workspace" tabIndex={-1}>
        <div className="reader-live" role="status" aria-live="polite">{notice && <div className="reader-notice"><span>{notice}</span><button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} aria-hidden="true" /></button></div>}</div>
        {problem && <div className="reader-problem" role="alert">
          <p>{problem.message}</p>
          <div className="problem-actions">
            {problem.recovery === 'history-back' && <button className="primary-button" type="button" onClick={() => history.back()}>Go back to the file</button>}
            {problem.recovery === 'grant-origin' && <button className="primary-button" type="button" onClick={() => void grantAndRetry()}>Allow access</button>}
            {problem.recovery === 'history-back' && <button className="secondary-button" type="button" onClick={chooseFile}>Open file…</button>}
            <button className="text-button" type="button" onClick={() => setProblem(undefined)}>Dismiss</button>
          </div>
        </div>}

        {!activeDocument && !source.loading && <section className="welcome-screen" aria-labelledby="welcome-title">
          <h2 id="welcome-title">Open a Markdown document</h2>
          <p>Files are read on this device and never uploaded. You can also drop a file anywhere on this page.</p>
          <div className="welcome-actions">
            <button type="button" className="welcome-action" onClick={chooseFile}><FilePlus2 size={20} aria-hidden="true" /><span><strong>Open file…</strong><small>Markdown or plain text</small></span></button>
            <button type="button" className="welcome-action" onClick={chooseFolder}><FolderOpen size={20} aria-hidden="true" /><span><strong>Open folder…</strong><small>Browse linked documents and images</small></span></button>
          </div>
          <form className="welcome-url" onSubmit={(event) => { event.preventDefault(); void submitUrl(); }}>
            <label htmlFor="remote-url">Online document</label>
            <div className="url-field"><input id="remote-url" type="url" inputMode="url" value={remoteInput} onChange={(event) => setRemoteInput(event.target.value)} placeholder="https://example.com/README.md" autoComplete="url" spellCheck={false} /><button className="primary-button" type="submit" disabled={!remoteInput.trim() || source.loading}>Open</button></div>
            <small>Markdown Reader asks for access to that site only. Remote images stay blocked unless you allow them in Settings.</small>
          </form>
        </section>}

        {(source.loading || rendering) && <div className="rendering-state" role="status"><span className="spinner" aria-hidden="true" />Opening document…</div>}

        {activeDocument && rendered && !rendering && <>
          <div className="document-controls">
            <div className="view-switch" role="group" aria-label="View">
              {(['rendered', 'source', 'split'] as const).map((mode) => <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>{mode === 'rendered' ? 'Read' : mode === 'source' ? 'Source' : 'Split'}</button>)}
            </div>
            <span className="document-meta">{wordCount.toLocaleString()} words · {minutes} min read</span>
            <div className="document-actions">
              {activeDocument.kind === 'remote' && <button className="icon-button" type="button" aria-label="Reload from the server" title="Reload from the server" onClick={() => void source.refreshRemote(false).then((changed) => notify(changed ? 'The document was updated.' : 'The document is up to date.'))}><RotateCw size={17} aria-hidden="true" /></button>}
              <button className={`icon-button ${focusMode ? 'is-active' : ''}`} type="button" aria-pressed={focusMode} aria-label="Focus mode" title="Focus mode" onClick={() => setFocusMode((value) => !value)}><Maximize size={17} aria-hidden="true" /></button>
              <button className="icon-button" type="button" aria-label="Print or save as PDF" title="Print or save as PDF" onClick={() => window.print()}><Printer size={17} aria-hidden="true" /></button>
            </div>
          </div>

          {searchOpen && <div className="document-search" role="search">
            <Search size={17} aria-hidden="true" />
            <input ref={searchInputRef} type="search" value={searchTerm} placeholder="Find in this document" aria-label="Find in this document" aria-describedby="search-count"
              onChange={(event) => { setSearchTerm(event.target.value); setSearchIndex(0); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchCount) { event.preventDefault(); setSearchIndex((index) => (index + (event.shiftKey ? searchCount - 1 : 1)) % searchCount); }
                if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
              }} />
            <span id="search-count" className="search-count" role="status">{searchTerm.trim() ? (searchCount ? `${Math.min(searchIndex + 1, searchCount)} of ${searchCount}` : 'No matches') : ''}</span>
            <button className="icon-button" type="button" aria-label="Previous match" disabled={!searchCount} onClick={() => setSearchIndex((index) => (index - 1 + searchCount) % searchCount)}><ChevronUp size={17} aria-hidden="true" /></button>
            <button className="icon-button" type="button" aria-label="Next match" disabled={!searchCount} onClick={() => setSearchIndex((index) => (index + 1) % searchCount)}><ChevronDown size={17} aria-hidden="true" /></button>
            <button className="icon-button" type="button" aria-label="Close search" onClick={closeSearch}><X size={17} aria-hidden="true" /></button>
          </div>}

          <div className={`document-panes ${viewMode === 'split' ? 'is-split' : ''} ${viewMode === 'source' ? 'is-source' : ''}`}>
            {showRendered && <DocumentArticle
              rendered={rendered}
              label={activeDocument.name}
              appearance={theme.appearance}
              showLineNumbers={settings.showLineNumbers}
              searchTerm={searchOpen ? searchTerm : ''}
              searchIndex={searchIndex}
              wordCount={wordCount}
              onSearchResults={(count) => { setSearchCount(count); setSearchIndex((index) => (count ? Math.min(index, count - 1) : 0)); }}
              onActiveHeading={setActiveHeading}
              onOpenImage={(list, index) => { setImages(list); setImageIndex(index); }}
              onLocalLink={(path, hash) => { void source.openFolderPath(path).then((opened) => { if (opened && hash) window.setTimeout(() => goToHeading(decodeURIComponent(hash.slice(1))), 200); }); }}
              notify={notify}
            />}
            {showSource && <pre className="raw-source" tabIndex={0} aria-label="Markdown source"><code>{activeDocument.text}</code></pre>}
          </div>
        </>}
      </main>
    </div>

    {settings.customCss && <style>{settings.customCss}</style>}

    <CommandPalette open={commandsOpen} onClose={() => setCommandsOpen(false)} commands={commands} />

    <ReaderDialog open={urlDialogOpen} onClose={() => setUrlDialogOpen(false)} title="Open online document" className="remote-dialog" description="Markdown Reader asks for access to that site only.">
      <form className="remote-dialog-form" onSubmit={(event) => { event.preventDefault(); void submitUrl(); }}>
        <label htmlFor="remote-url-dialog">Address</label>
        <div className="url-field"><input id="remote-url-dialog" data-autofocus type="url" inputMode="url" value={remoteInput} onChange={(event) => setRemoteInput(event.target.value)} placeholder="https://example.com/README.md" autoComplete="url" spellCheck={false} /><button className="primary-button" type="submit" disabled={!remoteInput.trim() || source.loading}>Open</button></div>
      </form>
    </ReaderDialog>

    <ReaderDialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts" className="shortcut-dialog">
      <dl className="shortcut-list">
        <div><dt>Commands</dt><dd><kbd>Ctrl</kbd> or <kbd>⌘</kbd> + <kbd>K</kbd></dd></div>
        {settings.singleKeyShortcuts && SINGLE_KEY_SHORTCUTS.map((shortcut) => <div key={shortcut.key}><dt>{shortcut.label}</dt><dd><kbd>{shortcut.key === '?' ? '?' : shortcut.key.toUpperCase()}</kbd></dd></div>)}
        <div><dt>Next or previous search match</dt><dd><kbd>Enter</kbd> / <kbd>Shift</kbd> + <kbd>Enter</kbd></dd></div>
        <div><dt>Close search, dialog, or focus mode</dt><dd><kbd>Esc</kbd></dd></div>
      </dl>
      <p className="dialog-note">{settings.singleKeyShortcuts ? 'Letter shortcuts can be turned off in Settings › Keyboard shortcuts.' : 'Letter shortcuts are off. Turn them on in Settings › Keyboard shortcuts.'} Browser shortcuts such as Find, zoom, and Print work as usual.</p>
    </ReaderDialog>

    <ImageViewer images={images} index={imageIndex} onIndex={setImageIndex} onClose={() => setImageIndex(null)} />
  </div>;
}
