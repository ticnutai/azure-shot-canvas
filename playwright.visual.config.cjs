// Pixel-exact visual regression set: every screen × several looks, compared against a stored baseline.
// Baseline:  npx playwright test -c playwright.visual.config.cjs --update-snapshots
// Compare:   npx playwright test -c playwright.visual.config.cjs
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/visual',
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__baseline__/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: 'disabled', caret: 'hide' } }
});
