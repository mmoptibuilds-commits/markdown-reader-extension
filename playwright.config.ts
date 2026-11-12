import { defineConfig } from '@playwright/test';

// Set MARKDOWN_READER_CHROME_PATH to a Chrome or Chromium binary when Playwright's
// bundled browser is not installed (for example, a sandbox with a pinned browser).
const executablePath = process.env.MARKDOWN_READER_CHROME_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  projects: [
    {
      // Mocked browser APIs on the built production pages. Fast; not an extension runtime.
      name: 'preview',
      testDir: './e2e/preview',
      use: { browserName: 'chromium', headless: true, ...(executablePath ? { launchOptions: { executablePath } } : {}), trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    },
    {
      // The real unpacked E2E build, loaded into a persistent Chromium profile.
      name: 'extension-runtime',
      testDir: './e2e/runtime',
      use: { browserName: 'chromium', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    },
  ],
  webServer: {
    command: 'npx vite preview --outDir .output/chrome-mv3 --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/reader.html',
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
  },
});
