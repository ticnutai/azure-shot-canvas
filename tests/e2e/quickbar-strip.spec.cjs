const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The default bar: a slim strip in the top edge with two large buttons, drop-down menus, pin/hide,
// the history grid of recent captures, and region capture straight from the strip.
test.describe.serial('slim capture strip', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  let strip;

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('quickbar-strip'));
    await expect.poll(() => app.windows().filter((candidate) => candidate.url().includes('quickbar.html')).length, { timeout: 15_000 }).toBe(1);
    strip = app.windows().find((candidate) => candidate.url().includes('quickbar.html'));
    await strip.waitForFunction(() => document.body.dataset.style === 'strip' && document.body.dataset.edge === 'top');
  });
  test.afterAll(async () => closeStudio(app));

  const barBounds = () => app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('quickbar.html'));
    return { bounds: win.getBounds(), workArea: screen.getDisplayMatching(win.getBounds()).workArea };
  });

  test('on by default: a tab in the top edge that opens into a slim strip flush with the edge', async () => {
    const collapsed = await barBounds();
    expect(collapsed.bounds).toMatchObject({ width: 86, y: collapsed.workArea.y });
    await strip.locator('#edge-handle').click();
    await expect.poll(async () => (await barBounds()).bounds.width).toBe(300);
    const open = await barBounds();
    expect(open.bounds).toMatchObject({ height: 64, y: open.workArea.y });
    await expect(strip.locator('#strip')).toBeVisible();
    await expect(strip.locator('#quickbar')).toBeHidden();
    await expect(strip.locator('[data-strip-action]')).toHaveCount(2);
  });

  test('each large button has a drop-down menu that grows the strip and closes again', async () => {
    await strip.locator('.strip-more[data-menu="capture"]').click();
    await expect.poll(async () => (await barBounds()).bounds.height).toBe(408);
    await expect(strip.locator('#strip-menu [data-menu-action]')).toHaveCount(7);
    await expect(strip.locator('#strip-menu .menu-toggle')).toHaveCount(3);
    await expect(strip.locator('#strip-menu [data-menu-action="repeatRegion"]')).toBeVisible();
    await strip.locator('.strip-more[data-menu="record"]').click();
    await expect(strip.locator('#strip-menu [data-menu-action="pause"]')).toBeVisible();
    await strip.locator('.strip-more[data-menu="record"]').click();
    await expect.poll(async () => (await barBounds()).bounds.height).toBe(64);
  });

  test('pin keeps it open; hide sends it back to the edge', async () => {
    await strip.locator('#strip-pin').click();
    await expect(strip.locator('#strip-pin')).toHaveAttribute('aria-pressed', 'true');
    await strip.locator('#strip').dispatchEvent('mouseleave');
    await strip.waitForTimeout(1800);
    await expect(strip.locator('body')).toHaveAttribute('data-expanded', 'true');
    await strip.locator('#strip-pin').click();
    await strip.locator('#strip-hide').click();
    await expect(strip.locator('body')).toHaveAttribute('data-expanded', 'false');
    await expect.poll(async () => (await barBounds()).bounds.width).toBe(86);
  });

  test('the capture button freezes the screen; the cut is saved and shown in the card, then in history', async () => {
    await strip.locator('#edge-handle').click();
    const before = new Set(await fs.readdir(outputDir));
    const since = Date.now();
    await strip.locator('[data-strip-action="region"]').click();
    // The strip steps aside before the screen freezes.
    await expect(strip.locator('body')).toHaveAttribute('data-expanded', 'false');
    await expect.poll(() => app.windows().filter((candidate) => candidate.url().includes('region-overlay.html')).length, { timeout: 15_000 }).toBeGreaterThan(0);
    let overlay = null;
    for (const candidate of app.windows().filter((item) => item.url().includes('region-overlay.html'))) {
      if (await candidate.waitForFunction((after) => Number(document.documentElement.dataset.regionReady || 0) > after, since, { timeout: 15_000 }).then(() => true).catch(() => false)) { overlay = candidate; break; }
    }
    expect(overlay).not.toBeNull();
    await overlay.evaluate(() => {
      const fire = (type, x, y) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1 }));
      fire('pointerdown', 20, 20);
      fire('pointermove', 120, 90);
      fire('pointerup', 120, 90);
      // The quick marks toolbar is up; Enter saves.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await expect.poll(async () => (await fs.readdir(outputDir)).filter((name) => name.endsWith('.png') && !before.has(name)).length, { timeout: 20_000 }).toBe(1);
    await expect(strip.locator('html')).toHaveAttribute('data-view', 'capture', { timeout: 15_000 });
    await expect(strip.locator('#capture-card')).toBeVisible();

    await strip.locator('#show-history').click();
    await expect(strip.locator('html')).toHaveAttribute('data-view', 'history');
    await expect.poll(async () => (await barBounds()).bounds).toMatchObject({ width: 392, height: 470 });
    await expect(strip.locator('.history-item')).toHaveCount(1);
    await strip.locator('.history-item').first().click();
    await expect(strip.locator('html')).toHaveAttribute('data-view', 'capture');
    await expect(strip.locator('#capture-name')).not.toHaveText('');
  });

  test('history: search, kind and time filters, and several captures chosen and moved to the recycle bin', async () => {
    await strip.locator('#show-history').click();
    await expect(strip.locator('.history-item')).toHaveCount(1);
    await strip.locator('[data-kind-filter="video"]').click();
    await expect(strip.locator('.history-item')).toHaveCount(0);
    await expect(strip.locator('.history-empty')).toHaveText('אין צילומים שמתאימים לחיפוש');
    await strip.locator('[data-kind-filter="image"]').click();
    await strip.locator('[data-time-filter="today"]').click();
    await expect(strip.locator('.history-item')).toHaveCount(1);
    await strip.locator('#history-search').fill('אין-כזה-שם');
    await expect(strip.locator('.history-item')).toHaveCount(0);
    await strip.locator('#history-search').fill('');
    await strip.locator('[data-kind-filter="all"]').click();
    await strip.locator('.history-item').first().click({ modifiers: ['Control'] });
    await expect(strip.locator('#history-selection')).toBeVisible();
    await expect(strip.locator('#history-selected-count')).toHaveText('1 נבחרו');
    await strip.locator('#history-trash').click();
    await expect(strip.locator('.history-item')).toHaveCount(0);
    await expect(strip.locator('html')).toHaveAttribute('data-view', 'history');
    expect((await fs.readdir(outputDir)).filter((name) => name.endsWith('.png'))).toEqual([]);
    await strip.locator('#history-back').click();
  });

  test('settings switch between the strip and the full panel', async () => {
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await expect(page.locator('#quickbar-style')).toHaveValue('strip');
    await expect(page.locator('#quickbar-edge')).toHaveValue('top');
    await page.locator('#quickbar-style').selectOption('panel');
    await expect(strip.locator('body')).toHaveAttribute('data-style', 'panel');
    await page.locator('#quickbar-style').selectOption('strip');
    await expect(strip.locator('body')).toHaveAttribute('data-style', 'strip');
    expect(runtimeErrors).toEqual([]);
  });
});
