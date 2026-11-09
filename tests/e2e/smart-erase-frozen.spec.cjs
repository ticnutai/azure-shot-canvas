const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { pngDimensions } = require('../helpers/media.cjs');

// Smart erase on the frozen screen: the tool is on the marks toolbar and on its own key (E); a box drawn with it is
// erased from the frozen picture itself and the saved picture has the right size.
test.describe.serial('smart erase on the frozen screen', () => {
  let app;
  let outputDir;
  let runtimeErrors;

  test.beforeAll(async () => {
    ({ app, outputDir, runtimeErrors } = await launchStudio('smart-erase-frozen'));
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.setPreferences({ regionMarkup: true }));
  });
  test.afterAll(async () => closeStudio(app));

  const overlays = () => app.windows().filter((candidate) => candidate.url().includes('region-overlay.html'));
  const drag = (overlay, from, to) => overlay.evaluate(([a, b]) => {
    const fire = (type, point) => window.dispatchEvent(new PointerEvent(type, { clientX: point.x, clientY: point.y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, pointerId: 1 }));
    fire('pointerdown', a);
    fire('pointermove', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    fire('pointermove', b);
    fire('pointerup', b);
  }, [from, to]);

  test('the erase tool: its key, a box, and a saved picture with the place erased', async () => {
    const before = new Set(await fs.readdir(outputDir));
    const since = Date.now();
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.runAction('region'));
    await expect.poll(() => overlays().length, { timeout: 15_000 }).toBeGreaterThan(0);
    let overlay = null;
    for (const candidate of overlays()) {
      if (await candidate.waitForFunction((after) => Number(document.documentElement.dataset.regionReady || 0) > after, since, { timeout: 15_000 }).then(() => true).catch(() => false)) { overlay = candidate; break; }
    }
    expect(overlay).toBeTruthy();
    const scale = await overlay.evaluate(() => window.devicePixelRatio);
    await drag(overlay, { x: 40, y: 50 }, { x: 340, y: 250 });
    await expect(overlay.locator('#toolbar')).toBeVisible();
    await expect(overlay.locator('button[data-tool="erase"]')).toHaveCount(1);
    await overlay.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', bubbles: true })));
    await expect(overlay.locator('button[data-tool="erase"]')).toHaveAttribute('aria-pressed', 'true');
    await drag(overlay, { x: 90, y: 90 }, { x: 220, y: 160 });
    await expect(overlay.locator('[data-command="undo"]')).toBeEnabled();
    await expect.poll(() => overlay.evaluate(() => document.documentElement.dataset.lastErase || ''), { timeout: 10_000 }).toMatch(/^(solid|lines|smooth)$/);
    await overlay.locator('[data-after="save"]').click();
    let saved = null;
    await expect.poll(async () => { saved = (await fs.readdir(outputDir)).find((name) => name.endsWith('.png') && !before.has(name)); return Boolean(saved); }, { timeout: 20_000 }).toBe(true);
    const size = await pngDimensions(path.join(outputDir, saved));
    expect(size.width).toBe(Math.round(300 * scale));
    expect(size.height).toBe(Math.round(200 * scale));
    expect(runtimeErrors).toEqual([]);
  });
});
