import { describe, expect, it } from 'vitest';
import { renderMarkdown, sanitizeSvg, sanitizeSvgElement } from './markdown';

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

describe('diagram SVG cannot fetch resources', () => {
  it.each([
    ['image-set() in a style element', '<svg><style>#a{background-image:image-set("https://t.example/p" 1x)}</style><rect id="a"/></svg>'],
    ['an escaped url() in a style element', '<svg><style>#a{background:u\\72l(https://t.example/p)}</style><rect id="a"/></svg>'],
    ['an escaped @import', '<svg><style>@\\69mport "https://t.example/x.css";</style><rect/></svg>'],
    ['@font-face', '<svg><style>@font-face{font-family:x;src:local(x)}</style><rect/></svg>'],
    ['cross-fade() in a style attribute', '<svg><rect style="fill:cross-fade(url(#a), url(#b))"/></svg>'],
    ['image() in a style attribute', '<svg><rect style="background:image(\'https://t.example/p\')"/></svg>'],
  ])('removes %s', (_label, svg) => {
    const safe = sanitizeSvg(svg);
    expect(safe).not.toContain('t.example');
    expect(safe).not.toMatch(/image-set|cross-fade|image\(|@import|@font-face|\\72/iu);
    expect(safe).toContain('<rect');
  });

  it('keeps local url(#id) references and ordinary styles', () => {
    const safe = sanitizeSvg('<svg><defs><marker id="arrow"/></defs><style>.edge{stroke:#333;marker-end:url(#arrow);font-family:"trebuchet ms",sans-serif}</style><path class="edge" style="marker-end:url(#arrow)"/></svg>');
    expect(safe).toContain('url(#arrow)');
    expect(safe).toContain('.edge');
  });

  it('returns a parsed element for direct insertion', () => {
    const element = sanitizeSvgElement('<svg><circle r="1"/></svg>');
    expect(element?.localName).toBe('svg');
    expect(sanitizeSvgElement('<p>not svg</p>')).toBeUndefined();
  });
});

describe('links and images without a safe destination', () => {
  it('neutralizes relative links when the document has no base address', async () => {
    const result = await renderMarkdown('[Settings](options.html) [Reader](reader.html?url=x) [Up](../notes.md)');
    expect(result.html).not.toMatch(/href="(?:options|reader)\.html/u);
    expect(result.html).not.toContain('href="../notes.md"');
  });

  it('neutralizes a relative link that resolves to an unsafe scheme', async () => {
    const result = await renderMarkdown('[Local](other.md)', { sourceUrl: 'file:///home/reader/a.md' });
    expect(result.html).not.toContain('href="other.md"');
    expect(result.html).not.toContain('file:');
  });

  it('keeps fragment links and absolute web links', async () => {
    const result = await renderMarkdown('# Top\n\n[Top](#top) [Web](https://example.test/a)');
    expect(result.html).toContain('href="#md-top"');
    expect(result.html).toContain('href="https://example.test/a"');
  });

  it('sends no referrer with remote images', async () => {
    const result = await renderMarkdown('![Logo](https://images.example.test/logo.png)', { allowRemoteImages: true });
    expect(result.html).toContain('referrerpolicy="no-referrer"');
  });
});
