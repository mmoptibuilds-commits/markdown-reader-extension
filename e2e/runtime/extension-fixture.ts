import { createServer, type Server } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';

/** The unpacked test build made by `npm run build:e2e`. */
export const extensionPath = path.resolve('.output-e2e/chrome-mv3');

interface RuntimeFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  documentServer: DocumentServer;
  localDocs: LocalDocs;
}

export interface LocalDocs {
  dir: string;
  /** The browser's file URL for a fixture path, percent-encoded the way the browser encodes it. */
  url(relativePath: string): string;
  remove(relativePath: string): Promise<void>;
}

/** Local fixture files: names with spaces and Unicode, nested folders, and non-Markdown types. */
const localDocuments: Record<string, string | Buffer> = {
  'Guide.md': '# Local guide\n\nRead from a file URL.\n\n## Section two\n',
  'deep/nested folder/Übersicht – 日本 notes.md': '# Übersicht 日本\n\nNested, with spaces and Unicode.\n',
  'formats/a.markdown': '# Format markdown\n',
  'formats/a.mkd': '# Format mkd\n',
  'formats/a.mkdn': '# Format mkdn\n',
  'formats/a.mdown': '# Format mdown\n',
  'formats/a.mdwn': '# Format mdwn\n',
  'Uppercase.MD': '# Uppercase extension\n',
  'page.html': '<!doctype html><title>Local HTML</title><h1>Local HTML page</h1>',
  'notes.txt': '# Text file\n\nNot Markdown by name.\n',
  'image.png': Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex'),
  'empty.md': '',
  'hostile.md': [
    '# Hostile document',
    '',
    '<script>window.__markdownReaderPwned = 1</script>',
    '<img src="x" onerror="window.__markdownReaderPwned = 2">',
    '[click](javascript:window.__markdownReaderPwned=3)',
    '![remote](https://example.invalid/track.png)',
    '',
    '```mermaid',
    'graph TD; A[<img src=x onerror=alert(1)>] --> B',
    '```',
    '',
    '```js',
    'unclosed fence with \u0000 control bytes \u0007',
  ].join('\n'),
};

async function writeLocalDocs(dir: string): Promise<LocalDocs> {
  await rm(dir, { recursive: true, force: true });
  for (const [relativePath, content] of Object.entries(localDocuments)) {
    const target = path.join(dir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  // About 3 MB: large, but under the 4 MB session handoff limit.
  const section = (index: number): string => `## Section ${index}\n\n${'Long reading text with **emphasis**, \`code\`, and a [link](https://example.test). '.repeat(40)}\n\n| a | b |\n| - | - |\n| ${index} | ${index * 2} |\n\n`;
  await writeFile(path.join(dir, 'large.md'), `# Large document\n\n${Array.from({ length: 900 }, (_, index) => section(index)).join('')}## Last section\n\nThe end.\n`);
  return {
    dir,
    url: (relativePath) => pathToFileURL(path.join(dir, relativePath)).href,
    remove: (relativePath) => rm(path.join(dir, relativePath), { force: true }),
  };
}

export interface DocumentServer {
  origin: string;
  close(): Promise<void>;
}

const documents: Record<string, { type: string; body: string }> = {
  '/doc.md': { type: 'text/plain; charset=utf-8', body: '# Runtime document\n\nServed as plain text.\n' },
  '/page.md': { type: 'text/html; charset=utf-8', body: '<!doctype html><html><head><title>HTML at .md</title></head><body><h1>HTML page at a .md path</h1></body></html>' },
  '/notes.md': { type: 'text/markdown; charset=utf-8', body: '# Declared Markdown\n\nServed with a Markdown media type.\n' },
  '/empty.md': { type: 'text/plain; charset=utf-8', body: '' },
};

async function startDocumentServer(): Promise<DocumentServer & { server: Server }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const document = documents[url.pathname];
    if (!document) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': document.type, 'cache-control': 'no-store' });
    response.end(document.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The document server did not bind to a port.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
    close: () => new Promise<void>((resolve, reject) => {
      // Chromium keeps idle keep-alive sockets open, so close them or server.close never finishes.
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

/**
 * Real-extension fixtures: each test gets a fresh persistent profile with the unpacked
 * extension loaded, its service worker, and a loopback document server.
 */
export const test = base.extend<RuntimeFixtures>({
  context: async ({}, use, testInfo) => {
    const profile = path.resolve('test-results', 'profiles', `${testInfo.testId}-${Date.now()}`);
    await mkdir(profile, { recursive: true });
    const chromePath = process.env.MARKDOWN_READER_CHROME_PATH;
    const context = await chromium.launchPersistentContext(profile, {
      headless: true,
      // Branded Chrome 137+ ignores --load-extension. Chromium and Chrome for Testing honor it.
      ...(chromePath ? { executablePath: chromePath } : { channel: 'chromium' }),
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  localDocs: async ({}, use, testInfo) => {
    const docs = await writeLocalDocs(path.resolve('test-results', 'local-docs', `${testInfo.testId}-${Date.now()}`));
    await use(docs);
    await rm(docs.dir, { recursive: true, force: true });
  },
  documentServer: async ({}, use) => {
    const served = await startDocumentServer();
    await use(served);
    await served.close();
  },
});

export const expect = test.expect;

/**
 * Turns Chromium's "Allow access to file URLs" switch on or off through the real
 * chrome://extensions page. Chromium reloads the extension afterwards, which needs
 * developer mode for an unpacked extension. Resolves once the new worker is running.
 */
export async function setFileUrlAccess(context: BrowserContext, extensionId: string, allowed: boolean): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${extensionId}`);
  await page.evaluate(() => new Promise<void>((resolve) => {
    (globalThis as unknown as { chrome: { developerPrivate: { updateProfileConfiguration(config: { inDeveloperMode: boolean }, done: () => void): void } } })
      .chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, resolve);
  }));
  const toggle = page.locator('#allow-on-file-urls');
  await toggle.waitFor();
  if ((await toggle.evaluate((element) => (element as HTMLInputElement).checked)) !== allowed) {
    await toggle.click();
  }
  await page.close();
  const probe = await context.newPage();
  await expectEventually(async () => {
    await probe.goto(`chrome-extension://${extensionId}/options.html`);
    return probe.evaluate(() => chrome.extension.isAllowedFileSchemeAccess());
  }, allowed);
  await probe.close();
}

async function expectEventually<T>(read: () => Promise<T>, expected: T, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (last === expected) return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${String(expected)}; last value: ${String(last)}`);
}
