import { defineConfig, devices } from '@playwright/test';

// 4278: unused by any sibling lab (the fleet holds 4276 and 4280 either side).
// Never 4173 — with 170+ labs checked out side by side, the Vite default means
// `reuseExistingServer` can silently scan a different lab's preview.
const PORT = 4278;
const BASE = '/crypto-lab-simon-period/';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  // The sweep drives every exhibit — including full Simon runs against four
  // targets and a measured classical-vs-quantum query race — and scans a dozen
  // states per theme.
  timeout: 240_000,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    colorScheme: 'dark',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build first: `preview` only serves whatever is already in dist/. Without
    // the build in front, a failing compile leaves the last good bundle on disk
    // and the suite passes green against source that no longer compiles —
    // which silently invalidates mutation checking.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
