import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ReaderSettings } from '../core/settings';
import { paletteVariables, resolveTheme, type ResolvedTheme, type ThemePalette } from '../core/themes';

const darkQuery = '(prefers-color-scheme: dark)';
const CACHE_KEY = 'markdown-reader-theme';

/** Follows the device's light or dark appearance, including changes while the page is open. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia?.(darkQuery).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(darkQuery);
    if (!query) return;
    const update = (): void => setDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return dark;
}

/** Writes a palette's variables, appearance, and color-scheme onto the root element. */
export function applyThemeToRoot(theme: Pick<ResolvedTheme, 'id' | 'appearance' | 'palette'>): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(paletteVariables(theme.palette))) root.style.setProperty(name, value);
  root.dataset.appearance = theme.appearance;
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.appearance;
}

/**
 * Applies the active theme to the whole page and returns it. The resolved palette is
 * remembered in this browser so the next page paints in the right colours before
 * settings load; it holds only colours.
 */
export function useAppliedTheme(settings: Pick<ReaderSettings, 'theme' | 'customThemeId' | 'customThemes'>, enabled = true): ResolvedTheme {
  const prefersDark = usePrefersDark();
  const theme = useMemo(() => resolveTheme(settings, prefersDark), [settings.theme, settings.customThemeId, settings.customThemes, prefersDark]);
  useLayoutEffect(() => {
    if (!enabled) return;
    applyThemeToRoot(theme);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ id: theme.id, appearance: theme.appearance, palette: theme.palette })); } catch { /* Storage can be unavailable. */ }
  }, [theme, enabled]);
  return theme;
}

/** Applies the last theme this browser used, before React renders, to avoid a flash. */
export function applyCachedTheme(): void {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { id?: unknown; appearance?: unknown; palette?: unknown } | null;
    if (!cached || typeof cached.id !== 'string' || (cached.appearance !== 'light' && cached.appearance !== 'dark') || typeof cached.palette !== 'object' || cached.palette === null) return;
    const palette = cached.palette as Record<string, unknown>;
    if (!Object.values(palette).every((value) => typeof value === 'string' && /^#[\da-f]{6}$/iu.test(value))) return;
    applyThemeToRoot({ id: cached.id, appearance: cached.appearance, palette: palette as unknown as ThemePalette });
  } catch { /* Ignore an unreadable cache. */ }
}

/** Reading measurements for the document canvas. */
export function readingStyle(settings: ReaderSettings): CSSProperties {
  return {
    '--reader-font-size': `${settings.fontSize}px`,
    '--reader-line-height': settings.lineHeight,
    '--reader-paragraph-gap': `${settings.paragraphSpacing}em`,
    '--reader-width': `${settings.readingWidth}px`,
  } as CSSProperties;
}

/** Inline colours for a theme preview card, independent of the page's own theme. */
export function swatchStyle(palette: ThemePalette): CSSProperties {
  return paletteVariables(palette) as CSSProperties;
}
