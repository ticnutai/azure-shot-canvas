const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { regionOverlay } = require('../helpers/region.cjs');

// The studio costs almost nothing while nobody looks at it, and every saving is undone the moment it is needed:
// numbered so a failure points straight at the behaviour that broke.
//   1  at start: no device watching, no audio / video-capture services
//   2  choosing a microphone watches devices and lists them; un-choosing stops watching
//   3  a hidden studio window reports itself hidden and does not start the live preview
//   4  hidden → visible → hidden: the live preview comes back and stops again
//   5  a recording in progress is never stopped by hiding the window
//   6  after a region capture the capture window gives back its pictures, and the next capture still works
test.describe.serial('resource savings', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;

  test.beforeAll(async () => {
    // Visibility reporting is normally off in tests (their windows are hidden on purpose); these tests check it.
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('resource-savings', { env: { SCREEN_STUDIO_TRACK_VISIBILITY: '1' } }));
  });
  test.afterAll(async () => closeStudio(app));

  const services = () => app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map((item) => item.serviceName || '').filter(Boolean));
  const html = () => page.locator('html');
  // What the main process sends when the studio window is shown or minimized (without putting a window on screen).
  const tellVisible = (visible) => app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('index.html')).webContents.send('app:visibility', value);
  }, visible);
  const setCheckbox = (selector, checked) => page.locator(selector).evaluate((element, value) => {
    element.checked = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, checked);

  test('1 · at start nothing watches devices and no audio or video-capture service runs', async () => {
    await page.waitForTimeout(3000);
    await expect(html()).toHaveAttribute('data-watching-devices', 'false');
    const running = await services();
    expect(running.filter((name) => /audio|video_capture/i.test(name))).toEqual([]);
  });

  test('2 · choosing a microphone watches devices and lists them; un-choosing stops watching', async () => {
    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="audio"]').click();
    await setCheckbox('#microphone', true);
    await expect(html()).toHaveAttribute('data-watching-devices', 'true');
    await expect(page.locator('#microphone-device option')).not.toHaveCount(0);
    expect(await page.locator('#microphone-device option').count()).toBeGreaterThan(1);
    await setCheckbox('#microphone', false);
    await expect(html()).toHaveAttribute('data-watching-devices', 'false');
    await expect(page.locator('#microphone-device')).toHaveCount(0);
    await page.locator('#close-capture-settings').click();
  });

  test('3 · a hidden studio window reports itself hidden and does not start the live preview', async () => {
    await expect(html()).toHaveAttribute('data-window-hidden', 'true');
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
    await page.locator('.source-card').first().click();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => Boolean(state.previewStream))).toBe(false);
    await expect(html()).not.toHaveAttribute('data-preview-state', 'ready');
  });

  test('4 · shown, the live preview comes back by itself; hidden again, it stops', async () => {
    await tellVisible(true);
    await expect(html()).toHaveAttribute('data-window-hidden', 'false');
    await expect(html()).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    await tellVisible(false);
    await expect(html()).toHaveAttribute('data-window-hidden', 'true');
    await expect.poll(() => page.evaluate(() => Boolean(state.previewStream))).toBe(false);
    await tellVisible(true);
    await expect(html()).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
  });

  test('5 · a recording in progress is never stopped by hiding the window', async () => {
    test.setTimeout(120_000);
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await page.locator('#default-capture-kind').selectOption('record');
    await page.locator('#default-capture-scope').selectOption('full');
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    await expect.poll(() => page.evaluate(() => state.recorder?.state || document.querySelector('#toast')?.textContent || 'none'), { timeout: 20_000 }).toBe('recording');
    await tellVisible(false);
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => state.recorder?.state)).toBe('recording');
    await page.locator('#stop-recording').dispatchEvent('click');
    let video = null;
    for (const deadline = Date.now() + 60_000; !video && Date.now() < deadline; await page.waitForTimeout(200)) {
      video = (await fs.readdir(outputDir)).find((name) => name.endsWith('.mp4') && !before.has(name)) || null;
    }
    expect(video).not.toBeNull();
    expect((await fs.stat(path.join(outputDir, video))).size).toBeGreaterThan(1000);
  });

  test('6 · after a region capture the capture window gives back its pictures, and the next capture still works', async () => {
    test.setTimeout(90_000);
    const region = regionOverlay(app);
    const press = () => app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('index.html')).webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PrintScreen', modifiers: [] });
    });
    const pngs = async () => new Set((await fs.readdir(outputDir)).filter((name) => name.endsWith('.png')));
    for (let round = 1; round <= 2; round += 1) {
      const before = await pngs();
      const since = Date.now();
      await press();
      const overlay = await region.opened(since);
      expect(await overlay.evaluate(() => document.querySelector('#frozen').width)).toBeGreaterThan(100);
      await region.drag(overlay, { x: 40, y: 50 }, { x: 240, y: 150 });
      await expect.poll(async () => [...await pngs()].filter((name) => !before.has(name)).length, { timeout: 20_000 }).toBeGreaterThan(0);
      await expect.poll(() => overlay.evaluate(() => Number(document.documentElement.dataset.regionReleased || 0)), { timeout: 10_000 }).toBeGreaterThan(since);
      const sizes = await overlay.evaluate(() => [document.querySelector('#frozen').width, document.querySelector('#marks').width]);
      expect(sizes, `round ${round}`).toEqual([0, 0]);
    }
    expect(runtimeErrors).toEqual([]);
  });
});
