import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'npx vite preview --outDir .output/chrome-mv3 --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/reader.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
