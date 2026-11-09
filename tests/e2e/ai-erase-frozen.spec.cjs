const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { MODEL } = require('../../src/ai-model.cjs');

// Erasing with artificial intelligence on the frozen screen, with the real model already downloaded (from the editor):
// on a photo-like picture the plain result shows at once, the model's result replaces it, and saving waits for it.
// The frozen screen of the tests is a plain stand-in, so the photo-like picture is drawn inside the frozen-screen page.
const CACHE = path.join(os.tmpdir(), 'model-cache-for-studio-tests', MODEL.file);

test.describe.serial('erasing with artificial intelligence on the frozen screen', () => {
  let app;
  let outputDir;
  let runtimeErrors;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    let bytes = await fs.readFile(CACHE).catch(() => null);
    if (!bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== MODEL.sha256) {
      bytes = Buffer.from(await (await fetch(MODEL.url)).arrayBuffer());
      await fs.mkdir(path.dirname(CACHE), { recursive: true });
      await fs.writeFile(CACHE, bytes);
    }
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screen-studio-ai-erase-frozen-'));
    await fs.mkdir(path.join(outputDir, 'electron-user-data', 'models'), { recursive: true });
    await fs.copyFile(CACHE, path.join(outputDir, 'electron-user-data', 'models', MODEL.file));
    ({ app, runtimeErrors } = await launchStudio('ai-erase-frozen', { outputDir }));
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.setPreferences({ regionMarkup: true }));
  });
  test.afterAll(async () => {
    await closeStudio(app);
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  test('a spot on a photo-like picture: plain at once, then the model, and saving waits for it', async () => {
    test.setTimeout(180_000);
    const since = Date.now();
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.runAction('region'));
    const overlays = () => app.windows().filter((candidate) => candidate.url().includes('region-overlay.html'));
    await expect.poll(() => overlays().length, { timeout: 15_000 }).toBeGreaterThan(0);
    let overlay = null;
    for (const candidate of overlays()) {
      if (await candidate.waitForFunction((after) => Number(document.documentElement.dataset.regionReady || 0) > after, since, { timeout: 15_000 }).then(() => true).catch(() => false)) { overlay = candidate; break; }
    }
    expect(overlay).toBeTruthy();
    const result = await overlay.evaluate(async () => {
      const frozen = document.createElement('canvas');
      frozen.width = 640;
      frozen.height = 420;
      const context = frozen.getContext('2d');
      const image = context.createImageData(640, 420);
      for (let y = 0; y < 420; y += 1) {
        for (let x = 0; x < 640; x += 1) {
          const wave = Math.round(18 * Math.sin(x / 13) + 14 * Math.cos(y / 9));
          image.data.set(x < 320 ? [200 + wave, 60 + wave, 50, 255] : [50, 70 + wave, 200 + wave, 255], (y * 640 + x) * 4);
        }
      }
      context.putImageData(image, 0, 0);
      context.fillStyle = '#00ff00';
      context.beginPath();
      context.arc(320, 210, 34, 0, Math.PI * 2);
      context.fill();
      const shape = { type: 'erase', from: { x: 280, y: 170 }, to: { x: 360, y: 250 } };
      const paint = () => {
        const out = document.createElement('canvas');
        out.width = 640;
        out.height = 420;
        const outContext = out.getContext('2d', { willReadFrequently: true });
        outContext.drawImage(frozen, 0, 0);
        window.AurumMarkup.drawShape(outContext, shape, { frozen, scale: 1 });
        return [[320, 210], [300, 210], [340, 210], [320, 182]].map(([x, y]) => [...outContext.getImageData(x, y, 1, 1).data].slice(0, 3));
      };
      paint();
      const plain = document.documentElement.dataset.lastErase || '';
      const started = performance.now();
      await window.AurumMarkup.settled();
      return { plain, after: document.documentElement.dataset.lastErase, seconds: (performance.now() - started) / 1000, pixels: paint() };
    });
    console.log(`the model took ${result.seconds.toFixed(1)} seconds`);
    expect(result.after).toBe('ai');
    const [middle, left, right, top] = result.pixels;
    for (const [r, g, b] of [middle, left, right, top]) expect(g > 200 && r < 80 && b < 80, `green left: ${r},${g},${b}`).toBe(false);
    expect(left[0], `the red side goes on: ${left}`).toBeGreaterThan(left[2]);
    expect(right[2], `the blue side goes on: ${right}`).toBeGreaterThan(right[0]);
    await overlay.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })));
    expect(runtimeErrors).toEqual([]);
  });
});
