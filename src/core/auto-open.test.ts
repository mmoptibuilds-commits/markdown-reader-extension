import { describe, expect, it } from 'vitest';
import { readerUrlFor, shouldOpenInReader, type AutoOpenPage } from './auto-open';

const page = (url: string, contentType: string, overrides: Partial<AutoOpenPage> = {}): AutoOpenPage => ({
  url,
  contentType,
  topLevel: true,
  fileAccessAllowed: false,
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

  it('opens file URLs only after the user allows file URL access', () => {
    const file = 'file:///Users/reader/notes/README.md';
    expect(shouldOpenInReader(page(file, 'text/plain'))).toBe(false);
    expect(shouldOpenInReader(page(file, 'text/plain', { fileAccessAllowed: true }))).toBe(true);
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
});
