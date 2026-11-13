import { browser } from 'wxt/browser';
import { AlertTriangle, ArrowLeft, Check, Download, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { localAutoOpenState, type LocalAutoOpenState } from '../core/local-file';
import { DEFAULT_SETTINGS, exportSettings, MAX_CUSTOM_THEMES, parseSettingsImport, scopeCustomCss, type CustomTheme, type ReaderSettings } from '../core/settings';
import { HEX_COLOR_PATTERN, type SettingsChange } from '../core/settings-change';
import { checkCustomThemeContrast, contrastRatio, deriveCustomPalette, normalizeHexColor } from '../core/themes';
import { extensionSettingsUrl, getLocalFileAccess } from '../shared/file-access';
import { AUTO_RENDER_UPDATE_MESSAGE } from '../shared/messages';
import { clearLocalReaderData, getAutoRenderOrigins, setAutoRenderOrigins } from '../shared/storage';
import { choiceToChange, ThemeGallery } from './components/ThemeGallery';
import { useSettings } from './hooks/useSettings';
import { useModalDialog } from './reader/dialogs';
import { SINGLE_KEY_SHORTCUTS } from './reader/shortcuts';
import { readingStyle, swatchStyle, useAppliedTheme } from './theme';

const sections = [
  { id: 'appearance', label: 'Appearance & reading' },
  { id: 'content', label: 'Content & rendering' },
  { id: 'files', label: 'Files & online documents' },
  { id: 'privacy', label: 'Privacy & data' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'advanced', label: 'Advanced' },
] as const;

const version = (): string => { try { return browser.runtime.getManifest().version; } catch { return ''; } };

export function SettingsApp(): ReactElement {
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const statusTimer = useRef(0);
  const report = (text: string, error = false): void => {
    window.clearTimeout(statusTimer.current);
    setStatus({ text, error });
    if (!error) statusTimer.current = window.setTimeout(() => setStatus({ text: '', error: false }), 2600);
  };
  const { settings, loaded, change, changeSoon } = useSettings((message) => report(message, true));
  useAppliedTheme(settings);
  const save = async (next: SettingsChange, success = 'Saved.'): Promise<boolean> => {
    const saved = await change(next);
    if (saved) report(success);
    return saved !== undefined;
  };
  const patch = (value: Partial<Omit<ReaderSettings, 'customThemes'>>): void => { void save({ kind: 'patch', patch: value }); };

  const [activeSection, setActiveSection] = useState<string>(() => location.hash.slice(1) || 'appearance');
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: '-15% 0px -70% 0px' });
    sections.forEach(({ id }) => { const element = document.getElementById(id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, []);

  return <div className="settings-shell">
    <a className="skip-link" href="#settings-content">Skip to settings</a>
    <header className="settings-header">
      <h1>Markdown Reader <span>Settings</span></h1>
      <a className="text-button" href={new URL('/reader.html', location.href).href}><ArrowLeft size={16} aria-hidden="true" />Open reader</a>
    </header>
    <div className="settings-grid">
      <nav className="settings-nav" aria-label="Settings sections">
        <ul>{sections.map((section) => <li key={section.id}><a href={`#${section.id}`} aria-current={activeSection === section.id ? 'true' : undefined} onClick={() => setActiveSection(section.id)}>{section.label}</a></li>)}</ul>
      </nav>
      <main id="settings-content" className="settings-main" tabIndex={-1} aria-busy={!loaded}>
        <p className="settings-intro">Settings are saved on this device as you change them. Document contents are never stored.</p>

        <Section id="appearance" title="Appearance & reading">
          <ThemeGallery settings={settings} legend="Theme" onSelect={(choice) => { void save({ kind: 'patch', patch: choiceToChange(choice) }, 'Theme changed.'); }} />
          <CustomThemes settings={settings} save={save} report={report} />
          <div className="setting-group">
            <RangeSetting label="Text size" value={settings.fontSize} min={14} max={28} step={1} format={(value) => `${value}px`} onChange={(value) => changeSoon({ fontSize: value })} />
            <RangeSetting label="Line spacing" value={settings.lineHeight} min={1.35} max={2.2} step={0.05} format={(value) => value.toFixed(2)} onChange={(value) => changeSoon({ lineHeight: value })} />
            <RangeSetting label="Paragraph spacing" value={settings.paragraphSpacing} min={0.5} max={2.5} step={0.05} format={(value) => `${value.toFixed(2)} em`} onChange={(value) => changeSoon({ paragraphSpacing: value })} />
            <RangeSetting label="Line width" value={settings.readingWidth} min={560} max={1120} step={20} format={(value) => `${value}px`} onChange={(value) => changeSoon({ readingWidth: value })} />
            <SelectSetting label="Typeface" description="Uses fonts installed on this device." value={settings.fontFamily} options={[['serif', 'Serif'], ['sans', 'Sans serif'], ['mono', 'Monospace']]} onChange={(value) => patch({ fontFamily: value as ReaderSettings['fontFamily'] })} />
          </div>
          <div className={`reading-preview font-${settings.fontFamily}`} style={readingStyle(settings)} aria-label="Preview">
            <div className="markdown-body"><h3>Reading preview</h3><p>A comfortable line length gives technical ideas room to unfold. <a href="#appearance">Links stay easy to find</a>, and <code>inline code</code> stays distinct.</p></div>
          </div>
          <ToggleSetting label="Restore reading position" description="Return to where you left off in each document. Positions are kept for the last 100 documents." checked={settings.restorePosition} onChange={(checked) => patch({ restorePosition: checked })} />
        </Section>

        <Section id="content" title="Content & rendering">
          <SelectSetting label="Code colours" description="Follow the theme, or always use light or dark syntax colours." value={settings.codeTheme} options={[['match', 'Follow theme'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(value) => patch({ codeTheme: value as ReaderSettings['codeTheme'] })} />
          <ToggleSetting label="Line numbers" description="Number the lines of code blocks. Copied code never includes the numbers." checked={settings.showLineNumbers} onChange={(checked) => patch({ showLineNumbers: checked })} />
          <details className="setting-details">
            <summary>How documents are rendered</summary>
            <ul>
              <li>Everything runs in this browser. Nothing is uploaded.</li>
              <li>HTML inside Markdown is shown as text, and scripts, JSX, and MDX code never run.</li>
              <li>Mermaid and Graphviz diagrams and KaTeX mathematics are drawn locally, and their output is sanitized.</li>
              <li>Links are limited to web, email, and phone addresses.</li>
            </ul>
          </details>
        </Section>

        <Section id="files" title="Files & online documents">
          <LocalFiles settings={settings} patch={patch} report={report} />
          <ToggleSetting label="Check online documents for changes" description="Reload an online document while its tab is visible." checked={settings.liveReloadEnabled} onChange={(checked) => patch({ liveReloadEnabled: checked })} />
          <SelectSetting label="Check every" value={String(settings.liveReloadSeconds)} disabled={!settings.liveReloadEnabled} options={[15, 30, 60, 120, 300].map((value) => [String(value), value < 60 ? `${value} seconds` : `${value / 60} minute${value === 60 ? '' : 's'}`])} onChange={(value) => patch({ liveReloadSeconds: Number(value) })} />
          <Sites report={report} />
        </Section>

        <Section id="privacy" title="Privacy & data">
          <ToggleSetting label="Load remote images" description="Images from other sites can reveal your IP address to them. Off by default." checked={settings.allowRemoteImages} onChange={(checked) => patch({ allowRemoteImages: checked })} />
          <div className="setting-note">
            <strong>Stored on this device</strong>
            <p>Settings, the names and web addresses of recent documents, bookmarks, and (if you turn it on) reading positions. Local file paths and document contents are not stored. There is no account, server, or tracking.</p>
          </div>
          <ClearData report={report} />
        </Section>

        <Section id="shortcuts" title="Keyboard shortcuts">
          <ToggleSetting label="Letter shortcuts" description="Single keys such as T for the next theme. Turn them off if you use speech input or they get in your way." checked={settings.singleKeyShortcuts} onChange={(checked) => patch({ singleKeyShortcuts: checked })} />
          <dl className="shortcut-grid">
            <dt>Commands</dt><dd><kbd>Ctrl</kbd> or <kbd>⌘</kbd> + <kbd>K</kbd></dd>
            {SINGLE_KEY_SHORTCUTS.map((shortcut) => <ShortcutRow key={shortcut.key} label={shortcut.label} keys={shortcut.key === '?' ? '?' : shortcut.key.toUpperCase()} off={!settings.singleKeyShortcuts} />)}
            <dt>Close search, a dialog, or focus mode</dt><dd><kbd>Esc</kbd></dd>
          </dl>
          <p className="settings-muted">Browser shortcuts such as Find, zoom, Open, and Print keep working in the reader. {import.meta.env.FIREFOX ? 'To change the shortcut that opens the popup, use Manage Extension Shortcuts in Firefox’s Add-ons manager.' : 'To change the shortcut that opens the popup, open the browser’s extension shortcuts page.'}</p>
          {!import.meta.env.FIREFOX && <button className="secondary-button" type="button" onClick={() => { void browser.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => report('Open the browser’s extension shortcuts page from its Extensions menu.', true)); }}>Change extension shortcut</button>}
        </Section>

        <Section id="advanced" title="Advanced">
          <CustomCss settings={settings} save={save} />
          <ImportExport settings={settings} save={save} report={report} />
        </Section>

        <footer className="settings-footer">Markdown Reader {version()}</footer>
      </main>
    </div>
    <div className={`settings-toast ${status.error ? 'is-error' : ''}`} role={status.error ? 'alert' : 'status'} aria-live={status.error ? 'assertive' : 'polite'}>
      {status.text && <span>{status.error ? <AlertTriangle size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{status.text}{status.error && <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setStatus({ text: '', error: false })}>×</button>}</span>}
    </div>
  </div>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }): ReactElement {
  return <section id={id} className="settings-section" aria-labelledby={`${id}-title`}><h2 id={`${id}-title`}>{title}</h2>{children}</section>;
}

function ShortcutRow({ label, keys, off }: { label: string; keys: string; off: boolean }): ReactElement {
  return <><dt className={off ? 'is-off' : ''}>{label}{off && <span className="visually-hidden"> (off)</span>}</dt><dd className={off ? 'is-off' : ''}><kbd>{keys}</kbd></dd></>;
}

function ToggleSetting({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }): ReactElement {
  const id = useId();
  return <div className="setting-row">
    <label htmlFor={id}><strong>{label}</strong><small id={`${id}-description`}>{description}</small></label>
    <input id={id} className="toggle" type="checkbox" role="switch" checked={checked} aria-describedby={`${id}-description`} onChange={(event) => onChange(event.target.checked)} />
  </div>;
}

function SelectSetting({ label, description, value, options, disabled = false, onChange }: { label: string; description?: string; value: string; options: Array<[string, string]>; disabled?: boolean; onChange: (value: string) => void }): ReactElement {
  const id = useId();
  return <div className="setting-row">
    <label htmlFor={id}><strong>{label}</strong>{description && <small id={`${id}-description`}>{description}</small>}</label>
    <select id={id} value={value} disabled={disabled} {...(description ? { 'aria-describedby': `${id}-description` } : {})} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>
  </div>;
}

function RangeSetting({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }): ReactElement {
  const id = useId();
  return <div className="range-setting">
    <label htmlFor={id}><strong>{label}</strong><output htmlFor={id}>{format(value)}</output></label>
    <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={format(value)} onChange={(event) => onChange(Number(event.target.value))} />
  </div>;
}

function ConfirmDialog({ open, title, body, confirm, onConfirm, onClose }: { open: boolean; title: string; body: string; confirm: string; onConfirm: () => void; onClose: () => void }): ReactElement {
  const ref = useModalDialog(open);
  const id = useId();
  return <dialog ref={ref} className="confirm-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <h2 id={`${id}-title`}>{title}</h2>
    <p id={`${id}-body`}>{body}</p>
    <div className="button-row"><button className="secondary-button" type="button" data-autofocus onClick={onClose}>Cancel</button><button className="danger-button" type="button" onClick={() => { onClose(); onConfirm(); }}>{confirm}</button></div>
  </dialog>;
}

type Save = (change: SettingsChange, success?: string) => Promise<boolean>;
type Report = (text: string, error?: boolean) => void;

const newThemeId = (name: string): string =>
  `custom-${name.toLowerCase().replace(/[^a-z\d]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 16) || 'theme'}-${crypto.randomUUID().slice(0, 8)}`;

function CustomThemes({ settings, save, report }: { settings: ReaderSettings; save: Save; report: Report }): ReactElement {
  const [draft, setDraft] = useState<CustomTheme | undefined>();
  const [editing, setEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CustomTheme | undefined>();
  const full = settings.customThemes.length >= MAX_CUSTOM_THEMES;

  const startNew = (): void => {
    if (full) { report(`You can keep up to ${MAX_CUSTOM_THEMES} custom themes. Delete one to add another.`, true); return; }
    setEditing(false);
    setDraft({ id: '', name: '', background: '#f7f6f0', foreground: '#202820', accent: '#386b4f' });
  };

  return <div className="custom-themes">
    <div className="custom-themes-head">
      <h3>Custom themes</h3>
      <button className="secondary-button" type="button" onClick={startNew} disabled={draft !== undefined}><Plus size={16} aria-hidden="true" />New theme</button>
    </div>
    {settings.customThemes.length === 0 && !draft && <p className="settings-muted">Create a theme from three colours. Secondary text, borders, and code colours are derived for you.</p>}
    {settings.customThemes.length > 0 && <ul className="custom-theme-list">
      {settings.customThemes.map((theme) => <li key={theme.id}>
        <span className="theme-chip" aria-hidden="true" style={swatchStyle(deriveCustomPalette(theme))}>Aa</span>
        <span className="custom-theme-name">{theme.name}{settings.customThemeId === theme.id && <small>In use</small>}</span>
        <button className="icon-button" type="button" aria-label={`Edit ${theme.name}`} onClick={() => { setEditing(true); setDraft({ ...theme }); }}><Pencil size={16} aria-hidden="true" /></button>
        <button className="icon-button" type="button" aria-label={`Delete ${theme.name}`} onClick={() => setPendingDelete(theme)}><Trash2 size={16} aria-hidden="true" /></button>
      </li>)}
    </ul>}
    {draft && <ThemeEditor
      draft={draft}
      editing={editing}
      onChange={setDraft}
      onCancel={() => setDraft(undefined)}
      onSave={async () => {
        const theme = editing ? draft : { ...draft, id: newThemeId(draft.name) };
        if (await save({ kind: 'save-theme', theme, select: !editing || settings.customThemeId === theme.id }, editing ? `Saved “${theme.name.trim()}”.` : `Created and applied “${theme.name.trim()}”.`)) setDraft(undefined);
      }}
    />}
    <ConfirmDialog open={pendingDelete !== undefined} title={`Delete “${pendingDelete?.name ?? ''}”?`} body={settings.customThemeId === pendingDelete?.id ? 'This theme is in use. The reader will switch back to your built-in theme.' : 'This custom theme will be removed.'} confirm="Delete theme" onClose={() => setPendingDelete(undefined)} onConfirm={() => { if (pendingDelete) void save({ kind: 'remove-theme', id: pendingDelete.id }, `Deleted “${pendingDelete.name}”.`); }} />
  </div>;
}

function ThemeEditor({ draft, editing, onChange, onSave, onCancel }: { draft: CustomTheme; editing: boolean; onChange: (theme: CustomTheme) => void; onSave: () => void; onCancel: () => void }): ReactElement {
  const id = useId();
  const valid = [draft.background, draft.foreground, draft.accent].every((color) => HEX_COLOR_PATTERN.test(color));
  const warnings = valid ? checkCustomThemeContrast(draft) : [];
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [draft.background, draft.foreground, draft.accent]);
  const named = draft.name.trim().length > 0;
  const palette = valid ? deriveCustomPalette(draft) : undefined;
  const colour = (key: 'background' | 'foreground' | 'accent', label: string): ReactElement => <ColorField label={label} value={draft[key]} onChange={(value) => onChange({ ...draft, [key]: value })} />;

  return <form className="theme-editor" aria-labelledby={`${id}-title`} onSubmit={(event) => { event.preventDefault(); if (named && valid && (warnings.length === 0 || acknowledged)) onSave(); }}>
    <h4 id={`${id}-title`}>{editing ? `Edit “${draft.name}”` : 'New theme'}</h4>
    <div className="theme-editor-fields">
      <label className="text-field"><span>Name</span><input value={draft.name} maxLength={40} required onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Evening notes" /></label>
      {colour('background', 'Background')}
      {colour('foreground', 'Text')}
      {colour('accent', 'Links and accents')}
    </div>
    {palette && <div className="theme-editor-preview" style={swatchStyle(palette)} aria-label="Theme preview">
      <strong>Preview heading</strong>
      <p>Body text with <span className="preview-link">a link</span> and <code>code</code>. <span className="preview-muted">Secondary text.</span></p>
      <small>Text {contrastRatio(draft.foreground, draft.background).toFixed(1)}:1 · Links {contrastRatio(draft.accent, draft.background).toFixed(1)}:1 (4.5:1 or more is readable)</small>
    </div>}
    {warnings.length > 0 && <div className="contrast-warning" role="alert">
      <AlertTriangle size={17} aria-hidden="true" />
      <div>{warnings.map((warning) => <p key={warning.part}>{warning.message}</p>)}
        <label className="checkbox-field"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />Save it anyway</label></div>
    </div>}
    <div className="button-row">
      <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
      <button className="primary-button" type="submit" disabled={!named || !valid || (warnings.length > 0 && !acknowledged)}>{editing ? 'Save changes' : 'Create theme'}</button>
    </div>
  </form>;
}

/** A colour picker paired with a text field, so colours can be typed or pasted exactly. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): ReactElement {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const invalid = !HEX_COLOR_PATTERN.test(text);
  return <div className="color-field">
    <label htmlFor={`${id}-text`}>{label}</label>
    <div>
      <input type="color" aria-label={`${label} colour picker`} value={normalizeHexColor(value) ?? '#000000'} onChange={(event) => onChange(event.target.value)} />
      <input id={`${id}-text`} value={text} maxLength={7} spellCheck={false} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => { const next = event.target.value.trim(); setText(next); if (HEX_COLOR_PATTERN.test(next)) onChange(normalizeHexColor(next) ?? next); else onChange(next); }} />
    </div>
    {invalid && <small id={`${id}-error`} className="field-error">Use #rgb or #rrggbb, for example #1a2b3c.</small>}
  </div>;
}

const localStateText: Record<LocalAutoOpenState, string> = {
  active: 'On. Local Markdown files you open in this browser are shown in the reader.',
  disabled: 'Off.',
  'permission-required': 'Waiting for browser permission. The browser must allow Markdown Reader to read local files.',
  unavailable: 'Not available in this browser. Firefox needs version 153 or later; you can still use Open file.',
};

function LocalFiles({ settings, patch, report }: { settings: ReaderSettings; patch: (value: Partial<ReaderSettings>) => void; report: Report }): ReactElement {
  const [fileAccess, setFileAccess] = useState<boolean | undefined>();
  useEffect(() => {
    const refresh = (): void => { void getLocalFileAccess().then(setFileAccess); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    browser.permissions.onAdded.addListener(refresh);
    browser.permissions.onRemoved.addListener(refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      browser.permissions.onAdded.removeListener(refresh);
      browser.permissions.onRemoved.removeListener(refresh);
    };
  }, []);
  const state = localAutoOpenState(settings.autoOpenLocalFiles, fileAccess);
  const settingsUrl = extensionSettingsUrl();
  const needsAccess = fileAccess === false;
  return <>
    <ToggleSetting label="Open local Markdown files automatically" description="When you open a .md file (or .markdown, .mdx, and similar) in this browser, show it in the reader. Other files are left alone." checked={settings.autoOpenLocalFiles} onChange={(checked) => patch({ autoOpenLocalFiles: checked })} />
    <div className="local-file-status setting-note" data-state={state} role="status">
      <strong>{localStateText[state]}</strong>
      {state === 'disabled' && fileAccess === true && <p>The browser already allows file access.</p>}
      {needsAccess && <p>{import.meta.env.FIREFOX
        ? 'To allow it, open the Firefox menu › Add-ons and themes › Markdown Reader › Permissions and data, and turn on “Access local files on your computer”.'
        : 'To allow it, open this extension’s details page and turn on “Allow access to file URLs”. The browser restarts the extension, so this page may reload.'}</p>}
      {needsAccess && settingsUrl && <button className="secondary-button" type="button" onClick={() => { void browser.tabs.create({ url: settingsUrl }).catch(() => report('The extension page could not be opened. Open it from the browser’s Extensions menu.', true)); }}>Open extension settings</button>}
      {import.meta.env.FIREFOX && state === 'active' && <p>Firefox passes files of up to 4 MB to the reader. Larger files stay as plain text; open them with Open file.</p>}
    </div>
  </>;
}

function Sites({ report }: { report: Report }): ReactElement {
  const [origins, setOrigins] = useState<string[] | undefined>();
  useEffect(() => { void getAutoRenderOrigins().then(setOrigins).catch(() => setOrigins([])); }, []);
  const remove = async (origin: string): Promise<void> => {
    try {
      await browser.permissions.remove({ origins: [`${origin}/*`] });
      const remaining = (origins ?? []).filter((item) => item !== origin);
      await setAutoRenderOrigins(remaining);
      setOrigins(remaining);
      await browser.runtime.sendMessage({ type: AUTO_RENDER_UPDATE_MESSAGE });
      report(`Removed ${new URL(origin).host}.`);
    } catch { report(`${origin} could not be removed.`, true); }
  };
  return <div className="site-list">
    <h3>Sites that open Markdown in the reader</h3>
    {origins?.length === 0 && <p className="settings-muted">None. Turn this on for a site from the popup while you are on it.</p>}
    {origins && origins.length > 0 && <ul>{origins.map((origin) => <li key={origin}><span>{origin}</span><button className="secondary-button" type="button" aria-label={`Remove ${origin}`} onClick={() => void remove(origin)}>Remove</button></li>)}</ul>}
  </div>;
}

function ClearData({ report }: { report: Report }): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const clear = async (): Promise<void> => {
    try {
      const origins = await getAutoRenderOrigins();
      await clearLocalReaderData();
      await Promise.all(origins.map((origin) => browser.permissions.remove({ origins: [`${origin}/*`] })));
      await browser.runtime.sendMessage({ type: AUTO_RENDER_UPDATE_MESSAGE });
      report('Reading history and site access were cleared. Settings were kept.');
    } catch { report('Some data could not be cleared. Try again.', true); }
  };
  return <>
    <button className="danger-button" type="button" onClick={() => setConfirming(true)}><Trash2 size={16} aria-hidden="true" />Clear reading history…</button>
    <ConfirmDialog open={confirming} title="Clear reading history?" body="This removes recent documents, bookmarks, reading positions, and site access for automatic opening. Your settings and themes stay." confirm="Clear history" onClose={() => setConfirming(false)} onConfirm={() => void clear()} />
  </>;
}

function CustomCss({ settings, save }: { settings: ReaderSettings; save: Save }): ReactElement {
  const [draft, setDraft] = useState(settings.customCss);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setDraft(settings.customCss); }, [settings.customCss, touched]);
  const scoped = scopeCustomCss(draft);
  const rejected = draft.trim() !== '' && scoped === '';
  return <div className="custom-css">
    <label htmlFor="custom-css"><strong>Document CSS</strong><small>Styles apply only inside the rendered document. At-rules, external resources, global selectors, and fixed positioning are not allowed.</small></label>
    <textarea id="custom-css" value={draft} spellCheck={false} aria-invalid={rejected} aria-describedby={rejected ? 'custom-css-error' : undefined} placeholder="h1 { color: #386b4f; }" onChange={(event) => { setTouched(true); setDraft(event.target.value); }} />
    {rejected && <small id="custom-css-error" className="field-error">This CSS can’t be used. Use simple selectors and declarations only.</small>}
    {scoped && <div className="css-preview" id="css-preview"><style>{scoped.replaceAll('#reader .markdown-body', '#css-preview .markdown-body')}</style><div className="markdown-body"><h3>Preview heading</h3><p>A paragraph with <a href="#advanced">a link</a> and <code>inline code</code>.</p></div></div>}
    <div className="button-row">
      <button className="primary-button" type="button" disabled={rejected || scoped === settings.customCss} onClick={() => { void save({ kind: 'patch', patch: { customCss: scoped } }, 'Document CSS saved.').then((ok) => { if (ok) setTouched(false); }); }}>Save CSS</button>
      <button className="secondary-button" type="button" disabled={!settings.customCss && !draft} onClick={() => { setDraft(''); void save({ kind: 'patch', patch: { customCss: '' } }, 'Document CSS removed.').then(() => setTouched(false)); }}>Remove CSS</button>
    </div>
  </div>;
}

function ImportExport({ settings, save, report }: { settings: ReaderSettings; save: Save; report: Report }): ReactElement {
  const importRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const handleImport = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const imported = parseSettingsImport(await file.text());
      await save({ kind: 'replace', settings: imported }, 'Settings imported.');
    } catch (reason) { report(reason instanceof Error ? reason.message : 'This settings file could not be imported.', true); }
  };
  const exportFile = (): void => {
    const url = URL.createObjectURL(new Blob([exportSettings(settings)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'markdown-reader-settings.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <div className="setting-row">
      <div><strong>Settings file</strong><small>Move your settings and custom themes to another browser.</small></div>
      <div className="button-row">
        <button className="secondary-button" type="button" onClick={exportFile}><Download size={16} aria-hidden="true" />Export</button>
        <button className="secondary-button" type="button" onClick={() => importRef.current?.click()}><Upload size={16} aria-hidden="true" />Import…</button>
        <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" tabIndex={-1} aria-hidden="true" onChange={(event) => void handleImport(event)} />
      </div>
    </div>
    <div className="setting-row">
      <div><strong>Reset settings</strong><small>Restore every setting to its default. Custom themes are deleted.</small></div>
      <button className="danger-button" type="button" onClick={() => setConfirmReset(true)}><RotateCcw size={16} aria-hidden="true" />Reset…</button>
    </div>
    <ConfirmDialog open={confirmReset} title="Reset all settings?" body="Every setting returns to its default and your custom themes are deleted. Bookmarks and reading history are kept." confirm="Reset settings" onClose={() => setConfirmReset(false)} onConfirm={() => void save({ kind: 'replace', settings: DEFAULT_SETTINGS }, 'Settings were reset.')} />
  </>;
}
