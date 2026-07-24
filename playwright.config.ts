import { defineConfig, devices } from '@playwright/test';

if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
  throw new Error('Recovery Supabase environment variables are required for acceptance tests.');
}

export default defineConfig({
  testDir: './tests/acceptance',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4178',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm.cmd run dev -- --host 127.0.0.1 --port 4178',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    },
  },
  projects: [
    {
      name: 'iphone-emulation',
      use: {
        ...devices['iPhone 13'],
      },
    },
    {
      name: 'android-emulation',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
});
