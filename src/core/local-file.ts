import { hasMarkdownExtension } from './document';

/** Largest local document the reader accepts, matching the file picker limit. */
export const LOCAL_DOCUMENT_LIMIT_BYTES = 16_000_000;
/**
 * Largest document the automatic-opening content script hands to the reader through
 * session storage. Chromium's session storage quota is 10 MB for all entries, so this
 * leaves room for JSON escaping and a second open tab.
 */
export const LOCAL_HANDOFF_LIMIT_BYTES = 4 * 1024 * 1024;

/**
 * The user's opt-in and the browser's file access combined:
 * - `active`: both are on, so local Markdown files open in the reader;
 * - `disabled`: the user has not turned automatic opening on;
 * - `permission-required`: the user opted in, but the browser has not granted file access;
 * - `unavailable`: the browser cannot report file access for this extension.
 */
export type LocalAutoOpenState = 'active' | 'disabled' | 'permission-required' | 'unavailable';

export const LOCAL_SIZE_LIMIT_MESSAGE = 'This file is larger than the 16 MB reading limit. Split it into smaller Markdown files.';

/** The size check every way of opening a local file shares. Run it before reading. */
export function checkLocalFileSize(size: number): LocalFileError | undefined {
  return size > LOCAL_DOCUMENT_LIMIT_BYTES ? new LocalFileError('size', LOCAL_SIZE_LIMIT_MESSAGE) : undefined;
}

export type LocalFileErrorKind = 'unreadable' | 'size';

/** An error whose message is safe to show to the reader. */
export class LocalFileError extends Error {
  constructor(readonly kind: LocalFileErrorKind, message: string) {
    super(message);
    this.name = 'LocalFileError';
  }
}

export interface LocalHandoff {
  url: string;
  text: string;
}

/**
 * Accepts only a file URL on this computer (no network-share host) whose path names a
 * Markdown file. Returns the parsed URL with its original encoding, or undefined.
 */
export function parseLocalMarkdownUrl(raw: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'file:') return undefined;
  if (url.hostname !== '' && url.hostname !== 'localhost') return undefined;
  if (url.username || url.password) return undefined;
  return hasMarkdownExtension(url.pathname) ? url : undefined;
}

/** The decoded last path segment, kept raw when it contains a malformed escape. */
export function localFileNameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** `fileAccess` is undefined when the browser could not answer. */
export function localAutoOpenState(enabled: boolean, fileAccess: boolean | undefined): LocalAutoOpenState {
  if (fileAccess === undefined) return 'unavailable';
  if (!enabled) return 'disabled';
  return fileAccess ? 'active' : 'permission-required';
}

/** Validates a stored handoff and returns it only when it belongs to the expected file. */
export function parseLocalHandoff(value: unknown, expectedUrl: string): LocalHandoff | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { url, text } = value as Partial<LocalHandoff>;
  if (url !== expectedUrl || typeof text !== 'string') return undefined;
  return { url, text };
}

/**
 * Reads a local file from an extension page. Chromium allows this once the user turns on
 * file URL access; Firefox refuses it, and the caller then falls back to the handoff.
 */
export async function readLocalMarkdown(url: URL, fetcher: typeof fetch): Promise<string> {
  const unreadable = (): LocalFileError =>
    new LocalFileError('unreadable', 'This local file could not be read. Check that it still exists and that the browser allows file access, then open it again.');
  let response: Response;
  try {
    response = await fetcher(url, { cache: 'no-store' });
  } catch {
    throw unreadable();
  }
  // File responses report status 0 in some browsers; only a real HTTP-style error fails.
  if (response.status >= 400) {
    await response.body?.cancel().catch(() => undefined);
    throw unreadable();
  }
  const tooLarge = (): LocalFileError => new LocalFileError('size', LOCAL_SIZE_LIMIT_MESSAGE);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LOCAL_DOCUMENT_LIMIT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }

  // Read in chunks and stop as soon as the limit is passed, so an oversize file is never
  // buffered whole.
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LOCAL_DOCUMENT_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (error instanceof LocalFileError) throw error;
    throw unreadable();
  }
  return text + decoder.decode();
}

/** The text a content script offered for the handoff, when it is a string within the limit. */
export function handoffTextOf(message: unknown): string | undefined {
  const text = typeof message === 'object' && message !== null ? (message as { text?: unknown }).text : undefined;
  if (typeof text !== 'string') return undefined;
  return new TextEncoder().encode(text).byteLength <= LOCAL_HANDOFF_LIMIT_BYTES ? text : undefined;
}
