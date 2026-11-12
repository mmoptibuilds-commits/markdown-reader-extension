import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import { themeStyle } from './theme';

describe('custom theme colors', () => {
  it('derives translucent surfaces from valid color-mix expressions', () => {
    const customTheme = {
      id: 'night-notes',
      name: 'Night notes',
      background: '#111922',
      foreground: '#e5edf4',
      accent: '#8dd1d6',
    };
    const styles = themeStyle({
      ...DEFAULT_SETTINGS,
      customThemeId: customTheme.id,
      customThemes: [customTheme],
    }) as unknown as Record<string, unknown>;

    expect(styles['--reader-border']).toBe('color-mix(in srgb, #e5edf4 27%, transparent)');
    expect(styles['--reader-code-bg']).toBe('color-mix(in srgb, #e5edf4 5%, transparent)');
  });
});
