import { hasMarkdownExtension, isMarkdownMimeType } from './document';
import { parseLocalMarkdownUrl } from './local-file';

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
