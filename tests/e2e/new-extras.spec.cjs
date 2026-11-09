const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The start-and-end journal and the extras added with it, on the program itself.
//   1  the journal records the start and marks the run as open (a sudden end is checked in tests/new-extras.test.cjs)
//   2  the colour picker: one click on the frozen screen puts the colour on the clipboard
//   3  drawing during a recording: only while recording and with the extra on; marks, undo, clear; gone when it ends
//   4  a watermark reaches a saved picture only when the extra is on
//   5  automatic cleaning: old files go, new files and favourites stay
//   6  a scheduled recording starts and stops by itself, then the one-time plan switches off
test.describe.serial('journal and new extras', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  const byUrl = (part) => app.windows().filter((candidate) => candidate.url().includes(part));
  const qa = (name) => app.evaluate((_electron, key) => { const value = globalThis.__aurumQa[key]; return value === undefined ? null : JSON.parse(JSON.stringify(value)); }, name);
  const setFeatures = (patch) => page.evaluate((value) => window.screenStudio.setFeatures(value), patch);
  const userData = () => path.join(outputDir, 'electron-user-data');
  const stopRecording = async () => {
    await page.waitForTimeout(1200);
    await page.locator('#stop-recording').dispatchEvent('click');
    await expect.poll(() => page.evaluate(() => (state.recorder ? 'on' : state.finalizing ? 'saving' : 'off')), { timeout: 30_000 }).toBe('off');
  };

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('new-extras'));
    await expect.poll(() => byUrl('quickbar.html').length, { timeout: 15_000 }).toBe(1);
  });
  test.afterAll(async () => closeStudio(app));

  test('1 · the journal records the start and marks the run as open', async () => {
    const log = await fs.readFile(path.join(userData(), 'app-journal.log'), 'utf8');
    expect(log).toMatch(/הפעלה: גרסה \d+\.\d+\.\d+/);
    await expect(fs.stat(path.join(userData(), 'app-running.json'))).resolves.toBeTruthy();
  });

  test('2 · the colour picker: one click on the frozen screen puts the colour on the clipboard', async () => {
    await byUrl('quickbar.html')[0].evaluate(() => { window.quickbarApi.runAction('colorPick'); });
    await expect.poll(() => byUrl('region-overlay.html').length, { timeout: 15_000 }).toBeGreaterThan(0);
    let overlay = null;
    await expect.poll(async () => {
      for (const candidate of byUrl('region-overlay.html')) {
        if (await candidate.evaluate(() => Boolean(document.querySelector('#hint, .hint')?.textContent.includes('קוד הצבע')) || document.body.textContent.includes('מעתיקה את קוד הצבע')).catch(() => false)) { overlay = candidate; return true; }
      }
      return false;
    }, { timeout: 15_000 }).toBe(true);
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('region-overlay.html')) win.showInactive(); });
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('region-overlay.html') && win.isVisible()) {
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 200, y: 200 });
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 200, y: 200 });
      }
    });
    await expect.poll(() => qa('lastPickedColor'), { timeout: 10_000 }).toMatch(/^#[0-9A-F]{6}$/);
    const picked = await qa('lastPickedColor');
    expect(await app.evaluate(async () => (await globalThis.__aurumQa.clipboard.readText()))).toBe(picked);
    expect(overlay).toBeTruthy();
  });

  test('3 · drawing during a recording: marks, undo, clear; gone when the recording ends', async () => {
    const toggle = () => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('recording-controls.html'));
      return win ? win.webContents.executeJavaScript("document.querySelector('#draw').click(); true") : false;
    });
    const liveOpen = () => app.evaluate(() => globalThis.__aurumQa.liveDraw.isOpen);
    const isDrawing = () => app.evaluate(() => globalThis.__aurumQa.liveDraw.drawing);

    await page.locator('#default-capture-kind').selectOption('record').catch(() => {});
    await setFeatures({ enabled: { liveDraw: false } });
    await page.evaluate(() => beginCapture('record', 'full'));
    await expect.poll(() => page.evaluate(() => state.recorder?.state || ''), { timeout: 20_000 }).toBe('recording');
    await expect.poll(() => qa('recordingControls').then((value) => Boolean(value)), { timeout: 10_000 }).toBe(true);
    const bar = () => byUrl('recording-controls.html')[0];
    await expect.poll(() => bar()?.evaluate(() => document.querySelector('#draw').hidden), { timeout: 10_000 }).toBe(true);
    await setFeatures({ enabled: { liveDraw: true } });
    await expect.poll(() => bar().evaluate(() => document.querySelector('#draw').hidden)).toBe(false);

    await toggle();
    await expect.poll(isDrawing, { timeout: 10_000 }).toBe(true);
    expect(await liveOpen()).toBe(true);
    expect(await app.evaluate(({ BrowserWindow, screen }) => { const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('live-draw.html')); return win.getBounds().height === screen.getPrimaryDisplay().bounds.height; })).toBe(true);
    await expect.poll(() => bar().evaluate(() => document.querySelector('#draw').getAttribute('aria-pressed'))).toBe('true');
    await expect.poll(() => byUrl('live-draw.html').length, { timeout: 10_000 }).toBe(1);
    const board = byUrl('live-draw.html')[0];
    await expect.poll(() => board.evaluate(() => document.body.dataset.drawing)).toBe('true');

    // Real mouse input; the window is shown only for this, as a test run leaves it unshown.
    // One stroke in one go: between separate calls Chromium's own moves (with no button, since Windows sees none) would end it.
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('live-draw.html')).showInactive(); });
    await page.waitForTimeout(300);
    const stroke = (x1, y1, x2, y2) => app.evaluate(({ BrowserWindow }, [a1, b1, a2, b2]) => {
      const { webContents } = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('live-draw.html'));
      webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: a1, y: b1 });
      webContents.sendInputEvent({ type: 'mouseMove', x: (a1 + a2) / 2, y: (b1 + b2) / 2, modifiers: ['leftButtonDown'] });
      webContents.sendInputEvent({ type: 'mouseMove', x: a2, y: b2, modifiers: ['leftButtonDown'] });
      webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: a2, y: b2 });
    }, [x1, y1, x2, y2]);
    const marks = () => board.evaluate(() => Number(document.documentElement.dataset.marks || 0));
    await stroke(100, 100, 300, 240);
    await expect.poll(marks).toBe(1);
    await app.evaluate(() => globalThis.__aurumQa.liveDraw.command('arrow'));
    await expect.poll(() => board.evaluate(() => document.documentElement.dataset.tool)).toBe('arrow');
    await stroke(400, 100, 600, 240);
    await expect.poll(marks).toBe(2);
    await app.evaluate(() => globalThis.__aurumQa.liveDraw.command('rect'));
    await stroke(100, 300, 300, 420);
    await expect.poll(marks).toBe(3);
    const painted = await board.evaluate(() => {
      const canvas = document.querySelector('#board');
      const scale = window.devicePixelRatio || 1;
      return canvas.getContext('2d').getImageData(Math.round(100 * scale), Math.round(360 * scale), 1, 1).data[3];
    });
    expect(painted).toBeGreaterThan(0);
    await app.evaluate(() => globalThis.__aurumQa.liveDraw.command('undo'));
    await expect.poll(marks).toBe(2);
    await app.evaluate(() => { const live = globalThis.__aurumQa.liveDraw; const before = live.color; live.command('color'); globalThis.__colorChanged = live.color !== before; });
    expect(await app.evaluate(() => globalThis.__colorChanged)).toBe(true);
    await app.evaluate(() => globalThis.__aurumQa.liveDraw.command('clear'));
    await expect.poll(marks).toBe(0);

    // Escape leaves drawing: the mouse goes back to the screen and the keys are released.
    await stroke(100, 100, 300, 240);
    await expect.poll(marks).toBe(1);
    await app.evaluate(() => globalThis.__aurumQa.liveDraw.command('exit'));
    await expect.poll(isDrawing).toBe(false);
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Z'))).toBe(false);
    expect(await marks()).toBe(1);

    await toggle();
    await expect.poll(isDrawing).toBe(true);
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Z'))).toBe(true);
    await stopRecording();
    await expect.poll(liveOpen, { timeout: 10_000 }).toBe(false);
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Z'))).toBe(false);
    await setFeatures({ enabled: { liveDraw: false } });
  });

  test('4 · a watermark reaches a saved picture only when the extra is on', async () => {
    const shoot = async () => {
      const before = await page.evaluate(() => document.documentElement.dataset.lastWatermark);
      await page.evaluate(() => { document.documentElement.dataset.lastWatermark = 'waiting'; beginCapture('screenshot', 'full'); });
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.lastWatermark), { timeout: 20_000 }).not.toBe('waiting');
      await expect.poll(() => page.evaluate(() => state.busy), { timeout: 20_000 }).toBe(false);
      return { before, now: await page.evaluate(() => document.documentElement.dataset.lastWatermark) };
    };
    expect((await shoot()).now).toBe('false');
    await setFeatures({ enabled: { watermark: true }, values: { watermark: { source: 'text', text: 'משרד טנארך', opacity: 100, position: 'top-left', size: 'large' } } });
    await expect.poll(() => page.evaluate(() => Boolean(state.features?.enabled?.watermark))).toBe(true);
    expect((await shoot()).now).toBe('true');

    // Drawn for real: the corner of a blank picture changes, the opposite corner does not.
    const pixels = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 400;
      const context = canvas.getContext('2d');
      context.fillStyle = '#000';
      context.fillRect(0, 0, 800, 400);
      stampWatermark(canvas, context, 'images');
      const lit = (x, y, w, h) => { const { data } = context.getImageData(x, y, w, h); let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 200) count += 1; return count; };
      return { corner: lit(0, 0, 300, 60), far: lit(500, 300, 300, 100) };
    });
    expect(pixels.corner).toBeGreaterThan(50);
    expect(pixels.far).toBe(0);

    // Images only: a recording's frames stay clean; a logo is kept and read back.
    expect(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 400; return stampWatermark(c, c.getContext('2d'), 'videos'); })).toBe(true);
    await setFeatures({ values: { watermark: { apply: 'images' } } });
    expect(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 400; return stampWatermark(c, c.getContext('2d'), 'videos'); })).toBe(false);
    const picture = path.join(outputDir, 'logo-source.png');
    await fs.writeFile(picture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));
    await app.evaluate((_electron, target) => globalThis.__aurumQa.setWatermarkLogo(target), picture);
    await expect(fs.stat(path.join(userData(), 'watermark-logo.png'))).resolves.toBeTruthy();
    await setFeatures({ values: { watermark: { source: 'logo' } } });
    await expect.poll(() => page.evaluate(() => Boolean(state.watermarkLogo)), { timeout: 10_000 }).toBe(true);
    await setFeatures({ enabled: { watermark: false } });
  });

  test('5 · automatic cleaning: old files go, new files and favourites stay', async () => {
    const tiny = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const directory = await app.evaluate(() => process.env.SCREEN_STUDIO_OUTPUT_DIR || null) || outputDir;
    const old = path.join(directory, 'בדיקת-ניקוי-ישן.png');
    const favourite = path.join(directory, 'בדיקת-ניקוי-מועדף.png');
    const fresh = path.join(directory, 'בדיקת-ניקוי-חדש.png');
    for (const file of [old, favourite, fresh]) await fs.writeFile(file, tiny);
    const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await fs.utimes(old, longAgo, longAgo);
    await fs.utimes(favourite, longAgo, longAgo);
    await fs.writeFile(`${favourite}.meta.json`, JSON.stringify({ favorite: true }));

    const exists = (file) => fs.stat(file).then(() => true, () => false);
    expect(await app.evaluate(() => globalThis.__aurumQa.runAutoClean())).toEqual({ skipped: 'off' });
    expect(await exists(old)).toBe(true);

    await setFeatures({ enabled: { autoClean: true }, values: { autoClean: { days: 90 } } });
    const preview = await page.evaluate(() => window.screenStudio.featureAction('auto-clean-preview'));
    expect(preview.message).toContain('יעברו לסל המיחזור');
    const result = await app.evaluate(() => globalThis.__aurumQa.runAutoClean());
    expect(result.moved).toBeGreaterThan(0);
    expect(await exists(old)).toBe(false);
    expect(await exists(favourite)).toBe(true);
    expect(await exists(fresh)).toBe(true);
    await setFeatures({ enabled: { autoClean: false } });
    for (const file of [favourite, `${favourite}.meta.json`, fresh]) await fs.rm(file, { force: true });
  });

  test('6 · a scheduled recording starts and stops by itself, then the one-time plan switches off', async () => {
    // The plan's clock is moved by the test; the recording itself is real.
    await app.evaluate(() => { globalThis.__scheduleClock = new Date(2026, 10, 5, 8, 59, 30).getTime(); globalThis.__aurumQa.recordSchedule.now = () => globalThis.__scheduleClock; });
    await setFeatures({ enabled: { recordSchedule: true }, values: { recordSchedule: { time: '09:00', minutes: 5, repeat: 'once' } } });
    const tickAt = (hour, minute, second = 0) => app.evaluate((_electron, [h, m, s]) => { globalThis.__scheduleClock = new Date(2026, 10, 5, h, m, s).getTime(); globalThis.__aurumQa.recordSchedule.tick(); }, [hour, minute, second]);
    await expect.poll(() => app.evaluate(() => globalThis.__aurumQa.recordSchedule.nextAt)).toBeTruthy();
    const said = await page.evaluate(() => window.screenStudio.featureAction('record-schedule-next'));
    expect(said.message).toContain('ההקלטה הבאה');

    await tickAt(8, 59, 30);
    expect((await qa('lastNotice')).body).toContain('בעוד דקה');
    await tickAt(9, 0);
    await expect.poll(() => page.evaluate(() => state.recorder?.state || ''), { timeout: 20_000 }).toBe('recording');
    await tickAt(9, 0, 10);
    await page.waitForTimeout(1500);
    await tickAt(9, 4, 59);
    expect(await page.evaluate(() => state.recorder?.state || '')).toBe('recording');
    await tickAt(9, 5);
    await expect.poll(() => page.evaluate(() => (state.recorder ? 'on' : state.finalizing ? 'saving' : 'off')), { timeout: 30_000 }).toBe('off');
    await expect.poll(() => page.evaluate(() => window.screenStudio.getFeatures().then((value) => value.enabled.recordSchedule))).toBe(false);
    const log = await fs.readFile(path.join(userData(), 'app-journal.log'), 'utf8');
    expect(log).toContain('הקלטה מתוזמנת התחילה');
    expect(log).toContain('הקלטה מתוזמנת הסתיימה');
    expect(runtimeErrors).toEqual([]);
  });
});
