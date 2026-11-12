import { browser } from 'wxt/browser';
import { ArrowDownToLine, Check, FileUp, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import {
  DEFAULT_SETTINGS,
  exportSettings,
  normalizeSettings,
  parseSettingsImport,
  scopeCustomCss,
  type CustomTheme,
  type ReaderSettings,
} from '../core/settings';
import { getAutoRenderOrigins, loadSettings, saveSettings, setAutoRenderOrigins } from '../shared/storage';
import { themeStyle } from './theme';

const sections = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'reading', label: 'Reading' },
  { id: 'markdown', label: 'Markdown features' },
  { id: 'code', label: 'Code blocks' },
  { id: 'diagrams', label: 'Diagrams & mathematics' },
  { id: 'files', label: 'File handling' },
  { id: 'online', label: 'Online documents' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'advanced', label: 'Advanced' },
] as const;

export function SettingsApp(): ReactElement {
  const [settings, setSettings] = useState<ReaderSettings>({ ...DEFAULT_SETTINGS });
  const [origins, setOrigins] = useState<string[]>([]);
  const [activeSection, setActiveSection] = useState<string>('appearance');
  const [status, setStatus] = useState('');
  const [cssDraft, setCssDraft] = useState('');
  const [cssPreview, setCssPreview] = useState(false);
  const [themeName, setThemeName] = useState('');
  const [themeBackground, setThemeBackground] = useState('#f7f6f0');
  const [themeForeground, setThemeForeground] = useState('#202820');
  const [themeAccent, setThemeAccent] = useState('#386b4f');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([loadSettings(), getAutoRenderOrigins()]).then(([saved, savedOrigins]) => {
      setSettings(saved);
      setCssDraft(saved.customCss);
      setOrigins(savedOrigins);
    }).catch(() => setStatus('Preferences could not be loaded. Try reopening this page.'));
  }, []);

  const update = (change: Partial<ReaderSettings>): void => {
    const next = normalizeSettings({ ...settings, ...change });
    setSettings(next);
    void saveSettings(next).then(() => {
      setStatus('Saved on this device.');
      window.setTimeout(() => setStatus(''), 1800);
    }).catch(() => setStatus('Settings could not be saved.'));
  };

  const saveCss = (): void => {
    const scoped = scopeCustomCss(cssDraft);
    if (cssDraft.trim() && !scoped) {
      setStatus('Custom CSS was not saved. Use simple selectors and declarations; remote resources and global selectors are blocked.');
      return;
    }
    update({ customCss: scoped });
    setCssDraft(scoped);
  };

  const saveCustomTheme = (): void => {
    const name = themeName.trim();
    if (!name) { setStatus('Give the theme a name before saving it.'); return; }
    const id = `custom-${name.toLowerCase().replace(/[^a-z\d]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 22)}-${Date.now().toString(36).slice(-4)}`;
    const theme: CustomTheme = { id, name: name.slice(0, 40), background: themeBackground, foreground: themeForeground, accent: themeAccent };
    update({ customThemes: [...settings.customThemes.filter((item) => item.id !== settings.customThemeId), theme].slice(-12), customThemeId: id });
    setThemeName('');
  };

  const removeCustomTheme = (id: string): void => {
    const remaining = settings.customThemes.filter((theme) => theme.id !== id);
    update({ customThemes: remaining, customThemeId: settings.customThemeId === id ? null : settings.customThemeId });
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const imported = parseSettingsImport(await file.text());
      update(imported);
      setCssDraft(imported.customCss);
      setStatus('Settings imported and saved on this device.');
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : 'This settings file could not be imported.'); }
  };

  const removeOrigin = async (origin: string): Promise<void> => {
    try {
      await browser.permissions.remove({ origins: [`${origin}/*`] });
      const remaining = origins.filter((item) => item !== origin);
      await setAutoRenderOrigins(remaining);
      setOrigins(remaining);
      await browser.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' });
      setStatus(`Automatic rendering and site access removed for ${origin}.`);
    } catch { setStatus(`Access for ${origin} could not be removed.`); }
  };

  const activeCustomTheme = settings.customThemeId
    ? settings.customThemes.find(({ id }) => id === settings.customThemeId)
    : undefined;

  return <main className="settings-shell">
    <a className="settings-skip-link" href="#settings-content">Skip to settings</a>
    <header className="settings-header"><div><a className="settings-brand" href={new URL('/reader.html', window.location.href).href}>Markdown Reader</a><span>Preferences</span></div><a className="reader-link" href={new URL('/reader.html', window.location.href).href}>Back to reader <ArrowDownToLine size={14} /></a></header>
    <div className="settings-grid">
      <aside className="settings-nav" aria-label="Settings sections"><p>SETTINGS</p>{sections.map((section) => <a key={section.id} href={`#${section.id}`} className={activeSection === section.id ? 'is-active' : ''} onClick={() => setActiveSection(section.id)}>{section.label}</a>)}</aside>
      <div id="settings-content" className="settings-main" tabIndex={-1}>
        <div className="settings-intro"><h1>Make reading yours.</h1><p>Every preference stays on this device. Document contents are not stored.</p>{status && <div className="settings-status" role="status"><Check size={14} />{status}</div>}</div>

        <section id="appearance" className="settings-section">
          <div className="section-heading"><h2>Appearance</h2><p>Set the page palette and the shape of the text.</p></div>
          <div className="setting-row"><div><strong>Theme</strong><small>Choose a reading surface or follow your device.</small></div><select aria-label="Reading theme" value={activeCustomTheme ? activeCustomTheme.id : settings.theme} onChange={(event) => {
            const custom = settings.customThemes.find((theme) => theme.id === event.target.value);
            if (custom) update({ customThemeId: custom.id }); else update({ theme: event.target.value as ReaderSettings['theme'], customThemeId: null });
          }}><option value="paper">Paper</option><option value="snow">Snow</option><option value="sepia">Sepia</option><option value="graphite">Graphite</option><option value="midnight">Midnight</option><option value="system">System</option>{settings.customThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></div>
          {settings.customThemes.map((theme) => <div className="custom-theme-row" key={theme.id}><span className="theme-swatch" style={{ background: theme.background, color: theme.foreground, borderColor: theme.accent }}>Aa</span><span>{theme.name}</span><button className="small-button" type="button" onClick={() => removeCustomTheme(theme.id)} aria-label={`Remove ${theme.name} theme`}><X size={14} /></button></div>)}
          <fieldset className="theme-builder"><legend>Create a custom theme</legend><label>Theme name<input value={themeName} maxLength={40} onChange={(event) => setThemeName(event.target.value)} placeholder="Evening notes" /></label><label>Background<input type="color" value={themeBackground} onChange={(event) => setThemeBackground(event.target.value)} /></label><label>Text<input type="color" value={themeForeground} onChange={(event) => setThemeForeground(event.target.value)} /></label><label>Accent<input type="color" value={themeAccent} onChange={(event) => setThemeAccent(event.target.value)} /></label><button className="primary-button" type="button" onClick={saveCustomTheme}>Save theme</button></fieldset>
          <div className="appearance-preview" id="reader" style={themeStyle(settings)}><div className="markdown-body"><h3>Reading preview</h3><p>A comfortable line length gives technical ideas room to unfold. <a href="#preview">Links remain easy to find.</a></p><pre><code>const page = "clear";</code></pre></div></div>
        </section>

        <section id="reading" className="settings-section">
          <div className="section-heading"><h2>Reading</h2><p>Adjust measure, spacing, and the reading voice.</p></div>
          <RangeSetting label="Text size" value={settings.fontSize} min={14} max={28} unit="px" onChange={(value) => update({ fontSize: value })} />
          <RangeSetting label="Line height" value={settings.lineHeight} min={1.35} max={2.2} step={0.05} unit="×" onChange={(value) => update({ lineHeight: value })} />
          <RangeSetting label="Paragraph spacing" value={settings.paragraphSpacing} min={0.5} max={2.5} step={0.05} unit="em" onChange={(value) => update({ paragraphSpacing: value })} />
          <RangeSetting label="Reading width" value={settings.readingWidth} min={560} max={1120} step={20} unit="px" onChange={(value) => update({ readingWidth: value })} />
          <div className="setting-row"><div><strong>Reading type</strong><small>Uses fonts installed on your device.</small></div><select aria-label="Reading font" value={settings.fontFamily} onChange={(event) => update({ fontFamily: event.target.value as ReaderSettings['fontFamily'] })}><option value="serif">Serif</option><option value="sans">Sans serif</option><option value="mono">Monospace</option></select></div>
          <ToggleSetting label="Restore reading position" description="Save the last scroll position for each document." checked={settings.restorePosition} onChange={(checked) => update({ restorePosition: checked })} />
        </section>

        <section id="markdown" className="settings-section">
          <div className="section-heading"><h2>Markdown features</h2><p>Rendering runs locally. Markdown HTML and MDX code are never executed.</p></div>
          <ToggleSetting label="Load remote images" description="Images can reveal your IP address to their host. Off by default." checked={settings.allowRemoteImages} onChange={(checked) => update({ allowRemoteImages: checked })} />
          <div className="setting-note"><ShieldCheck size={16} /><span>Raw HTML is disabled. Links are protocol-checked, and document-provided scripts and JSX are not run.</span></div>
        </section>

        <section id="code" className="settings-section">
          <div className="section-heading"><h2>Code blocks</h2><p>Syntax highlighting is bundled and works offline.</p></div>
          <div className="setting-row"><div><strong>Code palette</strong><small>Match the page or force a light/dark syntax palette.</small></div><select aria-label="Code color palette" value={settings.codeTheme} onChange={(event) => update({ codeTheme: event.target.value as ReaderSettings['codeTheme'] })}><option value="match">Match theme</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
          <ToggleSetting label="Show line numbers" description="Display a line count beside code blocks." checked={settings.showLineNumbers} onChange={(checked) => update({ showLineNumbers: checked })} />
          <div className="setting-note"><span>Each code block includes copy, wrap, collapse, and download controls.</span></div>
        </section>

        <section id="diagrams" className="settings-section">
          <div className="section-heading"><h2>Diagrams &amp; mathematics</h2><p>Large renderers load only when a document needs them.</p></div>
          <div className="feature-row"><span className="feature-mark">M</span><div><strong>Mermaid and Graphviz</strong><small>Run locally with strict diagram security. Output SVG is sanitized.</small></div><span className="feature-state">Available offline</span></div>
          <div className="feature-row"><span className="feature-mark">∑</span><div><strong>KaTeX mathematics</strong><small>Inline and display math render locally with trust disabled.</small></div><span className="feature-state">Available offline</span></div>
        </section>

        <section id="files" className="settings-section">
          <div className="section-heading"><h2>File handling</h2><p>Local file contents and folders stay in memory for the reading session.</p></div>
          <div className="setting-note"><span>Use Open file for one document, or Open folder to navigate Markdown files and relative images. Folder access falls back to the browser’s directory input where File System Access is unavailable.</span></div>
          <div className="setting-note"><span>To read file:// URLs directly, enable “Allow access to file URLs” in your browser’s extension settings. The file picker does not require this setting.</span></div>
        </section>

        <section id="online" className="settings-section">
          <div className="section-heading"><h2>Online documents</h2><p>Documents are fetched directly from the source after a site-specific permission request.</p></div>
          <ToggleSetting label="Live reload" description="Check a remote document only while this reader tab is visible." checked={settings.liveReloadEnabled} onChange={(checked) => update({ liveReloadEnabled: checked })} />
          <div className="setting-row"><div><strong>Reload interval</strong><small>Polling pauses when the reader is in a background tab.</small></div><select aria-label="Remote reload interval" value={settings.liveReloadSeconds} disabled={!settings.liveReloadEnabled} onChange={(event) => update({ liveReloadSeconds: Number(event.target.value) })}>{[15, 30, 60, 120, 300].map((value) => <option key={value} value={value}>{value < 60 ? `${value} seconds` : `${value / 60} minute${value === 60 ? '' : 's'}`}</option>)}</select></div>
          {origins.length > 0 && <div className="site-list"><h3>Sites with automatic rendering access</h3>{origins.map((origin) => <div className="site-row" key={origin}><span>{origin}</span><button className="small-button" type="button" onClick={() => void removeOrigin(origin)}>Remove</button></div>)}</div>}
          {origins.length === 0 && <p className="settings-muted">Automatic rendering is off for all sites.</p>}
        </section>

        <section id="privacy" className="settings-section">
          <div className="section-heading"><h2>Privacy</h2><p>The extension has no server, account, telemetry, or cloud sync.</p></div>
          <div className="setting-note"><span>Only preferences, recent-document metadata, optional reading positions, and bookmarks are stored locally. Local file paths and file contents are not included in history.</span></div>
          <button className="secondary-button" type="button" onClick={async () => {
            const keys = ['markdownReaderRecents', 'markdownReaderProgress', 'markdownReaderBookmarks', 'markdownReaderAutoRenderOrigins'];
            await browser.storage.local.remove(keys);
            await Promise.all(origins.map((origin) => browser.permissions.remove({ origins: [`${origin}/*`] })));
            setOrigins([]);
            await browser.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' }).catch(() => undefined);
            setStatus('Recent history, bookmarks, reading positions, and site grants were cleared. Preferences were kept.');
          }}>Clear history, bookmarks, and site grants</button>
        </section>

        <section id="shortcuts" className="settings-section">
          <div className="section-heading"><h2>Keyboard shortcuts</h2><p>Use browser extension settings to change the action shortcut.</p></div>
          <div className="shortcut-grid"><span>Search document</span><kbd>Ctrl / ⌘ F</kbd><span>Command palette</span><kbd>Ctrl / ⌘ K</kbd><span>Open file</span><kbd>Ctrl / ⌘ O</kbd><span>Open folder</span><kbd>Ctrl / ⌘ Shift O</kbd><span>Change theme / focus</span><kbd>T / F</kbd><span>Show shortcuts</span><kbd>?</kbd><span>Extension action</span><kbd>Alt Shift M</kbd></div>
          <p className="settings-muted">Shortcuts inside the reader are fixed. The browser controls the extension action shortcut and may let you change it.</p>
        </section>

        <section id="advanced" className="settings-section">
          <div className="section-heading"><h2>Advanced</h2><p>Custom CSS can only target the rendered Markdown document.</p></div>
          <label className="css-label" htmlFor="custom-css">Document CSS</label><textarea id="custom-css" value={cssDraft} onChange={(event) => setCssDraft(event.target.value)} spellCheck={false} placeholder="h1 { color: #386b4f; }" />
          <p className="settings-muted">Selectors are scoped under the reader document. Global selectors, @ rules, external resources, and fixed-position overlays are rejected.</p>
          <div className="button-row"><button className="primary-button" type="button" onClick={saveCss}>Save CSS</button><button className="secondary-button" type="button" onClick={() => setCssPreview((value) => !value)}>{cssPreview ? 'Hide preview' : 'Preview'}</button><button className="secondary-button" type="button" onClick={() => { setCssDraft(''); update({ customCss: '' }); }}>Reset CSS</button></div>
          {cssPreview && <div className="css-preview" id="reader" style={themeStyle(settings)}><style>{scopeCustomCss(cssDraft)}</style><div className="markdown-body"><h3>Preview heading</h3><p>Scoped styles apply to this sample of rendered Markdown. <a href="#preview">A sample link</a> and <code>inline code</code>.</p></div></div>}
          <div className="setting-row settings-file-tools"><div><strong>Settings file</strong><small>Export or import preferences as versioned JSON.</small></div><div className="button-row"><button className="secondary-button" type="button" onClick={() => {
            const url = URL.createObjectURL(new Blob([exportSettings(settings)], { type: 'application/json' }));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'markdown-reader-settings.json'; anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}><ArrowDownToLine size={14} />Export</button><button className="secondary-button" type="button" onClick={() => importRef.current?.click()}><FileUp size={14} />Import</button><input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Import settings file" onChange={(event) => void handleImport(event)} /></div></div>
          <button className="reset-button" type="button" onClick={async () => {
            setSettings({ ...DEFAULT_SETTINGS }); setCssDraft(''); await saveSettings(DEFAULT_SETTINGS); setStatus('All preferences were reset to defaults.');
          }}><RotateCcw size={14} />Reset all preferences</button>
        </section>

        <footer className="settings-footer">Markdown Reader · preferences stored on this device · v1.0.0</footer>
      </div>
    </div>
  </main>;
}

function RangeSetting({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void }): ReactElement {
  return <label className="range-setting"><span><strong>{label}</strong><output>{value}{unit}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function ToggleSetting({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }): ReactElement {
  return <label className="toggle-setting"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span></label>;
}
