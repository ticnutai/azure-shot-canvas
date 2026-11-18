const { test, expect } = require('@playwright/test');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The captures window, hidden in the right edge (as the user keeps it):
//   1  the design button opens its menu, and pressed again closes it
//   2  a handle being pulled never lets the window fold away, even when the pointer is outside it for a while
//   3  no handle on the side against the screen edge
//   4  the studio button folds the window away so the studio comes out in front
//   5  folded, it is a round button floating off the edge
test.describe.serial('the captures window in the edge: buttons and handles', () => {
  let app;
  let workspace;
  const pointer = (point) => app.evaluate(({ screen }, value) => {
    if (!globalThis.__realCursor) globalThis.__realCursor = screen.getCursorScreenPoint.bind(screen);
    screen.getCursorScreenPoint = value ? () => value : globalThis.__realCursor;
  }, point);
  const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('workspace.html')).getBounds());
  const docked = () => workspace.evaluate(() => document.documentElement.dataset.docked);

  test.beforeAll(async () => {
    ({ app } = await launchStudio('workspace-buttons'));
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
    workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const box = await bounds();
    await pointer({ x: box.x + 40, y: box.y + 40 });
    await workspace.locator('#dock').click();
    await expect.poll(docked).toBe('open');
  });
  test.afterAll(async () => { await pointer(null).catch(() => {}); await closeStudio(app); });

  test('1 · the design button opens its menu and closes it again', async () => {
    await workspace.locator('#theme-button').click();
    await expect(workspace.locator('#menu')).toBeVisible();
    await expect(workspace.locator('#menu [data-theme-choice]').first()).toBeVisible();
    await workspace.locator('#theme-button').click();
    await expect(workspace.locator('#menu')).toBeHidden();
    // Opened, then a press elsewhere in the window closes it too.
    await workspace.locator('#theme-button').click();
    await expect(workspace.locator('#menu')).toBeVisible();
    await workspace.locator('#search').click();
    await expect(workspace.locator('#menu')).toBeHidden();
  });

  test('2 · pulling a handle: the window stays open, even with the pointer outside it', async () => {
    const box = await bounds();
    await pointer({ x: box.x + 10, y: box.y + box.height - 2 });
    await workspace.evaluate(() => window.workspaceApi.resizeFrom('s'));
    // The pointer runs ahead of the window, far outside it, for longer than the window waits before folding.
    await pointer({ x: box.x - 300, y: box.y + box.height + 120 });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(await docked()).toBe('open');
    await workspace.evaluate(() => window.workspaceApi.resizeFrom(null));
    expect((await bounds()).height).toBeGreaterThan(box.height + 60);
    // Right after letting go it still waits a moment before folding.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await docked()).toBe('open');
    const now = await bounds();
    await pointer({ x: now.x + 40, y: now.y + 40 });
  });

  test('3 · no handle on the side against the screen edge', async () => {
    const shown = await workspace.evaluate(() => [...document.querySelectorAll('[data-grip]')].filter((grip) => getComputedStyle(grip).display !== 'none').map((grip) => grip.dataset.grip).sort());
    expect(shown).toEqual(['n', 'nw', 's', 'sw', 'w']);
  });

  test('4 · the studio button folds the window away and shows the studio', async () => {
    await workspace.locator('#open-studio').click();
    await expect.poll(docked).toBe('folded');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('index.html')).isVisible())).toBe(true);
  });

  test('5 · folded: the top bar own tab — a thin line with a small tab in its middle', async () => {
    const shape = await app.evaluate(() => globalThis.__aurumQa.tabShapes().find((item) => !item.tools).shape);
    const widths = shape.map((rect) => rect.width);
    expect(Math.max(...widths)).toBe(18); // the tab in the middle
    expect(widths[0]).toBe(5); // the thin line above and below it
    expect(widths.at(-1)).toBe(5);
    expect(shape.reduce((sum, rect) => sum + rect.height, 0)).toBe(120);
    await expect(workspace.locator('html')).toHaveAttribute('data-tab-style', 'tab');
  });
});
