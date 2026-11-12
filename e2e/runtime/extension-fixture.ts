import { createServer, type Server } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';

/** The unpacked test build made by `npm run build:e2e`. */
export const extensionPath = path.resolve('.output-e2e/chrome-mv3');

interface RuntimeFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  documentServer: DocumentServer;
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
  documentServer: async ({}, use) => {
    const served = await startDocumentServer();
    await use(served);
    await served.close();
  },
});

export const expect = test.expect;
