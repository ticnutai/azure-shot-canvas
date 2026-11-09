const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// Smart erase in the editor: something on the picture goes, and the place is filled from the background around it.
//   1  a box over text on a plain background: filled with exactly that colour
//   2  a box over text that a frame line crosses: the line goes on through the place
//   3  the brush over a spot on a busy, photo-like area: no trace of the spot, filled from around it
//   4  an erase is a step that undo takes back; the user's own colour can be chosen
const WHITE = [246, 247, 249];
test.describe.serial('smart erase in the editor', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  let imagePath;

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('smart-erase'));
    // A screen-like picture: a plain panel with a black word, a frame line with a word on it, and a busy photo-like area
    // with a magenta spot.
    const dataUrl = await page.evaluate((white) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 700;
      const context = canvas.getContext('2d');
      context.fillStyle = `rgb(${white.join(',')})`;
      context.fillRect(0, 0, 1200, 700);
      context.fillStyle = '#111111';
      context.font = '700 34px "Segoe UI"';
      context.direction = 'ltr';
      context.textAlign = 'left';
      context.fillText('מילה למחיקה', 120, 150);
      context.fillStyle = '#9aa0a8';
      context.fillRect(0, 320, 760, 3);
      context.fillStyle = '#111111';
      context.fillText('על הקו', 300, 334);
      const photo = context.createImageData(420, 700);
      for (let y = 0; y < 700; y += 1) for (let x = 0; x < 420; x += 1) photo.data.set([110 + Math.round(50 * Math.sin(x / 9)), 130 + Math.round(40 * Math.cos(y / 11)), 90 + ((x * 3 + y * 5) % 40), 255], (y * 420 + x) * 4);
      context.putImageData(photo, 780, 0);
      context.fillStyle = '#ff00ff';
      context.beginPath();
      context.arc(990, 360, 26, 0, Math.PI * 2);
      context.fill();
      return canvas.toDataURL('image/png');
    }, WHITE);
    imagePath = path.join(outputDir, 'smart-erase-fixture.png');
    await fs.writeFile(imagePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await page.evaluate((file) => window.aurumEditor.open(file, 'professional'), imagePath);
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-ready', 'true');
  });
  test.afterAll(async () => closeStudio(app));

  // A tool folded into its group's button is still the same button: pressed directly.
  const tool = (name) => page.evaluate((id) => document.querySelector(`[data-editor-tool="${id}"]`).click(), name);
  const client = (x, y) => page.evaluate(([a, b]) => window.aurumEditor.sceneToClient(a, b), [x, y]);
  const drag = async (points) => {
    const first = await client(...points[0]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const point of points.slice(1)) { const at = await client(...point); await page.mouse.move(at.x, at.y, { steps: 4 }); }
    await page.mouse.up();
  };
  // The picture as it would be saved, read at picture pixels.
  const pixels = (points) => page.evaluate(async (list) => {
    const image = new Image();
    image.src = window.aurumEditor.exportDataUrl();
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return list.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3));
  }, points);
  const near = (a, b, tolerance) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
  const erases = () => page.evaluate(() => window.aurumEditor.objects().filter((object) => object.toolType === 'erase').length);
  const lastMethod = () => page.locator('#image-editor-shell').getAttribute('data-last-erase');

  test('1 · a box over text on a plain background: filled with exactly that colour', async () => {
    await tool('erase');
    await expect(page.locator('#editor-erase-options')).toBeVisible();
    const before = await pixels([[200, 140], [1, 1]]);
    expect(before[1]).toEqual(WHITE);
    const darkBefore = (await pixels(Array.from({ length: 60 }, (_, i) => [120 + i * 3, 140]))).filter(([r]) => r < 100).length;
    expect(darkBefore).toBeGreaterThan(3);
    await drag([[100, 105], [400, 165]]);
    await expect.poll(erases).toBe(1);
    expect(await lastMethod()).toBe('solid');
    const after = await pixels([...Array.from({ length: 60 }, (_, i) => [120 + i * 3, 140]), [130, 120], [320, 160]]);
    for (const value of after) expect(near(value, WHITE, 2), String(value)).toBe(true);
    await expect(page.locator('#editor-erase-result')).toContainText('#F6F7F9');
  });

  test('2 · a box over text that a frame line crosses: the line goes on through the place', async () => {
    await drag([[285, 296], [440, 345]]);
    await expect.poll(erases).toBe(2);
    expect(await lastMethod()).toBe('lines');
    const [line, above, below] = await pixels([[360, 321], [360, 305], [360, 340]]);
    expect(near(line, [154, 160, 168], 30), `line ${line}`).toBe(true);
    expect(near(above, WHITE, 12), `above ${above}`).toBe(true);
    expect(near(below, WHITE, 12), `below ${below}`).toBe(true);
  });

  test('3 · the brush over a spot on a busy, photo-like area: no trace of the spot', async () => {
    await tool('erase-brush');
    await expect(page.locator('#editor-erase-options')).toBeVisible();
    // Back and forth over the spot, as a hand would paint it (the brush is 24 pixels wide).
    await drag([[958, 330], [1022, 330], [1022, 342], [958, 342], [958, 354], [1022, 354], [1022, 366], [958, 366], [958, 378], [1022, 378], [1022, 390], [958, 390]]);
    await expect.poll(erases, { timeout: 15_000 }).toBe(3);
    const values = await pixels([[990, 360], [972, 348], [1010, 372], [990, 337], [990, 383]]);
    for (const [r, g, b] of values) expect(r > 200 && g < 60 && b > 200, `left over ${r},${g},${b}`).toBe(false);
    for (const [r, g] of values) expect(r >= 50 && r <= 175 && g >= 80 && g <= 185, `out of place ${r},${g}`).toBe(true);
  });

  test('4 · an erase is a step that undo takes back; the user own colour can be chosen', async () => {
    const picture = await page.evaluate(() => window.aurumEditor.exportDataUrl());
    await fs.writeFile(path.join(outputDir, 'after.png'), Buffer.from(picture.split(',')[1], 'base64'));
    test.info().annotations.push({ type: 'picture', description: path.join(outputDir, 'after.png') });
    await page.locator('#editor-undo').click();
    await expect.poll(erases).toBe(2);
    await tool('erase');
    await page.locator('#editor-erase-own').check();
    await page.locator('#editor-erase-color').evaluate((input) => { input.value = '#ff0000'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await drag([[560, 420], [640, 470]]);
    await expect.poll(erases).toBe(3);
    expect(near((await pixels([[600, 445]]))[0], [255, 0, 0], 2)).toBe(true);
    await page.locator('#editor-erase-own').uncheck();
    expect(runtimeErrors).toEqual([]);
  });
});
