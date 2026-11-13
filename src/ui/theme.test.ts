import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../core/settings';
import { useAppliedTheme } from './theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockColorScheme(initiallyDark: boolean) {
  const listeners = new Set<() => void>();
  const query = { matches: initiallyDark, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) };
  vi.stubGlobal('matchMedia', () => query);
  window.matchMedia = (() => query) as unknown as typeof window.matchMedia;
  return { setDark(dark: boolean) { query.matches = dark; listeners.forEach((listener) => listener()); } };
}

function renderTheme(settings: ReaderSettings) {
  const host = document.createElement('div');
  const root = createRoot(host);
  const Probe = () => { useAppliedTheme(settings); return null; };
  act(() => root.render(createElement(Probe)));
  return () => act(() => root.unmount());
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.appearance;
});

describe('applying the theme to the page', () => {
  it('uses the light System palette when the device is light', () => {
    mockColorScheme(false);
    const unmount = renderTheme({ ...DEFAULT_SETTINGS, theme: 'system' });
    expect(document.documentElement.dataset.appearance).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#ffffff');
    unmount();
  });

  it('uses the dark System palette when the device is dark', () => {
    mockColorScheme(true);
    const unmount = renderTheme({ ...DEFAULT_SETTINGS, theme: 'system' });
    expect(document.documentElement.dataset.appearance).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#1d211e');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    unmount();
  });

  it('follows a device appearance change while the page is open', () => {
    const scheme = mockColorScheme(false);
    const unmount = renderTheme({ ...DEFAULT_SETTINGS, theme: 'system' });
    act(() => scheme.setDark(true));
    expect(document.documentElement.dataset.appearance).toBe('dark');
    act(() => scheme.setDark(false));
    expect(document.documentElement.dataset.appearance).toBe('light');
    unmount();
  });

  it('keeps a fixed theme when the device appearance changes', () => {
    const scheme = mockColorScheme(false);
    const unmount = renderTheme({ ...DEFAULT_SETTINGS, theme: 'midnight' });
    act(() => scheme.setDark(true));
    act(() => scheme.setDark(false));
    expect(document.documentElement.dataset.appearance).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#111922');
    unmount();
  });

  it('marks a dark custom theme as dark', () => {
    mockColorScheme(false);
    const unmount = renderTheme({ ...DEFAULT_SETTINGS, customThemeId: 'c', customThemes: [{ id: 'c', name: 'C', background: '#101418', foreground: '#e8edf2', accent: '#7cc4e0' }] });
    expect(document.documentElement.dataset.appearance).toBe('dark');
    unmount();
  });
});
