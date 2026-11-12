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
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    throw unreadable();
  }
  if (bytes.byteLength > LOCAL_DOCUMENT_LIMIT_BYTES) {
    throw new LocalFileError('size', 'This file is larger than the 16 MB reading limit. Split it into smaller Markdown files.');
  }
  return new TextDecoder().decode(bytes);
}

export const LOCAL_HANDOFF_MESSAGE = 'markdown-reader:local-file';

export interface LocalHandoffRequest {
  message: unknown;
  /** The sending frame's URL as reported by the browser, not by the content script. */
  senderUrl: string | undefined;
  frameId: number | undefined;
  tabId: number | undefined;
  /** The user's stored opt-in, read by the background worker. */
  enabled: boolean;
}

const withoutFragment = (raw: string): string => raw.split('#', 1)[0] ?? raw;

/**
 * Validates a content script's request to hand a local file's text to the reader. The file
 * must be the sender's own top-level Markdown document, the user must have opted in, and
 * the text must fit the session-storage handoff limit.
 */
export function acceptLocalHandoffRequest(request: LocalHandoffRequest): (LocalHandoff & { tabId: number }) | undefined {
  const { message, senderUrl, frameId, tabId, enabled } = request;
  if (!enabled || frameId !== 0 || tabId === undefined || !senderUrl) return undefined;
  if (typeof message !== 'object' || message === null) return undefined;
  const { type, url, text } = message as { type?: unknown; url?: unknown; text?: unknown };
  if (type !== LOCAL_HANDOFF_MESSAGE || typeof url !== 'string' || typeof text !== 'string') return undefined;
  if (!parseLocalMarkdownUrl(url) || withoutFragment(url) !== withoutFragment(senderUrl)) return undefined;
  if (new TextEncoder().encode(text).byteLength > LOCAL_HANDOFF_LIMIT_BYTES) return undefined;
  return { url, text, tabId };
}
