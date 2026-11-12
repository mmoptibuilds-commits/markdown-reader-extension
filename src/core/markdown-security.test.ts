import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('markup injected through Markdown constructs', () => {
  it('escapes GitHub alert titles so HTML in them cannot load a remote image', async () => {
    const result = await renderMarkdown('> [!NOTE] <img src="https://attacker.example/t.gif" alt="x">\n> Body text.', {
      allowRemoteImages: false,
    });

    expect(result.html).not.toMatch(/<img\b/iu);
    expect(result.html).toContain('&lt;img');
    expect(result.html).toContain('Body text.');
  });

  it('escapes GitHub alert titles so HTML in them cannot add a style element', async () => {
    const result = await renderMarkdown('> [!WARNING] <style>.markdown-body{position:fixed;inset:0}</style>\n> Careful.');

    expect(result.html).not.toMatch(/<style\b/iu);
    expect(result.html).toContain('&lt;style');
  });

  it('keeps normal alert titles readable', async () => {
    const result = await renderMarkdown('> [!TIP] Save the draft first\n> Then continue.');

    expect(result.html).toContain('Save the draft first');
    expect(result.html).toMatch(/markdown-alert-tip|alert-tip/u);
  });
});
