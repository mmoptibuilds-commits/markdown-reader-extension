import type { CustomTheme, ReaderSettings, ThemeId } from './settings';

/** Every colour a surface of the extension needs. All values are #rrggbb. */
export interface ThemePalette {
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
  /** Text drawn on an accent-coloured fill. */
  onAccent: string;
  codeBackground: string;
  codeForeground: string;
  /** Outline of inputs, selects, and switches: at least 3:1 against the background. */
  controlBorder: string;
  /** Error text: at least 4.5:1 against the background and surface. */
  danger: string;
}

export type Appearance = 'light' | 'dark';

export interface BuiltInTheme {
  id: ThemeId;
  name: string;
  description: string;
  appearance: Appearance | 'system';
  /** Absent only for System, which resolves to Snow or Graphite. */
  palette?: ThemePalette;
}

export interface ResolvedTheme {
  /** The built-in id or the custom theme id. */
  id: string;
  name: string;
  appearance: Appearance;
  palette: ThemePalette;
  custom: boolean;
}

const palettes = {
  paper: { background: '#f7f6f0', surface: '#fffefa', foreground: '#202820', muted: '#526052', border: '#d9ded3', accent: '#386b4f', onAccent: '#ffffff', codeBackground: '#eceee7', codeForeground: '#27352b', controlBorder: '#7c877d', danger: '#a44537' },
  snow: { background: '#ffffff', surface: '#ffffff', foreground: '#202523', muted: '#56615c', border: '#dde3df', accent: '#276b59', onAccent: '#ffffff', codeBackground: '#f1f4f2', codeForeground: '#202c28', controlBorder: '#7c877d', danger: '#a44537' },
  sepia: { background: '#f2eadb', surface: '#faf5e9', foreground: '#33291f', muted: '#6a5642', border: '#dbccb5', accent: '#80552f', onAccent: '#ffffff', codeBackground: '#e9deca', codeForeground: '#35271a', controlBorder: '#8a755e', danger: '#9a3b2e' },
  'solarized-light': { background: '#fdf6e3', surface: '#fffbf0', foreground: '#073642', muted: '#52666d', border: '#e4dcc4', accent: '#1b6aa3', onAccent: '#ffffff', codeBackground: '#eee8d5', codeForeground: '#073642', controlBorder: '#7d8b8c', danger: '#b02a26' },
  graphite: { background: '#1d211e', surface: '#252a26', foreground: '#e7ebe5', muted: '#b0bbb1', border: '#414a43', accent: '#a4d3a7', onAccent: '#1d211e', codeBackground: '#151916', codeForeground: '#dce8dd', controlBorder: '#6f7c72', danger: '#f08a7e' },
  midnight: { background: '#111922', surface: '#18222c', foreground: '#e5edf4', muted: '#b2c0cb', border: '#334351', accent: '#8dd1d6', onAccent: '#111922', codeBackground: '#0d141b', codeForeground: '#d9e9ec', controlBorder: '#5d7183', danger: '#f08a7e' },
  nord: { background: '#2e3440', surface: '#353c4a', foreground: '#eceff4', muted: '#c5ccd8', border: '#4c566a', accent: '#88c0d0', onAccent: '#2e3440', codeBackground: '#272c36', codeForeground: '#e5e9f0', controlBorder: '#8a96ae', danger: '#f0a0a8' },
  'solarized-dark': { background: '#002b36', surface: '#073642', foreground: '#eee8d5', muted: '#a3b1b1', border: '#24505c', accent: '#5fb3e8', onAccent: '#002b36', codeBackground: '#00212a', codeForeground: '#e4ddc8', controlBorder: '#6e8a90', danger: '#ff8a80' },
  oled: { background: '#000000', surface: '#0c0c0c', foreground: '#e8e8e8', muted: '#a6a6a6', border: '#2a2a2a', accent: '#8ab4f8', onAccent: '#000000', codeBackground: '#101010', codeForeground: '#e0e0e0', controlBorder: '#6b6b6b', danger: '#ff8b80' },
} satisfies Record<Exclude<ThemeId, 'system'>, ThemePalette>;

export const BUILT_IN_THEMES: readonly BuiltInTheme[] = [
  { id: 'paper', name: 'Paper', description: 'Warm off-white with green ink', appearance: 'light', palette: palettes.paper },
  { id: 'snow', name: 'Snow', description: 'Plain white, neutral contrast', appearance: 'light', palette: palettes.snow },
  { id: 'sepia', name: 'Sepia', description: 'Soft brown for long sessions', appearance: 'light', palette: palettes.sepia },
  { id: 'solarized-light', name: 'Solarized Light', description: 'Cream with blue accents', appearance: 'light', palette: palettes['solarized-light'] },
  { id: 'graphite', name: 'Graphite', description: 'Charcoal with sage accents', appearance: 'dark', palette: palettes.graphite },
  { id: 'midnight', name: 'Midnight', description: 'Deep blue-black with cyan', appearance: 'dark', palette: palettes.midnight },
  { id: 'nord', name: 'Nord', description: 'Cool slate with frost blue', appearance: 'dark', palette: palettes.nord },
  { id: 'solarized-dark', name: 'Solarized Dark', description: 'Deep teal with sky blue', appearance: 'dark', palette: palettes['solarized-dark'] },
  { id: 'oled', name: 'OLED Black', description: 'True black for OLED screens', appearance: 'dark', palette: palettes.oled },
  { id: 'system', name: 'System', description: 'Snow or Graphite, following your device', appearance: 'system' },
];

const SYSTEM_LIGHT = palettes.snow;
const SYSTEM_DARK = palettes.graphite;

type Rgb = [number, number, number];

export function parseHexColor(value: string): Rgb | undefined {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(value);
  if (!match?.[1]) return undefined;
  const hex = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1];
  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb): string => `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

/** Normalizes a valid hexadecimal colour to lowercase #rrggbb. */
export function normalizeHexColor(value: string): string | undefined {
  const rgb = parseHexColor(value.trim());
  return rgb ? toHex(rgb) : undefined;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two hexadecimal colours; 1 when either is invalid. */
export function contrastRatio(first: string, second: string): number {
  const a = parseHexColor(first);
  const b = parseHexColor(second);
  if (!a || !b) return 1;
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** Mixes `amount` (0–1) of `other` into `base`. */
function mix(base: string, other: string, amount: number): string {
  const a = parseHexColor(base) ?? [0, 0, 0];
  const b = parseHexColor(other) ?? [0, 0, 0];
  return toHex(a.map((channel, index) => channel + ((b[index] ?? 0) - channel) * amount) as Rgb);
}

export const appearanceOf = (background: string): Appearance =>
  contrastRatio(background, '#000000') < contrastRatio(background, '#ffffff') ? 'dark' : 'light';

type CustomColors = Pick<CustomTheme, 'background' | 'foreground' | 'accent'>;

/** Builds a full palette from a custom theme's three colours. */
export function deriveCustomPalette({ background, foreground, accent }: CustomColors): ThemePalette {
  // Secondary text is softened toward the background only as far as it stays readable.
  let muted = foreground;
  for (let amount = 0.32; amount > 0; amount -= 0.04) {
    const candidate = mix(foreground, background, amount);
    if (contrastRatio(candidate, background) >= 4.5) { muted = candidate; break; }
  }
  const onAccent = contrastRatio('#ffffff', accent) >= contrastRatio('#000000', accent) ? '#ffffff' : '#000000';
  return {
    background,
    surface: mix(background, foreground, 0.03),
    foreground,
    muted,
    border: mix(background, foreground, 0.18),
    accent,
    onAccent,
    codeBackground: mix(background, foreground, 0.06),
    codeForeground: foreground,
    controlBorder: readableMix(background, foreground, 3, 0.4),
    danger: appearanceOf(background) === 'dark' ? '#f08a7e' : '#a8322a',
  };
}

/** The least `foreground` mixed into `background` (from `start`) that reaches `ratio`. */
function readableMix(background: string, foreground: string, ratio: number, start: number): string {
  for (let amount = start; amount < 1; amount += 0.05) {
    const candidate = mix(background, foreground, amount);
    if (contrastRatio(candidate, background) >= ratio) return candidate;
  }
  return foreground;
}

export interface ContrastWarning {
  part: 'text' | 'accent';
  ratio: number;
  message: string;
}

/** Lists combinations below WCAG AA (4.5:1) so the editor can warn before saving. */
export function checkCustomThemeContrast(colors: CustomColors): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];
  const text = contrastRatio(colors.foreground, colors.background);
  if (text < 4.5) warnings.push({ part: 'text', ratio: text, message: `Text contrast is ${text.toFixed(1)}:1. Body text needs at least 4.5:1 to stay readable.` });
  const accent = contrastRatio(colors.accent, colors.background);
  if (accent < 4.5) warnings.push({ part: 'accent', ratio: accent, message: `Link contrast is ${accent.toFixed(1)}:1. Links need at least 4.5:1 to stay readable.` });
  return warnings;
}

export const builtInTheme = (id: ThemeId): BuiltInTheme =>
  BUILT_IN_THEMES.find((theme) => theme.id === id) ?? BUILT_IN_THEMES[0]!;

/** The palette a page should use now, given the settings and the device's appearance. */
export function resolveTheme(settings: Pick<ReaderSettings, 'theme' | 'customThemeId' | 'customThemes'>, prefersDark: boolean): ResolvedTheme {
  const custom = settings.customThemeId ? settings.customThemes.find(({ id }) => id === settings.customThemeId) : undefined;
  if (custom) {
    return { id: custom.id, name: custom.name, appearance: appearanceOf(custom.background), palette: deriveCustomPalette(custom), custom: true };
  }
  const theme = builtInTheme(settings.theme);
  if (theme.palette && theme.appearance !== 'system') {
    return { id: theme.id, name: theme.name, appearance: theme.appearance, palette: theme.palette, custom: false };
  }
  return { id: theme.id, name: theme.name, appearance: prefersDark ? 'dark' : 'light', palette: prefersDark ? SYSTEM_DARK : SYSTEM_LIGHT, custom: false };
}

/** CSS custom properties for a palette, shared by the reader, popup, and settings. */
export function paletteVariables(palette: ThemePalette): Record<string, string> {
  return {
    '--theme-bg': palette.background,
    '--theme-surface': palette.surface,
    '--theme-fg': palette.foreground,
    '--theme-muted': palette.muted,
    '--theme-border': palette.border,
    '--theme-accent': palette.accent,
    '--theme-on-accent': palette.onAccent,
    '--theme-code-bg': palette.codeBackground,
    '--theme-code-fg': palette.codeForeground,
    '--theme-control-border': palette.controlBorder,
    '--theme-danger': palette.danger,
  };
}
