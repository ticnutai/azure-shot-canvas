const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { regionOverlay } = require('../helpers/region.cjs');
const { pngDimensions } = require('../helpers/media.cjs');

// Choosing an area by numbers: the marks toolbar has width, height and place fields in real pixels.
//   1  the fields show the chosen area's real size and place
//   2  typing a size (Enter) changes the area, and the saved picture has exactly that size
//   3  a size larger than the screen is held to the screen; the magnifier is there while choosing
test.describe.serial('region capture: exact size by numbers', () => {
  let app;
  let page;
  let outputDir;
  let overlay;
  let scale;

  test.beforeAll(async () => {
    ({ app, page, outputDir } = await launchStudio('region-dims'));
    scale = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.setPreferences({ regionMarkup: true }));
  });
  test.afterAll(async () => closeStudio(app));

  const dims = () => overlay.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-dim]')].map((input) => [input.dataset.dim, Number(input.value)])));

  test('1 · the fields show the chosen area\'s real size and place', async () => {
    const region = regionOverlay(app);
    const since = Date.now();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('index.html')).webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PrintScreen', modifiers: [] }));
    overlay = await region.opened(since);
    // The magnifier follows the pointer while the area is being chosen.
    await overlay.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 70, bubbles: true })));
    await expect(overlay.locator('#loupe')).toBeVisible();
    await region.drag(overlay, { x: 40, y: 50 }, { x: 240, y: 150 });
    await expect(overlay.locator('#toolbar')).toBeVisible();
    expect(await dims()).toEqual({ width: Math.round(200 * scale), height: Math.round(100 * scale), x: Math.round(40 * scale), y: Math.round(50 * scale) });
  });

  test('2 · typing a size (Enter) changes the area, and the saved picture has exactly that size', async () => {
    const width = overlay.locator('[data-dim="width"]');
    await width.fill('321');
    await width.press('Enter');
    const height = overlay.locator('[data-dim="height"]');
    await height.fill('123');
    await height.press('Enter');
    await expect(overlay.locator('html')).toHaveAttribute('data-region-dims', '321x123');
    const before = new Set(await fs.readdir(outputDir));
    await overlay.locator('[data-after="save"]').click();
    let saved = null;
    for (const deadline = Date.now() + 20_000; !saved && Date.now() < deadline; await new Promise((resolve) => setTimeout(resolve, 100))) {
      saved = (await fs.readdir(outputDir)).find((name) => name.endsWith('.png') && !before.has(name)) || null;
    }
    expect(saved).not.toBeNull();
    expect(await pngDimensions(path.join(outputDir, saved))).toMatchObject({ width: 321, height: 123 });
  });

  test('3 · a size larger than the screen is held to the screen', async () => {
    const region = regionOverlay(app);
    const since = Date.now();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('index.html')).webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PrintScreen', modifiers: [] }));
    overlay = await region.opened(since);
    await region.drag(overlay, { x: 40, y: 50 }, { x: 240, y: 150 });
    const screenSize = await overlay.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const width = overlay.locator('[data-dim="width"]');
    await width.fill('99999');
    await width.press('Enter');
    const after = await dims();
    expect(after.width).toBe(Math.round(screenSize.width * scale));
    expect(after.x).toBe(0);
    await overlay.keyboard.press('Escape');
  });
});
