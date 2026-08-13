const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['./tests/reporters/scientific-reporter.cjs']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
});
