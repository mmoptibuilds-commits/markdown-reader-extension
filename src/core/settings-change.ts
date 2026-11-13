import {
  DEFAULT_SETTINGS,
  loadSettings,
  MAX_CUSTOM_THEMES,
  normalizeSettings,
  saveSettings,
  type CustomTheme,
  type ReaderSettings,
  type SettingsStorage,
} from './settings';

export { MAX_CUSTOM_THEMES };
export const SETTINGS_CHANGE_MESSAGE = 'markdown-reader:change-settings';

/** Fields a patch may change. Custom themes change only through their own operations. */
export type SettingsPatch = Partial<Omit<ReaderSettings, 'customThemes'>>;

/**
 * One intended change. Pages send intentions, never full snapshots, so a change made in
 * one page cannot overwrite a change another page made after it loaded.
 */
export type SettingsChange =
  | { kind: 'patch'; patch: SettingsPatch }
  | { kind: 'save-theme'; theme: CustomTheme; select: boolean }
  | { kind: 'remove-theme'; id: string }
  | { kind: 'replace'; settings: unknown };

export class SettingsChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsChangeError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const patchKeys = new Set(Object.keys(DEFAULT_SETTINGS).filter((key) => key !== 'customThemes'));
export const HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{6})$/iu;

export function applySettingsChange(current: ReaderSettings, change: SettingsChange): ReaderSettings {
  switch (change.kind) {
    case 'patch': {
      const { customThemes: _ignored, ...patch } = change.patch as Partial<ReaderSettings>;
      return normalizeSettings({ ...current, ...patch, customThemes: current.customThemes });
    }
    case 'save-theme': {
      const { theme } = change;
      for (const color of [theme.background, theme.foreground, theme.accent]) {
        if (!HEX_COLOR_PATTERN.test(color)) throw new SettingsChangeError(`“${color}” is not a valid colour. Use a value such as #1a2b3c.`);
      }
      const name = theme.name.trim().slice(0, 40);
      if (!name) throw new SettingsChangeError('Give the theme a name before saving it.');
      const saved: CustomTheme = { ...theme, name };
      const exists = current.customThemes.some(({ id }) => id === theme.id);
      if (!exists && current.customThemes.length >= MAX_CUSTOM_THEMES) {
        throw new SettingsChangeError(`You can keep up to ${MAX_CUSTOM_THEMES} custom themes. Delete one before adding another.`);
      }
      const customThemes = exists
        ? current.customThemes.map((item) => item.id === theme.id ? saved : item)
        : [...current.customThemes, saved];
      const next = normalizeSettings({ ...current, customThemes, customThemeId: change.select ? theme.id : current.customThemeId });
      if (!next.customThemes.some(({ id }) => id === theme.id)) throw new SettingsChangeError('This theme could not be saved.');
      return next;
    }
    case 'remove-theme':
      return normalizeSettings({
        ...current,
        customThemes: current.customThemes.filter(({ id }) => id !== change.id),
        customThemeId: current.customThemeId === change.id ? null : current.customThemeId,
      });
    case 'replace':
      return normalizeSettings(change.settings);
  }
}

/** Validates a change received from another extension context. */
export function parseSettingsChange(value: unknown): SettingsChange | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'patch' && isRecord(value.patch)) {
    return { kind: 'patch', patch: Object.fromEntries(Object.entries(value.patch).filter(([key]) => patchKeys.has(key))) as SettingsPatch };
  }
  if (value.kind === 'remove-theme' && typeof value.id === 'string') return { kind: 'remove-theme', id: value.id };
  if (value.kind === 'replace' && 'settings' in value) return { kind: 'replace', settings: value.settings };
  if (value.kind === 'save-theme' && isRecord(value.theme)) {
    const { id, name, background, foreground, accent } = value.theme;
    if ([id, name, background, foreground, accent].every((item) => typeof item === 'string')) {
      return { kind: 'save-theme', theme: { id, name, background, foreground, accent } as CustomTheme, select: value.select === true };
    }
  }
  return undefined;
}

/**
 * Returns a writer that applies changes one at a time, each on top of the value stored at
 * that moment. Run it in a single context (the background worker) so every page's changes
 * share one queue; storage itself has no transactions.
 */
export function createSettingsWriter(storage: SettingsStorage): (change: SettingsChange) => Promise<ReaderSettings> {
  let queue: Promise<unknown> = Promise.resolve();
  return (change) => {
    const result = queue.then(async () => {
      const current = await loadSettings(storage);
      const next = applySettingsChange(current, change);
      return saveSettings(storage, next);
    });
    queue = result.catch(() => undefined);
    return result;
  };
}
