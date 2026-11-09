const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { MODEL } = require('../../src/ai-model.cjs');

// Erasing with artificial intelligence in the editor, with the real model:
//   1  before the download it says so and offers the download; nothing erases with it yet
//   2  the one-time download (from a local copy of the real file) checks the file and makes it ready
//   3  a spot on a photo-like picture is erased by the model: no trace, and the place takes the colours around it
// The real model is fetched once into a cache folder of the test machine and reused by later runs.
const CACHE = path.join(os.tmpdir(), 'model-cache-for-studio-tests', MODEL.file);
async function cachedModel() {
  const have = await fs.readFile(CACHE).catch(() => null);
  if (have && crypto.createHash('sha256').update(have).digest('hex') === MODEL.sha256) return CACHE;
  const response = await fetch(MODEL.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== MODEL.sha256) throw new Error('the model download did not match');
  await fs.mkdir(path.dirname(CACHE), { recursive: true });
  await fs.writeFile(CACHE, bytes);
  return CACHE;
}

test.describe.serial('erasing with artificial intelligence', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    const model = await cachedModel();
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('ai-erase', { env: { SCREEN_STUDIO_AI_MODEL_URL: pathToFileURL(model).href } }));
    // A photo-like picture: soft waves of colour, with a green spot to erase on the left (red) and right (blue) halves.
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 420;
      const context = canvas.getContext('2d');
      const image = context.createImageData(640, 420);
      for (let y = 0; y < 420; y += 1) {
        for (let x = 0; x < 640; x += 1) {
          const wave = Math.round(18 * Math.sin(x / 13) + 14 * Math.cos(y / 9));
          image.data.set(x < 320 ? [200 + wave, 60 + wave, 50] : [50, 70 + wave, 200 + wave], (y * 640 + x) * 4);
          image.data[(y * 640 + x) * 4 + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
      context.fillStyle = '#00ff00';
      context.beginPath();
      context.arc(320, 210, 34, 0, Math.PI * 2);
      context.fill();
      return canvas.toDataURL('image/png');
    });
    const imagePath = path.join(outputDir, 'ai-erase-fixture.png');
    await fs.writeFile(imagePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await page.evaluate((file) => window.aurumEditor.open(file, 'professional'), imagePath);
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-ready', 'true');
    await page.evaluate(() => document.querySelector('[data-editor-tool="erase"]').click());
  });
  test.afterAll(async () => closeStudio(app));

  const client = (x, y) => page.evaluate(([a, b]) => window.aurumEditor.sceneToClient(a, b), [x, y]);
  const drag = async (from, to) => {
    const a = await client(...from);
    const b = await client(...to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
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
  const erases = () => page.evaluate(() => window.aurumEditor.objects().filter((object) => object.toolType === 'erase').length);

  test('1 · before the download it says so and offers the download', async () => {
    await expect(page.locator('#editor-ai-download')).toBeVisible();
    await expect(page.locator('#editor-ai-status')).toContainText('עוד לא הורדה');
    await page.locator('#editor-erase-method').selectOption('ai');
    await drag([280, 170], [360, 250]);
    await expect(page.locator('#editor-erase-result')).toContainText('צריך קודם להוריד');
    expect(await erases()).toBe(0);
  });

  test('2 · the one-time download checks the file and makes it ready', async () => {
    test.setTimeout(120_000);
    await page.locator('#editor-ai-download').click();
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-ai-ready', 'true', { timeout: 60_000 });
    await expect(page.locator('#editor-ai-download')).toBeHidden();
    const stored = await fs.stat(path.join(outputDir, 'electron-user-data', 'models', MODEL.file));
    expect(stored.size).toBe(MODEL.size);
  });

  test('3 · a spot on a photo-like picture is erased by the model', async () => {
    test.setTimeout(120_000);
    await drag([280, 170], [360, 250]);
    await expect.poll(erases, { timeout: 90_000 }).toBe(1);
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-last-erase', 'ai');
    const [middle, left, right, top] = await pixels([[320, 210], [300, 210], [340, 210], [320, 182]]);
    for (const [r, g, b] of [middle, left, right, top]) expect(g > 200 && r < 80 && b < 80, `green left: ${r},${g},${b}`).toBe(false);
    expect(left[0], `the red side goes on: ${left}`).toBeGreaterThan(left[2]);
    expect(right[2], `the blue side goes on: ${right}`).toBeGreaterThan(right[0]);
    expect(runtimeErrors).toEqual([]);
  });
});
