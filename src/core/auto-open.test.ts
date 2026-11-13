import { describe, expect, it } from 'vitest';
import { plainTextOfDocument, readerUrlFor, settledReaderLocation, shouldOpenInReader, type AutoOpenPage } from './auto-open';

const page = (url: string, contentType: string, overrides: Partial<AutoOpenPage> = {}): AutoOpenPage => ({
  url,
  contentType,
  topLevel: true,
  localFilesEnabled: false,
  ...overrides,
});

describe('automatic Markdown opening', () => {
  it.each([
    'https://notes.example.test/README.md',
    'https://notes.example.test/Guide.MARKDOWN',
    'https://notes.example.test/spec.mdx',
    'https://notes.example.test/a.mkd',
    'https://notes.example.test/a.mkdn',
    'https://notes.example.test/a.mdown',
    'https://notes.example.test/a.mdwn',
  ])('opens plain-text response %s', (url) => {
    expect(shouldOpenInReader(page(url, 'text/plain; charset=utf-8'))).toBe(true);
  });

  it('opens any response that declares a Markdown MIME type, whatever the path', () => {
    expect(shouldOpenInReader(page('https://api.example.test/readme', 'text/markdown; charset=utf-8'))).toBe(true);
    expect(shouldOpenInReader(page('https://api.example.test/readme', 'Application/X-Markdown'))).toBe(true);
  });

  it.each([
    ['an HTML page at a .md path', 'https://site.example.test/page.md', 'text/html; charset=utf-8'],
    ['a rendered GitHub Markdown page', 'https://github.com/owner/repo/blob/main/README.md', 'text/html; charset=utf-8'],
    ['an XHTML page at a .md path', 'https://site.example.test/a.md', 'application/xhtml+xml'],
    ['a .txt file', 'https://site.example.test/notes.txt', 'text/plain'],
    ['a .md name only in the query', 'https://site.example.test/search?file=README.md', 'text/plain'],
    ['a .md name with a trailing slash', 'https://site.example.test/README.md/', 'text/plain'],
    ['a response with no content type', 'https://site.example.test/README.md', ''],
    ['a binary download', 'https://site.example.test/README.md', 'application/octet-stream'],
  ])('does not open %s', (_label, url, contentType) => {
    expect(shouldOpenInReader(page(url, contentType))).toBe(false);
  });

  it('decodes percent-encoded path characters before checking the extension', () => {
    expect(shouldOpenInReader(page('https://notes.example.test/README%2Emd', 'text/plain'))).toBe(true);
  });

  it('ignores frames other than the top-level document', () => {
    expect(shouldOpenInReader(page('https://notes.example.test/README.md', 'text/plain', { topLevel: false }))).toBe(false);
  });

  it('never redirects extension, browser-internal, or credentialed URLs', () => {
    expect(shouldOpenInReader(page('chrome-extension://abcdef/reader.html', 'text/plain'))).toBe(false);
    expect(shouldOpenInReader(page('about:blank', 'text/plain'))).toBe(false);
    expect(shouldOpenInReader(page('https://user:secret@notes.example.test/README.md', 'text/plain'))).toBe(false);
  });

  describe('local files', () => {
    const file = 'file:///home/reader/My%20Notes/%C3%9Cbersicht.md';

    it('opens a local Markdown file only after the user turns on local automatic opening', () => {
      expect(shouldOpenInReader(page(file, 'text/markdown'))).toBe(false);
      expect(shouldOpenInReader(page(file, 'text/markdown', { localFilesEnabled: true }))).toBe(true);
      expect(shouldOpenInReader(page(file, 'text/plain', { localFilesEnabled: true }))).toBe(true);
    });

    it.each([
      ['an HTML file', 'file:///home/reader/page.html', 'text/html'],
      ['a PDF', 'file:///home/reader/paper.pdf', 'application/pdf'],
      ['an image', 'file:///home/reader/photo.png', 'image/png'],
      ['a text file', 'file:///home/reader/notes.txt', 'text/plain'],
      ['a directory listing', 'file:///home/reader/notes/', 'text/html'],
      ['a Markdown media type at a non-Markdown path', 'file:///home/reader/readme', 'text/markdown'],
      ['HTML at a .md path', 'file:///home/reader/page.md', 'text/html'],
      ['a .md file the browser treats as a download', 'file:///home/reader/a.md', 'application/octet-stream'],
      ['a network share', 'file://server/share/README.md', 'text/plain'],
    ])('does not open %s', (_label, url, contentType) => {
      expect(shouldOpenInReader(page(url, contentType, { localFilesEnabled: true }))).toBe(false);
    });

    it('does not open a local file inside a frame', () => {
      expect(shouldOpenInReader(page(file, 'text/markdown', { localFilesEnabled: true, topLevel: false }))).toBe(false);
    });

    it('does not let the local opt-in widen web automatic opening', () => {
      expect(shouldOpenInReader(page('ftp://files.example.test/README.md', 'text/plain', { localFilesEnabled: true }))).toBe(false);
    });
  });
});

describe('reader URL construction', () => {
  it('keeps the original address, including query and fragment, as the reader source', () => {
    const original = 'https://notes.example.test/docs/Guide.md?version=2#install';
    const built = readerUrlFor('chrome-extension://abcdef/reader.html', original);
    const target = new URL(built);

    expect(built.split('?', 1)[0]).toBe('chrome-extension://abcdef/reader.html');
    expect(target.searchParams.get('url')).toBe(original);
  });

  it('round-trips a local file URL with spaces and Unicode unchanged', () => {
    const original = 'file:///home/reader/My%20Notes/%C3%9Cbersicht.md#part-2';
    const target = new URL(readerUrlFor('moz-extension://uuid/reader.html', original));
    expect(target.searchParams.get('url')).toBe(original);
    expect(target.searchParams.has('local')).toBe(false);
  });

  it('adds the handoff token when one is given', () => {
    const target = new URL(readerUrlFor('chrome-extension://abcdef/reader.html', 'file:///a.md', 'tok_123'));
    expect(target.searchParams.get('url')).toBe('file:///a.md');
    expect(target.searchParams.get('local')).toBe('tok_123');
  });
});

describe('plain-text document extraction', () => {
  const documentWith = (body: string): Document => new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${body}</body></html>`, 'text/html');

  it('returns the exact text of a browser plain-text view', () => {
    expect(plainTextOfDocument(documentWith('<pre># Title\n\n&lt;script&gt;x&lt;/script&gt; ü</pre>'))).toBe('# Title\n\n<script>x</script> ü');
  });

  it('returns empty text for an empty file, which browsers show with no pre element', () => {
    expect(plainTextOfDocument(documentWith(''))).toBe('');
  });

  it.each([
    ['an HTML page', '<h1>Title</h1><p>Body</p>'],
    ['a pre next to other content', '<pre>text</pre><p>more</p>'],
    ['an empty body with stray text', 'stray'],
  ])('refuses %s', (_label, body) => {
    expect(plainTextOfDocument(documentWith(body))).toBeUndefined();
  });
});

describe('settling a reader page reached by automatic opening', () => {
  it('re-enters the reader once for a local file, keeping every parameter', () => {
    const href = 'chrome-extension://abc/reader.html?url=file%3A%2F%2F%2Fa%2520b.md&local=tok_12345678';
    const next = settledReaderLocation(href);
    expect(next).toBeDefined();
    const url = new URL(next ?? '');
    expect(url.searchParams.get('url')).toBe('file:///a%20b.md');
    expect(url.searchParams.get('local')).toBe('tok_12345678');
    expect(url.searchParams.get('settled')).toBe('1');
    expect(settledReaderLocation(next ?? '')).toBeUndefined();
  });

  it.each([
    ['https://example.test/a.md#Heading', 'https%3A%2F%2Fexample.test%2Fa.md%23Heading'],
    ['http://127.0.0.1:8080/docs/read%20me.md?ref=1', 'http%3A%2F%2F127.0.0.1%3A8080%2Fdocs%2Fread%2520me.md%3Fref%3D1'],
    ['HTTPS://EXAMPLE.TEST/A.MD', 'HTTPS%3A%2F%2FEXAMPLE.TEST%2FA.MD'],
  ])('re-enters the reader once for the web document %s', (documentUrl, encoded) => {
    const next = settledReaderLocation(`moz-extension://abc/reader.html?url=${encoded}`);
    expect(next).toBeDefined();
    const url = new URL(next ?? '');
    expect(next?.startsWith('moz-extension://abc/reader.html?')).toBe(true);
    expect(url.searchParams.get('url')).toBe(documentUrl);
    expect(url.searchParams.get('settled')).toBe('1');
    expect(settledReaderLocation(next ?? '')).toBeUndefined();
  });

  it.each([
    ['a plain reader page', 'chrome-extension://abc/reader.html'],
    ['an empty document address', 'chrome-extension://abc/reader.html?url='],
    ['an unsupported scheme', 'chrome-extension://abc/reader.html?url=javascript%3Aalert(1)'],
    ['a data address', 'chrome-extension://abc/reader.html?url=data%3Atext%2Fmarkdown%2C%23%20x'],
    ['a relative address', 'chrome-extension://abc/reader.html?url=%2Fa.md'],
  ])('leaves %s alone', (_label, href) => {
    expect(settledReaderLocation(href)).toBeUndefined();
  });
});
