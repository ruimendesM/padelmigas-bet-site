import { defineConfig, devices } from '@playwright/test';

/**
 * Two flows only, one viewport (ADR-009): broad E2E coverage is slow, flaky, and worse than unit
 * tests at the permutation edge cases. The viewport is a phone because that is how the club votes.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-PT',
    timezoneId: 'Europe/Lisbon',
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
  // Spread rather than assign `undefined`: `exactOptionalPropertyTypes` treats an explicit
  // `undefined` as a different thing from an absent key, and Playwright's type says absent.
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
