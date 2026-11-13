/** Runtime message types shared by extension pages, the content script, and the background worker. */
export const AUTO_RENDER_UPDATE_MESSAGE = 'markdown-reader:update-auto-render';

export type OpenResult =
  | { opened: true }
  | { opened: false; reason: 'refused' | 'handoff-failed' | 'failed' };

export const OPEN_RESULT = { failed: { opened: false, reason: 'failed' } } as const satisfies Record<string, OpenResult>;
