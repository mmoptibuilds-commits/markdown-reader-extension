import { describe, expect, it } from 'vitest';
import {
  acceptLocalHandoffRequest,
  LOCAL_DOCUMENT_LIMIT_BYTES,
  LOCAL_HANDOFF_LIMIT_BYTES,
  LocalFileError,
  localAutoOpenState,
  localFileNameFromUrl,
  parseLocalHandoff,
  parseLocalMarkdownUrl,
  readLocalMarkdown,
} from './local-file';

describe('local Markdown URL parsing', () => {
  it.each(['md', 'markdown', 'mdx', 'mkd', 'mkdn', 'mdown', 'mdwn', 'MD', 'Markdown'])('accepts a file URL ending in .%s', (extension) => {
    expect(parseLocalMarkdownUrl(`file:///home/reader/notes/README.${extension}`)?.protocol).toBe('file:');
  });

  it.each([
    ['an HTML file', 'file:///home/reader/page.html'],
    ['a PDF', 'file:///home/reader/paper.pdf'],
    ['an image', 'file:///home/reader/diagram.png'],
    ['an executable', 'file:///home/reader/setup.exe'],
    ['a text file', 'file:///home/reader/notes.txt'],
    ['a directory', 'file:///home/reader/notes/'],
    ['a name ending in .md only in the query', 'file:///home/reader/view?name=README.md'],
    ['a .md directory with a trailing slash', 'file:///home/reader/README.md/'],
    ['a file without an extension', 'file:///home/reader/README'],
  ])('rejects %s', (_label, url) => {
    expect(parseLocalMarkdownUrl(url)).toBeUndefined();
  });

  it.each([
    ['malformed text', 'not a url'],
    ['an empty string', ''],
    ['a web address', 'https://example.test/README.md'],
    ['a network share host', 'file://fileserver/share/README.md'],
    ['an extension page', 'chrome-extension://abcdef/README.md'],
    ['a data URL', 'data:text/markdown,%23%20Hi'],
  ])('rejects %s', (_label, url) => {
    expect(parseLocalMarkdownUrl(url)).toBeUndefined();
  });

  it('accepts the localhost form of a local file URL', () => {
    expect(parseLocalMarkdownUrl('file://localhost/home/reader/README.md')).toBeDefined();
  });

  it('keeps the exact percent-encoded path, including spaces and Unicode', () => {
    const raw = 'file:///home/reader/My%20Notes/%C3%9Cbersicht%20%E2%80%94%20%E6%97%A5%E6%9C%AC.md';
    expect(parseLocalMarkdownUrl(raw)?.href).toBe(raw);
  });

  it('decodes an encoded extension before checking it', () => {
    expect(parseLocalMarkdownUrl('file:///home/reader/README%2Emd')).toBeDefined();
  });

  it('names a document by its decoded file name', () => {
    expect(localFileNameFromUrl(new URL('file:///home/reader/My%20Notes/%C3%9Cbersicht%20%E6%97%A5.md'))).toBe('Übersicht 日.md');
  });

  it('keeps a malformed escape in the name instead of throwing', () => {
    expect(localFileNameFromUrl(new URL('file:///home/reader/100%zz.md'))).toBe('100%zz.md');
  });
});

describe('local automatic-opening state', () => {
  it('is active only when the user opted in and the browser grants file access', () => {
    expect(localAutoOpenState(true, true)).toBe('active');
  });

  it('reports a user opt-out regardless of browser access', () => {
    expect(localAutoOpenState(false, true)).toBe('disabled');
    expect(localAutoOpenState(false, false)).toBe('disabled');
  });

  it('asks for browser permission when the user opted in without file access', () => {
    expect(localAutoOpenState(true, false)).toBe('permission-required');
  });

  it('reports the feature as unavailable when the browser cannot report file access', () => {
    expect(localAutoOpenState(true, undefined)).toBe('unavailable');
    expect(localAutoOpenState(false, undefined)).toBe('unavailable');
  });
});

describe('local handoff validation', () => {
  const url = 'file:///home/reader/README.md';

  it('returns the text for a handoff that names the same file', () => {
    expect(parseLocalHandoff({ url, text: '# Title' }, url)).toEqual({ url, text: '# Title' });
  });

  it.each([
    ['a different file', { url: 'file:///home/reader/other.md', text: '# Other' }],
    ['missing text', { url }],
    ['non-string text', { url, text: 42 }],
    ['a non-object', 'text'],
    ['nothing', undefined],
  ])('rejects %s', (_label, value) => {
    expect(parseLocalHandoff(value, url)).toBeUndefined();
  });
});

describe('reading a local Markdown file', () => {
  const url = new URL('file:///home/reader/README.md');
  const respond = (body: BodyInit | null, init?: ResponseInit): typeof fetch => async () => new Response(body, init);

  it('returns the file text unchanged', async () => {
    await expect(readLocalMarkdown(url, respond('# Ü — 日本\r\n\ntext'))).resolves.toBe('# Ü — 日本\r\n\ntext');
  });

  it('reports an unreadable file with a reader-facing message', async () => {
    const failing: typeof fetch = async () => { throw new TypeError('Failed to fetch'); };
    await expect(readLocalMarkdown(url, failing)).rejects.toBeInstanceOf(LocalFileError);
    await expect(readLocalMarkdown(url, failing)).rejects.toMatchObject({ kind: 'unreadable' });
  });

  it('refuses files over the local reading limit', async () => {
    const large = new Uint8Array(LOCAL_DOCUMENT_LIMIT_BYTES + 1);
    await expect(readLocalMarkdown(url, respond(large))).rejects.toMatchObject({ kind: 'size' });
  });

  it('refuses a declared oversize file before reading it', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      headers: { 'content-length': String(LOCAL_DOCUMENT_LIMIT_BYTES + 1) },
    });
    await expect(readLocalMarkdown(url, async () => response)).rejects.toMatchObject({ kind: 'size' });
    expect(cancelled).toBe(true);
  });

  it('stops reading an undeclared oversize file once it passes the byte limit', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 64) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    });
    await expect(readLocalMarkdown(url, async () => new Response(stream))).rejects.toMatchObject({ kind: 'size' });
    expect(pulls).toBeLessThan(20);
    expect(cancelled).toBe(true);
  });

  it('reads a streamed file split across chunks, including a split multi-byte character', async () => {
    const bytes = new TextEncoder().encode('# Ü — 日本');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 4));
        controller.enqueue(bytes.slice(4));
        controller.close();
      },
    });
    await expect(readLocalMarkdown(url, async () => new Response(stream))).resolves.toBe('# Ü — 日本');
  });

  it('reports an unsuccessful response as unreadable', async () => {
    await expect(readLocalMarkdown(url, respond('missing', { status: 404 }))).rejects.toMatchObject({ kind: 'unreadable' });
  });
});

describe('local handoff requests from the content script', () => {
  const url = 'file:///home/reader/My%20Notes/README.md';
  const request = (overrides: Partial<Parameters<typeof acceptLocalHandoffRequest>[0]> = {}) => acceptLocalHandoffRequest({
    message: { type: 'markdown-reader:local-file', url, text: '# Notes' },
    senderUrl: url,
    frameId: 0,
    tabId: 7,
    enabled: true,
    ...overrides,
  });

  it('accepts a top-frame request for the sender’s own Markdown file', () => {
    expect(request()).toEqual({ url, text: '# Notes', tabId: 7 });
  });

  it('ignores a fragment difference between the sender and the message', () => {
    expect(request({ senderUrl: `${url}#part` })).toBeDefined();
  });

  it.each([
    ['local opening is off', { enabled: false }],
    ['the request comes from a frame', { frameId: 2 }],
    ['there is no tab', { tabId: undefined }],
    ['the sender is a different file', { senderUrl: 'file:///home/reader/other.md' }],
    ['the sender is a web page', { senderUrl: 'https://example.test/README.md' }],
    ['the file is not Markdown', { senderUrl: 'file:///home/reader/page.html', message: { type: 'markdown-reader:local-file', url: 'file:///home/reader/page.html', text: 'x' } }],
    ['the text is missing', { message: { type: 'markdown-reader:local-file', url } }],
    ['the message is malformed', { message: 'hello' }],
  ])('refuses the request when %s', (_label, overrides) => {
    expect(request(overrides as Partial<Parameters<typeof acceptLocalHandoffRequest>[0]>)).toBeUndefined();
  });

  it('refuses text over the handoff limit', () => {
    const text = 'a'.repeat(LOCAL_HANDOFF_LIMIT_BYTES + 1);
    expect(request({ message: { type: 'markdown-reader:local-file', url, text } })).toBeUndefined();
  });

  it('counts the limit in UTF-8 bytes, not characters', () => {
    const text = 'ü'.repeat(Math.floor(LOCAL_HANDOFF_LIMIT_BYTES / 2) + 1);
    expect(request({ message: { type: 'markdown-reader:local-file', url, text } })).toBeUndefined();
  });
});
