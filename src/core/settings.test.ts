import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  exportSettings,
  loadSettings,
  normalizeSettings,
  parseSettingsImport,
  saveSettings,
  scopeCustomCss,
  type SettingsStorage,
} from './settings';

describe('settings normalization', () => {
  it('fills defaults and clamps user-controlled reading values', () => {
    const settings = normalizeSettings({ theme: 'sepia', fontSize: 200, lineHeight: 0.5, allowRemoteImages: true });

    expect(settings.theme).toBe('sepia');
    expect(settings.fontSize).toBe(28);
    expect(settings.lineHeight).toBe(1.35);
    expect(settings.allowRemoteImages).toBe(true);
    expect(settings.readingWidth).toBe(DEFAULT_SETTINGS.readingWidth);
  });

  it('ignores malformed or unknown values instead of trusting imported data', () => {
    const settings = normalizeSettings({ theme: 'not-a-theme', customCss: 'body { color: red }', liveReloadSeconds: -1 });

    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.customCss).toBe('');
    expect(settings.liveReloadSeconds).toBe(15);
  });
});

describe('local automatic opening preference', () => {
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.autoOpenLocalFiles).toBe(false);
    expect(normalizeSettings({}).autoOpenLocalFiles).toBe(false);
  });

  it('accepts only an explicit true', () => {
    expect(normalizeSettings({ autoOpenLocalFiles: true }).autoOpenLocalFiles).toBe(true);
    expect(normalizeSettings({ autoOpenLocalFiles: 'true' }).autoOpenLocalFiles).toBe(false);
    expect(normalizeSettings({ autoOpenLocalFiles: 1 }).autoOpenLocalFiles).toBe(false);
  });

  it('survives export and import', () => {
    expect(parseSettingsImport(exportSettings({ ...DEFAULT_SETTINGS, autoOpenLocalFiles: true })).autoOpenLocalFiles).toBe(true);
  });
});

describe('settings import and export', () => {
  it('round-trips only versioned settings data', () => {
    const exported = exportSettings({ ...DEFAULT_SETTINGS, theme: 'midnight', fontSize: 20 });
    const imported = parseSettingsImport(exported);

    expect(imported.theme).toBe('midnight');
    expect(imported.fontSize).toBe(20);
    expect(exported).not.toContain('documentContents');
  });

  it('rejects unrelated or unsupported JSON files', () => {
    expect(() => parseSettingsImport('{"title":"README"}')).toThrow(/settings file/i);
    expect(() => parseSettingsImport('{"format":"markdown-reader-settings","version":99,"settings":{}}')).toThrow(/version/i);
  });
});

describe('custom CSS scoping', () => {
  it('limits selectors to the reader document', () => {
    expect(scopeCustomCss('h1, p { color: #223344; }')).toBe(
      '#reader .markdown-body h1, #reader .markdown-body p { color: #223344; }',
    );
  });

  it.each([
    '@import url(https://example.test/x.css);',
    'body { color: red; }',
    'p { background-image: url(https://example.test/pixel); }',
    'p { position: fixed; }',
  ])('rejects unscoped or remote-resource CSS: %s', (css) => {
    expect(scopeCustomCss(css)).toBe('');
  });
});

describe('local settings persistence', () => {
  it('loads and saves preferences through the provided local storage area', async () => {
    const values: Record<string, unknown> = {};
    const storage: SettingsStorage = {
      async get(key) {
        return { [key]: values[key] };
      },
      async set(items) {
        Object.assign(values, items);
      },
    };

    const saved = await saveSettings(storage, { ...DEFAULT_SETTINGS, theme: 'graphite' });
    const loaded = await loadSettings(storage);

    expect(saved.theme).toBe('graphite');
    expect(loaded.theme).toBe('graphite');
  });
});

describe('single-key shortcut preference', () => {
  it('is on by default and stays on for settings saved before it existed', () => {
    expect(normalizeSettings({}).singleKeyShortcuts).toBe(true);
  });

  it('turns off only for an explicit false', () => {
    expect(normalizeSettings({ singleKeyShortcuts: false }).singleKeyShortcuts).toBe(false);
    expect(normalizeSettings({ singleKeyShortcuts: 'no' }).singleKeyShortcuts).toBe(true);
  });
});

describe('custom theme colours from stored or imported settings', () => {
  it('keeps valid hexadecimal colours in lowercase six-digit form', () => {
    const [theme] = normalizeSettings({ customThemes: [{ id: 'a', name: 'A', background: '#FFF', foreground: '#112233', accent: '#AbCdEf' }] }).customThemes;
    expect(theme).toMatchObject({ background: '#ffffff', foreground: '#112233', accent: '#abcdef' });
  });

  it('replaces invalid lengths and non-hex values with defaults', () => {
    const [theme] = normalizeSettings({ customThemes: [{ id: 'a', name: 'A', background: '#12345', foreground: 'inherit', accent: '#1234567' }] }).customThemes;
    expect(theme?.background).toMatch(/^#[\da-f]{6}$/u);
    expect(theme?.background).not.toBe('#12345');
    expect(theme?.foreground).not.toBe('inherit');
    expect(theme?.accent).not.toBe('#1234567');
  });

  it('keeps themes imported from an earlier export', () => {
    const exported = exportSettings({ ...DEFAULT_SETTINGS, customThemeId: 'night', customThemes: [{ id: 'night', name: 'Night', background: '#101418', foreground: '#e8edf2', accent: '#7cc4e0' }] });
    expect(parseSettingsImport(exported).customThemeId).toBe('night');
  });
});
