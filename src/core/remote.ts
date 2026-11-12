import { classifyDocument } from './document';

/** Largest remote document the reader accepts, counted in bytes. */
export const REMOTE_DOCUMENT_LIMIT_BYTES = 8 * 1024 * 1024;
export const REMOTE_TIMEOUT_MS = 20_000;

export type RemoteErrorKind = 'http' | 'type' | 'size' | 'timeout' | 'network' | 'origin' | 'empty';

/** An error whose message is safe to show to the reader. */
export class RemoteDocumentError extends Error {
  constructor(readonly kind: RemoteErrorKind, message: string) {
    super(message);
    this.name = 'RemoteDocumentError';
  }
}

export interface RemoteReadOptions {
  /** Called with the final origin when a redirect moved the request elsewhere. */
  isOriginAllowed(origin: string): boolean | Promise<boolean>;
  timeoutMs?: number;
}

export interface RemoteDocument {
  text: string;
  finalUrl: string;
}

const htmlMediaTypes = new Set(['text/html', 'application/xhtml+xml']);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A human name for a remote document: its decoded last path segment, or its host. */
export function documentNameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  return safeDecode(last) || url.hostname;
}

/**
 * Fetches one remote Markdown document. Credentials and the HTTP cache are never used.
 * Every failure is reported as a RemoteDocumentError with a message written for the reader.
 */
export async function readRemoteMarkdown(
  url: URL,
  fetcher: typeof fetch,
  options: RemoteReadOptions,
): Promise<RemoteDocument> {
  const timeoutMs = options.timeoutMs ?? REMOTE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = (): RemoteDocumentError =>
    new RemoteDocumentError('timeout', `The server did not finish responding within ${Math.round(timeoutMs / 1000)} seconds.`);

  try {
    let response: Response;
    try {
      response = await fetcher(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store', signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw timedOut();
      throw new RemoteDocumentError('network', `Could not reach ${url.hostname}. Check the address and your connection.`);
    }

    const finalUrl = new URL(response.url || url.href);
    if (finalUrl.origin !== url.origin && !(await options.isOriginAllowed(finalUrl.origin))) {
      await response.body?.cancel().catch(() => undefined);
      throw new RemoteDocumentError('origin', `The server redirected to ${finalUrl.origin}. Allow that site, then open this address again.`);
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const status = [response.status, response.statusText].filter(Boolean).join(' ');
      throw new RemoteDocumentError('http', `The server returned ${status}.`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (htmlMediaTypes.has(mediaType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new RemoteDocumentError('type', 'This address returned a web page, not Markdown. Use a link to the Markdown source.');
    }
    if (classifyDocument(url.href, contentType) !== 'markdown') {
      await response.body?.cancel().catch(() => undefined);
      throw new RemoteDocumentError('type', 'This address does not look like Markdown. Use a link that ends in .md or a Markdown content type.');
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > REMOTE_DOCUMENT_LIMIT_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw sizeError();
    }

    const bytes = await readBounded(response, controller.signal, timedOut);
    const text = new TextDecoder('utf-8').decode(bytes);
    if (text.length === 0) throw new RemoteDocumentError('empty', 'The server returned an empty document.');
    return { text, finalUrl: finalUrl.href };
  } finally {
    clearTimeout(timer);
  }
}

function sizeError(): RemoteDocumentError {
  return new RemoteDocumentError('size', `This document is larger than the ${REMOTE_DOCUMENT_LIMIT_BYTES / (1024 * 1024)} MB reading limit.`);
}

async function readBounded(response: Response, signal: AbortSignal, timedOut: () => RemoteDocumentError): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > REMOTE_DOCUMENT_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw sizeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RemoteDocumentError) throw error;
    if (signal.aborted) throw timedOut();
    throw error;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
