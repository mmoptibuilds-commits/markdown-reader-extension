import { expect, test } from './extension-fixture';

test.describe('installed extension surfaces', () => {
  test('the service worker starts and every extension page loads without errors', async ({ context, extensionId, serviceWorker }) => {
    expect(serviceWorker.url()).toMatch(/background\.js$/);

    const problems: string[] = [];
    for (const path of ['popup.html', 'options.html', 'reader.html']) {
      const page = await context.newPage();
      page.on('pageerror', (error) => problems.push(`${path}: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`${path}: ${message.text()}`);
      });
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      await page.waitForLoadState('networkidle');
      await page.close();
    }
    expect(problems).toEqual([]);
  });

  test('the popup opens a chosen Markdown file in a new reader tab', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const created = context.waitForEvent('page');
    await popup.locator('input[type="file"]').setInputFiles({
      name: 'Notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Picked file\n\nOpened from the popup.\n'),
    });
    const reader = await created;
    await reader.waitForURL(/reader\.html/);
    await expect(reader.getByRole('heading', { level: 1, name: 'Picked file' })).toBeVisible();
  });
});
