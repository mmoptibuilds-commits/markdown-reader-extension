/**
 * Reader keyboard shortcuts. Browser shortcuts (Find, Open, zoom, print) are never taken
 * over. Letter shortcuts can be turned off, and they never fire while the user types,
 * operates a control that uses letters or arrows, holds a modifier, or has a dialog open.
 */
export type ShortcutAction = 'commands' | 'search' | 'theme' | 'focus' | 'sidebar' | 'help' | 'escape';

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

export const SINGLE_KEY_SHORTCUTS: ReadonlyArray<{ key: string; action: ShortcutAction; label: string }> = [
  { key: '/', action: 'search', label: 'Search this document' },
  { key: 't', action: 'theme', label: 'Next theme' },
  { key: 'f', action: 'focus', label: 'Focus mode' },
  { key: '[', action: 'sidebar', label: 'Show or hide navigation' },
  { key: '?', action: 'help', label: 'Keyboard shortcuts' },
];

/** Controls whose own keyboard behaviour a letter shortcut must not interrupt. */
const interactiveSelector = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="listbox"], [role="tree"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="menu"]';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  return element.isContentEditable || element.closest(interactiveSelector) !== null;
}

export function shortcutFor(event: ShortcutEvent, options: { singleKeys: boolean; dialogOpen: boolean }): ShortcutAction | undefined {
  if (event.isComposing) return undefined;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') return options.dialogOpen ? undefined : 'commands';
  if (event.key === 'Escape' && !options.dialogOpen) return 'escape';
  if (!options.singleKeys || options.dialogOpen || modifier || event.altKey || event.repeat || isTypingTarget(event.target)) return undefined;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  // Shift is allowed only where it is part of the character itself, as for "?".
  if (event.shiftKey && key !== '?') return undefined;
  return SINGLE_KEY_SHORTCUTS.find((shortcut) => shortcut.key === key)?.action;
}
