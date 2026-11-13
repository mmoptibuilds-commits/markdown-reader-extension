import { describe, expect, it } from 'vitest';
import { classifyDocument } from './document';
import { documentNameFromUrl, readRemoteMarkdown, RemoteDocumentError, REMOTE_DOCUMENT_LIMIT_BYTES } from './remote';

const url = new URL('https://notes.example.test/docs/Guide.md');
const markdownResponse = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' }, ...init });

async function failure(promise: Promise<unknown>): Promise<RemoteDocumentError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RemoteDocumentError) return error;
    throw error;
  }
  throw new Error('Expected the remote read to fail.');
}

describe('remote Markdown loading', () => {
  it('returns the decoded text of a successful Markdown response', async () => {
    const result = await readRemoteMarkdown(url, async () => markdownResponse('# Remote\n\nBody.'));

    expect(result.text).toBe('# Remote\n\nBody.');
  });

  it('reports the HTTP status when the server refuses the document', async () => {
    const error = await failure(readRemoteMarkdown(url, async () => new Response('nope', { status: 404, statusText: 'Not Found' })));

    expect(error.kind).toBe('http');
    expect(error.message).toBe('The server returned 404 Not Found.');
  });

  it('refuses a web page served at a .md address instead of rendering its HTML as Markdown', async () => {
    const error = await failure(readRemoteMarkdown(url, async () => new Response('<h1>Page</h1>', { headers: { 'content-type': 'text/html' } })));

    expect(error.kind).toBe('type');
    expect(error.message).toContain('web page');
  });

  it('rejects a declared oversize body before reading it', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      headers: { 'content-type': 'text/markdown', 'content-length': String(REMOTE_DOCUMENT_LIMIT_BYTES + 1) },
    });

    const error = await failure(readRemoteMarkdown(url, async () => response));

    expect(error.kind).toBe('size');
    expect(cancelled).toBe(true);
  });

  it('stops reading an undeclared oversize body once it passes the byte limit', async () => {
    const chunk = new TextEncoder().encode('a'.repeat(1024 * 1024));
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 100) controller.close();
        else controller.enqueue(chunk);
      },
    });

    const error = await failure(readRemoteMarkdown(url, async () => new Response(stream, { headers: { 'content-type': 'text/markdown' } })));

    expect(error.kind).toBe('size');
    expect(pulls).toBeLessThan(12);
  });

  it('times out a server that never answers', async () => {
    const hung = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')));
      });

    const error = await failure(readRemoteMarkdown(url, hung, { timeoutMs: 20 }));

    expect(error.kind).toBe('timeout');
  });

  it('explains a network failure without exposing the underlying error text', async () => {
    const error = await failure(readRemoteMarkdown(url, async () => { throw new TypeError('Failed to fetch'); }));

    expect(error.kind).toBe('network');
    expect(error.message).toBe('Could not reach notes.example.test. Check the address and your connection.');
  });

  it('never follows a redirect, so no other server is contacted', async () => {
    let init: RequestInit | undefined;
    const redirect = Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' });
    const error = await failure(readRemoteMarkdown(url, async (_input, options) => { init = options; return redirect; }));

    expect(init?.redirect).toBe('manual');
    expect(error.kind).toBe('redirect');
    expect(error.message).toContain('redirects');
  });

  it('sends no credentials and no referrer', async () => {
    let init: RequestInit | undefined;
    await readRemoteMarkdown(url, async (_input, options) => { init = options; return markdownResponse('# A'); });
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  });

  it('stops when the caller cancels the read', async () => {
    const controller = new AbortController();
    const hung = (_input: RequestInfo | URL, options?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    const pending = readRemoteMarkdown(url, hung, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('rejects an empty document with a specific message', async () => {
    const error = await failure(readRemoteMarkdown(url, async () => markdownResponse('')));

    expect(error.kind).toBe('empty');
  });
});

describe('remote document naming', () => {
  it('uses the last path segment and survives malformed percent-escapes', () => {
    expect(documentNameFromUrl(new URL('https://notes.example.test/docs/Guide%20One.md'))).toBe('Guide One.md');
    expect(documentNameFromUrl(new URL('https://notes.example.test/%E0%A4%A.md'))).toBe('%E0%A4%A.md');
    expect(documentNameFromUrl(new URL('https://notes.example.test/'))).toBe('notes.example.test');
  });
});

describe('document classification of HTML responses', () => {
  it('does not treat HTML as Markdown even when the address ends in .md', () => {
    expect(classifyDocument('https://site.example.test/page.md', 'text/html; charset=utf-8')).toBe('unsupported');
    expect(classifyDocument('https://site.example.test/page.md', 'application/xhtml+xml')).toBe('unsupported');
  });
});
