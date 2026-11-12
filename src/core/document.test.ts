import { describe, expect, it } from 'vitest';
import {
  buildHeadingIndex,
  classifyDocument,
  findTextMatches,
  isSafeLink,
  parseFrontmatter,
  resolveFolderTarget,
} from './document';

describe('document classification', () => {
  it('recognizes Markdown by case-insensitive pathname, not query string', () => {
    expect(classifyDocument('https://example.test/README.MD?raw=1')).toBe('markdown');
    expect(classifyDocument('https://example.test/guide.markdown#intro')).toBe('markdown');
  });

  it('recognizes Markdown MIME types when the URL has no useful extension', () => {
    expect(classifyDocument('https://example.test/raw/123', 'text/markdown; charset=utf-8')).toBe('markdown');
    expect(classifyDocument('https://example.test/raw/123', 'text/x-markdown')).toBe('markdown');
  });

  it('keeps ordinary text pages unsupported unless the user explicitly opens them', () => {
    expect(classifyDocument('https://example.test/page', 'text/plain')).toBe('unsupported');
    expect(classifyDocument('notes.txt')).toBe('unsupported');
    expect(classifyDocument('notes.txt', undefined, true)).toBe('text');
  });
});

describe('safe links', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd'])('rejects %s', (href) => {
    expect(isSafeLink(href)).toBe(false);
  });

  it.each(['https://example.test/a', 'mailto:reader@example.test', 'tel:+15551234567', '#chapter', '../guide.md', 'image.png'])('allows safe navigation %s', (href) => {
    expect(isSafeLink(href)).toBe(true);
  });
});

describe('heading index', () => {
  it('creates stable, unique ids for duplicate headings', () => {
    const headings = buildHeadingIndex([
      { level: 1, text: 'Getting Started' },
      { level: 2, text: 'Getting Started' },
      { level: 2, text: 'Café & Tea' },
    ]);

    expect(headings.map(({ id }) => id)).toEqual(['md-getting-started', 'md-getting-started-1', 'md-cafe-tea']);
  });
});

describe('frontmatter', () => {
  it('parses YAML metadata without removing the Markdown body', () => {
    const result = parseFrontmatter('---\ntitle: Field Notes\ntags:\n  - research\n---\n\n# Findings');

    expect(result.metadata).toEqual({ title: 'Field Notes', tags: ['research'] });
    expect(result.body).toBe('\n# Findings');
    expect(result.error).toBeUndefined();
  });

  it('leaves malformed frontmatter visible and reports a safe error', () => {
    const source = '---\ntitle: [broken\n---\n\n# Still readable';
    const result = parseFrontmatter(source);

    expect(result.body).toBe(source);
    expect(result.metadata).toEqual({});
    expect(result.error).toBeTruthy();
  });

  it('does not accept prototype-polluting metadata keys', () => {
    const result = parseFrontmatter('---\n__proto__:\n  polluted: true\nconstructor: unsafe\ntitle: Safe\n---\nBody');

    expect(result.metadata).toEqual({ title: 'Safe' });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('document search', () => {
  it('returns case-insensitive, non-overlapping offsets and handles an empty query', () => {
    expect(findTextMatches('Reader reader READ', 'reader')).toEqual([0, 7]);
    expect(findTextMatches('anything', '   ')).toEqual([]);
  });
});

describe('folder-relative links', () => {
  it('resolves a sibling path and preserves its heading fragment', () => {
    expect(resolveFolderTarget('notes/deep/README.md', '../guide.md#setup')).toEqual({
      path: 'notes/guide.md',
      hash: '#setup',
    });
    expect(resolveFolderTarget('notes/deep/README.md', './media/photo.png')).toEqual({
      path: 'notes/deep/media/photo.png',
      hash: '',
    });
  });

  it('refuses links that escape above the selected folder', () => {
    expect(resolveFolderTarget('notes/README.md', '../../../private.md')).toBeUndefined();
  });
});
