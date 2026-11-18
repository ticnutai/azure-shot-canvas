const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// A nearly full disk (simulated: 600 MB free) and a video in the library:
//   1  a red strip under the title bar says how much is left and that a new recording will not start
//   2  its ✕ hides it; the free space also shows in Hebrew in the settings
//   3  the video's picture is taken 960 wide, so it stays sharp when the cards are enlarged
test.describe.serial('nearly full disk, and sharp video pictures', () => {
  let app;
  let page;

  test.beforeAll(async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screen-studio-disk-'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=1920x1080:d=1', '-pix_fmt', 'yuv420p', path.join(outputDir, 'הקלטה א.mp4')]);
    process.env.SCREEN_STUDIO_FREE_BYTES = String(600 * 1024 ** 2);
    ({ app, page } = await launchStudio('disk-video', { outputDir }));
  });
  test.afterAll(async () => { delete process.env.SCREEN_STUDIO_FREE_BYTES; await closeStudio(app); });

  test('1 · the strip says how much is left and that recording waits for space', async () => {
    await expect(page.locator('#disk-warning')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#disk-warning')).toHaveAttribute('data-level', 'critical');
    await expect(page.locator('#disk-warning-title')).toHaveText('הדיסק כמעט מלא — נשארו 0.6 ג׳יגה');
    await expect(page.locator('#disk-warning-text')).toContainText('הקלטה חדשה לא תתחיל');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('2 · ✕ hides it; the settings show the free space in Hebrew', async () => {
    await page.locator('#disk-warning-close').click();
    await expect(page.locator('#disk-warning')).toBeHidden();
    await page.evaluate(() => refreshStorageStatus());
    await expect(page.locator('#disk-warning')).toBeHidden();
    await expect(page.locator('#storage-status')).toHaveText('0.6 ג׳יגה פנויים');
  });

  test('3 · the video picture is 960 wide', async () => {
    await page.locator('[data-page="library"]').click();
    const picture = page.locator('.library-item .file-icon img').first();
    await expect.poll(() => picture.evaluate((image) => image.naturalWidth), { timeout: 30_000 }).toBe(960);
  });
});
