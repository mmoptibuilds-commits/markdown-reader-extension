import { describe, expect, it } from 'vitest';
import { scopeCustomCss } from './settings';

describe('custom CSS resource loading', () => {
  it.each([
    ['image-set with a quoted remote URL', '#reader .markdown-body p{background-image:image-set("https://attacker.example/x.png" 1x)}'],
    ['src() with a quoted remote URL', '#reader .markdown-body p{background:src("https://attacker.example/x.png")}'],
    ['-webkit-image-set with a single-quoted URL', "p{background-image:-webkit-image-set('https://attacker.example/x.png' 1x)}"],
    ['image() with a string argument', 'p{background-image:image("https://attacker.example/x.png")}'],
    ['cross-fade with a string argument', 'p{background-image:cross-fade("https://attacker.example/a.png", red)}'],
  ])('rejects %s', (_label, css) => {
    expect(scopeCustomCss(css)).toBe('');
  });

  it('still accepts ordinary typography and colour rules', () => {
    const scoped = scopeCustomCss('p{color: #222; font-family: "Iowan Old Style", serif}');

    expect(scoped).toContain('color');
    expect(scoped).toContain('Iowan Old Style');
  });
});
