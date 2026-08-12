const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const executablePath = path.join(process.env.LOCALAPPDATA, 'Programs', 'hebrew-screen-studio', 'אולפן צילום מסך.exe');
  await fs.access(executablePath);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurum-installed-verify-'));
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${path.join(root, 'profile')}`],
    env: {
      ...process.env,
      SCREEN_STUDIO_HEADLESS: '1',
      SCREEN_STUDIO_OUTPUT_DIR: path.join(root, 'library'),
      SCREEN_STUDIO_QA_REPORT_DIR: path.join(root, 'qa')
    },
    timeout: 30_000
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true', null, { timeout: 20_000 });
    const result = {
      filters: await page.locator('button[data-recent-filter]').count(),
      sorts: await page.locator('#recent-sort option').count(),
      views: await page.locator('button[data-recent-view]').count(),
      quickActions: await page.locator('.capture-quick-actions > button').count()
    };
    result.shortcuts = await page.locator('[data-shortcut-action]').count();
    result.videoEditor = await page.locator('#video-editor-modal').count();
    result.storageLevel = await page.locator('html').getAttribute('data-storage-level');
    await page.locator('.source-card').first().click();
    await page.waitForFunction(() => document.documentElement.dataset.previewState === 'ready' && Number(document.documentElement.dataset.previewFrames) > 2, null, { timeout: 15_000 });
    result.livePreview = await page.locator('#display-video').evaluate((video) => ({ width: video.videoWidth, height: video.videoHeight, paused: video.paused, frames: Number(document.documentElement.dataset.previewFrames) }));
    await page.locator('button[data-recent-filter="image"]').click();
    await page.locator('#recent-sort').selectOption('size-desc');
    await page.locator('button[data-recent-view="list"]').click();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    result.persisted = await page.locator('html').evaluate((node) => ({
      filter: node.dataset.recentFilter,
      sort: node.dataset.recentSort,
      view: node.dataset.recentView
    }));
    result.errors = errors;
    const passed = result.filters === 3 && result.sorts === 5 && result.views === 3 && result.quickActions === 3
      && result.shortcuts === 6 && result.videoEditor === 1 && ['healthy', 'warning', 'unknown'].includes(result.storageLevel)
      && result.livePreview.width >= 320 && result.livePreview.height >= 200 && !result.livePreview.paused && result.livePreview.frames > 2
      && result.persisted.filter === 'image' && result.persisted.sort === 'size-desc' && result.persisted.view === 'list'
      && result.errors.length === 0;
    console.log(JSON.stringify({ passed, executablePath, ...result }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await app.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
