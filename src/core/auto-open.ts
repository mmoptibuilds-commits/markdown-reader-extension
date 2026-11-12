import { hasMarkdownExtension, isMarkdownMimeType } from './document';

/** Facts about a navigation that the automatic-opening content script can observe. */
export interface AutoOpenPage {
  url: string;
  /** Content type reported by the browser for this document, possibly including parameters. */
  contentType: string;
  topLevel: boolean;
  /** True only when the user has enabled file URL access for the extension. */
  fileAccessAllowed: boolean;
}

/**
 * Decides whether a loaded document is raw Markdown that should move to the reader.
 *
 * A Markdown media type always qualifies. Plain text qualifies only when the path names
 * a Markdown file, so HTML pages that happen to end in `.md` (for example a rendered
 * GitHub blob page) are left alone.
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
  if (url.protocol === 'file:') {
    if (!page.fileAccessAllowed) return false;
  } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  const contentType = page.contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!contentType) return false;
  if (isMarkdownMimeType(contentType)) return true;
  return contentType === 'text/plain' && hasMarkdownExtension(url.pathname);
}

/** Builds the reader address that receives the original document URL, fragment included. */
export function readerUrlFor(readerPageUrl: string, documentUrl: string): string {
  return `${readerPageUrl}?url=${encodeURIComponent(documentUrl)}`;
}
