import type { CSSProperties } from 'react';
import type { ReaderSettings, ThemeId } from '../core/settings';

export interface ThemePalette {
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
  codeBackground: string;
  codeForeground: string;
}

export const THEME_PALETTES: Record<Exclude<ThemeId, 'system'>, ThemePalette> = {
  paper: { background: '#f7f6f0', surface: '#fffefa', foreground: '#202820', muted: '#526052', border: '#d9ded3', accent: '#386b4f', codeBackground: '#eceee7', codeForeground: '#27352b' },
  snow: { background: '#ffffff', surface: '#ffffff', foreground: '#202523', muted: '#56615c', border: '#dde3df', accent: '#276b59', codeBackground: '#f1f4f2', codeForeground: '#202c28' },
  sepia: { background: '#f2eadb', surface: '#faf5e9', foreground: '#33291f', muted: '#6a5642', border: '#dbccb5', accent: '#80552f', codeBackground: '#e9deca', codeForeground: '#35271a' },
  graphite: { background: '#1d211e', surface: '#252a26', foreground: '#e7ebe5', muted: '#b0bbb1', border: '#414a43', accent: '#a4d3a7', codeBackground: '#151916', codeForeground: '#dce8dd' },
  midnight: { background: '#111922', surface: '#18222c', foreground: '#e5edf4', muted: '#b2c0cb', border: '#334351', accent: '#8dd1d6', codeBackground: '#0d141b', codeForeground: '#d9e9ec' },
};

export function themeStyle(settings: ReaderSettings): CSSProperties {
  const selectedCustom = settings.customThemeId
    ? settings.customThemes.find(({ id }) => id === settings.customThemeId)
    : undefined;
  const palette = settings.theme === 'system'
    ? THEME_PALETTES.snow
    : THEME_PALETTES[settings.theme];
  const custom = selectedCustom ? {
    background: selectedCustom.background,
    surface: selectedCustom.background,
    foreground: selectedCustom.foreground,
    muted: selectedCustom.foreground,
    border: `color-mix(in srgb, ${selectedCustom.foreground} 27%, transparent)`,
    accent: selectedCustom.accent,
    codeBackground: `color-mix(in srgb, ${selectedCustom.foreground} 5%, transparent)`,
    codeForeground: selectedCustom.foreground,
  } : palette;
  return {
    '--reader-bg': custom.background,
    '--reader-surface': custom.surface,
    '--reader-fg': custom.foreground,
    '--reader-muted': custom.muted,
    '--reader-border': custom.border,
    '--reader-accent': custom.accent,
    '--reader-code-bg': custom.codeBackground,
    '--reader-code-fg': custom.codeForeground,
    '--reader-font-size': `${settings.fontSize}px`,
    '--reader-line-height': settings.lineHeight,
    '--reader-paragraph-gap': `${settings.paragraphSpacing}em`,
    '--reader-width': `${settings.readingWidth}px`,
  } as CSSProperties;
}

export function themeClass(settings: ReaderSettings): string {
  return `theme-${settings.customThemeId ? 'custom' : settings.theme}`;
}
