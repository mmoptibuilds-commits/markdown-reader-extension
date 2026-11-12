import { expect, test } from './extension-fixture';

const document = [
  '# Diagrams under the extension CSP',
  '',
  '```mermaid',
  'flowchart LR',
  '  Start --> Finish',
  '```',
  '',
  '```dot',
  'digraph G { Alpha -> Beta }',
  '```',
  '',
  'Inline math: $e^{i\\pi} + 1 = 0$.',
  '',
].join('\n');

test.describe('rendering inside the installed extension', () => {
  test('draws Mermaid and Graphviz diagrams without any Content Security Policy violation', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const problems: string[] = [];
    const created = context.waitForEvent('page');
    await popup.locator('input[type="file"]').setInputFiles({ name: 'Diagrams.md', mimeType: 'text/markdown', buffer: Buffer.from(document) });
    const reader = await created;
    reader.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    reader.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    await reader.waitForURL(/reader\.html/);

    await expect(reader.locator('[data-diagram="mermaid"] svg')).toBeAttached({ timeout: 30_000 });
    await expect(reader.locator('[data-diagram="graphviz"] svg')).toBeAttached({ timeout: 30_000 });
    await expect(reader.locator('.katex')).toBeAttached();

    expect(problems.filter((problem) => /Content Security Policy|eval|Refused/iu.test(problem))).toEqual([]);
    expect(problems).toEqual([]);
  });
});
