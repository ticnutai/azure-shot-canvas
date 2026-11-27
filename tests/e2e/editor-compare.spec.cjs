const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The editor: every picture opens filling the whole work area (even after a zoom set by hand on an earlier one), and
// two pictures can be compared side by side or one under the other, zooming and moving together.
test.describe.serial('editor: filling the area and comparing two pictures', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  let wide;
  let other;

  const fixture = async (name, width, height, color) => {
    const dataUrl = await page.evaluate(([w, h, c]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const context = canvas.getContext('2d');
      context.fillStyle = c; context.fillRect(0, 0, w, h);
      context.fillStyle = '#ffffff'; context.fillRect(w * 0.4, h * 0.4, w * 0.2, h * 0.2);
      return canvas.toDataURL('image/png');
    }, [width, height, color]);
    const file = path.join(outputDir, name);
    await fs.writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return file;
  };

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('editor-compare'));
    wide = await fixture('compare-wide.png', 4000, 2200, '#3a7bd5');
    other = await fixture('compare-other.png', 1600, 1000, '#d5733a');
  });
  test.afterAll(async () => closeStudio(app));

  const openEditor = async (file) => {
    await page.evaluate((f) => window.aurumEditor.open(f, 'professional'), file);
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-ready', 'true');
    await page.waitForTimeout(400);
  };
  const use = () => page.evaluate(() => {
    const work = document.querySelector('#editor-workspace').getBoundingClientRect();
    const picture = document.querySelector('#editor-canvas-wrap').getBoundingClientRect();
    return Math.max(picture.width / (work.width - 26), picture.height / (work.height - 26));
  });

  test('a picture fills the whole area, also after a zoom set by hand on the one before', async () => {
    await openEditor(wide);
    expect(await use()).toBeGreaterThan(0.97);
    // זום ידני, סגירה ופתיחה מחדש: התמונה שוב ממלאת את האזור
    await page.locator('#editor-zoom-out').click();
    await page.locator('#editor-zoom-out').click();
    expect(await use()).toBeLessThan(0.8);
    await page.evaluate(() => window.aurumEditor.close());
    await openEditor(other);
    expect(await use()).toBeGreaterThan(0.97);
    if (process.env.COMPARE_SHOTS) await page.screenshot({ path: path.join(process.env.COMPARE_SHOTS, 'editor-fill.png') });
  });

  test('comparing: the menu, the chooser, one under the other and side by side, zooming together', async () => {
    await expect(page.locator('#editor-compare-menu')).toBeHidden(); // סגור עד שלוחצים
    await page.locator('#editor-compare').click();
    await expect(page.locator('#editor-compare-menu')).toBeVisible();
    await page.locator('[data-compare-layout="column"]').click();
    await expect(page.locator('.compare-chooser')).toBeVisible();
    await expect(page.locator('.compare-choice').first()).toBeVisible();
    await page.locator('.compare-choice', { hasText: 'compare-wide.png' }).click();
    const view = page.locator('.compare-view');
    await expect(view).toBeVisible();
    await expect(view).toHaveAttribute('data-layout', 'column');
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.compare-pane img')].every((img) => img.naturalWidth > 0))).toBe(true);
    const panes = () => page.evaluate(() => [...document.querySelectorAll('.compare-pane')].map((p) => { const b = p.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; }));
    let [first, second] = await panes();
    expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1); // אחת מתחת לשנייה
    if (process.env.COMPARE_SHOTS) await page.screenshot({ path: path.join(process.env.COMPARE_SHOTS, 'compare-column.png') });
    await page.locator('.compare-layout-button[data-layout="row"]').click();
    await expect(view).toHaveAttribute('data-layout', 'row');
    [first, second] = await panes();
    expect(Math.abs(first.top - second.top)).toBeLessThan(2); // זו לצד זו
    if (process.env.COMPARE_SHOTS) await page.screenshot({ path: path.join(process.env.COMPARE_SHOTS, 'compare-row.png') });
    // גלגלת על אחת – שתיהן מוגדלות יחד
    const box = await page.locator('.compare-pane').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => page.evaluate(() => Number(document.querySelector('.compare-view').dataset.zoom))).toBeGreaterThan(1);
    const scales = await page.evaluate(() => [...document.querySelectorAll('.compare-pane img')].map((img) => img.style.transform));
    expect(scales.every((t) => /scale\(/.test(t))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
  });
});
