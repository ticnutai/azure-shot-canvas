const { test, expect } = require('@playwright/test');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The "start with the computer" switch stays where it was put. Windows' start list is replaced here by one in memory
// that compares like the real one (the path and the arguments must match exactly), so a test run never changes the
// real list of this computer.
test.describe.serial('start with the computer', () => {
  let app;
  let page;

  test.beforeAll(async () => {
    ({ app, page } = await launchStudio('autostart'));
    await app.evaluate(({ app: electronApp }) => {
      let entry = '';
      globalThis.__clearStartList = () => { entry = ''; };
      const line = (options = {}) => [options.path || process.execPath, ...(options.args || [])].join(' ');
      electronApp.setLoginItemSettings = (options) => { entry = options.openAtLogin ? line(options) : ''; };
      electronApp.getLoginItemSettings = (options) => ({ openAtLogin: entry === line(options) });
    });
  });
  test.afterAll(async () => closeStudio(app));

  test('turning it on stays on, turning it off stays off', async () => {
    await page.locator('[data-page="settings"]').click();
    const box = page.locator('#autostart-app');
    await box.evaluate((element) => element.closest('[data-preference-panel]')?.classList.add('active'));
    const flip = (on) => box.evaluate((element, value) => {
      element.checked = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, on);

    await flip(true);
    await expect.poll(() => page.evaluate(() => window.screenStudio.getAutostart())).toBe(true);
    await page.waitForTimeout(300);
    await expect(box).toBeChecked();

    await flip(false);
    await expect.poll(() => page.evaluate(() => window.screenStudio.getAutostart())).toBe(false);
    await page.waitForTimeout(300);
    await expect(box).not.toBeChecked();
  });

  test('an entry that went missing comes back at the next opening; one turned off stays off', async () => {
    const isOn = () => page.evaluate(() => window.screenStudio.getAutostart());
    await page.evaluate(() => window.screenStudio.setAutostart(true));
    await app.evaluate(() => globalThis.__clearStartList());
    expect(await isOn()).toBe(false);
    await app.evaluate(() => globalThis.__aurumQa.restoreAutostart());
    expect(await isOn()).toBe(true);

    await page.evaluate(() => window.screenStudio.setAutostart(false));
    await expect.poll(async () => { await app.evaluate(() => globalThis.__aurumQa.restoreAutostart()); return isOn(); }).toBe(false);
    await page.waitForTimeout(300);
    await app.evaluate(() => globalThis.__aurumQa.restoreAutostart());
    expect(await isOn()).toBe(false);
  });

  test('the "hide from captures" switch covers the studio window and the bar', async () => {
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    const shield = () => app.evaluate(({ BrowserWindow }) => {
      const find = (part) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes(part));
      // Windows applies it to a shown window; the windows of a test run start hidden.
      for (const win of [find('index.html'), find('quickbar.html')]) win.showInactive();
      return [find('index.html').isContentProtected(), find('quickbar.html').isContentProtected()];
    });
    await expect.poll(shield).toEqual([true, true]);
    const flip = (on) => page.locator('#exclude-studio-window').evaluate((element, value) => {
      element.checked = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, on);
    await flip(false);
    await expect.poll(shield).toEqual([false, false]);
    await flip(true);
    await expect.poll(shield).toEqual([true, true]);
  });
});
