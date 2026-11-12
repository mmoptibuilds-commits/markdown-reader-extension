import { describe, expect, it } from 'vitest';
import { renderMarkdown, sanitizeSvg } from './markdown';

describe('renderMarkdown', () => {
  it('renders common GFM constructs and an outline', async () => {
    const result = await renderMarkdown([
      '# Reader',
      '',
      'A **clear** paragraph with ~~old~~ text.',
      '',
      '- [ ] Read the guide',
      '- [x] Open the file',
      '',
      '| Name | Value |',
      '| --- | ---: |',
      '| A | 12 |',
      '',
      '> [!NOTE]',
      '> Keep reading.',
      '',
      'See[^n].',
      '',
      '[^n]: A footnote.',
    ].join('\n'));

    expect(result.html).toContain('<table>');
    expect(result.html).toContain('type="checkbox"');
    expect(result.html).toContain('markdown-alert-note');
    expect(result.html).toContain('footnote');
    expect(result.headings).toEqual([{ id: 'md-reader', level: 1, text: 'Reader' }]);
  });

  it('renders advanced inline syntax, math and safe code highlighting locally', async () => {
    const result = await renderMarkdown([
      'H~2~O and x^2^ and ++added++ and ==marked== :sparkles:',
      '',
      'Inline math $a^2 + b^2 = c^2$.',
      '',
      '```typescript',
      'const total: number = 2 + 2;',
      '```',
    ].join('\n'));

    expect(result.html).toContain('<sub>2</sub>');
    expect(result.html).toContain('<sup>2</sup>');
    expect(result.html).toContain('<ins>added</ins>');
    expect(result.html).toContain('<mark>marked</mark>');
    expect(result.html).toContain('katex');
    expect(result.html).toContain('hljs');
  });

  it('keeps raw HTML inert and rejects dangerous URL schemes', async () => {
    const result = await renderMarkdown([
      '<img src=x onerror="alert(1)">',
      '',
      '[run](javascript:alert(1))',
      '',
      '```mermaid',
      'flowchart TD; A-->B',
      '```',
      '',
      '```dot',
      'digraph { A -> B }',
      '```',
    ].join('\n'));

    expect(result.html).not.toMatch(/<img[^>]+onerror=/i);
    expect(result.html).not.toMatch(/href=["']javascript:/i);
    expect(result.html).toContain('diagram-placeholder');
    expect(result.html).toContain('data-diagram="mermaid"');
    expect(result.html).toContain('data-diagram="graphviz"');
  });

  it('blocks remote images by default and resolves local folder assets', async () => {
    const source = '![Remote](https://images.example.test/photo.png)\n\n![Local](./media/photo.png)';
    const blocked = await renderMarkdown(source, {
      sourceUrl: 'https://docs.example.test/guide.md',
      documentPath: 'notes/guide.md',
      assetUrls: new Map([['notes/media/photo.png', 'blob:reader-session/photo']]),
    });

    expect(blocked.html).toContain('remote image blocked');
    expect(blocked.html).not.toContain('https://images.example.test/photo.png');
    expect(blocked.html).toContain('src="blob:reader-session/photo"');

    const allowed = await renderMarkdown('![Remote](https://images.example.test/photo.png)', {
      sourceUrl: 'https://docs.example.test/guide.md',
      allowRemoteImages: true,
    });
    expect(allowed.html).toContain('src="https://images.example.test/photo.png"');
  });

  it('rewrites folder links and same-document heading anchors', async () => {
    const result = await renderMarkdown('[Guide](../guide.md#setup)\n\n[Section](#getting-started)\n\n## Getting Started', {
      documentPath: 'notes/deep/README.md',
      documentPaths: new Set(['notes/guide.md']),
    });

    expect(result.html).toContain('data-local-path="notes/guide.md"');
    expect(result.html).toContain('data-local-available="true"');
    expect(result.html).toContain('href="#md-getting-started"');
  });

  it('sanitizes active SVG content and preserves diagram geometry', () => {
    const safe = sanitizeSvg('<svg onload="alert(1)"><script>alert(1)</script><image href="https://tracker.example/pixel.png"/><path d="M0 0" style="fill:url(https://tracker.example/fill.svg)"/><circle cx="2" cy="2" r="1" /></svg>');

    expect(safe).toContain('<svg');
    expect(safe).toContain('<path d="M0 0"');
    expect(safe).toContain('<circle cx="2" cy="2" r="1"');
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('onload=');
    expect(safe).not.toContain('tracker.example');
  });

  it('renders display math and accessible custom details containers', async () => {
    const result = await renderMarkdown('$$\n\\int_0^1 x^2 \\, dx\n$$\n\n::: details A little more\n\nHidden context.\n\n:::');

    expect(result.html).toContain('math-block');
    expect(result.html).toContain('katex-display');
    expect(result.html).toContain('<summary>A little more</summary>');
    expect(result.html).toContain('Hidden context.');
  });
});
