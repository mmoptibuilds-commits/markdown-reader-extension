import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, THEME_IDS, type ReaderSettings } from './settings';
import {
  BUILT_IN_THEMES,
  checkCustomThemeContrast,
  contrastRatio,
  deriveCustomPalette,
  parseHexColor,
  resolveTheme,
} from './themes';

const settings = (overrides: Partial<ReaderSettings> = {}): ReaderSettings => ({ ...DEFAULT_SETTINGS, ...overrides });

describe('colour parsing and contrast', () => {
  it('parses three- and six-digit hexadecimal colours only', () => {
    expect(parseHexColor('#fff')).toEqual([255, 255, 255]);
    expect(parseHexColor('#0a0B0c')).toEqual([10, 11, 12]);
    for (const bad of ['#ffff', '#12345', '#1234567', 'fff', '#ggg', 'red', '']) expect(parseHexColor(bad)).toBeUndefined();
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('built-in themes', () => {
  const concrete = BUILT_IN_THEMES.filter((theme) => theme.palette);

  it('lists every stored theme id exactly once', () => {
    expect(BUILT_IN_THEMES.map(({ id }) => id).sort()).toEqual([...THEME_IDS].sort());
  });

  it.each(concrete.map((theme) => [theme.name, theme] as const))('%s meets WCAG AA for text, secondary text, links, and code', (_name, theme) => {
    const palette = theme.palette!;
    expect(contrastRatio(palette.foreground, palette.background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(palette.muted, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.muted, palette.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.accent, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.accent, palette.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.codeForeground, palette.codeBackground)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.controlBorder, palette.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(palette.controlBorder, palette.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(palette.danger, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.danger, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('declares an appearance that matches its background', () => {
    for (const theme of concrete) {
      const darkBackground = contrastRatio(theme.palette!.background, '#000000') < contrastRatio(theme.palette!.background, '#ffffff');
      expect(theme.appearance === 'dark').toBe(darkBackground);
    }
  });
});

describe('resolving the active theme', () => {
  it('follows the system appearance for the System theme', () => {
    expect(resolveTheme(settings({ theme: 'system' }), false).appearance).toBe('light');
    expect(resolveTheme(settings({ theme: 'system' }), true).appearance).toBe('dark');
    expect(resolveTheme(settings({ theme: 'system' }), true).palette).not.toEqual(resolveTheme(settings({ theme: 'system' }), false).palette);
  });

  it('ignores the system appearance for a fixed theme', () => {
    expect(resolveTheme(settings({ theme: 'paper' }), true).appearance).toBe('light');
    expect(resolveTheme(settings({ theme: 'midnight' }), false).appearance).toBe('dark');
  });

  it('uses the selected custom theme and derives its appearance from its colours', () => {
    const dark = { id: 'night', name: 'Night', background: '#101418', foreground: '#e8edf2', accent: '#7cc4e0' };
    const resolved = resolveTheme(settings({ customThemeId: 'night', customThemes: [dark] }), false);
    expect(resolved.id).toBe('night');
    expect(resolved.appearance).toBe('dark');
    expect(resolved.palette.background).toBe('#101418');
  });

  it('falls back to the built-in theme when the custom theme is missing', () => {
    expect(resolveTheme(settings({ theme: 'sepia', customThemeId: 'gone' }), false).id).toBe('sepia');
  });
});

describe('custom theme palettes', () => {
  it('derives readable secondary text, borders, and code colours from three colours', () => {
    const palette = deriveCustomPalette({ background: '#fdf6e3', foreground: '#073642', accent: '#268bd2' });
    expect(palette.muted).toMatch(/^#[\da-f]{6}$/u);
    expect(contrastRatio(palette.muted, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.codeForeground, palette.codeBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.controlBorder, palette.background)).toBeGreaterThanOrEqual(3);
  });

  it('warns about unreadable combinations', () => {
    const warnings = checkCustomThemeContrast({ background: '#ffffff', foreground: '#dddddd', accent: '#eeeeee' });
    expect(warnings.map(({ part }) => part)).toEqual(['text', 'accent']);
    expect(checkCustomThemeContrast({ background: '#ffffff', foreground: '#1a1a1a', accent: '#2457a6' })).toEqual([]);
  });
});
