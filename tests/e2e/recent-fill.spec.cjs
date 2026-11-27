const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The recent media on the capture page uses the whole page down to the window's bottom, shows every capture (not
// only the first few) and scrolls inside itself, adding cards as it is scrolled.
test.describe.serial('recent media fills the page', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('recent-fill'));
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 200;
      const context = canvas.getContext('2d');
      context.fillStyle = '#3a7bd5'; context.fillRect(0, 0, 320, 200);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    for (let index = 0; index < 75; index += 1) await fs.writeFile(path.join(outputDir, `fill-${String(index).padStart(3, '0')}.png`), Buffer.from(png, 'base64'));
  });
  test.afterAll(async () => closeStudio(app));

  test('the section reaches the window bottom, shows more than a handful, and loads more on scrolling', async () => {
    await page.evaluate(() => loadLibrary());
    await page.evaluate(() => { document.querySelector('[data-recent-view="compact"]')?.click(); });
    await expect.poll(() => page.locator('#recent-library .clip-card').count()).toBeGreaterThan(8);
    const box = await page.evaluate(() => {
      const strip = document.querySelector('#capture-page .library-strip').getBoundingClientRect();
      return { bottom: strip.bottom, window: window.innerHeight, fills: document.querySelector('#capture-page .library-strip').classList.contains('fills') };
    });
    expect(box.fills).toBe(true);
    expect(box.window - box.bottom).toBeLessThan(40);
    const before = await page.locator('#recent-library .clip-card').count();
    await page.evaluate(() => { const list = document.querySelector('#recent-library'); list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll')); });
    await expect.poll(async () => page.locator('#recent-library .clip-card').count()).toBe(75);
    expect(before).toBeGreaterThanOrEqual(Math.min(60, 75));
    expect(runtimeErrors).toEqual([]);
  });
});
