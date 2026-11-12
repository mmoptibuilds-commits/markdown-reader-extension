import { expect, test } from './extension-fixture';

const readerHeading = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('heading', { level: 1, name });

test.describe('automatic Markdown opening in installed Chromium', () => {
  test('redirects a text/plain .md page to the reader once the site is enabled', async ({ context, extensionId, documentServer }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(async (origin) => {
      await chrome.storage.local.set({ markdownReaderAutoRenderOrigins: [origin] });
      await chrome.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' });
    }, documentServer.origin);

    const page = await context.newPage();
    await page.goto(`${documentServer.origin}/doc.md`);
    await page.waitForURL(/reader\.html\?url=/);
    await expect(readerHeading(page, 'Runtime document')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('url')).toBe(`${documentServer.origin}/doc.md`);
  });

  test('redirects a document that declares a Markdown media type regardless of extension', async ({ context, extensionId, documentServer }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(async (origin) => {
      await chrome.storage.local.set({ markdownReaderAutoRenderOrigins: [origin] });
      await chrome.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' });
    }, documentServer.origin);

    const page = await context.newPage();
    await page.goto(`${documentServer.origin}/notes.md`);
    await page.waitForURL(/reader\.html\?url=/);
    await expect(readerHeading(page, 'Declared Markdown')).toBeVisible();
  });

  test('leaves an HTML page at a .md path where it is', async ({ context, extensionId, documentServer }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(async (origin) => {
      await chrome.storage.local.set({ markdownReaderAutoRenderOrigins: [origin] });
      await chrome.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' });
    }, documentServer.origin);

    const page = await context.newPage();
    await page.goto(`${documentServer.origin}/page.md`);
    await expect(page.getByRole('heading', { level: 1, name: 'HTML page at a .md path' })).toBeVisible();
    expect(page.url()).toBe(`${documentServer.origin}/page.md`);
  });

  test('does not redirect when the site has not been enabled', async ({ context, documentServer }) => {
    const page = await context.newPage();
    await page.goto(`${documentServer.origin}/doc.md`);
    await expect(page.locator('pre')).toContainText('# Runtime document');
    expect(page.url()).toBe(`${documentServer.origin}/doc.md`);
  });

  test('stops redirecting after the site is removed from automatic opening', async ({ context, extensionId, documentServer }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(async (origin) => {
      await chrome.storage.local.set({ markdownReaderAutoRenderOrigins: [origin] });
      await chrome.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' });
      await chrome.storage.local.set({ markdownReaderAutoRenderOrigins: [] });
      await chrome.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' });
    }, documentServer.origin);

    const registered = await options.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    expect(registered).toHaveLength(0);

    const page = await context.newPage();
    await page.goto(`${documentServer.origin}/doc.md`);
    await expect(page.locator('pre')).toContainText('# Runtime document');
    expect(page.url()).toBe(`${documentServer.origin}/doc.md`);
  });
});
