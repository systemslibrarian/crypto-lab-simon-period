import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/crypto-lab-simon-period/',
  test: {
    // Keep the Playwright accessibility specs out of the Vitest run — they are
    // driven by `npm run test:a11y`, not by the unit suite.
    include: ['src/**/*.test.ts'],
  },
});
