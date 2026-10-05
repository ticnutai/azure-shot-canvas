const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { version: appVersion } = require('../package.json');

async function main() {
  const executablePath = process.env.SCREEN_STUDIO_VERIFY_EXECUTABLE || path.join(process.env.LOCALAPPDATA, 'Programs', 'hebrew-screen-studio', 'אולפן צילום מסך.exe');
  await fs.access(executablePath);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurum-installed-verify-'));
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${path.join(root, 'profile')}`],
    env: {
      ...process.env,
      SCREEN_STUDIO_HEADLESS: '1',
      SCREEN_STUDIO_OUTPUT_DIR: path.join(root, 'library'),
      SCREEN_STUDIO_QA_REPORT_DIR: path.join(root, 'qa'),
      SCREEN_STUDIO_USER_DATA_DIR: path.join(root, 'user-data')
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
    result.versionBadge = await page.locator('#app-version').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { text: node.textContent, left: rect.left, bottomGap: innerHeight - rect.bottom, fontSize: Number.parseFloat(getComputedStyle(node).fontSize), visible: getComputedStyle(node).display !== 'none' };
    });
    result.removedChrome = {
      profile: await page.locator('.profile-button').count(),
      sidebarLogo: await page.locator('.logo-mark').count(),
      firstSidebarItemTop: await page.locator('.sidebar nav .nav-item').first().evaluate((node) => node.getBoundingClientRect().top)
    };
    result.captureLayouts = {
      defaultLayout: await page.locator('html').getAttribute('data-capture-layout'),
      dashboardCards: await page.locator('.dashboard-grid').count(),
      railInitiallyVisible: await page.locator('#capture-settings').isVisible()
    };
    await page.locator('#open-capture-settings').click();
    result.captureLayouts.dialogVisible = await page.locator('#capture-settings').isVisible();
    await page.locator('#close-capture-settings').click();
    await page.locator('#capture-layout-button').click();
    await page.locator('[data-capture-layout-choice="professional"]').click();
    result.captureLayouts.professionalRailVisible = await page.locator('#capture-settings').isVisible();
    await page.locator('#capture-layout-button').click();
    await page.locator('[data-capture-layout-choice="focus"]').click();
    result.captureLayouts.focusLibraryHidden = !(await page.locator('#capture-page .library-strip').isVisible());
    await page.locator('#capture-layout-button').click();
    await page.locator('[data-capture-layout-choice="clean"]').click();
    result.shortcuts = await page.locator('[data-shortcut-action]').count();
    result.shortcutKinds = await page.locator('[data-shortcut-kind]').count();
    result.shortcutScopes = await page.locator('[data-shortcut-scope]').count();
    result.videoEditor = await page.locator('#video-editor-modal').count();
    result.previewControls = await page.locator('.preview-display-controls button, .preview-display-controls input').count();
    result.captureDelayChoices = await page.locator('#capture-delay option').count();
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="workflows"]').click();
    result.workflows = { tab: await page.locator('[data-preference-section="workflows"]').isVisible(), templates: await page.locator('[data-workflow-template]').count(), actions: await page.locator('.workflow-actions label').count() };
    await page.locator('[data-preference-tab="general"]').click();
    result.recordButton = await page.locator('#record-button').evaluate((button) => ({ color: getComputedStyle(button).color, background: getComputedStyle(button).backgroundImage, iconRadius: getComputedStyle(button.querySelector('.record-action-icon')).borderRadius }));
    result.storageLevel = await page.locator('html').getAttribute('data-storage-level');
    await page.locator('.sidebar .nav-item[data-page="settings"]').click();
    await page.locator('#quickbar-enabled').evaluate((input) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#quickbar-edge')?.disabled === false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const quickbarPage = app.windows().find((candidate) => candidate.url().includes('quickbar.html'));
    result.quickbar = {
      available: Boolean(quickbarPage),
      actions: quickbarPage ? await quickbarPage.locator('[data-action]').count() : 0,
      native: await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('quickbar.html'));
        return win ? { alwaysOnTop: win.isAlwaysOnTop(), focusable: win.isFocusable(), width: win.getBounds().width } : null;
      })
    };
    await page.locator('#quickbar-enabled').evaluate((input) => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#quickbar-edge')?.disabled === true);
    await page.locator('.sidebar .nav-item[data-page="capture"]:not([data-action])').click();
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
    result.tools = await page.evaluate(async () => {
      const engines = await window.screenStudio.getLocalEngines();
      const ocr = await window.screenStudio.runOcr(document.documentElement.dataset.lastSavedPath);
      return { engines, ocrCharacters: ocr.text.length, ocrLanguage: ocr.language };
    });
    await page.locator('.sidebar .nav-item[data-page="tools"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.enginePolicy === 'reuse-existing-only', null, { timeout: 20_000 });
    result.smartActions = await page.locator('[data-smart-action]').count();
    result.engineCards = await page.locator('#engine-grid article').count();
    await page.locator('.sidebar .nav-item[data-page="library"]').click();
    await page.locator('.sidebar .nav-item[data-action="edit"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.editorOpen === 'true', null, { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('#image-editor-shell')?.dataset.editorReady === 'true', null, { timeout: 20_000 });
    result.editorLayout = await page.locator('#image-editor-shell, .sidebar, .editor-tools, #editor-workspace').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const key = node.id === 'image-editor-shell' ? 'shell' : node.classList.contains('sidebar') ? 'sidebar' : node.classList.contains('editor-tools') ? 'tools' : 'workspace';
      return [key, { left: rect.left, right: rect.right, top: rect.top }];
    })));
    result.editorSidebarVisible = await page.locator('.sidebar').isVisible();
    await page.locator('#editor-zoom-range').fill('150');
    result.editorZoom = { percent: await page.locator('#editor-zoom').innerText(), manual: await page.locator('#editor-workspace').getAttribute('data-manual-zoom'), controlsVisible: await page.locator('.editor-history').isVisible() };
    await page.locator('#editor-fit').click();
    result.editorRounding = await page.locator('#editor-workspace, #editor-canvas-wrap').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => {
      const style = getComputedStyle(node);
      return [node.id, { radius: Number.parseFloat(style.borderTopLeftRadius), overflow: style.overflow }];
    })));
    await page.locator('#editor-close').click();
    const recordingNav = page.locator('.sidebar .nav-item[data-page="capture"]:not([data-action])');
    result.captureNavigation = { count: await recordingNav.count(), label: (await recordingNav.innerText()).trim(), duplicateScreenshotEntry: await page.locator('.sidebar .nav-item[data-action="screenshot"]').count() };
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
      && result.versionBadge.text === `v${appVersion}` && result.versionBadge.visible && result.versionBadge.left <= 12 && result.versionBadge.bottomGap <= 10 && result.versionBadge.fontSize <= 9
      && result.removedChrome.profile === 0 && result.removedChrome.sidebarLogo === 0 && result.removedChrome.firstSidebarItemTop <= 30
      && result.captureLayouts.defaultLayout === 'clean' && result.captureLayouts.dashboardCards === 0 && !result.captureLayouts.railInitiallyVisible
      && result.captureLayouts.dialogVisible && result.captureLayouts.professionalRailVisible && result.captureLayouts.focusLibraryHidden
      && result.shortcuts === 15 && result.shortcutKinds === 15 && result.shortcutScopes === 15 && result.videoEditor === 1 && result.previewControls >= 4 && result.captureDelayChoices === 4 && ['healthy', 'warning', 'unknown'].includes(result.storageLevel)
      && result.livePreview.width >= 320 && result.livePreview.height >= 200 && !result.livePreview.paused && result.livePreview.frames > 2
      && result.previewControlsClear
      && result.workflows.tab && result.workflows.templates === 3
      && result.quickbar.available && result.quickbar.actions === 8 && result.quickbar.native?.alwaysOnTop && !result.quickbar.native?.focusable && result.quickbar.native?.width === 11
      && result.recordButton.color === 'rgb(255, 255, 255)' && result.recordButton.background !== 'none' && result.recordButton.iconRadius !== '0px'
      && result.editorSidebarVisible && result.editorLayout.shell.right <= result.editorLayout.sidebar.left + 1
      && result.editorZoom.percent === '150%' && result.editorZoom.manual === 'true' && result.editorZoom.controlsVisible
      && result.editorLayout.tools.left >= 8 && result.editorLayout.tools.right <= result.editorLayout.workspace.left + 1
      && result.editorRounding['editor-workspace'].radius >= 12 && result.editorRounding['editor-canvas-wrap'].radius >= 8
      && result.editorRounding['editor-canvas-wrap'].overflow === 'hidden'
      && result.captureNavigation.count === 1 && result.captureNavigation.label.includes('צילום והקלטה') && result.captureNavigation.duplicateScreenshotEntry === 0
      && result.recordingNavExclusive.count === 1 && result.recordingNavExclusive.action === null
      && result.smartActions === 5 && result.engineCards === 4
      && result.tools.engines.ffmpeg.available && result.tools.engines.ffprobe.available && result.tools.engines.ocr.available
      && result.tools.engines.ocr.languages.includes('heb') && result.tools.ocrLanguage.includes('heb')
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
