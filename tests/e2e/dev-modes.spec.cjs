const { test, expect, chromium, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startDevServer } = require('../../scripts/dev-server-lib.cjs');
const { metric } = require('../helpers/metrics.cjs');

test.describe('Development launch modes', () => {
  let server;
  test.beforeAll(async () => { server = await startDevServer(); });
  test.afterAll(async () => { if (!server.reused) await server.close(); });

  test('localhost-only loads browser fallback and performs real live reload', async ({}, testInfo) => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ locale: 'he-IL' });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(server.url);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      await expect(page.locator('html')).toHaveAttribute('data-live-reload', 'connected');
      expect(await page.evaluate(() => window.screenStudio.browserMode)).toBe(true);
      await expect(page.locator('.source-card')).toHaveCount(1);
      await page.evaluate(() => { window.__liveReloadSentinel = 'before-change'; });
      const probePath = path.resolve('src/dev-reload-probe.txt');
      const original = await fs.readFile(probePath, 'utf8');
      try {
        const navigated = page.waitForEvent('framenavigated');
        await fs.writeFile(probePath, `${original.trim()}\n${Date.now()}\n`);
        await navigated;
        await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true' && window.__liveReloadSentinel !== 'before-change');
      } finally { await fs.writeFile(probePath, original); }
      expect(errors).toEqual([]);
      await testInfo.attach('metrics', { body: Buffer.from(JSON.stringify([
        metric('Localhost browser mode ready', 1, 'mode', 1, 'min', `${server.url}, browser fallback API`),
        metric('Live reload file-change cycle', 1, 'reload', 1, 'min', 'filesystem watcher -> SSE -> navigation')
      ])), contentType: 'application/json' });
    } finally { await browser.close(); }
  });

  test('Electron development mode loads the healthy localhost with preload API', async ({}, testInfo) => {
    const app = await electron.launch({
      args: ['.'], cwd: path.resolve('.'),
      env: { ...process.env, SCREEN_STUDIO_DEV_URL: server.url, SCREEN_STUDIO_QA: '1' }
    });
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      expect(page.url()).toBe(`${server.url}/`);
      expect(await page.evaluate(() => window.screenStudio.browserMode)).toBe(false);
      await expect(page.locator('html')).toHaveAttribute('data-live-reload', 'connected');
      await testInfo.attach('metrics', { body: Buffer.from(JSON.stringify([
        metric('Electron localhost preload bridge', 1, 'mode', 1, 'min', `${server.url}, Electron IPC API retained`)
      ])), contentType: 'application/json' });
    } finally { await app.close(); }
  });
});
