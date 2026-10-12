const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The capture screen costs nothing it does not need to: the live view starts off, switches on and off from one
// clear switch, stops by itself after two idle minutes, and the screen can shrink to one row.
//   1  first run: the live view is off — no screen stream, the switch says off
//   2  the switch turns it on and off; off releases the stream; there is exactly one switch on the screen
//   3  two minutes without a touch stop it; the first movement brings it back
//   4  the compact layout: no preview area and no stream, and a capture still works
//   5  folding the recording row's captions keeps every button usable, each with its name in the hint
test.describe.serial('capture screen: live view off by default and compact layouts', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('capture-compact', { livePreview: 'default' }));
  });
  test.afterAll(async () => closeStudio(app));

  const html = () => page.locator('html');
  const streaming = () => page.evaluate(() => Boolean(state.previewStream));

  test('1 · first run: the live view is off — no screen stream, the switch says off', async () => {
    await page.locator('.source-card').first().click();
    await page.waitForTimeout(1500);
    await expect(html()).toHaveAttribute('data-live-preview', 'off');
    await expect(page.locator('#live-preview-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(await streaming()).toBe(false);
  });

  test('2 · the switch turns it on and off; off releases the stream; there is exactly one switch', async () => {
    await expect(page.locator('#live-preview-toggle')).toHaveCount(1);
    await expect(page.locator('#live-preview-toggle')).toBeVisible();
    await page.locator('#live-preview-toggle').click();
    await expect(html()).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    expect(await streaming()).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('aurum-live-preview'))).toBe('on');
    // Started from "off", the preview's own controls (fit, zoom) must come back once it runs.
    await expect(page.locator('[data-preview-fit="cover"]')).toBeVisible();
    await page.locator('#live-preview-toggle').click();
    await expect.poll(streaming).toBe(false);
    await expect(page.locator('#live-preview-toggle')).toHaveAttribute('aria-pressed', 'false');
    // The settings page shows the same choice (a mirror of the one setting, not a second one).
    expect(await page.evaluate(() => document.querySelector('#live-preview-enabled')?.checked)).toBe(false);
  });

  test('3 · two minutes without a touch stop it; the first movement brings it back', async () => {
    await page.locator('#live-preview-toggle').click();
    await expect(html()).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    // Time travel instead of waiting two real minutes.
    expect(await page.evaluate(() => { state.lastActivity = Date.now() - 125_000; return checkPreviewIdle(); })).toBe(true);
    expect(await streaming()).toBe(false);
    await expect(html()).toHaveAttribute('data-preview-idle', 'true');
    await expect(page.locator('#live-preview-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(300, 300);
    await page.mouse.move(320, 310);
    await expect(html()).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    await expect(html()).toHaveAttribute('data-preview-idle', 'false');
    // Activity just now: nothing stops.
    expect(await page.evaluate(() => checkPreviewIdle())).toBe(false);
  });

  test('4 · the compact layout: no preview area and no stream, and a capture still works', async () => {
    await page.evaluate(() => applyCaptureLayout('compact'));
    await expect(html()).toHaveAttribute('data-capture-layout', 'compact');
    await expect(page.locator('#capture-page .capture-preview')).toBeHidden();
    await expect.poll(streaming).toBe(false);
    await expect(page.locator('#record-button')).toBeVisible();
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await page.locator('#default-capture-kind').selectOption('screenshot');
    await page.locator('#default-capture-scope').selectOption('full');
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    await expect.poll(async () => (await fs.readdir(outputDir)).some((name) => name.endsWith('.png') && !before.has(name)), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => applyCaptureLayout('clean'));
    await expect(page.locator('#capture-page .capture-preview')).toBeVisible();
  });

  test('5 · folding the recording row captions keeps every button usable, each with its name in the hint', async () => {
    await page.locator('[data-collapse-toggle="transport"]').click();
    await expect(html()).toHaveAttribute('data-collapsed-transport', 'true');
    const buttons = await page.evaluate(() => [...document.querySelectorAll('#capture-page .transport-bar button')].filter((button) => !button.classList.contains('transport-collapse')).map((button) => ({ title: button.title, visible: button.offsetParent !== null, width: button.getBoundingClientRect().width })));
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    expect(buttons.every((button) => button.visible && button.width > 0 && button.title.length > 0)).toBe(true);
    await expect(page.locator('#record-button span')).toBeHidden();
    await page.locator('[data-collapse-toggle="transport"]').click();
    await expect(page.locator('#record-button span')).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  });
});
