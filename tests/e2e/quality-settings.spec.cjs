const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// Quality settings do what they say and are kept:
//   1  at first the window shows exactly what a recording uses (it showed 60 frames and 24 megabits while 30 and 18 were used)
//   2  changed settings are what a recording uses, and they are still there after the program is opened again
//   3  a recording at 720 lines really is 1280 × 720
//   4  pictures: a quality for JPG / WEBP / PDF; a lower quality gives a smaller file; it rests while PNG is chosen
test.describe.serial('quality settings', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  const used = () => page.evaluate(() => ({ height: state.targetHeight, fps: qualityPresets[state.quality].fps, bitrate: qualityPresets[state.quality].bitrate / 1e6, format: document.querySelector('#format-select').value, label: document.querySelector('#quality-status').textContent }));
  const set = (selector, value, kind = 'change') => page.evaluate(([sel, val, type]) => { const element = document.querySelector(sel); element.value = val; element.dispatchEvent(new Event(type, { bubbles: true })); }, [selector, value, kind]);

  test.beforeAll(async () => { ({ app, page, outputDir, runtimeErrors } = await launchStudio('quality-settings')); });
  test.afterAll(async () => closeStudio(app));

  test('1 · at first the window shows exactly what a recording uses', async () => {
    const shown = await page.evaluate(() => ({ fps: Number(document.querySelector('#fps-select').value), bitrate: Number(document.querySelector('#bitrate-range').value), height: Number(document.querySelector('#resolution-select').value) }));
    const now = await used();
    expect(now.fps).toBe(shown.fps);
    expect(now.bitrate).toBe(shown.bitrate);
    expect(now.height).toBe(shown.height);
    expect(now.label).toContain(`${shown.fps}fps`);
  });

  test('2 · changed settings are used, and kept when the program opens again', async () => {
    await set('#resolution-select', '720');
    await set('#fps-select', '60');
    await set('#bitrate-range', '40', 'input');
    await set('#format-select', 'webm');
    expect(await used()).toMatchObject({ height: 720, fps: 60, bitrate: 40, format: 'webm' });
    expect(await page.locator('#bitrate-output').textContent()).toBe('40 Mbps');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    expect(await used()).toMatchObject({ height: 720, fps: 60, bitrate: 40, format: 'webm' });
    expect((await used()).label).toBe('720p · 60fps');
    expect(await page.locator('#convert-mp4').isChecked()).toBe(false);
  });

  test('3 · a recording at 720 lines really is 1280 × 720', async () => {
    test.setTimeout(120_000);
    await page.evaluate(() => { localStorage.setItem('aurum-live-preview', 'on'); setLivePreviewEnabled(true, false); });
    await page.waitForFunction(() => document.querySelectorAll('.source-card').length > 0, null, { timeout: 20_000 });
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await page.locator('#default-capture-kind').selectOption('record');
    await page.locator('#default-capture-scope').selectOption('full');
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
    await set('#fps-select', '30');
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    await expect.poll(() => page.evaluate(() => state.recorder?.state || ''), { timeout: 20_000 }).toBe('recording');
    await page.waitForTimeout(2500);
    await page.locator('#stop-recording').dispatchEvent('click');
    let file = null;
    await expect.poll(async () => { file = (await fs.readdir(outputDir)).find((name) => /\.webm$/.test(name) && !before.has(name)); return Boolean(file); }, { timeout: 60_000 }).toBe(true);
    const quality = await expect.poll(async () => (await page.evaluate((target) => window.screenStudio.analyzeMedia(target), path.join(outputDir, file)).catch(() => ({}))).height || 0, { timeout: 30_000 }).toBe(720).then(() => page.evaluate((target) => window.screenStudio.analyzeMedia(target), path.join(outputDir, file)));
    expect(quality.width).toBe(1280);
  });

  test('4 · pictures: a quality for JPG; lower quality, smaller file; the slider rests while PNG is chosen', async () => {
    test.setTimeout(120_000);
    expect(await page.locator('#image-quality').isDisabled()).toBe(true);
    await set('#image-format', 'jpg');
    await expect(page.locator('#image-quality')).toBeEnabled();
    // A busy picture, so the quality makes a real difference.
    const picture = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 900; canvas.height = 600;
      const context = canvas.getContext('2d');
      for (let i = 0; i < 4000; i += 1) { context.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 50)}%)`; context.fillRect((i * 53) % 900, (i * 29) % 600, 14, 14); }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    const saveAt = async (quality) => {
      await set('#image-quality', String(quality), 'input');
      expect(await page.locator('#image-quality-output').textContent()).toBe(`${quality}%`);
      const before = new Set(await fs.readdir(outputDir));
      await app.evaluate(async (_electron, bytes) => globalThis.__aurumQa.deliverCapture({ png: Buffer.from(bytes), width: 900, height: 600, after: 'save', afterAction: 'save' }), picture);
      let saved = null;
      await expect.poll(async () => { saved = (await fs.readdir(outputDir)).find((name) => name.endsWith('.jpg') && !before.has(name)); return Boolean(saved); }, { timeout: 20_000 }).toBe(true);
      return (await fs.stat(path.join(outputDir, saved))).size;
    };
    const low = await saveAt(45);
    const high = await saveAt(100);
    expect(low).toBeLessThan(high * 0.7);
    // Kept for next time.
    expect(await page.evaluate(() => localStorage.getItem('aurum-image-quality'))).toBe('100');
    await set('#image-format', 'png');
    await expect(page.locator('#image-quality')).toBeDisabled();
    expect(runtimeErrors).toEqual([]);
  });
});
