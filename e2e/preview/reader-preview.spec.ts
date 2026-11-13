import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser, type BrowserContext, type Page, test, expect } from '@playwright/test';

/*
 * The built production pages with mocked extension APIs. Fast checks of UI behaviour,
 * accessibility, and layout. They are not extension runtime coverage; e2e/runtime is.
 */
const origin = 'http://127.0.0.1:4173';
const screenshotDir = path.resolve('test-results', 'screenshots');
const guide = '# Getting Started\n\nFind this sentence and copy the example.\n\n```ts\nconst answer: number = 42;\n```\n\n```mermaid\nflowchart TD\n  Start[Start] --> Read[Read]\n```\n\n```dot\ndigraph G { Start -> Read; }\n```\n\n## Next steps\n\nKeep reading the example.\n\n## Final notes\n\nThe end.';

let browser: Browser;
let context: BrowserContext;

test.describe.configure({ mode: 'serial' });

async function newContext(): Promise<BrowserContext> {
  const created = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await created.addInitScript(() => {
    const listeners = new Set<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>();
    const area = (name: string) => ({
      get: async (keys?: string | string[] | null) => {
        const values = JSON.parse(localStorage.getItem(`reader-preview-${name}`) ?? '{}') as Record<string, unknown>;
        if (typeof keys === 'string') return keys in values ? { [keys]: values[keys] } : {};
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
        return values;
      },
      set: async (items: Record<string, unknown>) => {
        const values = JSON.parse(localStorage.getItem(`reader-preview-${name}`) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(`reader-preview-${name}`, JSON.stringify({ ...values, ...items }));
        const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { oldValue: values[key], newValue: value }]));
        listeners.forEach((listener) => listener(changes, name));
      },
      remove: async (keys: string | string[]) => {
        const values = JSON.parse(localStorage.getItem(`reader-preview-${name}`) ?? '{}') as Record<string, unknown>;
        for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
        localStorage.setItem(`reader-preview-${name}`, JSON.stringify(values));
      },
    });
    const listenerSet = { addListener: () => undefined, removeListener: () => undefined };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://example.test/README.md') {
        return new Response('# Remote guide\n\nFetched from the authorized origin.', { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' } });
      }
      return nativeFetch(input, init);
    };
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          id: 'local-reader-preview',
          getURL: (path: string) => new URL(path, location.origin).href,
          getManifest: () => ({ version: '1.1.0' }),
          // No background worker answers here, so pages use their own settings queue.
          sendMessage: async () => undefined,
          openOptionsPage: async () => { localStorage.setItem('reader-preview-last-created-url', 'options'); },
          onMessage: listenerSet, onInstalled: listenerSet, onStartup: listenerSet,
        },
        storage: { local: area('local'), session: area('session'), onChanged: { addListener: (listener: never) => listeners.add(listener), removeListener: (listener: never) => listeners.delete(listener) } },
        permissions: {
          contains: async () => true,
          request: async (request?: { origins?: string[] }) => { localStorage.setItem('reader-preview-requested-origins', JSON.stringify(request?.origins ?? [])); return true; },
          remove: async () => true,
          onAdded: listenerSet,
          onRemoved: listenerSet,
        },
        extension: { isAllowedFileSchemeAccess: async () => localStorage.getItem('reader-preview-file-access') === 'true' },
        tabs: {
          query: async () => [{ id: 1, url: 'https://docs.example.test/start' }],
          create: async (properties?: { url?: string }) => { if (properties?.url) localStorage.setItem('reader-preview-last-created-url', properties.url); return { id: 2, url: properties?.url }; },
        },
        scripting: { executeScript: async () => [], getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => undefined, registerContentScripts: async () => undefined },
      },
    });
  });
  return created;
}

const axeViolations = async (page: Page, include?: string) => {
  const builder = new AxeBuilder({ page });
  const result = await (include ? builder.include(include) : builder).analyze();
  return result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target.join(' ')) }));
};
const overflows = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

async function openGuide(page: Page): Promise<void> {
  await page.goto(`${origin}/reader.html`);
  await expect(page.getByRole('heading', { name: 'Open a Markdown document' })).toBeVisible();
  await page.locator('input[type="file"][accept*=".md"]').setInputFiles({ name: 'Guide.md', mimeType: 'text/markdown', buffer: Buffer.from(guide) });
  await expect(page.getByRole('heading', { level: 1, name: 'Getting Started' })).toBeVisible();
}

test.beforeAll(async () => {
  const chromePath = process.env.MARKDOWN_READER_CHROME_PATH;
  browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
  await mkdir(screenshotDir, { recursive: true });
  context = await newContext();
});

test.afterAll(async () => {
  await context?.close();
  await browser?.close();
});

test('renders a local document with outline, diagrams, search, and views', async () => {
  const page = await context.newPage();
  await openGuide(page);
  await expect(page.getByRole('navigation', { name: 'Table of contents' })).toContainText('Next steps');
  await page.locator('[data-diagram="mermaid"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-diagram="mermaid"] svg')).toBeAttached();
  await page.locator('[data-diagram="graphviz"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-diagram="graphviz"] svg')).toBeAttached();
  await expect.poll(() => page.locator('[data-diagram="mermaid"] svg').evaluate((svg) => svg.getBoundingClientRect().width)).toBeGreaterThan(0);
  await page.screenshot({ path: path.resolve(screenshotDir, 'reader-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Search this document' }).click();
  const search = page.getByRole('searchbox', { name: 'Find in this document' });
  // Typed one character at a time: matches must still be found.
  await search.pressSequentially('example');
  await expect(page.locator('#search-count')).toHaveText('1 of 2');
  await search.press('Enter');
  await expect(page.locator('#search-count')).toHaveText('2 of 2');
  await search.press('Shift+Enter');
  await expect(page.locator('#search-count')).toHaveText('1 of 2');
  await search.press('Escape');
  await expect(search).toBeHidden();

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.raw-source')).toContainText('const answer: number = 42;');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.raw-source')).toBeVisible();
  await expect(page.locator('.markdown-body')).toBeVisible();
  await page.getByRole('button', { name: 'Read', exact: true }).click();

  const wrap = page.locator('[data-action="wrap-code"]').first();
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Collapse', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Expand', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Focus mode' }).click();
  await expect(page.locator('.reader-toolbar')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader-toolbar')).toBeVisible();
  await page.close();
});

test('command palette is a keyboard-operable listbox', async () => {
  const page = await context.newPage();
  await openGuide(page);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Commands' });
  await expect(dialog).toBeVisible();
  const input = page.getByRole('combobox', { name: 'Search commands' });
  await expect(input).toBeFocused();
  const selected = () => page.locator('[role="option"][aria-selected="true"]');
  await expect(selected()).toHaveCount(1);
  await expect(selected()).toHaveText('Open file…');
  await input.press('ArrowDown');
  await expect(selected()).toHaveText('Open folder…');
  await input.press('End');
  await expect(selected()).toHaveText('Settings');
  await input.press('ArrowDown');
  await expect(selected()).toHaveText('Open file…');
  await input.press('ArrowUp');
  await expect(selected()).toHaveText('Settings');
  await input.press('Home');
  await expect(selected()).toHaveText('Open file…');
  await expect(input).toHaveAttribute('aria-activedescendant', (await selected().getAttribute('id')) ?? '');

  await input.fill('zzz');
  await expect(page.locator('[role="option"]')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText('No commands match');
  await input.fill('source');
  await expect(selected()).toHaveText('Source view');
  await input.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.raw-source')).toBeVisible();

  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Commands' })).not.toBeFocused();
  await page.close();
});

test('leaves browser shortcuts alone and honours the letter-shortcut preference', async () => {
  const page = await context.newPage();
  await openGuide(page);
  const prevented = (key: string) => page.evaluate((combo) => new Promise<boolean>((resolve) => {
    window.addEventListener('keydown', (event) => setTimeout(() => resolve(event.defaultPrevented), 0), { once: true });
    const [modifier, name] = combo.split('+') as [string, string];
    window.dispatchEvent(new KeyboardEvent('keydown', { key: name, ctrlKey: modifier === 'Control', bubbles: true, cancelable: true }));
  }), key);
  for (const combo of ['Control+f', 'Control+o', 'Control+=', 'Control+-', 'Control+0', 'Control+p']) expect(await prevented(combo), combo).toBe(false);

  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const before = await theme();
  await page.locator('body').press('t');
  await expect.poll(theme).not.toBe(before);

  await page.evaluate(async () => {
    const stored = JSON.parse(localStorage.getItem('reader-preview-local') ?? '{}') as { markdownReaderSettings?: Record<string, unknown> };
    await (window as unknown as { chrome: { storage: { local: { set(items: unknown): Promise<void> } } } }).chrome.storage.local.set({ markdownReaderSettings: { ...stored.markdownReaderSettings, singleKeyShortcuts: false } });
  });
  const current = await theme();
  await page.locator('body').press('t');
  await page.waitForTimeout(300);
  expect(await theme()).toBe(current);
  await page.locator('body').press('f');
  await expect(page.locator('.reader-toolbar')).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('reader-preview-local'));
  await page.close();
});

test('System follows the device appearance, including live changes', async () => {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${origin}/reader.html`);
  await page.evaluate(() => (window as unknown as { chrome: { storage: { local: { set(items: unknown): Promise<void> } } } }).chrome.storage.local.set({ markdownReaderSettings: { theme: 'system' } }));
  await page.reload();
  const appearance = () => page.evaluate(() => [document.documentElement.dataset.appearance, getComputedStyle(document.body).backgroundColor]);
  await expect.poll(appearance).toEqual(['light', 'rgb(255, 255, 255)']);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(appearance).toEqual(['dark', 'rgb(29, 33, 30)']);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(appearance).toEqual(['light', 'rgb(255, 255, 255)']);
  await page.evaluate(() => localStorage.removeItem('reader-preview-local'));
  await page.close();
});

test('opens a folder, filters it, and follows relative links', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/reader.html`);
  await page.evaluate((documents) => {
    const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]');
    if (!input) throw new Error('Folder input was not found.');
    const transfer = new DataTransfer();
    for (const item of documents) {
      const file = new File([item.text], item.path.split('/').at(-1) ?? item.path, { type: 'text/markdown' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `notes/${item.path}` });
      transfer.items.add(file);
    }
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [
    { path: 'README.md', text: '# Folder guide\n\n[Read next](docs/Next.md)' },
    { path: 'docs/Next.md', text: '# Next section\n\nThe folder-relative link worked.' },
    { path: 'guide/Next.md', text: '# Other next\n\nSame file name, different folder.' },
    { path: 'image.png', text: 'not a Markdown file' },
  ]);
  await expect(page.getByRole('heading', { level: 1, name: 'Folder guide' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'README.md' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Next.md' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'image.png' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Filter files' }).fill('guide/');
  await expect(page.getByRole('button', { name: 'Next.md' })).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Filter files' }).fill('');
  await page.getByRole('link', { name: 'Read next' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Next section' })).toBeVisible();

  // Sidebar tabs follow the tab pattern: arrow keys move and select.
  await page.getByRole('tab', { name: 'Files' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Bookmarks/u })).toBeFocused();
  await expect(page.getByRole('tab', { name: /Bookmarks/u })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true');
  await page.close();
});

test('bookmarks the current section and removes it from the list', async () => {
  const page = await context.newPage();
  await openGuide(page);
  const bookmark = page.getByRole('button', { name: /^Bookmark this section/u });
  await bookmark.click();
  await expect(bookmark).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: /Bookmarks/u }).click();
  await expect(page.locator('.bookmark-row')).toContainText('Getting Started');
  await page.getByRole('button', { name: 'Remove bookmark Getting Started' }).click();
  await expect(page.getByText('Bookmark the section you are reading')).toBeVisible();
  await expect(bookmark).toHaveAttribute('aria-pressed', 'false');
  await page.close();
});

test('opens an online document after a single-site permission request', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/reader.html`);
  await page.getByLabel('Online document', { exact: true }).fill('https://example.test/README.md');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Remote guide' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('reader-preview-requested-origins'))).toBe('["https://example.test/*"]');
  await page.close();
});

test('reader passes axe checks and does not overflow at any tested width', async () => {
  const page = await context.newPage();
  await openGuide(page);
  for (const width of [320, 360, 390, 590, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 600 ? 800 : 900 });
    expect(await overflows(page), `${width}px`).toBe(false);
    await page.screenshot({ path: path.resolve(screenshotDir, `reader-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Show navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Table of contents' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: 'Reading settings: theme and text' }).click();
  await expect(page.locator('.reading-panel')).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.close();
});

test('settings create, edit, and delete custom themes without losing others', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/options.html`);
  await expect(page.getByRole('heading', { level: 2, name: 'Appearance & reading' })).toBeVisible();

  const create = async (name: string, background: string, text: string, accent: string) => {
    await page.getByRole('button', { name: 'New theme' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Background', { exact: true }).fill(background);
    await page.getByLabel('Text', { exact: true }).fill(text);
    await page.getByLabel('Links and accents', { exact: true }).fill(accent);
    await page.getByRole('button', { name: 'Create theme' }).click();
    await expect(page.getByText(`Created and applied “${name}”.`)).toBeVisible();
  };
  await create('Night notes', '#101418', '#e8edf2', '#7cc4e0');
  await create('Morning', '#fbf8f1', '#1f2420', '#2f6247');
  await expect(page.locator('.custom-theme-list li')).toHaveCount(2);
  await expect(page.getByRole('radio', { name: /Morning/u })).toBeChecked();

  // Invalid colours are refused before saving.
  await page.getByRole('button', { name: 'New theme' }).click();
  await page.getByLabel('Name').fill('Broken');
  await page.getByLabel('Background', { exact: true }).fill('#12345');
  await expect(page.getByText('Use #rgb or #rrggbb')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create theme' })).toBeDisabled();
  // Unreadable contrast needs explicit confirmation.
  await page.getByLabel('Background', { exact: true }).fill('#ffffff');
  await page.getByLabel('Text', { exact: true }).fill('#eeeeee');
  await expect(page.getByRole('alert').filter({ hasText: 'Text contrast is' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create theme' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Edit Night notes' }).click();
  await page.getByLabel('Name').fill('Night reading');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('radio', { name: /Night reading/u })).toBeAttached();
  await expect(page.locator('.custom-theme-list li')).toHaveCount(2);

  await page.getByRole('button', { name: 'Delete Morning' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete theme' }).click();
  await expect(page.locator('.custom-theme-list li')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Paper Warm off-white with green ink' })).toBeChecked();

  await page.reload();
  await expect(page.locator('.custom-theme-list li')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /Night reading/u })).toBeAttached();

  // The popup lists and applies custom themes too.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 700 });
  await popup.goto(`${origin}/popup.html`);
  await popup.getByRole('radio', { name: /Night reading/u }).check({ force: true });
  await expect.poll(() => popup.evaluate(() => document.documentElement.dataset.appearance)).toBe('dark');
  await popup.close();
  // Each mocked page has its own change listeners; cross-page updates are covered by the runtime suite.
  await page.reload();
  await expect(page.getByRole('radio', { name: /Night reading/u })).toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.appearance)).toBe('dark');
  await page.evaluate(() => localStorage.removeItem('reader-preview-local'));
  await page.close();
});

test('settings explain local automatic opening states and link to browser settings', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/options.html#files`);
  const toggle = page.getByRole('switch', { name: /Open local Markdown files automatically/u });
  const status = page.locator('.local-file-status');
  await expect(toggle).not.toBeChecked();
  await expect(status).toHaveAttribute('data-state', 'disabled');

  await toggle.check();
  await expect(status).toHaveAttribute('data-state', 'permission-required');
  await expect(status).toContainText('Allow access to file URLs');
  await page.getByRole('button', { name: 'Open extension settings' }).click();
  expect(await page.evaluate(() => localStorage.getItem('reader-preview-last-created-url'))).toBe('chrome://extensions/?id=local-reader-preview');

  await page.evaluate(() => { localStorage.setItem('reader-preview-file-access', 'true'); window.dispatchEvent(new Event('focus')); });
  await expect(status).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('button', { name: 'Open extension settings' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('switch', { name: /Open local Markdown files automatically/u })).toBeChecked();
  await page.evaluate(() => { localStorage.removeItem('reader-preview-file-access'); localStorage.removeItem('reader-preview-local'); });
  await page.close();
});

test('settings pass axe checks and fit small windows, including an embedded 590 × 425 view', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/options.html`);
  await expect(page.getByRole('heading', { level: 2, name: 'Appearance & reading' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  for (const [width, height] of [[590, 425], [360, 780], [320, 640], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    expect(await overflows(page), `${width}px`).toBe(false);
    await page.screenshot({ path: path.resolve(screenshotDir, `settings-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 590, height: 425 });
  // The section navigation stays reachable and the first setting is visible without scrolling.
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.theme-option').first()).toBeInViewport();
  await page.close();
});

test('popup passes axe checks and requests one site for an address', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`${origin}/popup.html`);
  await expect(page.getByRole('heading', { name: 'Markdown Reader' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  expect(await overflows(page)).toBe(false);
  await page.screenshot({ path: path.resolve(screenshotDir, 'popup.png'), fullPage: true });
  await page.getByLabel('Online Markdown document').fill('https://example.test/README.md');
  await page.getByRole('button', { name: 'Open address' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('reader-preview-requested-origins'))).toBe('["https://example.test/*"]');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('reader-preview-last-created-url'))).toContain('/reader.html?url=');
  await expect(page.getByRole('switch', { name: /Open Markdown links in the reader/u })).toHaveAttribute('aria-checked', 'false');
  await page.close();
});

test('the popup refuses a file over the shared 16 MB limit without reading it', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`${origin}/popup.html`);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('File input missing.');
    const file = new File(['x'], 'huge.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'size', { value: 16_000_001 });
    Object.defineProperty(file, 'text', { value: () => { (window as unknown as { readHuge: boolean }).readHuge = true; return Promise.resolve('x'); } });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('status')).toContainText('larger than the 16 MB reading limit');
  expect(await page.evaluate(() => (window as unknown as { readHuge?: boolean }).readHuge)).toBeUndefined();
  await page.close();
});
