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
    expect(collapsed.bounds).toMatchObject({ width: 120, y: collapsed.workArea.y });
    // 6px line; Windows may keep the window itself a few pixels taller (invisible catch area).
    expect(collapsed.bounds.height).toBeLessThanOrEqual(19);
    expect(await strip.locator('#edge-handle').evaluate((node) => node.getBoundingClientRect().height)).toBe(6);
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
    await expect.poll(async () => (await barBounds()).bounds.width).toBe(120);
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

    // The small grid inside the bar (the default button opens the captures window — tested below).
    await strip.evaluate(() => window.quickbarApi.setPreferences({ historyStyle: 'panel' }));
    await strip.locator('#show-history').click();
    await expect(strip.locator('html')).toHaveAttribute('data-view', 'history');
    await expect.poll(async () => (await barBounds()).bounds).toMatchObject({ width: 392, height: 470 });
    await expect(strip.locator('.history-item')).toHaveCount(1);
    await strip.locator('.history-item').first().click();
    await expect(strip.locator('html')).toHaveAttribute('data-view', 'capture');
    await expect(strip.locator('#capture-name')).not.toHaveText('');
  });

  test('history: search, kind and time filters, and several captures chosen and moved to the recycle bin', async () => {
    // The small grid inside the bar (the default history button opens the captures window — tested below).
    await strip.evaluate(() => window.quickbarApi.setPreferences({ historyStyle: 'panel' }));
    await expect(strip.locator('body')).toHaveAttribute('data-style', 'strip');
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

  test('touching the thin line opens the strip and leaving hides it again (the default)', async () => {
    await expect(strip.locator('body')).toHaveAttribute('data-activation', 'hover');
    if (await strip.locator('body').getAttribute('data-expanded') === 'true') await strip.locator('#strip-hide').click();
    await expect(strip.locator('body')).toHaveAttribute('data-expanded', 'false');
    await strip.locator('#edge-handle').dispatchEvent('mouseenter');
    await expect(strip.locator('body')).toHaveAttribute('data-expanded', 'true', { timeout: 2000 });
    await expect.poll(async () => (await barBounds()).bounds.width).toBe(300);
    await strip.mouse.move(3000, 3000);
    await strip.locator('#strip').dispatchEvent('mouseleave');
    await expect(strip.locator('body')).toHaveAttribute('data-expanded', 'false', { timeout: 2000 });
    await expect.poll(async () => (await barBounds()).bounds.width).toBe(120);
  });

  test('captures window: large thumbnails with names, choose, delete, and capture from its round button', async () => {
    await strip.evaluate(() => window.quickbarApi.setPreferences({ historyStyle: 'workspace' }));
    // Two captures to show.
    for (let i = 0; i < 2; i += 1) {
      const before = new Set(await fs.readdir(outputDir));
      const since = Date.now();
      await strip.evaluate(() => window.quickbarApi.runAction('region'));
      let overlay = null;
      for (let tries = 0; tries < 200 && !overlay; tries += 1) {
        for (const candidate of app.windows().filter((item) => item.url().includes('region-overlay.html'))) {
          if (Number(await candidate.evaluate(() => document.documentElement.dataset.regionReady || 0).catch(() => 0)) > since) overlay = candidate;
        }
        if (!overlay) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await overlay.evaluate((n) => {
        const fire = (type, x, y) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1 }));
        fire('pointerdown', 30, 30); fire('pointermove', 130 + n * 20, 90); fire('pointerup', 130 + n * 20, 90);
      }, i);
      await expect.poll(async () => (await fs.readdir(outputDir)).filter((name) => name.endsWith('.png') && !before.has(name)).length, { timeout: 20_000 }).toBe(1);
    }
    if (await strip.locator('body').getAttribute('data-expanded') !== 'true') await strip.locator('#edge-handle').click();
    await strip.evaluate(() => { document.documentElement.dataset.view = 'actions'; });
    await strip.locator('#strip-history').click();
    await expect.poll(() => app.windows().filter((candidate) => candidate.url().includes('workspace.html')).length, { timeout: 15_000 }).toBe(1);
    const workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const pngs = (await fs.readdir(outputDir)).filter((name) => name.endsWith('.png'));
    await expect(workspace.locator('.item')).toHaveCount(pngs.length);
    await expect(workspace.locator('.item .name').first()).toHaveText(/\.png$/);
    await expect(workspace.locator('.round-action')).toHaveCount(4);
    await expect(workspace.locator('#edit')).toBeDisabled();
    await workspace.locator('.item').first().click();
    await expect(workspace.locator('.item').first()).toHaveAttribute('aria-selected', 'true');
    await expect(workspace.locator('#edit')).toBeEnabled();
    // A new capture appears in the open window by itself.
    const countBefore = await workspace.locator('.item').count();
    await workspace.locator('.item').first().click();
    await workspace.keyboard.press('Delete');
    await expect(workspace.locator('.item')).toHaveCount(countBefore - 1);
    // The ▾ menu lists the other capture kinds.
    await workspace.locator('.more[data-menu="capture"]').click();
    await expect(workspace.locator('#menu [data-menu-item]')).toHaveCount(5);
    await workspace.keyboard.press('Escape');
    // Designs, views and picture size; the choice is remembered when the window opens again.
    await workspace.locator('#theme-button').click();
    await expect(workspace.locator('#menu [data-theme-choice]')).toHaveCount(6);
    await workspace.locator('#menu [data-theme-choice="office"]').click();
    await expect(workspace.locator('html')).toHaveAttribute('data-theme', 'office');
    await expect(workspace.locator('.ribbon')).toBeVisible();
    await expect(workspace.locator('.actions')).toBeHidden();
    await workspace.locator('[data-view-choice="table"]').click();
    await expect(workspace.locator('.table-head')).toHaveCount(1);
    await workspace.locator('[data-view-choice="large"]').click();
    await workspace.locator('#thumb-size').fill('320');
    await expect.poll(() => workspace.evaluate(() => document.documentElement.style.getPropertyValue('--thumb'))).toBe('320px');
    await workspace.reload();
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await expect(workspace.locator('html')).toHaveAttribute('data-theme', 'office');
    // Ribbon actions follow the selection.
    await expect(workspace.locator('.ribbon [data-item-action="copy"]')).toBeDisabled();
    await workspace.locator('.item').first().click();
    await expect(workspace.locator('.ribbon [data-item-action="copy"]')).toBeEnabled();
    await workspace.locator('.ribbon [data-item-action="copy"]').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readImage().isEmpty())).toBe(false);
    await workspace.evaluate(() => { localStorage.setItem('aurum-ws-theme', 'graphite'); });
    await workspace.reload();
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await workspace.locator('#close-bottom').click();
    await expect.poll(() => app.windows().filter((candidate) => candidate.url().includes('workspace.html')).length).toBe(0);
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
