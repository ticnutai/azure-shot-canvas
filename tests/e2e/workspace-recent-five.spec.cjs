const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The captures window docked as a narrow side panel (as the user keeps it):
//   1  it shows the five newest captures, newest first, and a button for all of them
//   2  "all" shows every capture, and docking again starts from the five newest
//   3  cards are never wider than the panel: no sideways scrolling, whole cards
//   4  the large cards show the original pictures, sharp
test.describe.serial('the side panel: always the five newest, whole and sharp', () => {
  let app;
  let workspace;
  const names = [];
  const pointer = (point) => app.evaluate(({ screen }, value) => {
    if (!globalThis.__realCursor) globalThis.__realCursor = screen.getCursorScreenPoint.bind(screen);
    screen.getCursorScreenPoint = value ? () => value : globalThis.__realCursor;
  }, point);
  const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('workspace.html')).getBounds());
  const docked = () => workspace.evaluate(() => document.documentElement.dataset.docked);
  const shownNames = () => workspace.locator('.item').evaluateAll((tiles) => tiles.map((tile) => tile.title));

  test.beforeAll(async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screen-studio-recent-five-'));
    for (let index = 1; index <= 7; index += 1) {
      const file = path.join(outputDir, `צילום ${index}.png`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=1', '-frames:v', '1', file]);
      const stamp = new Date(Date.now() - (8 - index) * 60_000);
      await fs.utimes(file, stamp, stamp);
      names.push(path.basename(file));
    }
    ({ app } = await launchStudio('workspace-recent-five', { outputDir }));
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
    workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await expect(workspace.locator('.item')).toHaveCount(7, { timeout: 15_000 });
    const box = await bounds();
    await pointer({ x: box.x + 40, y: box.y + 40 });
    await workspace.locator('#dock').click();
    await expect.poll(docked).toBe('open');
    const now = await bounds();
    await pointer({ x: now.x + 40, y: now.y + 40 });
  });
  test.afterAll(async () => { await pointer(null).catch(() => {}); await closeStudio(app); });

  test('1 · five newest, newest first, and a button for all', async () => {
    await expect(workspace.locator('.item')).toHaveCount(5);
    expect(await shownNames()).toEqual(names.slice(2).reverse());
    await expect(workspace.locator('.show-all-captures')).toHaveText('הצגת כל הצילומים (7)');
  });

  test('2 · "all" shows every capture; docking again starts from the five newest', async () => {
    await workspace.locator('.show-all-captures').click();
    await expect(workspace.locator('.item')).toHaveCount(7);
    await expect(workspace.locator('.show-all-captures')).toHaveText('רק 5 האחרונים');
    await workspace.locator('.show-all-captures').click();
    await expect(workspace.locator('.item')).toHaveCount(5);
  });

  test('3 · no card is wider than the panel, nothing scrolls sideways', async () => {
    // As large as the slider goes, in a narrow panel.
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('workspace.html')); const box = win.getBounds(); win.setBounds({ ...box, width: 420 }); });
    await workspace.locator('#thumb-size').evaluate((slider) => { slider.value = slider.max; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    const layout = await workspace.evaluate(() => {
      const grid = document.querySelector('#grid');
      const tiles = [...grid.querySelectorAll('.item')].map((tile) => tile.getBoundingClientRect());
      const area = grid.getBoundingClientRect();
      return { sideways: grid.scrollWidth - grid.clientWidth, outside: tiles.filter((rect) => rect.left < area.left - 1 || rect.right > area.right + 1).length };
    });
    expect(layout.sideways).toBeLessThanOrEqual(1);
    expect(layout.outside).toBe(0);
  });

  test('4 · the large cards show the original pictures, sharp', async () => {
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('workspace.html')); const box = win.getBounds(); win.setBounds({ ...box, width: 760 }); });
    const first = workspace.locator('.item img').first();
    await expect.poll(() => first.evaluate((image) => image.naturalWidth), { timeout: 15_000 }).toBe(1920);
    expect(await first.evaluate((image) => image.dataset.sharp)).toBe('full');
  });
});
