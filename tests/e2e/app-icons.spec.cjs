const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// Settings → appearance → icons: the program's icon (7 shapes × 8 colours) and the top bar's tab (5 shapes × 9 colours).
//   1  the settings show every shape and colour once, the current choice marked
//   2  choosing an icon draws real pictures for every size, keeps them, and gives them to the windows at once
//   3  choosing a tab shape and colour reaches the top bar at once and is remembered
//   4  bad pictures are refused; going back to the built-in icon removes the saved one
test.describe.serial('program icon and top bar tab', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('app-icons'));
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="appearance"]').click();
  });
  test.afterAll(async () => closeStudio(app));

  const iconFile = () => path.join(outputDir, 'electron-user-data', 'app-icon.json');
  const bar = () => app.windows().find((candidate) => candidate.url().includes('quickbar.html'));

  test('1 · the settings show every shape and colour once, the current choice marked', async () => {
    const counts = await page.evaluate(() => {
      const values = (selector) => [...document.querySelectorAll(selector)].map((node) => node.dataset.value);
      return {
        shapes: values('#icon-shapes [role="radio"]'),
        colors: values('#icon-colors [role="radio"]'),
        tabs: values('#tab-styles [role="radio"]'),
        tabColors: values('#tab-colors [role="radio"]'),
        checked: [...document.querySelectorAll('#icon-section [aria-checked="true"]')].map((node) => node.dataset.value)
      };
    });
    expect(counts.shapes.length).toBe(7);
    expect(counts.colors.length).toBe(8);
    expect(counts.tabs).toEqual(['tab', 'line', 'pill', 'dot', 'glass']);
    expect(counts.tabColors.length).toBe(9);
    for (const list of [counts.shapes, counts.colors, counts.tabs, counts.tabColors]) expect(new Set(list).size).toBe(list.length);
    expect(counts.checked).toEqual(['lens', 'gold', 'tab', 'look']);
  });

  test('2 · choosing an icon draws real pictures for every size, keeps them, and gives them to the windows at once', async () => {
    const calls = await app.evaluate(({ BrowserWindow }) => {
      globalThis.__iconCalls = 0;
      for (const win of BrowserWindow.getAllWindows()) {
        const original = win.setIcon.bind(win);
        win.setIcon = (image) => { globalThis.__iconCalls += 1; return original(image); };
      }
      return true;
    });
    expect(calls).toBe(true);
    await page.locator('#icon-shapes [data-value="aperture"]').click();
    await page.locator('#icon-colors [data-value="violet"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-app-icon', 'aperture:violet', { timeout: 10_000 });
    const saved = JSON.parse(await fs.readFile(iconFile(), 'utf8'));
    expect(saved.shape).toBe('aperture');
    expect(saved.color).toBe('violet');
    expect(Object.keys(saved.images).map(Number).sort((a, b) => a - b)).toEqual([16, 20, 24, 32, 40, 48, 64, 256]);
    const big = await app.evaluate(({ nativeImage }, url) => nativeImage.createFromDataURL(url).getSize(), saved.images[256]);
    expect(big).toEqual({ width: 256, height: 256 });
    expect(await app.evaluate(() => globalThis.__iconCalls)).toBeGreaterThan(0);
    await expect(page.locator('#icon-shapes [data-value="aperture"]')).toHaveAttribute('aria-checked', 'true');
  });

  test('3 · choosing a tab shape and colour reaches the top bar at once and is remembered', async () => {
    await page.locator('#tab-styles [data-value="pill"]').click();
    await page.locator('#tab-colors [data-value="green"]').click();
    await expect.poll(() => bar().evaluate(() => `${document.body.dataset.tabStyle}:${document.body.dataset.tabColor}`)).toBe('pill:own');
    const look = await bar().evaluate(() => ({ light: document.body.style.getPropertyValue('--tab-light'), clip: getComputedStyle(document.querySelector('#edge-handle')).clipPath }));
    expect(look.light).toBe('#62d6a0');
    expect(look.clip).toContain('inset');
    const prefs = await page.evaluate(() => window.screenStudio.getQuickbarPreferences());
    expect(prefs.tabStyle).toBe('pill');
    expect(prefs.tabColor).toBe('green');
  });

  test('4 · bad pictures are refused; going back to the built-in icon removes the saved one', async () => {
    const refused = await page.evaluate(() => window.screenStudio.setAppIcon({ shape: 'ring', color: 'red', images: { 16: 'javascript:alert(1)' } }).then(() => 'accepted', (error) => error.message));
    expect(refused).toContain('אינה תקינה');
    await page.evaluate(() => window.screenStudio.setAppIcon(null));
    await expect.poll(() => fs.access(iconFile()).then(() => true, () => false)).toBe(false);
    expect(runtimeErrors).toEqual([]);
  });
});
