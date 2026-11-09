const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The floating panel (the classic look, on the left edge):
//   1  the pictures button shows the recent captures in place of the buttons, and the same button brings them back
//   2  a click on a picture copies it to the clipboard at once
//   3  handles on the three free sides (none against the edge): a drag makes the panel bigger, it is kept for this
//      view, and a double click brings back the usual size
test.describe.serial('the floating panel: pictures, copy on click, handles', () => {
  let app;
  let outputDir;
  let runtimeErrors;
  const bar = () => app.windows().find((candidate) => candidate.url().includes('quickbar.html'));
  const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('quickbar.html')).getBounds());

  test.beforeAll(async () => {
    ({ app, outputDir, runtimeErrors } = await launchStudio('panel-gallery'));
    await expect.poll(() => Boolean(bar()), { timeout: 15_000 }).toBe(true);
    // Two pictures in the captures folder: a red one and a blue one.
    const page = app.windows().find((candidate) => candidate.url().endsWith('index.html'));
    for (const [name, colour] of [['אדום.png', '#e11d48'], ['כחול.png', '#2563eb']]) {
      const data = await page.evaluate((fill) => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, 160, 90); return c.toDataURL('image/png'); }, colour);
      await fs.writeFile(path.join(outputDir, name), Buffer.from(data.split(',')[1], 'base64'));
    }
    await bar().evaluate(() => window.quickbarApi.setPreferences({ enabled: true, style: 'panel', edge: 'left', offset: 0.5, activation: 'click', pinned: false, hideDelay: null, panelSizes: null }));
    if (await bar().locator('body').getAttribute('data-expanded') !== 'true') await bar().locator('#edge-handle').click();
    await expect(bar().locator('body')).toHaveAttribute('data-expanded', 'true');
  });
  test.afterAll(async () => closeStudio(app));

  test('1 · the pictures button swaps the buttons for the recent captures, and back', async () => {
    await expect(bar().locator('#quickbar-actions')).toBeVisible();
    await bar().locator('#show-gallery').click();
    await expect(bar().locator('html')).toHaveAttribute('data-view', 'history');
    await expect(bar().locator('.history-item')).toHaveCount(2);
    await expect(bar().locator('#history-gallery')).toHaveAttribute('aria-pressed', 'true');
    await bar().locator('#history-gallery').click();
    await expect(bar().locator('html')).toHaveAttribute('data-view', 'actions');
    await expect(bar().locator('#quickbar-actions')).toBeVisible();
  });

  test('2 · a click on a picture copies it to the clipboard', async () => {
    await app.evaluate(async () => globalThis.__aurumQa.clipboard.clear());
    await bar().locator('#show-gallery').click();
    await expect(bar().locator('.history-item')).toHaveCount(2);
    await bar().locator('.history-item').first().click();
    await expect(bar().locator('.history-item.copied')).toHaveCount(1);
    const copied = await app.evaluate(async () => { const image = (await globalThis.__aurumQa.clipboard.readImage()); return image.isEmpty() ? null : image.getSize(); });
    expect(copied).toEqual({ width: 160, height: 90 });
    await expect(bar().locator('html')).toHaveAttribute('data-view', 'history');
    await bar().locator('#history-gallery').click();
  });

  test('3 · handles on the free sides: bigger, kept for this view, and back with a double click', async () => {
    const visible = await bar().evaluate(() => [...document.querySelectorAll('.resize-handle')].filter((handle) => getComputedStyle(handle).display !== 'none').map((handle) => handle.dataset.side).sort());
    expect(visible).toEqual(['e', 'n', 's']);
    const before = await bounds();
    // A drag on a handle, as screen points (the handle follows the pointer's place on the screen).
    const drag = (side, dx, dy) => bar().evaluate(([which, x, y]) => {
      const handle = document.querySelector(`.resize-handle[data-side="${which}"]`);
      const box = handle.getBoundingClientRect();
      const sx = window.screenX + box.left + box.width / 2;
      const sy = window.screenY + box.top + box.height / 2;
      const fire = (type, ax, ay, buttons) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, buttons, screenX: ax, screenY: ay }));
      fire('pointerdown', sx, sy, 1);
      fire('pointermove', sx + x / 2, sy + y / 2, 1);
      return new Promise((resolve) => setTimeout(() => {
        fire('pointermove', sx + x, sy + y, 1);
        setTimeout(() => { fire('pointerup', sx + x, sy + y, 0); resolve(); }, 120);
      }, 80));
    }, [side, dx, dy]);
    await drag('s', 0, 120);
    await expect.poll(async () => (await bounds()).height, { timeout: 5000 }).toBeGreaterThan(before.height + 100);
    expect(Math.abs((await bounds()).y - before.y)).toBeLessThanOrEqual(2);
    await drag('e', 140, 0);
    await expect.poll(async () => (await bounds()).width, { timeout: 5000 }).toBeGreaterThan(before.width + 120);
    expect((await bounds()).x).toBe(before.x);
    const saved = await bar().evaluate(() => window.quickbarApi.getState().then((state) => state.preferences.panelSizes));
    expect(saved.actions.width).toBeGreaterThan(before.width + 120);
    // More room: more buttons in a row.
    const perRow = await bar().evaluate(() => { const tops = [...document.querySelectorAll('#quickbar-actions button')].map((b) => Math.round(b.getBoundingClientRect().top)); return tops.filter((t) => t === tops[0]).length; });
    expect(perRow).toBeGreaterThan(4);
    // The pictures view keeps its own size.
    await bar().locator('#show-gallery').click();
    await expect.poll(async () => (await bounds()).width).toBe(392);
    await bar().locator('#history-gallery').click();
    await expect.poll(async () => (await bounds()).width).toBe(saved.actions.width);
    await bar().locator('.resize-handle[data-side="s"]').dispatchEvent('dblclick');
    await expect.poll(async () => (await bounds()).width).toBe(before.width);
    expect(runtimeErrors).toEqual([]);
  });
});
