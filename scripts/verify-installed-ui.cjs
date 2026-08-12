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
    await page.waitForFunction(() => document.documentElement.dataset.sourcesLoading === 'false' && document.querySelectorAll('.source-card').length > 0, null, { timeout: 20_000 });
    await page.waitForFunction(() => Boolean(document.documentElement.dataset.storageLevel), null, { timeout: 20_000 });
    const result = {
      filters: await page.locator('button[data-recent-filter]').count(),
      sorts: await page.locator('#recent-sort option').count(),
      views: await page.locator('button[data-recent-view]').count(),
      quickActions: await page.locator('.recent-utility-actions > button').count()
    };
    result.shortcuts = await page.locator('[data-shortcut-action]').count();
    result.videoEditor = await page.locator('#video-editor-modal').count();
    result.previewControls = await page.locator('.preview-display-controls button, .preview-display-controls input').count();
    result.captureDelayChoices = await page.locator('#capture-delay option').count();
    result.storageLevel = await page.locator('html').getAttribute('data-storage-level');
    await page.locator('.source-card').first().click();
    await page.waitForFunction(() => document.documentElement.dataset.previewState === 'ready' && Number(document.documentElement.dataset.previewFrames) > 2, null, { timeout: 15_000 });
    result.livePreview = await page.locator('#display-video').evaluate((video) => ({ width: video.videoWidth, height: video.videoHeight, paused: video.paused, frames: Number(document.documentElement.dataset.previewFrames) }));
    const previewCollision = await page.locator('#screenshot-button, .preview-display-controls').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    const overlapX = Math.min(previewCollision[0].right, previewCollision[1].right) - Math.max(previewCollision[0].left, previewCollision[1].left);
    const overlapY = Math.min(previewCollision[0].bottom, previewCollision[1].bottom) - Math.max(previewCollision[0].top, previewCollision[1].top);
    result.previewControlsClear = overlapX <= 0 || overlapY <= 0;
    await page.locator('#screenshot-button').click();
    await page.waitForFunction(() => Boolean(document.documentElement.dataset.lastSavedPath), null, { timeout: 20_000 });
    await page.locator('.sidebar .nav-item[data-action="edit"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.editorOpen === 'true', null, { timeout: 20_000 });
    result.editorLayout = await page.locator('#image-editor-shell, .sidebar, .editor-tools, #editor-workspace').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const key = node.id === 'image-editor-shell' ? 'shell' : node.classList.contains('sidebar') ? 'sidebar' : node.classList.contains('editor-tools') ? 'tools' : 'workspace';
      return [key, { left: rect.left, right: rect.right, top: rect.top }];
    })));
    result.editorSidebarVisible = await page.locator('.sidebar').isVisible();
    result.editorRounding = await page.locator('#editor-workspace, #editor-canvas-wrap').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => {
      const style = getComputedStyle(node);
      return [node.id, { radius: Number.parseFloat(style.borderTopLeftRadius), overflow: style.overflow }];
    })));
    await page.locator('#editor-close').click();
    const recordingNav = page.locator('.sidebar .nav-item[data-page="capture"]:not([data-action="screenshot"])');
    const screenshotNav = page.locator('.sidebar .nav-item[data-action="screenshot"]');
    await screenshotNav.click();
    result.screenshotNavExclusive = await page.locator('.sidebar .nav-item.active').evaluateAll((nodes) => ({
      count: nodes.length,
      action: nodes[0]?.dataset.action || null
    }));
    await recordingNav.click();
    result.recordingNavExclusive = await page.locator('.sidebar .nav-item.active').evaluateAll((nodes) => ({
      count: nodes.length,
      action: nodes[0]?.dataset.action || null
    }));
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
      && result.shortcuts === 6 && result.videoEditor === 1 && result.previewControls >= 4 && result.captureDelayChoices === 4 && ['healthy', 'warning', 'unknown'].includes(result.storageLevel)
      && result.livePreview.width >= 320 && result.livePreview.height >= 200 && !result.livePreview.paused && result.livePreview.frames > 2
      && result.previewControlsClear
      && result.editorSidebarVisible && result.editorLayout.shell.right <= result.editorLayout.sidebar.left + 1
      && result.editorLayout.tools.left >= 8 && result.editorLayout.tools.right <= result.editorLayout.workspace.left + 1
      && result.editorRounding['editor-workspace'].radius >= 12 && result.editorRounding['editor-canvas-wrap'].radius >= 8
      && result.editorRounding['editor-canvas-wrap'].overflow === 'hidden'
      && result.screenshotNavExclusive.count === 1 && result.screenshotNavExclusive.action === 'screenshot'
      && result.recordingNavExclusive.count === 1 && result.recordingNavExclusive.action === null
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
