import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  webServer: {
    command: `${process.execPath} node_modules/vite/bin/vite.js --host=127.0.0.1 --port=8080`,
    url: 'http://127.0.0.1:8080',
    env: { ...process.env, VITE_STORAGE_ENGINE: 'localStorage' },
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  testDir: './tests',
  fullyParallel: true,
  // Retry on CI only.
  retries: process.env.CI ? 2 : 0,
  // Opt out of parallel tests on CI.
  workers: process.env.CI ? 1 : undefined,
  timeout: 180000,
  reporter: 'html',

  use: {
    baseURL: 'http://127.0.0.1:8080',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
