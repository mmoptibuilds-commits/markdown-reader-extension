import { describe, expect, it } from 'vitest';
import { addCodeLines, searchDocument, SEARCH_LIMIT } from './article-dom';

const container = (html: string): HTMLElement => {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.replaceChildren(element);
  return element;
};

describe('document search without the highlight API', () => {
  it('finds case-insensitive matches in text and code, but not in buttons', () => {
    const element = container('<p>Reader reads</p><pre><code>const reader = 1;</code></pre><button>Reader</button>');
    expect(searchDocument(element, 'READER').count).toBe(2);
  });

  it('finds the same matches when the term is typed one character at a time', () => {
    const element = container('<p>needle in a haystack with another needle</p>');
    let result = searchDocument(element, 'n');
    for (const term of ['ne', 'nee', 'need', 'needl', 'needle']) result = searchDocument(element, term);
    expect(result.count).toBe(2);
  });

  it('marks the selected match as current', () => {
    const element = container('<p>one two one</p>');
    const result = searchDocument(element, 'one');
    result.select(1);
    expect(element.querySelectorAll('mark.is-current')).toHaveLength(1);
    expect(element.querySelector('mark[aria-current="true"]')).toBe(element.querySelectorAll('mark')[1]);
  });

  it('restores the original text when cleared', () => {
    const element = container('<p>alpha beta alpha</p>');
    searchDocument(element, 'alpha').clear();
    expect(element.innerHTML).toBe('<p>alpha beta alpha</p>');
    expect(element.querySelector('p')?.childNodes).toHaveLength(1);
  });

  it('stops counting at the limit', () => {
    const element = container(`<p>${'a '.repeat(SEARCH_LIMIT + 50)}</p>`);
    const result = searchDocument(element, 'a');
    expect(result.count).toBe(SEARCH_LIMIT);
    expect(result.capped).toBe(true);
  });
});

describe('numbered code lines', () => {
  it.each([
    ['plain code', 'first line\nsecond line\n\nlast', 'first line\nsecond line\n\nlast'],
    ['a trailing newline', 'a\nb\n', 'a\nb\n'],
    ['highlighted spans across lines', '<span class="k">a\nb</span>\nc', 'a\nb\nc'],
  ])('keeps the text of %s unchanged', (_name, html, text) => {
    const code = container(`<code>${html}</code>`).querySelector('code') as HTMLElement;
    expect(code.textContent).toBe(text);
    addCodeLines(code);
    expect(code.textContent).toBe(text);
    expect(code.querySelectorAll('.code-line').length).toBe(text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length);
  });
});
