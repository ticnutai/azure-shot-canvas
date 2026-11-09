const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { VIDEO_TOOLS } = require('../../src/video-tools.cjs');

// A computer without the video tool: the smart tools page says so and offers a one-time download; the real file
// (from a local copy) is checked, unpacked into the program's data folder, and then the program uses it.
const CACHE = path.join(os.tmpdir(), 'video-tool-cache', VIDEO_TOOLS.file);

async function cachedArchive() {
  const have = fs.existsSync(CACHE) ? fs.readFileSync(CACHE) : null;
  if (have && crypto.createHash('sha256').update(have).digest('hex') === VIDEO_TOOLS.sha256) return CACHE;
  const bytes = Buffer.from(await (await fetch(VIDEO_TOOLS.url)).arrayBuffer());
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, bytes);
  return CACHE;
}

test.describe.serial('the video tool, downloaded once into the program', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const archive = await cachedArchive();
    // The search path of this computer without any folder that has the video tool in it.
    const searchPath = (process.env.PATH || '').split(path.delimiter).filter((folder) => folder && !fs.existsSync(path.join(folder, 'ffmpeg.exe'))).join(path.delimiter);
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('video-tools', { env: { PATH: searchPath, Path: searchPath, SCREEN_STUDIO_VIDEO_TOOLS_URL: pathToFileURL(archive).href } }));
  });
  test.afterAll(async () => closeStudio(app));

  test('missing at first, one download, then used by the program', async () => {
    test.setTimeout(240_000);
    await page.locator('.sidebar .nav-item[data-page="tools"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-video-tools', 'missing', { timeout: 20_000 });
    await expect(page.locator('#video-tools-download')).toBeVisible();
    await page.locator('#video-tools-download').click();
    await expect(page.locator('html')).toHaveAttribute('data-video-tools', 'downloaded', { timeout: 180_000 });
    await expect(page.locator('#video-tools-download')).toHaveCount(0);
    const engines = await page.evaluate(() => window.screenStudio.getLocalEngines());
    expect(engines.ffmpeg.available).toBe(true);
    expect(engines.ffmpeg.version).toContain(VIDEO_TOOLS.version);
    expect(engines.ffprobe.available).toBe(true);
    // Only the two tools are kept; the downloaded archive is gone.
    const folder = path.join(outputDir, 'electron-user-data', 'video-tools', VIDEO_TOOLS.version);
    expect(fs.readdirSync(folder).sort()).toEqual(['ffmpeg.exe', 'ffprobe.exe']);
    expect(fs.existsSync(path.join(outputDir, 'electron-user-data', 'models', VIDEO_TOOLS.file))).toBe(false);
    expect(runtimeErrors).toEqual([]);
  });
});
