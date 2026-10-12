const { test, expect } = require('@playwright/test');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// Drop-down lists opened and shut at once: every 0.8 s the top bar re-asserted its place and always-on-top level,
// and Windows closes an open drop-down whenever the window order changes. Nothing may touch the window order, or
// replace a drop-down under the pointer, while the user is just looking at a screen.
//   1  with the pointer still, the top bar is never moved or raised again
//   2  when the pointer moves to another place the bar must follow, it still moves (the fix did not freeze it)
//   3  no drop-down in the studio or the captures window is rebuilt while the user only looks
test.describe.serial('drop-down lists stay open', () => {
  let app;
  let page;

  test.beforeAll(async () => {
    ({ app, page } = await launchStudio('dropdown-stability'));
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
  });
  test.afterAll(async () => closeStudio(app));

  // Counts the calls that change the window order on the top bar, for `ms` milliseconds.
  const countBarTouches = (ms) => app.evaluate(async ({ BrowserWindow }, wait) => {
    const bar = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('quickbar.html'));
    const counts = { setBounds: 0, setAlwaysOnTop: 0, showInactive: 0, moveTop: 0 };
    const originals = {};
    for (const name of Object.keys(counts)) {
      originals[name] = bar[name];
      bar[name] = function (...args) { counts[name] += 1; return originals[name].apply(this, args); };
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    for (const name of Object.keys(counts)) bar[name] = originals[name];
    return counts;
  }, ms);

  test('1 · with the pointer still, the top bar is never moved or raised again', async () => {
    // The bar is placed a few times while the studio starts (recent captures arrive); after that, quiet.
    await page.waitForTimeout(3000);
    const counts = await countBarTouches(3500);
    expect(counts).toEqual({ setBounds: 0, setAlwaysOnTop: 0, showInactive: 0, moveTop: 0 });
  });

  test('2 · when the bar is out of place it is still moved back (the fix did not freeze it)', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const bar = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('quickbar.html'));
      const box = bar.getBounds();
      bar.setBounds({ ...box, x: box.x + 40 });
    });
    const counts = await countBarTouches(2000);
    expect(counts.setBounds).toBeGreaterThanOrEqual(1);
    const again = await countBarTouches(2000);
    expect(again.setBounds).toBe(0);
  });

  test('3 · no drop-down in the studio or the captures window is rebuilt while the user only looks', async () => {
    const watch = (target) => target.evaluate(() => new Promise((resolve) => {
      let replaced = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 1 && (node.matches('select') || node.querySelector?.('select'))) replaced += 1;
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve({ replaced, selects: document.querySelectorAll('select').length }); }, 3000);
    }));
    await page.locator('[data-page="settings"]').click();
    const studio = await watch(page);
    expect(studio.selects).toBeGreaterThan(0);
    expect(studio.replaced).toBe(0);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
    const workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const captures = await watch(workspace);
    expect(captures.replaced).toBe(0);
  });
});
