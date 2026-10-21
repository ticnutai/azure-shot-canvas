const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

const powershell = (script) => new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout))));

// The captures window: several captures copied at once, and the window hidden in a screen edge like the top bar.
//   1  several chosen captures are copied together: the clipboard holds all of them as files
//   2  one capture is still copied as a picture
//   3  into the edge: open against the right edge and above other windows; folded it is the small tab only
//   4  pointing at the tab opens the window
//   5  the pointer away folds it again — not while pinned, not while a dialog is open
//   6  the tab can be dragged to another edge, and the place is remembered
//   7  Escape folds it; leaving the edge gives the free window back with its size and place
test.describe.serial('captures window: copy many, hide in the screen edge', () => {
  let app;
  let outputDir;
  let workspace;
  const pointer = (point) => app.evaluate(({ screen }, value) => {
    if (!globalThis.__realCursor) globalThis.__realCursor = screen.getCursorScreenPoint.bind(screen);
    screen.getCursorScreenPoint = value ? () => value : globalThis.__realCursor;
  }, point);
  const win = () => app.evaluate(({ BrowserWindow, screen }) => {
    const target = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('workspace.html'));
    const box = target.getBounds();
    return { box, area: screen.getDisplayMatching(box).workArea, onTop: target.isAlwaysOnTop(), min: target.getMinimumSize() };
  });
  const docked = () => workspace.evaluate(() => document.documentElement.dataset.docked);

  test.beforeAll(async () => {
    ({ app, outputDir } = await launchStudio('workspace-dock'));
    const baseline = path.resolve(__dirname, '..', 'visual', '__baseline__');
    const samples = (await fs.readdir(baseline)).filter((name) => name.endsWith('.png')).slice(0, 3);
    for (const [index, name] of samples.entries()) await fs.copyFile(path.join(baseline, name), path.join(outputDir, `צילום_2026-10-08_10-0${index}-00-000.png`));
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
    workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await expect(workspace.locator('.item')).toHaveCount(3);
  });
  test.afterAll(async () => { await pointer(null).catch(() => {}); await closeStudio(app); });

  test('1 · several chosen captures are copied together: the clipboard holds all of them as files', async () => {
    await workspace.locator('#grid').focus();
    await workspace.keyboard.press('Control+A');
    await workspace.keyboard.press('Control+C');
    await expect(workspace.locator('#count')).toContainText('הועתקו 3 צילומים');
    const files = (await powershell('(Get-Clipboard -Format FileDropList).FullName')).trim().split(/\r?\n/).filter(Boolean);
    expect(files.length).toBe(3);
    expect(files.every((file) => file.startsWith(outputDir))).toBe(true);
  });

  test('2 · one capture is still copied as a picture', async () => {
    await workspace.locator('.item').first().click();
    await workspace.keyboard.press('Control+C');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readImage().isEmpty())).toBe(false);
  });

  test('3 · into the edge: open against the right edge and above others; folded it is the small tab only', async () => {
    await pointer({ x: 5, y: 5 });
    await workspace.locator('#dock').click();
    await expect.poll(docked).toBe('open');
    let state = await win();
    expect(state.box.x + state.box.width).toBe(state.area.x + state.area.width);
    expect(state.onTop).toBe(true);
    await workspace.evaluate(() => window.workspaceApi.setDock({ expanded: false }));
    await expect.poll(docked).toBe('folded');
    state = await win();
    // The tab starts 18 points from the right edge. Windows keeps the folded window ~40 wide at least; the part past
    // the edge is cut away (the window is shaped to the tab), so only the tab shows and takes the pointer.
    expect(state.box.x).toBe(state.area.x + state.area.width - 18);
    expect(state.box.width).toBeLessThanOrEqual(48);
    expect(state.box.height).toBeGreaterThanOrEqual(120);
    expect(state.box.height).toBeLessThanOrEqual(130);
    await expect(workspace.locator('#dock-tab')).toBeVisible();
    await expect(workspace.locator('#grid')).toBeHidden();
  });

  test('4 · pointing at the tab opens the window', async () => {
    await workspace.locator('#dock-tab').dispatchEvent('mouseenter');
    await expect.poll(docked, { timeout: 5000 }).toBe('open');
    expect((await win()).box.width).toBeGreaterThanOrEqual(420);
  });

  test('5 · the pointer away folds it again — not while pinned, not while a dialog is open', async () => {
    await pointer({ x: 5, y: 5 });
    await expect.poll(docked, { timeout: 5000 }).toBe('folded');
    // The pointer over where the window opens (against the right edge, mid-height) while it is pinned.
    const area = (await win()).area;
    await pointer({ x: area.x + area.width - 60, y: area.y + Math.round(area.height / 2) });
    await workspace.evaluate(() => window.workspaceApi.setDock({ expanded: true }));
    await expect.poll(docked).toBe('open');
    await workspace.locator('#on-top').click();
    await expect(workspace.locator('#on-top')).toHaveAttribute('aria-pressed', 'true');
    await pointer({ x: 5, y: 5 });
    await workspace.waitForTimeout(1800);
    expect(await docked()).toBe('open');
    await pointer({ x: area.x + area.width - 60, y: area.y + Math.round(area.height / 2) });
    await workspace.locator('#on-top').click();
    await expect(workspace.locator('#on-top')).toHaveAttribute('aria-pressed', 'false');
    // A dialog open (the keys window): the pointer may leave, the window stays.
    await workspace.locator('#grid').focus();
    await workspace.keyboard.press('F1');
    await expect(workspace.locator('html')).toHaveAttribute('data-busy', 'true');
    await pointer({ x: 5, y: 5 });
    await workspace.waitForTimeout(1800);
    expect(await docked()).toBe('open');
    // Dialog closed, pointer away: it folds.
    await workspace.keyboard.press('Escape');
    await expect.poll(docked, { timeout: 5000 }).toBe('folded');
  });

  test('6 · the tab can be dragged to another edge, and the place is remembered', async () => {
    const area = (await win()).area;
    await pointer({ x: area.x + 3, y: area.y + Math.round(area.height * 0.7) });
    await workspace.evaluate(() => window.workspaceApi.dragDock(true));
    await expect.poll(() => workspace.evaluate(() => document.documentElement.dataset.dockEdge)).toBe('left');
    await workspace.evaluate(() => window.workspaceApi.dragDock(false));
    const state = await win();
    expect(state.box.x).toBe(area.x);
    const saved = JSON.parse(await fs.readFile(path.join(outputDir, 'electron-user-data', 'workspace-window.json'), 'utf8'));
    expect(saved.dock).toMatchObject({ enabled: true, edge: 'left' });
    expect(saved.dock.offset).toBeGreaterThan(0.6);
  });

  test('7 · Escape folds it; leaving the edge gives the free window back with its size and place', async () => {
    await workspace.evaluate(() => window.workspaceApi.setDock({ expanded: true }));
    await expect.poll(docked).toBe('open');
    await workspace.locator('#grid').focus();
    await workspace.keyboard.press('Escape');
    await expect.poll(docked).toBe('folded');
    await workspace.evaluate(() => window.workspaceApi.setDock({ enabled: false }));
    await expect.poll(docked).toBe('off');
    const state = await win();
    expect(state.box.width).toBeGreaterThanOrEqual(420);
    expect(state.min).toEqual([420, 380]);
    expect(state.onTop).toBe(false);
  });
});
