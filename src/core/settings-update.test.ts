import { describe, expect, it } from 'vitest';
import { updateSettings, type SettingsStorage } from './settings';

function memoryStorage(initial: Record<string, unknown> = {}): SettingsStorage & { values: Record<string, unknown> } {
  const values: Record<string, unknown> = { ...initial };
  return {
    values,
    get: async (key: string) => (key in values ? { [key]: values[key] } : {}),
    set: async (items) => {
      Object.assign(values, items);
    },
  };
}

describe('settings patches', () => {
  it('keeps preferences changed elsewhere when only the theme is patched', async () => {
    const storage = memoryStorage();
    // Another page (the options page) saves a font size after this page loaded its settings.
    await updateSettings(storage, { fontSize: 21 });

    const result = await updateSettings(storage, { theme: 'sepia' });

    expect(result.theme).toBe('sepia');
    expect(result.fontSize).toBe(21);
  });
});
