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

  test('a click outside the area does not lose the marks; with no marks it starts a new area', async () => {
    const toolbarHidden = () => overlay.evaluate(() => document.querySelector('#toolbar').hidden);
    const useTool = (name) => overlay.evaluate((tool) => document.querySelector(`[data-tool="${tool}"]`).click(), name);
    const clickAt = async (x, y) => { await realMove(x, y); await press(x, y); await letGo(x, y); };
    const settled = () => overlay.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await open();
    await realMove(200, 200);
    await press(200, 200);
    await moveHeld(500, 450);
    await letGo(500, 450);
    await expect.poll(toolbarHidden).toBe(false);
    await useTool('rect');
    await realMove(250, 250);
    await press(250, 250);
    await moveHeld(350, 330);
    await letGo(350, 330);
    await expect.poll(undoOff).toBe(false);

    await useTool('move');
    const before = await area();
    await clickAt(800, 700);
    await settled();
    expect(await undoOff()).toBe(false);
    expect(await toolbarHidden()).toBe(false);
    expect(await dragging()).toBe('false');
    expect(await area()).toBe(before);

    // The mark can still be taken back, and then a click outside starts a new area as before.
    await overlay.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true })));
    await expect.poll(undoOff).toBe(true);
    await realMove(800, 700);
    await press(800, 700);
    await expect.poll(dragging).toBe('true');
    await expect.poll(toolbarHidden).toBe(true);
    await letGo(800, 700);
    await cancel();
  });

  test('a mark can be changed after it is drawn: handles on every side, moving, undo, delete', async () => {
    const box = () => overlay.evaluate(() => document.documentElement.dataset.activeBounds || '');
    const kind = () => overlay.evaluate(() => document.documentElement.dataset.activeShape || '');
    const useTool = (name) => overlay.evaluate((tool) => document.querySelector(`[data-tool="${tool}"]`).click(), name);
    const drag = async (x1, y1, x2, y2) => { await realMove(x1, y1); await press(x1, y1); await moveHeld(Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)); await moveHeld(x2, y2); await letGo(x2, y2); await settled(); };
    const clickAt = async (x, y) => { await realMove(x, y); await press(x, y); await letGo(x, y); await settled(); };
    const settled = () => overlay.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const undo = async () => { await overlay.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true }))); await settled(); };
    await open();
    await drag(100, 100, 900, 700);
    await expect.poll(() => overlay.evaluate(() => document.querySelector('#toolbar').hidden)).toBe(false);
    await useTool('rect');

    // Just drawn: it already shows its handles.
    await drag(200, 200, 400, 400);
    expect(await kind()).toBe('rect');
    expect(await box()).toBe('200,200,200,200');
    // Wider from the right side, narrower from the left, taller from below: each in one direction only.
    await drag(400, 300, 500, 330);
    expect(await box()).toBe('200,200,300,200');
    await drag(200, 300, 260, 100);
    expect(await box()).toBe('260,200,240,200');
    await drag(380, 400, 300, 450);
    expect(await box()).toBe('260,200,240,250');
    // A corner changes both.
    await drag(500, 450, 450, 420);
    expect(await box()).toBe('260,200,190,220');

    // A press elsewhere draws a new one; a click on the old one brings its handles back, with the same tool on.
    await drag(600, 500, 700, 600);
    expect(await box()).toBe('600,500,100,100');
    await clickAt(300, 300);
    expect(await box()).toBe('260,200,190,220');
    // With the move tool: a drag moves it.
    await useTool('move');
    await drag(300, 300, 330, 310);
    expect(await box()).toBe('290,210,190,220');
    // Undo takes back the change itself and not the whole mark.
    await undo();
    await clickAt(300, 300);
    expect(await box()).toBe('260,200,190,220');
    // Delete removes the chosen one only; undo brings it back.
    await overlay.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true })));
    await settled();
    expect(await kind()).toBe('');
    await clickAt(300, 300);
    expect(await kind()).toBe('');
    await undo();
    await clickAt(300, 300);
    expect(await kind()).toBe('rect');
    // A double click on a mark does not end the work.
    await realMove(300, 300);
    await press(300, 300);
    await letGo(300, 300);
    await input({ type: 'mouseDown', button: 'left', clickCount: 2, x: 300, y: 300 });
    await input({ type: 'mouseUp', button: 'left', clickCount: 2, x: 300, y: 300 });
    await settled();
    expect(await overlay.evaluate(() => document.querySelector('#toolbar').hidden)).toBe(false);
    expect(await overlay.evaluate(() => document.documentElement.dataset.regionAfter || '')).toBe('');
    // Escape first lets go of the mark, and only then ends the capture.
    await cancel();
    expect(await kind()).toBe('');
    expect(await overlay.evaluate(() => document.querySelector('#toolbar').hidden)).toBe(false);
    await cancel();
  });

  test('a press that starts outside the area still draws, from the nearest edge', async () => {
    const settled = () => overlay.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await open();
    await realMove(300, 300);
    await press(300, 300);
    await moveHeld(600, 600);
    await letGo(600, 600);
    await expect.poll(() => overlay.evaluate(() => document.querySelector('#toolbar').hidden)).toBe(false);
    await overlay.evaluate(() => document.querySelector('[data-tool="rect"]').click());
    await realMove(100, 400);
    await press(100, 400);
    await moveHeld(450, 500);
    await letGo(450, 500);
    await settled();
    expect(await overlay.evaluate(() => document.documentElement.dataset.activeBounds)).toBe('300,400,150,100');
    await cancel();
    await cancel();
  });

  test('the key held by the program (as Escape really arrives): the list of keys closes and the capture stays', async () => {
    const heldEscape = () => app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('region-overlay.html') && win.isVisible()) win.webContents.send('region:key', 'Escape'); });
    await open();
    await realMove(300, 300);
    await press(300, 300);
    await moveHeld(600, 600);
    await letGo(600, 600);
    await expect.poll(() => overlay.evaluate(() => document.querySelector('#toolbar').hidden)).toBe(false);
    await overlay.evaluate(() => document.querySelector('[data-command="tool-keys"]').click());
    await overlay.evaluate(() => document.querySelector('[data-key-tool="rect"]').click());
    await heldEscape();
    await expect(overlay.locator('[data-key-tool="rect"]')).toHaveAttribute('data-listening', 'false');
    await expect(overlay.locator('#keys-panel')).toBeVisible();
    await heldEscape();
    await expect(overlay.locator('#keys-panel')).toBeHidden();
    await expect(overlay.locator('#toolbar')).toBeVisible();
    await heldEscape();
    await expect.poll(() => overlay.evaluate(() => document.documentElement.dataset.regionReleased || '')).not.toBe('');
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
