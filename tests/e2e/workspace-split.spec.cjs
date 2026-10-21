const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The captures window split in two: the list in one window, its action buttons in a second, small one.
//   1  the split button opens the tools window; the list window no longer shows the buttons
//   2  the tools buttons follow the choice made in the list, and act on it (copy)
//   3  a button with a dialog (folder) opens it in the list window
//   4  a design chosen in the list shows in the tools window at once
//   5  each window hides in a screen edge on its own
//   6  closing the tools window ends the split: the buttons are back in the list
//   7  the split is remembered: closing the list closes both, opening again brings both back
test.describe.serial('captures window split in two', () => {
  let app;
  let list;
  const tools = () => app.windows().find((candidate) => candidate.url().includes('part=tools'));
  const toolsCount = () => app.windows().filter((candidate) => candidate.url().includes('part=tools')).length;
  const listCount = () => app.windows().filter((candidate) => candidate.url().includes('workspace.html') && !candidate.url().includes('part=tools')).length;
  const openList = async () => {
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(listCount, { timeout: 15_000 }).toBe(1);
    list = app.windows().find((candidate) => candidate.url().includes('workspace.html') && !candidate.url().includes('part=tools'));
    await list.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  };
  const ready = async () => {
    await expect.poll(toolsCount, { timeout: 15_000 }).toBe(1);
    await tools().waitForFunction(() => document.documentElement.dataset.ready === 'true' && document.documentElement.dataset.split === 'on');
  };

  test.beforeAll(async () => {
    let outputDir;
    ({ app, outputDir } = await launchStudio('workspace-split'));
    const baseline = path.resolve(__dirname, '..', 'visual', '__baseline__');
    const samples = (await fs.readdir(baseline)).filter((name) => name.endsWith('.png')).slice(0, 3);
    for (const [index, name] of samples.entries()) await fs.copyFile(path.join(baseline, name), path.join(outputDir, `צילום_2026-10-08_11-0${index}-00-000.png`));
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await openList();
    // The light design shows the buttons as a ribbon; it is the one checked here.
    await list.evaluate(() => { localStorage.setItem('aurum-ws-theme', 'office'); localStorage.setItem('aurum-ws-bar', 'full'); });
    await list.reload();
    await list.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await expect(list.locator('.item')).toHaveCount(3);
  });
  test.afterAll(async () => closeStudio(app));

  test('1 · the split button opens the tools window; the list window no longer shows the buttons', async () => {
    await expect(list.locator('.ribbon')).toBeVisible();
    await list.locator('#split').click();
    await ready();
    await expect(list.locator('html')).toHaveAttribute('data-split', 'on');
    await expect(list.locator('#split')).toHaveAttribute('aria-pressed', 'true');
    await expect(list.locator('.ribbon')).toBeHidden();
    await expect(list.locator('#grid')).toBeVisible();
    const win = tools();
    await expect(win.locator('.ribbon')).toBeVisible();
    await expect(win.locator('#grid')).toBeHidden();
    await expect(win.locator('.title')).toHaveText('כלי הצילום');
    // The tools window is small, with a title bar of its own.
    const box = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('part=tools')).getBounds());
    expect(box.height).toBeLessThan(300);
    // Its height follows its buttons: narrow, they wrap and the window grows so none is cut off.
    const allInside = () => win.evaluate(() => [...document.querySelectorAll('.ribbon button')].every((button) => {
      const edge = button.getBoundingClientRect();
      return edge.bottom <= window.innerHeight + 1 && edge.left >= -1 && edge.right <= window.innerWidth + 1;
    }));
    await expect.poll(allInside).toBe(true);
    await app.evaluate(({ BrowserWindow }) => { const target = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('part=tools')); target.setBounds({ ...target.getBounds(), width: 430 }); });
    await expect.poll(allInside).toBe(true);
    await app.evaluate(({ BrowserWindow }) => { const target = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('part=tools')); target.setBounds({ ...target.getBounds(), width: 760 }); });
  });

  test('2 · the tools buttons follow the choice made in the list, and act on it', async () => {
    const win = tools();
    await expect(win.locator('.ribbon [data-item-action="copy"]')).toBeDisabled();
    await expect(win.locator('.ribbon [data-action="region"]')).toBeEnabled();
    await list.locator('.item').first().click();
    await expect(win.locator('.ribbon [data-item-action="copy"]')).toBeEnabled();
    await expect(win.locator('.ribbon [data-item-action="edit"]')).toBeEnabled();
    await win.locator('.ribbon [data-item-action="copy"]').click();
    await expect(list.locator('#count')).toContainText('הצילום הועתק');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readImage().isEmpty())).toBe(false);
    // Two chosen: the one-capture buttons turn off again.
    await list.locator('.item').nth(1).click({ modifiers: ['Control'] });
    await expect(win.locator('.ribbon [data-item-action="edit"]')).toBeDisabled();
    await expect(win.locator('.ribbon [data-item-action="copy"]')).toBeEnabled();
  });

  test('3 · a button with a dialog opens it in the list window', async () => {
    await tools().locator('.ribbon [data-item-action="folder"]').click();
    await expect(list.locator('html')).toHaveAttribute('data-dialog', 'folder');
    await expect(list.locator('#dialog h2')).toHaveText('העברה לתיקייה (2 צילומים)');
    await expect(tools().locator('#dialog-backdrop')).toBeHidden();
    await list.keyboard.press('Escape');
    await expect(list.locator('#dialog-backdrop')).toBeHidden();
  });

  test('4 · a design chosen in the list shows in the tools window at once', async () => {
    await list.locator('#theme-button').click();
    await list.locator('#menu [data-theme-choice="tiles"]').click();
    await expect(tools().locator('html')).toHaveAttribute('data-theme', 'tiles');
    await list.locator('#theme-button').click();
    await list.locator('#menu [data-theme-choice="office"]').click();
    await expect(tools().locator('html')).toHaveAttribute('data-theme', 'office');
  });

  test('5 · each window hides in a screen edge on its own', async () => {
    const win = tools();
    await win.locator('#dock').click();
    await expect(win.locator('html')).toHaveAttribute('data-docked', 'open');
    await expect(list.locator('html')).toHaveAttribute('data-docked', 'off');
    await win.evaluate(() => window.workspaceApi.setDock({ expanded: false }));
    await expect(win.locator('html')).toHaveAttribute('data-docked', 'folded');
    // Its tab sits higher on the right edge than the list's would.
    const box = await app.evaluate(({ BrowserWindow, screen }) => {
      const target = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('part=tools'));
      return { box: target.getBounds(), area: screen.getDisplayMatching(target.getBounds()).workArea };
    });
    // The tab starts 18 points from the right edge (Windows keeps the window wider; the rest is cut away).
    expect(box.box.x).toBe(box.area.x + box.area.width - 18);
    expect(box.box.y).toBeLessThan(box.area.y + box.area.height * 0.4);
    await win.evaluate(() => window.workspaceApi.setDock({ enabled: false }));
    await expect(win.locator('html')).toHaveAttribute('data-docked', 'off');
  });

  test('6 · closing the tools window ends the split: the buttons are back in the list', async () => {
    await tools().locator('#close').click();
    await expect.poll(toolsCount).toBe(0);
    await expect(list.locator('html')).toHaveAttribute('data-split', 'off');
    await expect(list.locator('.ribbon')).toBeVisible();
    // The keys of the list still work as before.
    await list.locator('.item').first().click();
    await list.keyboard.press('F2');
    await expect(list.locator('html')).toHaveAttribute('data-dialog', 'rename');
    await list.keyboard.press('Escape');
  });

  test('7 · the split is remembered: closing the list closes both, opening again brings both back', async () => {
    await list.locator('#split').click();
    await ready();
    await list.locator('#close').click();
    await expect.poll(listCount).toBe(0);
    await expect.poll(toolsCount).toBe(0);
    await openList();
    await ready();
    await expect(list.locator('html')).toHaveAttribute('data-split', 'on');
    await expect(list.locator('.ribbon')).toBeHidden();
  });

  test('8 · handles on every side: dragging one makes the window bigger or smaller from that side', async () => {
    const pointer = (point) => app.evaluate(({ screen }, value) => {
      if (!globalThis.__realCursor) globalThis.__realCursor = screen.getCursorScreenPoint.bind(screen);
      screen.getCursorScreenPoint = value ? () => value : globalThis.__realCursor;
    }, point);
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('workspace.html') && !candidate.webContents.getURL().includes('part=tools')).getBounds());
    const press = (grip, type, buttons) => list.locator(`[data-grip="${grip}"]`).dispatchEvent(type, { button: 0, buttons, pointerId: 1 });
    await expect(list.locator('[data-grip]')).toHaveCount(8);
    const start = await bounds();
    // The left side, dragged 100 points further left: wider, and the right side stays put.
    await pointer({ x: start.x, y: start.y + 200 });
    await press('w', 'pointerdown', 1);
    await pointer({ x: start.x - 100, y: start.y + 200 });
    await expect.poll(async () => (await bounds()).width).toBe(start.width + 100);
    expect((await bounds()).x + (await bounds()).width).toBe(start.x + start.width);
    await press('w', 'pointerup', 0);
    // The bottom-right corner, dragged up and in: smaller on both sides, never below the smallest size.
    const wide = await bounds();
    await pointer({ x: wide.x + wide.width, y: wide.y + wide.height });
    await press('se', 'pointerdown', 1);
    await pointer({ x: wide.x + wide.width - 50, y: wide.y + wide.height - 2000 });
    await expect.poll(async () => (await bounds()).height).toBe(380);
    expect((await bounds()).width).toBe(wide.width - 50);
    await press('se', 'pointerup', 0);
    // Let go: moving the pointer no longer changes the window.
    const after = await bounds();
    await pointer({ x: 10, y: 10 });
    await list.waitForTimeout(150);
    expect(await bounds()).toEqual(after);
    await pointer(null);
  });
});
