import { defineConfig } from '@playwright/test';

/**
 * E2E runs the built extension in a real Chromium profile. An MV3 extension
 * cannot be loaded in headless mode with a persistent service worker, so these
 * always run headed.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:5599',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx --yes http-server tests/fixtures -p 5599 --silent',
    url: 'http://127.0.0.1:5599/mock-survey.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
