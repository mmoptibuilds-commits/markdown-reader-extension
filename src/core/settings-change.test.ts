import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, type CustomTheme, type ReaderSettings, type SettingsStorage } from './settings';
import {
  applySettingsChange,
  createSettingsWriter,
  MAX_CUSTOM_THEMES,
  parseSettingsChange,
  SettingsChangeError,
} from './settings-change';

const theme = (id: string, overrides: Partial<CustomTheme> = {}): CustomTheme => ({
  id, name: `Theme ${id}`, background: '#101820', foreground: '#f0f4f8', accent: '#8dd1d6', ...overrides,
});
const base = (overrides: Partial<ReaderSettings> = {}): ReaderSettings => ({ ...DEFAULT_SETTINGS, customThemes: [], ...overrides });

function memoryStorage(initial: Record<string, unknown> = {}, delays: number[] = []): SettingsStorage & { values: Record<string, unknown>; writes: number } {
  const values: Record<string, unknown> = { ...initial };
  const storage = {
    values,
    writes: 0,
    get: async (key: string) => {
      // Simulate slow reads so overlapping, unserialized writers would interleave.
      await new Promise((resolve) => setTimeout(resolve, delays.shift() ?? 0));
      return key in values ? { [key]: structuredClone(values[key]) } : {};
    },
    set: async (items: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, delays.shift() ?? 0));
      storage.writes += 1;
      Object.assign(values, structuredClone(items));
    },
  };
  return storage;
}

describe('applying a settings change', () => {
  it('changes only the patched fields', () => {
    const next = applySettingsChange(base({ fontSize: 21 }), { kind: 'patch', patch: { theme: 'sepia' } });
    expect(next.theme).toBe('sepia');
    expect(next.fontSize).toBe(21);
  });

  it('cannot replace custom themes through a patch', () => {
    const current = base({ customThemes: [theme('a')] });
    const next = applySettingsChange(current, { kind: 'patch', patch: { customThemes: [] } as Partial<ReaderSettings> });
    expect(next.customThemes).toEqual([theme('a')]);
  });

  it('adds a new custom theme without removing the active one', () => {
    const current = base({ customThemes: [theme('a'), theme('b')], customThemeId: 'a' });
    const next = applySettingsChange(current, { kind: 'save-theme', theme: theme('c'), select: true });
    expect(next.customThemes.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(next.customThemeId).toBe('c');
  });

  it('edits an existing custom theme in place', () => {
    const current = base({ customThemes: [theme('a'), theme('b')], customThemeId: 'b' });
    const next = applySettingsChange(current, { kind: 'save-theme', theme: theme('a', { name: 'Renamed', accent: '#ffcc00' }), select: false });
    expect(next.customThemes.map(({ id, name }) => [id, name])).toEqual([['a', 'Renamed'], ['b', 'Theme b']]);
    expect(next.customThemes[0]?.accent).toBe('#ffcc00');
    expect(next.customThemeId).toBe('b');
  });

  it('refuses a new theme past the limit instead of dropping an existing one', () => {
    const full = base({ customThemes: Array.from({ length: MAX_CUSTOM_THEMES }, (_, index) => theme(`t${index}`)) });
    expect(() => applySettingsChange(full, { kind: 'save-theme', theme: theme('extra'), select: true })).toThrow(SettingsChangeError);
    // Editing an existing theme still works when the list is full.
    expect(applySettingsChange(full, { kind: 'save-theme', theme: theme('t0', { name: 'Edited' }), select: false }).customThemes[0]?.name).toBe('Edited');
  });

  it('refuses a theme whose colours are not valid hexadecimal colours', () => {
    expect(() => applySettingsChange(base(), { kind: 'save-theme', theme: theme('bad', { background: '#12345' }), select: false })).toThrow(SettingsChangeError);
  });

  it('removes a theme and clears the selection when it was selected', () => {
    const current = base({ customThemes: [theme('a'), theme('b')], customThemeId: 'a' });
    const next = applySettingsChange(current, { kind: 'remove-theme', id: 'a' });
    expect(next.customThemes.map(({ id }) => id)).toEqual(['b']);
    expect(next.customThemeId).toBeNull();
  });

  it('keeps the selection when another theme is removed', () => {
    const next = applySettingsChange(base({ customThemes: [theme('a'), theme('b')], customThemeId: 'a' }), { kind: 'remove-theme', id: 'b' });
    expect(next.customThemeId).toBe('a');
  });

  it('replaces everything for import and reset', () => {
    const next = applySettingsChange(base({ fontSize: 22 }), { kind: 'replace', settings: { theme: 'midnight' } });
    expect(next.theme).toBe('midnight');
    expect(next.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});

describe('parsing a settings change message', () => {
  it('accepts the known change shapes', () => {
    expect(parseSettingsChange({ kind: 'patch', patch: { fontSize: 20 } })).toEqual({ kind: 'patch', patch: { fontSize: 20 } });
    expect(parseSettingsChange({ kind: 'remove-theme', id: 'a' })).toEqual({ kind: 'remove-theme', id: 'a' });
    expect(parseSettingsChange({ kind: 'save-theme', theme: theme('a'), select: true })?.kind).toBe('save-theme');
    expect(parseSettingsChange({ kind: 'replace', settings: {} })?.kind).toBe('replace');
  });

  it.each([null, 'patch', { kind: 'patch' }, { kind: 'patch', patch: [] }, { kind: 'remove-theme' }, { kind: 'save-theme', theme: 'x' }, { kind: 'drop-table' }])('rejects %j', (value) => {
    expect(parseSettingsChange(value)).toBeUndefined();
  });

  it('drops unknown patch keys', () => {
    expect(parseSettingsChange({ kind: 'patch', patch: { fontSize: 20, evil: 1 } })).toEqual({ kind: 'patch', patch: { fontSize: 20 } });
  });
});

describe('the serialized settings writer', () => {
  it('applies rapid overlapping changes in order without losing any', async () => {
    const storage = memoryStorage({}, [30, 5, 20, 1, 10, 1, 5, 1]);
    const write = createSettingsWriter(storage);
    const results = await Promise.all([
      write({ kind: 'patch', patch: { fontSize: 20 } }),
      write({ kind: 'patch', patch: { theme: 'sepia' } }),
      write({ kind: 'save-theme', theme: theme('a'), select: false }),
      write({ kind: 'patch', patch: { lineHeight: 2 } }),
    ]);
    const stored = storage.values[SETTINGS_STORAGE_KEY] as ReaderSettings;
    expect(stored.fontSize).toBe(20);
    expect(stored.theme).toBe('sepia');
    expect(stored.customThemes.map(({ id }) => id)).toEqual(['a']);
    expect(stored.lineHeight).toBe(2);
    expect(results.at(-1)).toEqual(stored);
  });

  it('keeps going after a failed change', async () => {
    const storage = memoryStorage();
    const write = createSettingsWriter(storage);
    const failed = write({ kind: 'save-theme', theme: theme('bad', { accent: 'nope' }), select: false });
    const next = write({ kind: 'patch', patch: { fontSize: 24 } });
    await expect(failed).rejects.toBeInstanceOf(SettingsChangeError);
    await expect(next).resolves.toMatchObject({ fontSize: 24 });
  });

  it('reports a storage failure to the caller', async () => {
    const write = createSettingsWriter({ get: async () => ({}), set: async () => { throw new Error('quota'); } });
    await expect(write({ kind: 'patch', patch: { fontSize: 20 } })).rejects.toThrow('quota');
  });

  it('never writes defaults over saved settings it has not read', async () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, fontSize: 25, theme: 'midnight' } });
    await createSettingsWriter(storage)({ kind: 'patch', patch: { showLineNumbers: true } });
    expect(storage.values[SETTINGS_STORAGE_KEY]).toMatchObject({ fontSize: 25, theme: 'midnight', showLineNumbers: true });
  });
});
