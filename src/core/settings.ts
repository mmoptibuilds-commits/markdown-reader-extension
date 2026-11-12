export const SETTINGS_STORAGE_KEY = 'markdownReaderSettings';
export const SETTINGS_FILE_FORMAT = 'markdown-reader-settings';
export const SETTINGS_FILE_VERSION = 1;

export const THEME_IDS = ['paper', 'snow', 'sepia', 'graphite', 'midnight', 'system'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type ReadingFont = 'sans' | 'serif' | 'mono';
export type CodeTheme = 'match' | 'light' | 'dark';

export interface CustomTheme {
  id: string;
  name: string;
  background: string;
  foreground: string;
  accent: string;
}

export interface ReaderSettings {
  theme: ThemeId;
  customThemeId: string | null;
  fontFamily: ReadingFont;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  readingWidth: number;
  codeTheme: CodeTheme;
  showLineNumbers: boolean;
  allowRemoteImages: boolean;
  liveReloadEnabled: boolean;
  liveReloadSeconds: number;
  restorePosition: boolean;
  customCss: string;
  customThemes: CustomTheme[];
}

export interface SettingsStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const DEFAULT_SETTINGS: Readonly<ReaderSettings> = Object.freeze({
  theme: 'paper',
  customThemeId: null,
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.72,
  paragraphSpacing: 1.15,
  readingWidth: 760,
  codeTheme: 'match',
  showLineNumbers: false,
  allowRemoteImages: false,
  liveReloadEnabled: false,
  liveReloadSeconds: 15,
  restorePosition: false,
  customCss: '',
  customThemes: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function boundedNumber(value: unknown, fallback: number, min: number, max: number, digits = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const bounded = Math.min(max, Math.max(min, value));
  const scale = 10 ** digits;
  return Math.round(bounded * scale) / scale;
}

function safeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length > 32) return fallback;
  return /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.% ,/+-]+\)|[a-z]{1,20})$/iu.test(value.trim())
    ? value.trim()
    : fallback;
}

function normalizeCustomThemes(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) return [];
  const themes: CustomTheme[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, 12)) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.replace(/[^a-z\d_-]/giu, '').slice(0, 32) : '';
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 40) : '';
    if (!id || !name || ids.has(id)) continue;
    ids.add(id);
    themes.push({
      id,
      name,
      background: safeColor(item.background, '#f5f3ed'),
      foreground: safeColor(item.foreground, '#252720'),
      accent: safeColor(item.accent, '#567562'),
    });
  }
  return themes;
}

export function scopeCustomCss(source: string): string {
  const css = source.trim();
  if (!css || css.length > 16_384) return '';
  if (/[\\@]|\/\*|\*\/|url\s*\(|expression\s*\(|javascript\s*:|data\s*:/iu.test(css)) return '';
  // image(), image-set(), src() and cross-fade() can fetch resources without url(), and a
  // quoted first argument to any function is how they carry a URL.
  if (/(?:^|[^\w-])(?:-webkit-)?(?:image|image-set|src|cross-fade)\s*\(/iu.test(css) || /\(\s*["']/u.test(css)) return '';

  const rules = css.match(/[^{}]+\{[^{}]*\}/gu);
  if (!rules || rules.join('').replace(/\s/gu, '') !== css.replace(/\s/gu, '')) return '';

  const scoped: string[] = [];
  for (const rule of rules) {
    const open = rule.indexOf('{');
    const selectorsText = rule.slice(0, open).trim();
    const declarationsText = rule.slice(open + 1, -1).trim();
    if (!selectorsText || !declarationsText) return '';

    const selectors = selectorsText.split(',').map((selector) => selector.trim());
    if (selectors.some((selector) =>
      !selector ||
      /(?:^|[\s>+~,(])(?:html|body|:root|:host|:global)(?:$|[\s>+~.#:[,)])/iu.test(selector) ||
      !/^[\w.#:[\]()="'\s>+~|^$*-]+$/u.test(selector)
    )) return '';

    const declarations = declarationsText.split(';').map((declaration) => declaration.trim()).filter(Boolean);
    if (declarations.length === 0) return '';
    const cleanDeclarations: string[] = [];
    for (const declaration of declarations) {
      const colon = declaration.indexOf(':');
      if (colon < 1) return '';
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (!/^-?[a-z][a-z-]*$/u.test(property) || !value || /[{};]/u.test(value)) return '';
      if (property === 'position' && /\bfixed\b/iu.test(value)) return '';
      if (property === 'behavior' || property === '-moz-binding') return '';
      cleanDeclarations.push(`${property}: ${value}`);
    }

    scoped.push(`${selectors.map((selector) => `#reader .markdown-body ${selector}`).join(', ')} { ${cleanDeclarations.join('; ')}; }`);
  }
  return scoped.join('\n');
}

export function normalizeSettings(value: unknown): ReaderSettings {
  const input = isRecord(value) ? value : {};
  const theme = THEME_IDS.includes(input.theme as ThemeId) ? input.theme as ThemeId : DEFAULT_SETTINGS.theme;
  const fontFamily: ReadingFont = input.fontFamily === 'sans' || input.fontFamily === 'mono' ? input.fontFamily : 'serif';
  const codeTheme: CodeTheme = input.codeTheme === 'light' || input.codeTheme === 'dark' ? input.codeTheme : 'match';
  const customCss = typeof input.customCss === 'string' ? scopeCustomCss(input.customCss) : '';
  const customThemes = normalizeCustomThemes(input.customThemes);
  const customThemeId = typeof input.customThemeId === 'string' && customThemes.some(({ id }) => id === input.customThemeId)
    ? input.customThemeId
    : null;
  const reloadSeconds = typeof input.liveReloadSeconds === 'number' && input.liveReloadSeconds >= 5 && input.liveReloadSeconds <= 300
    ? Math.round(input.liveReloadSeconds)
    : DEFAULT_SETTINGS.liveReloadSeconds;

  return {
    theme,
    customThemeId,
    fontFamily,
    fontSize: boundedNumber(input.fontSize, DEFAULT_SETTINGS.fontSize, 14, 28),
    lineHeight: boundedNumber(input.lineHeight, DEFAULT_SETTINGS.lineHeight, 1.35, 2.2, 2),
    paragraphSpacing: boundedNumber(input.paragraphSpacing, DEFAULT_SETTINGS.paragraphSpacing, 0.5, 2.5, 2),
    readingWidth: boundedNumber(input.readingWidth, DEFAULT_SETTINGS.readingWidth, 560, 1120),
    codeTheme,
    showLineNumbers: input.showLineNumbers === true,
    allowRemoteImages: input.allowRemoteImages === true,
    liveReloadEnabled: input.liveReloadEnabled === true,
    liveReloadSeconds: reloadSeconds,
    restorePosition: input.restorePosition === true,
    customCss,
    customThemes,
  };
}

export async function loadSettings(storage: SettingsStorage): Promise<ReaderSettings> {
  const values = await storage.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(values[SETTINGS_STORAGE_KEY]);
}

export async function saveSettings(storage: SettingsStorage, settings: unknown): Promise<ReaderSettings> {
  const normalized = normalizeSettings(settings);
  await storage.set({ [SETTINGS_STORAGE_KEY]: normalized });
  return normalized;
}

/** Applies a partial change on top of the stored settings, so concurrent pages do not overwrite each other. */
export async function updateSettings(storage: SettingsStorage, patch: Partial<ReaderSettings>): Promise<ReaderSettings> {
  const current = await loadSettings(storage);
  return saveSettings(storage, { ...current, ...patch });
}

export function exportSettings(settings: unknown): string {
  return JSON.stringify({
    format: SETTINGS_FILE_FORMAT,
    version: SETTINGS_FILE_VERSION,
    settings: normalizeSettings(settings),
  }, null, 2);
}

export function parseSettingsImport(raw: string): ReaderSettings {
  if (raw.length > 256_000) throw new Error('Settings file is larger than 256 KB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Settings file is not valid JSON.');
  }
  if (!isRecord(parsed) || parsed.format !== SETTINGS_FILE_FORMAT || !('settings' in parsed)) {
    throw new Error('Choose a Markdown Reader settings file.');
  }
  if (parsed.version !== SETTINGS_FILE_VERSION) throw new Error('This settings file version is not supported.');
  return normalizeSettings(parsed.settings);
}
