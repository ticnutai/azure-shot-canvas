const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { pngDimensions } = require('../helpers/media.cjs');

// The fast region capture: hotkey → frozen screens → drag or click → quick marks toolbar → save / copy / editor /
// copy text; area recording and delayed capture use the same frozen screen. The studio window never comes forward
// for a capture.
test.describe.serial('region capture on the frozen screen', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  let scale;

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('region-overlay'));
    scale = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
    // These tests cover the marks toolbar: turned on here (the default saves on release — tested below).
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.setPreferences({ regionMarkup: true }));
  });
  test.afterAll(async () => closeStudio(app));

  const overlayPages = () => app.windows().filter((candidate) => candidate.url().includes('region-overlay.html'));
  const strip = () => app.windows().find((candidate) => candidate.url().includes('quickbar.html'));
  const pngsSince = async (before) => (await fs.readdir(outputDir)).filter((name) => name.endsWith('.png') && !before.has(name));
  const newPng = async (before, timeout = 20_000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const added = await pngsSince(before);
      if (added.length) return path.join(outputDir, added[0]);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('no new PNG');
  };
  const studioWindow = (code) => app.evaluate(({ BrowserWindow }, source) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('index.html'));
    // eslint-disable-next-line no-new-func
    return new Function('win', source)(win);
  }, code);
  // The default keys: PrtSc = pick an area, Shift+PrtSc = the previous area (sent as real key events to the studio).
  const pressShortcut = (which) => studioWindow(`win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PrintScreen', modifiers: ${which === '4' ? "['shift']" : '[]'} })`);
  const runBarAction = (action) => strip().evaluate((name) => window.quickbarApi.runAction(name), action);
  const setPreferences = (patch) => strip().evaluate((value) => window.quickbarApi.setPreferences(value), patch);
  // Waits for an overlay to receive a fresh frozen picture.
  const openedOverlay = async (since) => {
    await expect.poll(() => overlayPages().length, { timeout: 15_000 }).toBeGreaterThan(0);
    for (const candidate of overlayPages()) {
      const ready = await candidate.waitForFunction((after) => Number(document.documentElement.dataset.regionReady || 0) > after, since, { timeout: 15_000 }).then(() => true).catch(() => false);
      if (ready) return candidate;
    }
    throw new Error('overlay never received a frozen screen');
  };
  const drag = (overlay, from, to) => overlay.evaluate(([a, b]) => {
    const fire = (type, point) => window.dispatchEvent(new PointerEvent(type, { clientX: point.x, clientY: point.y, button: 0, bubbles: true, pointerId: 1 }));
    fire('pointermove', a);
    fire('pointerdown', a);
    fire('pointermove', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    fire('pointermove', b);
    fire('pointerup', b);
  }, [from, to]);
  const key = (overlay, init) => overlay.evaluate((value) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...value })), init);

  test('drag → marks toolbar → arrow and blur → save: exactly the selected area, studio stays hidden', async () => {
    await studioWindow('win.hide()');
    const before = new Set(await fs.readdir(outputDir));
    const since = Date.now();
    const started = performance.now();
    await pressShortcut('3');
    const overlay = await openedOverlay(since);
    const openedMs = performance.now() - started;
    await drag(overlay, { x: 40, y: 50 }, { x: 240, y: 150 });
    await expect(overlay.locator('html')).toHaveAttribute('data-region-editing', 'true');
    await expect(overlay.locator('#toolbar')).toBeVisible();
    // Nothing is saved until the user chooses what to do.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await pngsSince(before)).toEqual([]);
    await overlay.locator('[data-tool="arrow"]').click();
    await drag(overlay, { x: 60, y: 70 }, { x: 200, y: 130 });
    await overlay.locator('[data-tool="blur"]').click();
    await drag(overlay, { x: 150, y: 60 }, { x: 230, y: 100 });
    await expect(overlay.locator('[data-command="undo"]')).toBeEnabled();
    await overlay.locator('[data-after="save"]').click();
    const dimensions = await pngDimensions(await newPng(before));
    expect(dimensions.width).toBe(Math.round(200 * scale));
    expect(dimensions.height).toBe(Math.round(100 * scale));
    expect(await studioWindow('return win.isVisible()')).toBe(false);
    await expect(page.locator('html')).toHaveAttribute('data-last-region-capture', `${dimensions.width}x${dimensions.height}`);
    test.info().annotations.push({ type: 'metric', description: `frozen screen ready in ${Math.round(openedMs)} ms` });
  });

  test('repeat shortcut captures the previous area at once, without a picker', async () => {
    const before = new Set(await fs.readdir(outputDir));
    const shownBefore = await Promise.all(overlayPages().map((candidate) => candidate.evaluate(() => document.documentElement.dataset.regionReady)));
    await pressShortcut('4');
    const dimensions = await pngDimensions(await newPng(before));
    expect({ width: dimensions.width, height: dimensions.height }).toEqual({ width: Math.round(200 * scale), height: Math.round(100 * scale) });
    const shownAfter = await Promise.all(overlayPages().map((candidate) => candidate.evaluate(() => document.documentElement.dataset.regionReady)));
    expect(shownAfter).toEqual(shownBefore);
  });

  test('copy from the toolbar saves and puts the picture on the clipboard; the area can be resized first', async () => {
    await app.evaluate(({ clipboard }) => clipboard.clear());
    const before = new Set(await fs.readdir(outputDir));
    const since = Date.now();
    await pressShortcut('3');
    const overlay = await openedOverlay(since);
    await drag(overlay, { x: 100, y: 100 }, { x: 200, y: 160 });
    await expect(overlay.locator('html')).toHaveAttribute('data-region-editing', 'true');
    // Drag the bottom-right handle 50 points right: the saved picture is 150 × 60.
    await drag(overlay, { x: 200, y: 160 }, { x: 250, y: 160 });
    await key(overlay, { key: 'c', code: 'KeyC', ctrlKey: true });
    const dimensions = await pngDimensions(await newPng(before));
    expect(dimensions.width).toBe(Math.round(150 * scale));
    expect(dimensions.height).toBe(Math.round(60 * scale));
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readImage().getSize().width)).toBe(Math.round(150 * scale));
  });

  test('Escape cancels without saving; a click with no window under it takes the whole screen', async () => {
    let before = new Set(await fs.readdir(outputDir));
    let since = Date.now();
    await pressShortcut('3');
    let overlay = await openedOverlay(since);
    await key(overlay, { key: 'Escape' });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await pngsSince(before)).toEqual([]);

    since = Date.now();
    await pressShortcut('3');
    overlay = await openedOverlay(since);
    const size = await overlay.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    before = new Set(await fs.readdir(outputDir));
    await drag(overlay, { x: 100, y: 100 }, { x: 101, y: 101 });
    await key(overlay, { key: 'Enter' });
    const dimensions = await pngDimensions(await newPng(before));
    expect(dimensions.width).toBe(Math.round(size.width * scale));
    expect(dimensions.height).toBe(Math.round(size.height * scale));
  });

  test('default: the area is saved the moment the mouse is released; Control on release opens the marks toolbar', async () => {
    await setPreferences({ regionMarkup: false });
    let before = new Set(await fs.readdir(outputDir));
    let since = Date.now();
    await pressShortcut('3');
    let overlay = await openedOverlay(since);
    await expect(overlay.locator('#hint')).toContainText('שחרור — נשמר מיד');
    await app.evaluate(({ clipboard }) => clipboard.writeText('לפני הצילום'));
    await drag(overlay, { x: 10, y: 10 }, { x: 90, y: 50 });
    const dimensions = await pngDimensions(await newPng(before));
    expect(dimensions.width).toBe(Math.round(80 * scale));
    // On by default: the capture is on the clipboard as a picture (ready to paste), not as text.
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readImage().getSize().width)).toBe(Math.round(80 * scale));
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('');
    // Control held on release: the toolbar instead, nothing saved yet.
    before = new Set(await fs.readdir(outputDir));
    since = Date.now();
    await pressShortcut('3');
    overlay = await openedOverlay(since);
    await overlay.evaluate(() => {
      const fire = (type, x, y, extra = {}) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1, ...extra }));
      fire('pointerdown', 20, 20); fire('pointermove', 120, 80); fire('pointerup', 120, 80, { ctrlKey: true });
    });
    await expect(overlay.locator('html')).toHaveAttribute('data-region-editing', 'true');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await pngsSince(before)).toEqual([]);
    await overlay.locator('[data-after="save"]').click();
    expect((await pngDimensions(await newPng(before))).width).toBe(Math.round(100 * scale));
    await setPreferences({ regionMarkup: true });
  });

  test('copy text from an area: recognised text goes to the clipboard, no image is saved', async () => {
    test.setTimeout(90_000);
    const before = new Set(await fs.readdir(outputDir));
    const since = Date.now();
    await runBarAction('ocrRegion');
    const overlay = await openedOverlay(since);
    await drag(overlay, { x: 0, y: 0 }, { x: 600, y: 200 });
    await expect.poll(() => app.evaluate(() => globalThis.__aurumQa.lastNotice?.title || ''), { timeout: 60_000 }).toMatch(/הטקסט הועתק ללוח|לא נמצא טקסט באזור/);
    expect(await pngsSince(before)).toEqual([]);
  });

  test('a delayed capture shows the countdown first and freezes the screen only after it', async () => {
    await setPreferences({ captureDelay: 3 });
    const since = Date.now();
    await pressShortcut('3');
    const overlay = await openedOverlay(since);
    const frozenAt = Number(await overlay.evaluate(() => document.documentElement.dataset.regionReady));
    expect(frozenAt - since).toBeGreaterThanOrEqual(2900);
    await key(overlay, { key: 'Escape' });
    await setPreferences({ captureDelay: 0 });
  });

  test('record an area chosen on the frozen screen', async () => {
    test.setTimeout(90_000);
    const since = Date.now();
    await runBarAction('recordRegion');
    const overlay = await openedOverlay(since);
    await expect(overlay.locator('#hint b')).toHaveText('גררו לבחירת אזור להקלטה');
    await drag(overlay, { x: 20, y: 20 }, { x: 420, y: 260 });
    await expect.poll(() => page.evaluate(() => Boolean(state.recorder)), { timeout: 30_000 }).toBe(true);
    const region = await page.evaluate(() => state.region);
    const bounds = await overlay.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    expect(region.x).toBeCloseTo(20 / bounds.width, 3);
    expect(region.width).toBeCloseTo(400 / bounds.width, 3);
    await page.waitForTimeout(1500);
    const before = new Set(await fs.readdir(outputDir));
    await page.evaluate(() => executeShortcutAction('recordStop'));
    await expect.poll(async () => (await fs.readdir(outputDir)).some((name) => /\.(webm|mp4)$/i.test(name) && !before.has(name)), { timeout: 60_000 }).toBe(true);
    expect(runtimeErrors).toEqual([]);
  });
});
