import type { BrowserContext, Page } from '@playwright/test';
import { expect, setFileUrlAccess, test } from './extension-fixture';

const readerHeading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

/** Sets the user's opt-in the way Settings does, then waits for the background sync. */
async function setLocalAutoOpen(context: BrowserContext, extensionId: string, enabled: boolean): Promise<void> {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(async (on) => {
    await chrome.storage.local.set({ markdownReaderSettings: { autoOpenLocalFiles: on } });
    await chrome.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' });
  }, enabled);
  await options.close();
}

/** Opens a file URL and returns once the page has either moved to the reader or settled. */
async function openFile(page: Page, url: string): Promise<void> {
  await page.goto(url).catch((error: unknown) => {
    // location.replace() can interrupt the file navigation Playwright is waiting on.
    if (!String(error).includes('interrupted')) throw error;
  });
}

const launchUrlOf = (page: Page): string | null => new URL(page.url()).searchParams.get('url');

test.describe('automatic opening of local Markdown files in installed Chromium', () => {
  test('opens a local Markdown file in the reader and keeps its exact address', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    const page = await context.newPage();
    const url = localDocs.url('Guide.md');

    await openFile(page, url);
    await page.waitForURL(/reader\.html\?url=/);

    await expect(readerHeading(page, 'Local guide')).toBeVisible();
    expect(launchUrlOf(page)).toBe(url);
    await expect(page.locator('.document-kind')).toHaveText('Local file');
  });

  test('opens nested files whose names contain spaces and Unicode', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    const page = await context.newPage();
    const url = localDocs.url('deep/nested folder/Übersicht – 日本 notes.md');
    expect(url).toContain('%20');

    await openFile(page, url);
    await page.waitForURL(/reader\.html\?url=/);

    await expect(readerHeading(page, 'Übersicht 日本')).toBeVisible();
    expect(launchUrlOf(page)).toBe(url);
    await expect(page.locator('.toolbar-title')).toHaveText('Übersicht – 日本 notes.md');
  });

  test('opens every Markdown extension the browser displays as text', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    for (const [file, heading] of [
      ['formats/a.markdown', 'Format markdown'],
      ['formats/a.mkd', 'Format mkd'],
      ['formats/a.mkdn', 'Format mkdn'],
      ['formats/a.mdown', 'Format mdown'],
      ['formats/a.mdwn', 'Format mdwn'],
      ['Uppercase.MD', 'Uppercase extension'],
    ] as const) {
      const page = await context.newPage();
      await openFile(page, localDocs.url(file));
      await page.waitForURL(/reader\.html\?url=/);
      await expect(readerHeading(page, heading)).toBeVisible();
      await page.close();
    }
  });

  test('leaves HTML, text, and image files where they are', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    for (const file of ['page.html', 'notes.txt', 'image.png']) {
      const page = await context.newPage();
      const url = localDocs.url(file);
      await openFile(page, url);
      await page.waitForTimeout(800);
      expect(page.url()).toBe(url);
      await page.close();
    }
  });

  test('does nothing until the user opts in, and stops after the user opts out', async ({ context, extensionId, localDocs }) => {
    const url = localDocs.url('Guide.md');
    const before = await context.newPage();
    await openFile(before, url);
    await before.waitForTimeout(800);
    expect(before.url()).toBe(url);
    await expect(before.locator('pre')).toContainText('# Local guide');

    await setLocalAutoOpen(context, extensionId, true);
    const enabled = await context.newPage();
    await openFile(enabled, url);
    await enabled.waitForURL(/reader\.html\?url=/);

    await setLocalAutoOpen(context, extensionId, false);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    expect(await options.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toHaveLength(0);
    const after = await context.newPage();
    await openFile(after, url);
    await after.waitForTimeout(800);
    expect(after.url()).toBe(url);
  });

  test('keeps the document through reload and back/forward navigation without a redirect loop', async ({ context, extensionId, localDocs, documentServer }) => {
    await setLocalAutoOpen(context, extensionId, true);
    const page = await context.newPage();
    const start = `${documentServer.origin}/page.md`;
    await page.goto(start);
    await openFile(page, localDocs.url('Guide.md'));
    await page.waitForURL(/reader\.html\?url=/);
    await expect(readerHeading(page, 'Local guide')).toBeVisible();

    await page.reload();
    await expect(readerHeading(page, 'Local guide')).toBeVisible();

    // Back shows the original file, which stays put and offers the reader again.
    await page.goBack();
    await page.waitForURL(localDocs.url('Guide.md'));
    await expect(page.getByText('This Markdown file can be shown in Markdown Reader.')).toBeVisible();
    await page.waitForTimeout(800);
    expect(page.url()).toBe(localDocs.url('Guide.md'));
    await page.goBack();
    await page.waitForURL(start);
    await page.goForward();
    await page.goForward();
    await page.waitForURL(/reader\.html\?url=/);
    await expect(readerHeading(page, 'Local guide')).toBeVisible();
  });

  test('falls back to the handoff copy when the file can no longer be read directly', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    const page = await context.newPage();
    await openFile(page, localDocs.url('Guide.md'));
    await page.waitForURL(/reader\.html\?url=.*&local=/);
    await expect(readerHeading(page, 'Local guide')).toBeVisible();

    await localDocs.remove('Guide.md');
    await page.reload();
    await expect(readerHeading(page, 'Local guide')).toBeVisible();

    await page.close();
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect.poll(async () => Object.keys(await options.evaluate(() => chrome.storage.session.get(null)))
      .filter((key) => key.startsWith('markdownReaderLocalFile:'))).toEqual([]);
  });

  test('keeps working after the service worker is stopped', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    const control = await context.newPage();
    const cdp = await context.newCDPSession(control);
    const statuses = new Map<string, string>();
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      for (const version of versions) if (version.scriptURL.startsWith(`chrome-extension://${extensionId}/`)) statuses.set(version.versionId, version.runningStatus);
    });
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await expect.poll(() => [...statuses.values()]).toContain('stopped');

    const page = await context.newPage();
    await openFile(page, localDocs.url('Guide.md'));
    await page.waitForURL(/reader\.html\?url=.*&local=/);
    await expect(readerHeading(page, 'Local guide')).toBeVisible();
  });

  test('stops when file URL access is turned off and resumes when it is turned back on', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    await setFileUrlAccess(context, extensionId, false);

    const url = localDocs.url('Guide.md');
    const blocked = await context.newPage();
    await openFile(blocked, url);
    await blocked.waitForTimeout(1000);
    expect(blocked.url()).toBe(url);

    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${extensionId}/reader.html?url=${encodeURIComponent(url)}`);
    await expect(reader.getByRole('alert').or(reader.locator('.error-banner'))).toContainText('has not given Markdown Reader access to local files');

    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extensionId}/options.html#files`);
    await expect(settings.locator('.local-file-status')).toHaveAttribute('data-state', 'permission-required');
    const opened = context.waitForEvent('page');
    await settings.getByRole('button', { name: 'Open extension settings' }).click();
    const details = await opened;
    await details.waitForURL(`chrome://extensions/?id=${extensionId}`);
    await details.close();

    await setFileUrlAccess(context, extensionId, true);
    const resumed = await context.newPage();
    await openFile(resumed, url);
    await resumed.waitForURL(/reader\.html\?url=/);
    await expect(readerHeading(resumed, 'Local guide')).toBeVisible();
  });

  test('refuses a direct reader link to a local file while the user has not opted in', async ({ context, extensionId, localDocs }) => {
    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${extensionId}/reader.html?url=${encodeURIComponent(localDocs.url('Guide.md'))}`);
    await expect(reader.getByRole('alert').or(reader.locator('.error-banner'))).toContainText('Automatic opening of local files is off');
    await expect(readerHeading(reader, 'Local guide')).toHaveCount(0);
  });

  test('reports malformed and missing local addresses instead of failing silently', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${extensionId}/reader.html?url=${encodeURIComponent(localDocs.url('missing.md'))}`);
    await expect(reader.getByRole('alert').or(reader.locator('.error-banner'))).toContainText('could not be read');

    await reader.goto(`chrome-extension://${extensionId}/reader.html?url=${encodeURIComponent('file:///not%zz/page.html')}`);
    await expect(reader.getByRole('alert').or(reader.locator('.error-banner'))).toContainText('not a Markdown file');
  });

  test('renders empty and hostile documents safely without network requests', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    const external: string[] = [];
    const errors: string[] = [];
    context.on('request', (request) => {
      const { protocol } = new URL(request.url());
      if (protocol === 'http:' || protocol === 'https:') external.push(request.url());
    });

    const empty = await context.newPage();
    empty.on('pageerror', (error) => errors.push(error.message));
    await openFile(empty, localDocs.url('empty.md'));
    await empty.waitForURL(/reader\.html\?url=/);

    const hostile = await context.newPage();
    hostile.on('pageerror', (error) => errors.push(error.message));
    await openFile(hostile, localDocs.url('hostile.md'));
    await hostile.waitForURL(/reader\.html\?url=/);
    await expect(readerHeading(hostile, 'Hostile document')).toBeVisible();
    await hostile.waitForTimeout(1500);

    expect(await hostile.evaluate(() => (window as unknown as { __markdownReaderPwned?: number }).__markdownReaderPwned)).toBeUndefined();
    expect(await hostile.locator('.markdown-body script, .markdown-body [onerror], .markdown-body a[href^="javascript:"]').count()).toBe(0);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('opens a large local document', async ({ context, extensionId, localDocs }) => {
    await setLocalAutoOpen(context, extensionId, true);
    const page = await context.newPage();
    const started = Date.now();
    await openFile(page, localDocs.url('large.md'));
    await page.waitForURL(/reader\.html\?url=/);
    await expect(readerHeading(page, 'Large document')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Last section' })).toBeAttached({ timeout: 30_000 });
    test.info().annotations.push({ type: 'large-document-ms', description: String(Date.now() - started) });
  });
});
