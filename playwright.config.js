// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,   // one retry in CI only; a test that needs more is a defect
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 15_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 5_000,
  },
  projects: [
    { name: 'api', testMatch: /api\/.*\.spec\.js/ },
    { name: 'ui', testMatch: /ui\/.*\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node app/server.js',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
