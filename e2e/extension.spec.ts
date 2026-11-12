import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser, type BrowserContext, type Page, test, expect } from '@playwright/test';

let browser: Browser;
let context: BrowserContext;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  await mkdir(path.resolve('screenshots'), { recursive: true });
  context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  await context.addInitScript(() => {
    const area = (name: string) => ({
      get: async (keys?: string | string[]) => {
        const values = JSON.parse(localStorage.getItem(`reader-preview-${name}`) ?? '{}') as Record<string, unknown>;
        if (typeof keys === 'string') return { [keys]: values[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, values[key]]));
        return values;
      },
      set: async (items: Record<string, unknown>) => {
        const values = JSON.parse(localStorage.getItem(`reader-preview-${name}`) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(`reader-preview-${name}`, JSON.stringify({ ...values, ...items }));
      },
      remove: async (keys: string | string[]) => {
        const values = JSON.parse(localStorage.getItem(`reader-preview-${name}`) ?? '{}') as Record<string, unknown>;
        for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
        localStorage.setItem(`reader-preview-${name}`, JSON.stringify(values));
      },
    });
    const listenerSet = { addListener: (_listener: unknown) => undefined };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://example.test/README.md') {
        return new Response('# Remote guide\n\nFetched from the authorized origin.', {
          status: 200,
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        });
      }
      return nativeFetch(input, init);
    };
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: { id: 'local-reader-preview', getURL: (path: string) => new URL(path, location.origin).href, sendMessage: async () => undefined, onMessage: listenerSet, onInstalled: listenerSet, onStartup: listenerSet },
        storage: { local: area('local'), session: area('session') },
        permissions: {
          contains: async () => true,
          request: async (request?: { origins?: string[] }) => {
            localStorage.setItem('reader-preview-requested-origins', JSON.stringify(request?.origins ?? []));
            return true;
          },
          remove: async () => true,
          onRemoved: listenerSet,
        },
        tabs: {
          query: async () => [{ id: 1, url: location.href }],
          create: async (properties?: { url?: string }) => {
            if (properties?.url) localStorage.setItem('reader-preview-last-created-url', properties.url);
            return { id: 2, url: properties?.url };
          },
        },
        scripting: { executeScript: async () => [], getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => undefined, registerContentScripts: async () => undefined },
      },
    });
  });
  page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/reader.html');
  await expect(page.getByRole('heading', { name: 'Make room to read.' })).toBeVisible();
});

test.afterAll(async () => {
  await context?.close();
  await browser?.close();
});

test('opens a local Markdown file and uses reading controls', async () => {
  await page.locator('input[type="file"][accept*=".md"]').setInputFiles({
    name: 'Guide.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Getting Started\n\nFind this sentence and copy the example.\n\n```ts\nconst answer: number = 42;\n```\n\n```mermaid\nflowchart TD\n  Start[Start] --> Read[Read]\n```\n\n```dot\ndigraph G { Start -> Read; }\n```\n\n## Next steps\n\nKeep reading.'),
  });
  await expect(page.getByRole('heading', { name: 'Getting Started' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next steps' })).toBeVisible();
  await expect(page.locator('.outline-nav')).toContainText('Getting Started');
  await expect(page.locator('[data-diagram="mermaid"] svg')).toBeAttached();
  await expect(page.locator('[data-diagram="graphviz"] svg')).toBeAttached();
  await expect(page.locator('[data-diagram="mermaid"] svg')).toHaveAttribute('viewBox', /.+/u);
  await expect(page.locator('[data-diagram="mermaid"] svg path[d]').first()).toHaveAttribute('d', /M/u);
  await expect(page.locator('[data-diagram="graphviz"] svg')).toHaveAttribute('viewBox', /.+/u);
  await expect(page.locator('[data-diagram="graphviz"] svg path[d]').first()).toHaveAttribute('d', /M/u);
  await expect.poll(() => page.locator('[data-diagram="mermaid"] svg').evaluate((svg) => svg.getBoundingClientRect().width)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('[data-diagram="graphviz"] svg').evaluate((svg) => svg.getBoundingClientRect().height)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('[data-diagram="mermaid"] svg rect.basic').first().evaluate((rect) => rect.getBoundingClientRect().width)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({
    path: path.resolve('screenshots/reader-desktop.png'),
    fullPage: true,
    style: '.reader-bottom-controls { display: none !important; }',
  });

  await page.getByRole('button', { name: 'Search this document' }).click();
  const search = page.getByRole('searchbox', { name: 'Find in this document' });
  await search.fill('copy the example');
  await expect(page.locator('mark.search-hit')).toHaveText('copy the example');

  await page.getByRole('button', { name: 'Close search' }).click();
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await expect(page.getByRole('dialog', { name: 'Jump to an action' })).toBeVisible();
  await page.getByRole('option', { name: 'Toggle raw source / rendered view' }).click();
  await expect(page.getByRole('dialog', { name: 'Jump to an action' })).toBeHidden();

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.raw-source')).toContainText('const answer: number = 42;');
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByRole('button', { name: 'Wrap', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Unwrap' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Expand', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Enter focus mode' }).click();
  await expect(page.getByRole('button', { name: 'Leave focus mode' })).toBeVisible();
  await expect(page.locator('.reader-sidebar')).toHaveCSS('visibility', 'hidden');
  await page.getByRole('button', { name: 'Leave focus mode' }).click();

  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.getByRole('option', { name: 'Open Markdown URL' }).click();
  await expect(page.getByRole('dialog', { name: 'Open a Markdown URL' })).toBeVisible();
  await page.getByLabel('Document address').fill('https://example.test/README.md');
  await page.getByRole('button', { name: 'Request access & open' }).click();
  await expect(page.getByRole('heading', { name: 'Remote guide' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('reader-preview-requested-origins'))).toBe('["https://example.test/*"]');
});

test('keeps the reader usable on a narrow viewport and passes axe checks', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('input[type="file"][accept*=".md"]').setInputFiles({
    name: 'Guide.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Getting Started\n\nA document that remains readable at every tested width.'),
  });
  await expect(page.getByRole('heading', { name: 'Getting Started' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Table of contents' })).toBeHidden();
  await page.screenshot({ path: path.resolve('screenshots/reader-mobile.png'), fullPage: true });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Table of contents' })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target.join(' ')) }))).toEqual([]);
  await page.getByRole('button', { name: 'Close navigation' }).click();

  for (const viewport of [
    { width: 768, height: 1024, screenshot: 'reader-tablet.png' },
    { width: 1920, height: 1080, screenshot: 'reader-wide-desktop.png' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasOverflow, `${viewport.width} × ${viewport.height} should not overflow horizontally`).toBe(false);
    await page.screenshot({ path: path.resolve(`screenshots/${viewport.screenshot}`), fullPage: true });
  }
});

test('opens a folder workspace, filters to Markdown files, and follows relative links', async () => {
  const folderPage = await context.newPage();
  await folderPage.goto('http://127.0.0.1:4173/reader.html');
  await folderPage.evaluate((documents) => {
    const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]');
    if (!input) throw new Error('Folder input was not found.');
    const transfer = new DataTransfer();
    for (const document of documents) {
      const file = new File([document.text], document.path.split('/').at(-1) ?? document.path, { type: 'text/markdown' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `notes/${document.path}` });
      transfer.items.add(file);
    }
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [
    { path: 'README.md', text: '# Folder guide\n\n[Read next](docs/Next.md)' },
    { path: 'docs/Next.md', text: '# Next section\n\nThe folder-relative link worked.' },
    { path: 'image.png', text: 'not a Markdown file' },
  ]);
  await expect(folderPage.getByRole('heading', { name: 'Folder guide' })).toBeVisible();
  await expect(folderPage.getByRole('button', { name: 'README.md' })).toBeVisible();
  await expect(folderPage.getByRole('button', { name: 'image.png' })).toHaveCount(0);
  await folderPage.getByRole('link', { name: 'Read next' }).click();
  await expect(folderPage.getByRole('heading', { name: 'Next section' })).toBeVisible();
  await folderPage.close();
});

test('settings save and persist a local theme preference', async () => {
  const settingsPage = await context.newPage();
  await settingsPage.goto('http://127.0.0.1:4173/options.html');
  await expect(settingsPage.getByRole('heading', { name: 'Make reading yours.' })).toBeVisible();
  await settingsPage.locator('#appearance select').selectOption('sepia');
  await expect(settingsPage.locator('.settings-status')).toContainText('Saved on this device.');
  await settingsPage.screenshot({ path: path.resolve('screenshots/settings-desktop.png'), fullPage: true });
  await settingsPage.setViewportSize({ width: 390, height: 844 });
  const settingsOverflow = await settingsPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(settingsOverflow).toBe(false);
  const settingsAccessibility = await new AxeBuilder({ page: settingsPage }).analyze();
  expect(settingsAccessibility.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target.join(' ')) }))).toEqual([]);
  await settingsPage.screenshot({ path: path.resolve('screenshots/settings-mobile.png'), fullPage: true });
  await settingsPage.reload();
  await expect(settingsPage.locator('#appearance select')).toHaveValue('sepia');
  await settingsPage.close();
});

test('popup requests a single site and opens the reader URL', async () => {
  const popupPage = await context.newPage();
  await popupPage.setViewportSize({ width: 380, height: 680 });
  await popupPage.goto('http://127.0.0.1:4173/popup.html');
  await expect(popupPage.getByText('Markdown Reader', { exact: true })).toBeVisible();
  const popupAccessibility = await new AxeBuilder({ page: popupPage }).analyze();
  expect(popupAccessibility.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target.join(' ')) }))).toEqual([]);
  await popupPage.screenshot({ path: path.resolve('screenshots/popup.png'), fullPage: true });

  await popupPage.getByLabel('Open an online Markdown URL').fill('https://example.test/README.md');
  await popupPage.getByRole('button', { name: 'Open URL' }).click();
  await expect.poll(() => popupPage.evaluate(() => localStorage.getItem('reader-preview-requested-origins'))).toBe('["https://example.test/*"]');
  await expect.poll(() => popupPage.evaluate(() => localStorage.getItem('reader-preview-last-created-url'))).toContain('/reader.html?url=');
  await popupPage.close();
});
