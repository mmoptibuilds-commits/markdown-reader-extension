import { hasMarkdownExtension, isMarkdownMimeType } from './document';
import { LOCAL_DOCUMENT_LIMIT_BYTES, LOCAL_HANDOFF_LIMIT_BYTES, parseLocalMarkdownUrl } from './local-file';

/** Facts about a navigation that the automatic-opening content script can observe. */
export interface AutoOpenPage {
  url: string;
  /** Content type reported by the browser for this document, possibly including parameters. */
  contentType: string;
  topLevel: boolean;
  /** True only when the user has turned on automatic opening for local files. */
  localFilesEnabled: boolean;
}

/**
 * Decides whether a loaded document is raw Markdown that should move to the reader.
 *
 * On the web, a Markdown media type always qualifies, and plain text qualifies only when
 * the path names a Markdown file, so HTML pages that happen to end in `.md` (for example
 * a rendered GitHub blob page) are left alone. A local file must have a Markdown name and
 * be shown as Markdown or plain text, and only after the user has opted in.
 */
export function shouldOpenInReader(page: AutoOpenPage): boolean {
  if (!page.topLevel) return false;

  let url: URL;
  try {
    url = new URL(page.url);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;

  const contentType = page.contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!contentType) return false;

  if (url.protocol === 'file:') {
    if (!page.localFilesEnabled || !parseLocalMarkdownUrl(page.url)) return false;
    return isMarkdownMimeType(contentType) || contentType === 'text/plain';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (isMarkdownMimeType(contentType)) return true;
  return contentType === 'text/plain' && hasMarkdownExtension(url.pathname);
}

/**
 * Builds the reader address that receives the original document URL, fragment included.
 * `handoffToken` names a session-storage copy of a local file's text.
 */
export function readerUrlFor(readerPageUrl: string, documentUrl: string, handoffToken?: string): string {
  const local = handoffToken ? `&local=${encodeURIComponent(handoffToken)}` : '';
  return `${readerPageUrl}?url=${encodeURIComponent(documentUrl)}${local}`;
}

/**
 * Returns the text of a browser's plain-text document view (a body holding one `pre`), or
 * undefined for anything else, so an HTML document is never treated as Markdown source.
 */
export function plainTextOfDocument(doc: Document): string | undefined {
  const body = doc.body;
  if (!body) return undefined;
  // An empty file has an empty body rather than an empty pre.
  if (body.children.length === 0) return body.textContent === '' ? '' : undefined;
  if (body.children.length !== 1) return undefined;
  const pre = body.firstElementChild;
  if (pre?.tagName !== 'PRE' || pre.children.length > 0) return undefined;
  return pre.textContent ?? '';
}

/**
 * Chromium blocks reloading a reader page whose history entry was created by a page's
 * redirect to the web-accessible (dynamic) reader URL. Replacing the entry once from the
 * reader itself makes reload and back/forward work. Returns the replacement address, or
 * undefined when the page is already settled or was not opened for a local or web document.
 */
export function settledReaderLocation(href: string): string | undefined {
  const url = new URL(href);
  const documentUrl = url.searchParams.get('url');
  if (!documentUrl || url.searchParams.has('settled')) return undefined;
  const protocol = /^([a-z][a-z0-9+.-]*:)/i.exec(documentUrl)?.[1]?.toLowerCase();
  if (protocol !== 'file:' && protocol !== 'http:' && protocol !== 'https:') return undefined;
  url.searchParams.set('settled', '1');
  return url.href;
}

export const OPEN_IN_READER_MESSAGE = 'markdown-reader:open-in-reader';

/** How the browser reached the current document (PerformanceNavigationTiming.type). */
export type NavigationKind = 'navigate' | 'reload' | 'back_forward' | 'prerender';

export type LocalOpenPlan =
  | { action: 'open'; sendText: boolean }
  | { action: 'stay'; reason: 'history' | 'too-large' | 'handoff-too-large' };

/**
 * Decides, before any navigation, whether a local file can open in the reader. Firefox
 * extension pages cannot read file URLs, so there the reader depends on the handoff copy
 * and the tab must stay on the file when that copy cannot be made. Back and Forward never
 * redirect, so the original file stays reachable in history.
 */
export function planLocalOpen({ bytes, firefox, navigationType }: { bytes: number; firefox: boolean; navigationType: NavigationKind }): LocalOpenPlan {
  if (navigationType === 'back_forward') return { action: 'stay', reason: 'history' };
  if (bytes > LOCAL_DOCUMENT_LIMIT_BYTES) return { action: 'stay', reason: 'too-large' };
  if (bytes <= LOCAL_HANDOFF_LIMIT_BYTES) return { action: 'open', sendText: true };
  return firefox ? { action: 'stay', reason: 'handoff-too-large' } : { action: 'open', sendText: false };
}

export interface OpenRequest {
  message: unknown;
  /** Facts the browser reports about the sender, never values the content script supplies. */
  senderUrl: string | undefined;
  senderId: string | undefined;
  extensionId: string;
  frameId: number | undefined;
  tabId: number | undefined;
  /** The user's stored opt-in for local files. */
  localFilesEnabled: boolean;
  /** Whether the sender's web origin is on the user's automatic-opening list and granted. */
  originAllowed: boolean;
}

export interface AcceptedOpenRequest {
  url: string;
  tabId: number;
  local: boolean;
}

/**
 * Validates a content script's request to move its own tab into the reader. The background
 * worker performs the navigation, so the reader page need not be reachable from web pages.
 */
export function acceptOpenRequest(request: OpenRequest): AcceptedOpenRequest | undefined {
  const { message, senderUrl, senderId, extensionId, frameId, tabId } = request;
  if (senderId !== extensionId || frameId !== 0 || tabId === undefined || !senderUrl) return undefined;
  if (typeof message !== 'object' || message === null) return undefined;
  const { type, url } = message as { type?: unknown; url?: unknown };
  if (type !== OPEN_IN_READER_MESSAGE || typeof url !== 'string') return undefined;
  if (withoutFragment(url) !== withoutFragment(senderUrl)) return undefined;
  if (parseLocalMarkdownUrl(url)) return request.localFilesEnabled ? { url, tabId, local: true } : undefined;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return undefined; }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return undefined;
  return request.originAllowed ? { url, tabId, local: false } : undefined;
}

const withoutFragment = (raw: string): string => raw.split('#', 1)[0] ?? raw;
