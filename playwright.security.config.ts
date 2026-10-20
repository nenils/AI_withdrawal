import { defineConfig, devices } from '@playwright/test';
process.env.WITHDRAWAL_SECURITY_TESTS = '1';

export default defineConfig({
  testDir: './tests',
  testMatch: 'withdrawal-security.spec.ts',
  timeout: 60000,
  workers: 1,
  reporter: 'line',
  webServer: {
    command: `${process.execPath} node_modules/vite/bin/vite.js --host=127.0.0.1 --port=8185`,
    url: 'http://127.0.0.1:8185',
    env: { ...process.env, VITE_STORAGE_ENGINE: 'supabase', VITE_SUPABASE_URL: 'https://test.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-publishable-key' },
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:8185' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
