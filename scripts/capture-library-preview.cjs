const path = require('node:path');
const fs = require('node:fs/promises');
const { launchStudio, closeStudio } = require('../tests/helpers/electron-app.cjs');

(async () => {
  const output = path.resolve('artifacts/current/library-real-thumbnails.png');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const { app, page } = await launchStudio('library-visual-proof');
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#record-button').dispatchEvent('click');
    await page.locator('#recording-bar').waitFor({ state: 'visible' });
    await page.waitForTimeout(1800);
    await page.locator('#stop-recording').dispatchEvent('click');
    await page.waitForFunction(() => document.documentElement.dataset.lastSavedPath?.endsWith('.mp4'), null, { timeout: 45_000 });
    await page.locator('[data-page="library"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.library-item .file-icon img').length >= 2, null, { timeout: 30_000 });
    await page.locator('#library-size').fill('3');
    await page.screenshot({ path: output, fullPage: true });
    process.stdout.write(`${output}\n`);
  } finally { await closeStudio(app); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
