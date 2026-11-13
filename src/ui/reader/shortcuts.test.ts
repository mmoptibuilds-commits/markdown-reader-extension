import { describe, expect, it } from 'vitest';
import { shortcutFor, type ShortcutEvent } from './shortcuts';

const press = (key: string, overrides: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, target: document.body, ...overrides,
});
const options = { singleKeys: true, dialogOpen: false };

describe('reader keyboard shortcuts', () => {
  it.each([
    ['Find', press('f', { ctrlKey: true })],
    ['Find on macOS', press('f', { metaKey: true })],
    ['Open', press('o', { ctrlKey: true })],
    ['Open folder', press('O', { ctrlKey: true, shiftKey: true })],
    ['zoom in', press('=', { ctrlKey: true })],
    ['zoom in with plus', press('+', { ctrlKey: true, shiftKey: true })],
    ['zoom out', press('-', { ctrlKey: true })],
    ['reset zoom', press('0', { ctrlKey: true })],
    ['print', press('p', { ctrlKey: true })],
  ])('leaves the browser’s %s shortcut alone', (_label, event) => {
    expect(shortcutFor(event, options)).toBeUndefined();
  });

  it('opens the command palette with Ctrl or Command K', () => {
    expect(shortcutFor(press('k', { ctrlKey: true }), options)).toBe('commands');
    expect(shortcutFor(press('K', { metaKey: true }), options)).toBe('commands');
    expect(shortcutFor(press('k', { ctrlKey: true }), { ...options, dialogOpen: true })).toBeUndefined();
  });

  it('maps the single-key shortcuts', () => {
    expect(shortcutFor(press('t'), options)).toBe('theme');
    expect(shortcutFor(press('T', { shiftKey: true }), options)).toBeUndefined();
    expect(shortcutFor(press('f'), options)).toBe('focus');
    expect(shortcutFor(press('/'), options)).toBe('search');
    expect(shortcutFor(press('?', { shiftKey: true }), options)).toBe('help');
    expect(shortcutFor(press('['), options)).toBe('sidebar');
  });

  it('turns every single-key shortcut off when the preference is off', () => {
    for (const key of ['t', 'f', '/', '?', '[']) expect(shortcutFor(press(key), { ...options, singleKeys: false })).toBeUndefined();
    expect(shortcutFor(press('k', { ctrlKey: true }), { ...options, singleKeys: false })).toBe('commands');
  });

  it('ignores letter keys while typing or operating a control', () => {
    const input = document.createElement('input');
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    const option = document.createElement('div');
    listbox.append(option);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(input, listbox, editable);
    for (const target of [input, option, editable]) expect(shortcutFor(press('t', { target }), options)).toBeUndefined();
  });

  it('ignores held keys, modifier combinations, composition, and open dialogs', () => {
    expect(shortcutFor(press('t', { repeat: true }), options)).toBeUndefined();
    expect(shortcutFor(press('t', { altKey: true }), options)).toBeUndefined();
    expect(shortcutFor(press('t', { isComposing: true }), options)).toBeUndefined();
    expect(shortcutFor(press('t'), { ...options, dialogOpen: true })).toBeUndefined();
  });
});
