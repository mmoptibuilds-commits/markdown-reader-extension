import { browser } from 'wxt/browser';
import { BookOpen, FileText, FilePlus2, Globe2, Link2, ScanText, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { isOpenableFileName, OPENABLE_FILE_ACCEPT } from '../core/document';
import { checkLocalFileSize } from '../core/local-file';
import { AUTO_RENDER_UPDATE_MESSAGE } from '../shared/messages';
import { getAutoRenderOrigins, getRecents, putPendingDocument, setAutoRenderOrigins, type RecentDocument } from '../shared/storage';
import { choiceToChange, ThemeGallery } from './components/ThemeGallery';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './theme';
import { hostPattern } from '../core/origins';

const PAGE_TEXT_LIMIT = 2_000_000;
const readerUrl = (query = ''): string => `${new URL('/reader.html', window.location.href).href}${query}`;

/** Stored recents can be damaged; a bad URL should not blank the popup. */
const hostnameOf = (value: string | undefined): string => {
  try { return new URL(value ?? '').hostname || 'Online document'; } catch { return 'Online document'; }
};

export function PopupApp(): ReactElement {
  const [message, setMessage] = useState('');
  const { settings, change } = useSettings(setMessage);
  useAppliedTheme(settings);
  const [recents, setRecents] = useState<RecentDocument[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [currentOrigin, setCurrentOrigin] = useState<string>();
  const [remoteUrl, setRemoteUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([getRecents(), getAutoRenderOrigins(), browser.tabs.query({ active: true, currentWindow: true })]).then(([recentItems, savedOrigins, tabs]) => {
      setRecents(recentItems);
      setOrigins(savedOrigins);
      const url = tabs[0]?.url;
      if (!url) return;
      try { const parsed = new URL(url); if (parsed.protocol === 'https:' || parsed.protocol === 'http:') setCurrentOrigin(parsed.origin); } catch { /* Browser pages cannot be granted. */ }
    }).catch(() => setMessage('Extension storage is unavailable. Reload the extension and try again.'));
  }, []);

  const openTab = async (url: string): Promise<void> => {
    await browser.tabs.create({ url });
    window.close();
  };

  const openUrl = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    let url: URL;
    try { url = new URL(remoteUrl.trim()); } catch { setMessage('Enter a complete address that begins with https:// or http://.'); return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { setMessage('Only http:// and https:// addresses without a user name or password can be opened.'); return; }
    try {
      // Requested first, straight from the click: Firefox refuses a request after another await.
      const granted = await browser.permissions.request({ origins: [hostPattern(url)] });
      if (!granted) { setMessage(`Access to ${url.host} was not granted.`); return; }
      await openTab(readerUrl(`?url=${encodeURIComponent(url.href)}`));
    } catch { setMessage(`Access to ${url.host} could not be requested.`); }
  };

  const capturePage = async (): Promise<void> => {
    setBusy(true);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('There is no page to capture.');
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: (limit: number) => {
          const title = document.title || 'Web page';
          const body = document.body?.innerText?.trim() ?? '';
          return { title, source: location.href, text: `# ${title}\n\n${body.slice(0, limit)}${body.length > limit ? '\n\n*The page text was cut off at 2 MB.*' : ''}` };
        },
        args: [PAGE_TEXT_LIMIT],
      });
      const page = results[0]?.result as { title?: string; source?: string; text?: string } | undefined;
      if (!page || typeof page.text !== 'string') throw new Error('This page has no readable text.');
      const token = await putPendingDocument({ kind: 'page', name: page.title || 'Web page', source: page.source || 'Current page', text: page.text });
      await openTab(readerUrl(`?pending=${token}`));
    } catch (reason) {
      setMessage(`${reason instanceof Error ? reason.message : 'This page could not be captured.'} Browser pages and some sites do not allow it.`);
    } finally { setBusy(false); }
  };

  const openSelectedFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!isOpenableFileName(file.name) && file.type !== 'text/markdown' && file.type !== 'text/plain') { setMessage('Choose a Markdown file (.md and similar) or a plain text file.'); return; }
    // Checked before reading, so an oversized file is never loaded into memory.
    const tooLarge = checkLocalFileSize(file.size);
    if (tooLarge) { setMessage(tooLarge.message); return; }
    setBusy(true);
    try {
      const text = await file.text();
      const token = await putPendingDocument({ kind: 'local', name: file.name, source: file.name, text, lastModified: file.lastModified, size: file.size });
      await openTab(readerUrl(`?pending=${token}`));
    } catch (reason) {
      setMessage(reason instanceof Error && /quota/iu.test(reason.message)
        ? 'This file is too large to pass to a new tab. Open the reader and choose it there instead.'
        : 'The selected file could not be opened.');
    } finally { setBusy(false); }
  };

  const autoOpenOn = currentOrigin ? origins.includes(currentOrigin) : false;
  const toggleAutoOpen = async (): Promise<void> => {
    if (!currentOrigin) return;
    const pattern = hostPattern(currentOrigin);
    try {
      if (autoOpenOn) {
        await browser.permissions.remove({ origins: [pattern] });
      } else if (!(await browser.permissions.request({ origins: [pattern] }))) {
        setMessage(`Access to ${new URL(currentOrigin).host} was not granted.`);
        return;
      }
      const next = autoOpenOn ? origins.filter((origin) => origin !== currentOrigin) : [...origins, currentOrigin];
      await setAutoRenderOrigins(next);
      setOrigins(next);
      await browser.runtime.sendMessage({ type: AUTO_RENDER_UPDATE_MESSAGE });
      setMessage(autoOpenOn ? 'Markdown links on this site now open normally.' : 'Markdown links on this site now open in the reader.');
    } catch { setMessage('The setting for this site could not be changed.'); }
  };

  const openRecent = async (item: RecentDocument): Promise<void> => {
    if (item.kind !== 'remote' || !item.url) return;
    try {
      const url = new URL(item.url);
      // request() resolves at once without a prompt when access is already granted.
      if (!(await browser.permissions.request({ origins: [hostPattern(url)] }))) { setMessage(`Access to ${url.host} was not granted.`); return; }
      await openTab(readerUrl(`?url=${encodeURIComponent(url.href)}`));
    } catch { setMessage('This document could not be reopened.'); }
  };

  return <main className="popup-shell">
    <header className="popup-header">
      <span className="popup-icon" aria-hidden="true"><BookOpen size={18} /></span>
      <h1>Markdown Reader</h1>
      <button type="button" className="icon-button" title="Settings" aria-label="Settings" onClick={() => { void browser.runtime.openOptionsPage(); window.close(); }}><Settings2 size={18} aria-hidden="true" /></button>
    </header>

    <section className="popup-actions" aria-label="Open a document">
      <button className="popup-action" type="button" disabled={busy} onClick={() => fileInput.current?.click()}><FilePlus2 size={18} aria-hidden="true" /><span><strong>Open file…</strong><small>Markdown or plain text from this device</small></span></button>
      <input ref={fileInput} className="visually-hidden" type="file" accept={OPENABLE_FILE_ACCEPT} tabIndex={-1} aria-hidden="true" onChange={(event) => void openSelectedFile(event)} />
      <button className="popup-action" type="button" onClick={() => void openTab(readerUrl())}><BookOpen size={18} aria-hidden="true" /><span><strong>Open reader</strong><small>Open a folder, file, or address</small></span></button>
      <button className="popup-action" type="button" disabled={busy} onClick={() => void capturePage()}><ScanText size={18} aria-hidden="true" /><span><strong>Read this page</strong><small>Capture the current page’s text</small></span></button>
    </section>

    <form className="popup-url" onSubmit={(event) => void openUrl(event)}>
      <label htmlFor="popup-url">Online Markdown document</label>
      <div className="url-field"><input id="popup-url" type="url" inputMode="url" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://example.com/README.md" spellCheck={false} /><button className="primary-button" type="submit" disabled={!remoteUrl.trim() || busy} aria-label="Open address"><Link2 size={17} aria-hidden="true" /></button></div>
    </form>

    {currentOrigin && <div className="popup-site">
      <Globe2 size={17} aria-hidden="true" />
      <span id="popup-site-label"><strong>Open Markdown links in the reader</strong><small>{new URL(currentOrigin).host}</small></span>
      <button type="button" role="switch" aria-checked={autoOpenOn} aria-labelledby="popup-site-label" className="switch" onClick={() => void toggleAutoOpen()}><span /></button>
    </div>}

    <section className="popup-theme" aria-labelledby="popup-theme-title">
      <h2 id="popup-theme-title">Theme</h2>
      <ThemeGallery compact legend="Theme" settings={settings} onSelect={(choice) => void change({ kind: 'patch', patch: choiceToChange(choice) })} />
    </section>

    <section className="popup-recents" aria-labelledby="popup-recents-title">
      <h2 id="popup-recents-title">Recent</h2>
      {recents.length === 0 && <p className="popup-empty">Documents you open appear here. Only names and web addresses are kept, never contents.</p>}
      <ul>{recents.slice(0, 5).map((item) => <li key={item.id}>
        {item.kind === 'remote' && item.url
          ? <button className="popup-recent" type="button" onClick={() => void openRecent(item)}><Globe2 size={15} aria-hidden="true" /><span><strong>{item.name}</strong><small>{hostnameOf(item.url)}</small></span></button>
          : <div className="popup-recent is-static"><FileText size={15} aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.kind === 'page' ? 'Page capture · not kept' : 'Local file · choose it again to reopen'}</small></span></div>}
      </li>)}</ul>
    </section>

    <div className="popup-live" role="status" aria-live="polite">{message && <p className="popup-message">{message}<button type="button" className="icon-button" onClick={() => setMessage('')} aria-label="Dismiss message">×</button></p>}</div>
  </main>;
}
