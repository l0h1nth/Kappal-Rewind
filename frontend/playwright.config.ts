import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    browserName: 'firefox',
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH ? {
      executablePath: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH,
    } : {},
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
