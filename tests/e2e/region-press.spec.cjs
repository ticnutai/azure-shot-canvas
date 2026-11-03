const { test, expect } = require('@playwright/test');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// A press on the frozen screen always ends, even when its release never reaches the page: the mark or the area stops
// following the mouse. Everything is real mouse input, as Windows delivers it, with the release left out.
test.describe.serial('a press on the frozen screen always ends', () => {
  let app;
  let overlay;
  const byUrl = (part) => app.windows().filter((candidate) => candidate.url().includes(part));
  const input = (event) => app.evaluate(({ BrowserWindow }, value) => {
    for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('region-overlay.html') && win.isVisible()) win.webContents.sendInputEvent(value);
  }, event);
  const press = (x, y) => input({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
  const moveHeld = (x, y) => input({ type: 'mouseMove', x, y, modifiers: ['leftButtonDown'] });
  const letGo = (x, y) => input({ type: 'mouseUp', button: 'left', clickCount: 1, x, y });
  const realMove = (x, y) => input({ type: 'mouseMove', x, y });
  const open = async () => {
    const since = byUrl('region-overlay.html').length ? Math.max(0, ...await Promise.all(byUrl('region-overlay.html').map((c) => c.evaluate(() => Number(document.documentElement.dataset.regionReady || 0))))) : 0;
    await byUrl('quickbar.html')[0].evaluate(() => window.quickbarApi.runAction('region'));
    await expect.poll(() => byUrl('region-overlay.html').length, { timeout: 15_000 }).toBeGreaterThan(0);
    for (const candidate of byUrl('region-overlay.html')) {
      if (await candidate.waitForFunction((after) => Number(document.documentElement.dataset.regionReady || 0) > after, since, { timeout: 8_000 }).then(() => true).catch(() => false)) {
        overlay = candidate;
        // A test run leaves this window unshown, and a real input event needs it shown.
        await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('region-overlay.html')) win.showInactive(); });
        return;
      }
    }
    throw new Error('no frozen screen');
  };
  const cancel = () => overlay.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  const dragging = () => overlay.evaluate(() => document.body.dataset.dragging);
  const undoOff = () => overlay.evaluate(() => document.querySelector('[data-command="undo"]').disabled);
  const area = () => overlay.evaluate(() => document.querySelector('#size-label').textContent);

  test.beforeAll(async () => {
    ({ app } = await launchStudio('region-press'));
    await expect.poll(() => byUrl('quickbar.html').length, { timeout: 15_000 }).toBe(1);
    await byUrl('quickbar.html')[0].evaluate(() => window.quickbarApi.setPreferences({ regionMarkup: true }));
  });
  test.afterAll(async () => closeStudio(app));

  test('choosing an area: a move with no button ends the press', async () => {
    await open();
    await realMove(100, 100);
    await press(100, 100);
    await moveHeld(400, 300);
    await expect.poll(dragging).toBe('true');
    await realMove(700, 500);
    await expect.poll(dragging).toBe('false');
    // The area is where the button was let go, and it no longer follows the mouse.
    await expect.poll(() => overlay.evaluate(() => document.querySelector('#toolbar').hidden)).toBe(false);
    const chosen = await area();
    await realMove(900, 700);
    await overlay.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await area()).toBe(chosen);
  });

  test('drawing a mark: a move with no button ends it, and the mark is kept', async () => {
    await overlay.evaluate(() => document.querySelector('[data-tool="rect"]').click());
    expect(await undoOff()).toBe(true);
    await realMove(150, 150);
    await press(150, 150);
    await moveHeld(280, 240);
    await realMove(300, 260);
    await expect.poll(undoOff).toBe(false);
    // A next press starts a new mark instead of carrying on with the old one.
    await press(170, 170);
    await moveHeld(260, 220);
    await letGo(260, 220);
    const undo = () => overlay.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true })));
    await undo();
    await expect.poll(undoOff).toBe(false);
    await undo();
    await expect.poll(undoOff).toBe(true);
    await cancel();
  });

  test('the system takes the pointer away: nothing is chosen', async () => {
    await open();
    await realMove(100, 100);
    await press(100, 100);
    await moveHeld(400, 300);
    await expect.poll(dragging).toBe('true');
    await overlay.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
    expect(await dragging()).toBe('false');
    expect(await overlay.evaluate(() => document.querySelector('#toolbar').hidden)).toBe(true);
    await cancel();
  });
});
