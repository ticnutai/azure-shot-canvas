const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// Sliders move smoothly:
//   1  no slider in the studio has only a few stops (the library's size slider had three: start, middle, end)
//   2  dragging the library's size slider with the mouse goes through many sizes, and the pictures follow at once
//      without the library being rebuilt on every step
//   3  the interface size slider does not resize the window while it is dragged (the slider ran away from the
//      pointer); the size is applied when it is let go
test.describe.serial('sliders', () => {
  let app;
  let page;
  let outputDir;

  test.beforeAll(async () => {
    ({ app, page, outputDir } = await launchStudio('sliders'));
    const baseline = path.resolve(__dirname, '..', 'visual', '__baseline__');
    const samples = (await fs.readdir(baseline)).filter((name) => name.endsWith('.png')).slice(0, 4);
    for (const [index, name] of samples.entries()) await fs.copyFile(path.join(baseline, name), path.join(outputDir, `צילום_2026-10-24_12-0${index}-00-000.png`));
  });
  test.afterAll(async () => closeStudio(app));

  // Presses the slider's thumb and drags it across in small moves, the way a hand does; returns the values seen.
  const dragAcross = async (selector) => {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const box = await page.locator(selector).boundingBox();
    const y = box.y + box.height / 2;
    const seen = [];
    await page.mouse.move(box.x + 2, y);
    await page.mouse.down();
    for (let step = 0; step <= 30; step += 1) {
      await page.mouse.move(box.x + 2 + (box.width - 4) * step / 30, y);
      seen.push(await page.locator(selector).inputValue());
    }
    await page.mouse.up();
    return seen;
  };

  test('1 · no slider has only a few stops', async () => {
    const coarse = await page.evaluate(() => [...document.querySelectorAll('input[type="range"]')]
      .map((input) => ({ id: input.id, stops: Math.round((Number(input.max) - Number(input.min)) / (Number(input.step) || 1)) }))
      .filter((slider) => slider.stops < 10));
    expect(coarse).toEqual([]);
  });

  test('2 · the library size slider goes through many sizes and the pictures follow, without a rebuild', async () => {
    await page.locator('.nav-item[data-page="library"]').click();
    await expect(page.locator('#library-list .library-item')).toHaveCount(4);
    await page.evaluate(() => { document.querySelector('#library-list .library-item').dataset.kept = 'yes'; });
    const width = () => page.locator('#library-list .library-item').first().evaluate((row) => row.getBoundingClientRect().width);
    const seen = await dragAcross('#library-size');
    expect(new Set(seen).size).toBeGreaterThan(10);
    // Right to left the values go down or up depending on the page direction; either way they change steadily.
    const numbers = seen.map(Number);
    const monotonic = numbers.every((value, index) => index === 0 || value >= numbers[index - 1]) || numbers.every((value, index) => index === 0 || value <= numbers[index - 1]);
    expect(monotonic, numbers.join(' ')).toBe(true);
    // The rows are the same elements: the size changed, nothing was rebuilt.
    expect(await page.locator('#library-list .library-item[data-kept="yes"]').count()).toBe(1);
    // The pictures follow the slider.
    await page.locator('#library-size').fill('160');
    const small = await width();
    await page.locator('#library-size').fill('500');
    await expect.poll(width).toBeGreaterThan(small * 1.5);
    await page.locator('#library-size').fill('245');
  });

  test('3 · the interface size is applied when the slider is let go, not while it is dragged', async () => {
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="appearance"]').click();
    await expect(page.locator('#ui-zoom')).toBeVisible();
    const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('index.html')).webContents.getZoomFactor());
    expect(await zoom()).toBe(1);
    await page.locator('#ui-zoom').scrollIntoViewIfNeeded();
    const box = await page.locator('#ui-zoom').boundingBox();
    const y = box.y + box.height / 2;
    const middle = box.x + box.width / 2;
    await page.mouse.move(middle, y);
    await page.mouse.down();
    const during = [];
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(middle + (box.width / 2 - 3) * step / 10, y);
      during.push(await zoom());
    }
    // While held: the window keeps its size, the number already shows the new value.
    expect(new Set(during)).toEqual(new Set([1]));
    expect(await page.locator('#ui-zoom-output').textContent()).not.toBe('100%');
    const chosen = Number(await page.locator('#ui-zoom').inputValue());
    await page.mouse.up();
    await expect.poll(zoom).toBeCloseTo(chosen / 100, 2);
    // Back to normal for the next tests.
    await page.locator('#ui-zoom-reset').click();
    await expect.poll(zoom).toBe(1);
  });
});
