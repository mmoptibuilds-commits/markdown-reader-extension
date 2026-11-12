import { browser } from 'wxt/browser';
import { BookOpen, ExternalLink, FilePlus2, FolderOpen, Globe2, Settings2, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../core/settings';
import { getAutoRenderOrigins, getRecents, loadSettings, putPendingDocument, saveSettings, setAutoRenderOrigins, type RecentDocument } from '../shared/storage';

const readerUrl = (): string => new URL('/reader.html', window.location.href).href;

export function PopupApp(): ReactElement {
  const [settings, setSettings] = useState<ReaderSettings>({ ...DEFAULT_SETTINGS });
  const [recents, setRecents] = useState<RecentDocument[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [currentOrigin, setCurrentOrigin] = useState<string>();
  const [remoteUrl, setRemoteUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([loadSettings(), getRecents(), getAutoRenderOrigins(), browser.tabs.query({ active: true, currentWindow: true })]).then(([saved, recentItems, savedOrigins, tabs]) => {
      setSettings(saved);
      setRecents(recentItems);
      setOrigins(savedOrigins);
      const url = tabs[0]?.url;
      if (url) {
        try { const parsed = new URL(url); if (parsed.protocol === 'https:' || parsed.protocol === 'http:') setCurrentOrigin(parsed.origin); } catch { /* Browser-internal tabs cannot be granted. */ }
      }
    }).catch(() => setMessage('Extension storage is unavailable. Reload the extension and try again.'));
  }, []);

  const openReader = (): void => { void browser.tabs.create({ url: readerUrl() }).catch(() => setMessage('The reader tab could not be opened.')); };

  const openUrl = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    let url: URL;
    try { url = new URL(remoteUrl); } catch { setMessage('Enter a complete http:// or https:// Markdown URL.'); return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { setMessage('Only public HTTP and HTTPS URLs are supported.'); return; }
    setBusy(true);
    try {
      const granted = await browser.permissions.request({ origins: [`${url.origin}/*`] });
      if (!granted) { setMessage(`Access to ${url.origin} was not granted.`); return; }
      await browser.tabs.create({ url: `${readerUrl()}?url=${encodeURIComponent(url.href)}` });
    } catch {
      setMessage(`Could not request access to ${url.origin}.`);
    } finally { setBusy(false); }
  };

  const openCurrentPage = async (): Promise<void> => {
    setBusy(true);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('There is no active page to read.');
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const title = document.title || 'Web page';
          const body = document.body?.innerText?.trim() ?? '';
          return { title, source: location.href, text: `# ${title}\n\n${body.slice(0, 2_000_000)}${body.length > 2_000_000 ? '\n\n[Page text truncated after 2 MB.]' : ''}` };
        },
      });
      const page = results[0]?.result;
      if (!page || typeof page.text !== 'string') throw new Error('This page did not provide readable text.');
      await putPendingDocument({ kind: 'page', name: page.title || 'Web page', source: page.source || 'Current page', text: page.text });
      await browser.tabs.create({ url: readerUrl() });
    } catch (reason) {
      const description = reason instanceof Error ? reason.message : 'The current page could not be read.';
      setMessage(`${description} Some browser and extension pages block access.`);
    } finally { setBusy(false); }
  };

  const openSelectedFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    try {
      if (!/\.(?:md|markdown|mdx|mkd|mdown|txt)$/iu.test(file.name) && file.type !== 'text/markdown' && file.type !== 'text/plain') {
        setMessage('Choose a Markdown file or a plain text file.');
        return;
      }
      const text = await file.text();
      await putPendingDocument({ kind: 'local', name: file.name, source: file.name, text, lastModified: file.lastModified, size: file.size });
      await browser.tabs.create({ url: readerUrl() });
    } catch { setMessage('The selected file could not be opened.'); }
    finally { setBusy(false); }
  };

  const toggleAutoRender = async (): Promise<void> => {
    if (!currentOrigin) return;
    const enabled = origins.includes(currentOrigin);
    const next = enabled ? origins.filter((origin) => origin !== currentOrigin) : [...origins, currentOrigin];
    try {
      if (enabled) {
        await browser.permissions.remove({ origins: [`${currentOrigin}/*`] });
      } else {
        const granted = await browser.permissions.request({ origins: [`${currentOrigin}/*`] });
        if (!granted) { setMessage(`Access to ${currentOrigin} was not granted.`); return; }
      }
      await setAutoRenderOrigins(next);
      setOrigins(next);
      await browser.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' });
      setMessage(enabled ? 'Automatic rendering disabled for this site.' : `Markdown URLs on ${currentOrigin} will open in the reader.`);
    } catch { setMessage('The site permission could not be changed.'); }
  };

  const updateTheme = (theme: ReaderSettings['theme']): void => {
    const next = { ...settings, theme, customThemeId: null };
    setSettings(next);
    void saveSettings(next).catch(() => setMessage('The theme preference could not be saved.'));
  };

  const openRecent = async (item: RecentDocument): Promise<void> => {
    if (item.kind !== 'remote' || !item.url) {
      setMessage('Local files and page snapshots are not retained. Choose the file or page again to reopen it.');
      return;
    }
    try {
      const url = new URL(item.url);
      const granted = await browser.permissions.contains({ origins: [`${url.origin}/*`] }) || await browser.permissions.request({ origins: [`${url.origin}/*`] });
      if (!granted) { setMessage(`Access to ${url.origin} was not granted.`); return; }
      await browser.tabs.create({ url: `${readerUrl()}?url=${encodeURIComponent(url.href)}` });
    } catch { setMessage('This recent URL could not be reopened.'); }
  };

  return <main className={`popup-shell popup-${settings.theme}`}>
    <header className="popup-header"><span className="popup-icon"><BookOpen size={17} /></span><div><h1>Markdown Reader</h1><small>Read locally, stay in control</small></div><button type="button" className="popup-icon-button" title="Settings" aria-label="Open settings" onClick={() => void browser.tabs.create({ url: new URL('/options.html', window.location.href).href })}><Settings2 size={17} /></button></header>
    <section className="popup-primary" aria-label="Open a document">
      <label className="popup-action"><FilePlus2 size={17} /><span>Open Markdown file</span><input type="file" accept=".md,.markdown,.mdx,.mkd,.mdown,.txt,text/markdown,text/plain" onChange={(event) => void openSelectedFile(event)} /></label>
      <button className="popup-action" type="button" onClick={openReader}><FolderOpen size={17} /><span>Open reader &amp; choose folder</span></button>
      <button className="popup-action" type="button" disabled={busy} onClick={() => void openCurrentPage()}><Globe2 size={17} /><span>Render current page</span></button>
    </section>

    <form className="popup-url" onSubmit={(event) => void openUrl(event)}>
      <label htmlFor="popup-url">Open an online Markdown URL</label>
      <div><input id="popup-url" type="url" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://site.test/README.md" /><button type="submit" disabled={!remoteUrl || busy} aria-label="Open URL"><ExternalLink size={15} /></button></div>
      <small>Requests access to that site only.</small>
    </form>

    {currentOrigin && <section className="popup-autoload">
      <div className="popup-autoload-copy"><ShieldCheck size={16} /><span><strong>Automatic Markdown URLs</strong><small>{origins.includes(currentOrigin) ? `Enabled for ${currentOrigin}` : `Off for ${currentOrigin}`}</small></span></div>
      <button type="button" aria-pressed={origins.includes(currentOrigin)} className={`switch ${origins.includes(currentOrigin) ? 'is-on' : ''}`} onClick={() => void toggleAutoRender()} aria-label={origins.includes(currentOrigin) ? 'Disable automatic rendering for this site' : 'Enable automatic rendering for this site'}><span /></button>
    </section>}

    <section className="popup-appearance"><label htmlFor="quick-theme">Reading theme</label><select id="quick-theme" value={settings.theme} onChange={(event) => updateTheme(event.target.value as ReaderSettings['theme'])}><option value="paper">Paper</option><option value="snow">Snow</option><option value="sepia">Sepia</option><option value="graphite">Graphite</option><option value="midnight">Midnight</option><option value="system">System</option></select></section>

    <section className="popup-recents"><div className="popup-section-title"><span>Recent documents</span>{recents.length > 0 && <span>{recents.length}</span>}</div>
      {recents.slice(0, 4).map((item) => <button key={item.id} className="popup-recent" type="button" onClick={() => void openRecent(item)}><span className="recent-dot" /><span><strong>{item.name}</strong><small>{item.kind === 'remote' ? new URL(item.url ?? 'https://example.test').hostname : `${item.kind === 'page' ? 'Page snapshot' : 'Local file'} · choose again to reopen`}</small></span><ExternalLink size={13} /></button>)}
      {!recents.length && <p className="popup-empty">Documents you open appear here. File contents are never saved.</p>}
    </section>

    {message && <p className="popup-message" role="status">{message}<button type="button" onClick={() => setMessage('')} aria-label="Dismiss message">×</button></p>}
    <footer className="popup-footer"><span>Local preferences · no account</span><a href={new URL('/options.html', window.location.href).href} target="_blank" rel="noreferrer">Settings</a></footer>
  </main>;
}
