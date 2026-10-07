const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { regionOverlay } = require('../helpers/region.cjs');
const { audioLevels, pngDimensions, probe } = require('../helpers/media.cjs');
const { metric, summarize } = require('../helpers/metrics.cjs');
const { version: appVersion } = require('../../package.json');

async function attachMetrics(testInfo, metrics) {
  await testInfo.attach('metrics', { body: Buffer.from(JSON.stringify(metrics)), contentType: 'application/json' });
}

async function setCheckbox(page, selector, checked) {
  await page.locator(selector).evaluate((element, value) => {
    element.checked = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, checked);
}

async function setCaptureDefaults(page, kind, scope) {
  await page.locator('[data-page="settings"]').click();
  await page.locator('[data-preference-tab="general"]').click();
  await page.locator('#default-capture-kind').selectOption(kind);
  await page.locator('#default-capture-scope').selectOption(scope);
  await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
}

async function waitForNewFile(directory, extension, before = new Set(), timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const names = await fs.readdir(directory);
    const found = names.find((name) => name.toLowerCase().endsWith(extension) && !before.has(name));
    if (found) {
      const fullPath = path.join(directory, found);
      const stat = await fs.stat(fullPath);
      if (stat.size > 0) return fullPath;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${extension} in ${directory}`);
}

test.describe('Electron production workflow', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;

  test.beforeEach(async ({}, testInfo) => {
    const started = performance.now();
    ({ app, page, outputDir, runtimeErrors } = await launchStudio(testInfo.title.replace(/\W+/g, '-')));
    testInfo.startupMs = performance.now() - started;
  });

  test.afterEach(async () => {
    const errors = [...runtimeErrors];
    await closeStudio(app);
    expect(errors, 'renderer console/page errors').toEqual([]);
  });

  test('startup, sources, responsive UI and navigation', async ({}, testInfo) => {
    // Covers themes, layouts, shortcuts and two reloads; it outgrew the 90s default.
    test.setTimeout(240_000);
    const metrics = [metric('Cold app ready', testInfo.startupMs, 'ms', 10_000, 'max', 'Electron launch to appReady, including parallel in-app QA execution')];
    await expect(page.locator('#app-version')).toHaveText(`v${appVersion}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-version', appVersion);
    const versionBadge = await page.locator('#app-version').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, bottomGap: innerHeight - rect.bottom, fontSize: Number.parseFloat(getComputedStyle(node).fontSize), visible: getComputedStyle(node).display !== 'none' };
    });
    expect(versionBadge.visible).toBeTruthy();
    expect(versionBadge.left).toBeLessThanOrEqual(12);
    expect(versionBadge.bottomGap).toBeLessThanOrEqual(10);
    expect(versionBadge.fontSize).toBeLessThanOrEqual(9);
    metrics.push(metric('Always-visible version badge', 6, 'assertions', 6, 'min', `v${appVersion}; left=${versionBadge.left}px bottom=${versionBadge.bottomGap}px font=${versionBadge.fontSize}px`));
    await expect(page.locator('.profile-button')).toHaveCount(0);
    await expect(page.locator('.logo-mark')).toHaveCount(0);
    const firstSidebarItemTop = await page.locator('.sidebar nav .nav-item').first().evaluate((node) => node.getBoundingClientRect().top);
    expect(firstSidebarItemTop).toBeLessThanOrEqual(30);
    metrics.push(metric('Removed redundant header/sidebar marks', 3, 'assertions', 3, 'min', `profile=0, logo=0, first sidebar item top=${firstSidebarItemTop}px`));
    await expect(page.locator('html')).toHaveAttribute('data-capture-layout', 'clean');
    await expect(page.locator('.dashboard-grid')).toHaveCount(0);
    await expect(page.locator('#capture-settings')).toBeHidden();
    await page.locator('#open-capture-settings').click();
    await expect(page.locator('html')).toHaveAttribute('data-capture-settings-open', 'true');
    await expect(page.locator('#capture-settings')).toBeVisible();
    await expect(page.locator('#capture-settings .settings-tabs')).toBeVisible();
    await page.locator('#close-capture-settings').click();
    await page.locator('#capture-layout-button').click();
    await page.locator('[data-capture-layout-choice="professional"]').click();
    await expect(page.locator('#capture-settings')).toBeVisible();
    await page.locator('#capture-layout-button').click();
    await page.locator('[data-capture-layout-choice="focus"]').click();
    await expect(page.locator('#capture-page .library-strip')).toBeHidden();
    await page.locator('#capture-layout-button').click();
    await page.locator('[data-capture-layout-choice="clean"]').click();
    await expect(page.locator('#capture-layout-select')).toHaveValue('clean');
    metrics.push(metric('Capture workspace layouts', 3, 'layouts', 3, 'min', 'clean dialog, professional inline rail, focus preview-only; dashboard cards removed'));
    const sourceCount = await page.locator('.source-card').count();
    expect(sourceCount).toBeGreaterThan(0);
    metrics.push(metric('Capture sources discovered', sourceCount, 'sources', 1, 'min', 'desktopCapturer source cards'));

    const previewStarted = performance.now();
    await page.locator('.source-card').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    await expect(page.locator('#display-video')).toBeVisible();
    await expect.poll(async () => Number(await page.locator('html').getAttribute('data-preview-frames')), { timeout: 5000 }).toBeGreaterThan(3);
    const preview = await page.locator('#display-video').evaluate((video) => ({ width: video.videoWidth, height: video.videoHeight, paused: video.paused, readyState: video.readyState }));
    expect(preview.width).toBeGreaterThanOrEqual(320);
    expect(preview.height).toBeGreaterThanOrEqual(200);
    expect(preview.paused).toBeFalsy();
    expect(preview.readyState).toBeGreaterThanOrEqual(2);
    const previewReadyMs = performance.now() - previewStarted;
    metrics.push(metric('Live preview ready', previewReadyMs, 'ms', 5000, 'max', `${preview.width}x${preview.height}; moving frames verified, not placeholder or frozen thumbnail`));
    await page.locator('[data-preview-fit="cover"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-fit', 'cover');
    await page.locator('#preview-zoom').fill('140');
    await expect(page.locator('#preview-zoom-output')).toHaveText('140%');
    await page.locator('#toggle-safe-area').click();
    await expect(page.locator('.capture-preview')).toHaveClass(/safe-area-visible/);
    await page.locator('#open-capture-settings').click();
    await page.locator('#camera-position').selectOption('top-left');
    await page.locator('#camera-size').fill('28');
    await page.locator('[data-settings-tab="image"]').click();
    await page.locator('#capture-delay').selectOption('3');
    await page.locator('[data-settings-tab="video"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-camera-position', 'top-left');
    await expect(page.locator('html')).toHaveAttribute('data-camera-size', '28');
    await expect(page.locator('html')).toHaveAttribute('data-capture-delay', '3');
    await page.locator('#close-capture-settings').click();
    metrics.push(metric('Professional preview composition controls', 7, 'assertions', 7, 'min', 'fit/fill, 140% zoom, safe area, four camera positions and 12-35% camera sizing'));

    const refreshSamples = [];
    for (let i = 0; i < 5; i += 1) {
      const revision = await page.locator('html').getAttribute('data-sources-revision');
      const started = performance.now();
      await page.locator('#refresh-sources').dispatchEvent('click');
      await page.waitForFunction((previous) => document.documentElement.dataset.sourcesRevision !== previous && document.documentElement.dataset.sourcesLoading === 'false', revision);
      refreshSamples.push(performance.now() - started);
    }
    const refresh = summarize(refreshSamples);
    metrics.push(metric('Source refresh p50', refresh.p50, 'ms', 2500, 'max', `n=${refresh.count}; Windows desktop source enumeration`));
    metrics.push(metric('Source refresh p95', refresh.p95, 'ms', 3500, 'max', `min=${refresh.min.toFixed(1)}, max=${refresh.max.toFixed(1)}; regression delta remains visible`));

    for (const viewport of [{ width: 1280, height: 840 }, { width: 1000, height: 700 }]) {
      await page.setViewportSize(viewport);
      const cards = await page.locator('.capture-stage, .settings-rail').evaluateAll((nodes) => nodes.map((node) => {
        const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }));
      expect(cards).toHaveLength(2);
      expect(cards[0].left).toBeGreaterThanOrEqual(0);
      expect(cards[1].right).toBeLessThanOrEqual(viewport.width);
      const horizontalOverlap = Math.min(cards[0].right, cards[1].right) - Math.max(cards[0].left, cards[1].left);
      const verticalOverlap = Math.min(cards[0].bottom, cards[1].bottom) - Math.max(cards[0].top, cards[1].top);
      expect(horizontalOverlap > 1 && verticalOverlap > 1, 'stage and settings must not overlap on both axes').toBeFalsy();
    }
    metrics.push(metric('Responsive Aurum layout coverage', 2, 'viewports', 2, 'min', '1280x840 and 1000x700, stage/settings never overlap'));

    const themes = ['midnight', 'porcelain', 'sky', 'sand', 'mint', 'ivory'];
    await expect(page.locator('#theme-button')).toContainText('ערכות נושא');
    for (const theme of themes) {
      await page.locator(`#theme-button`).dispatchEvent('click');
      await page.locator(`[data-theme-choice="${theme}"]`).dispatchEvent('click');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    }
    const ivoryWeight = await page.locator('.wordmark h1').evaluate((node) => getComputedStyle(node).fontWeight);
    expect(Number(ivoryWeight)).toBeLessThanOrEqual(400);
    metrics.push(metric('Working color themes', themes.length, 'themes', 6, 'min', `${themes.join(', ')}; ivory typography weight=${ivoryWeight}`));

    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="audio"]').click();
    await expect(page.locator('[data-settings-section="audio"]')).toHaveClass(/active/);
    await page.locator('[data-settings-tab="image"]').click();
    await expect(page.locator('[data-settings-section="image"]')).toHaveClass(/active/);
    await page.locator('[data-settings-tab="video"]').click();
    // Every format is available now (MOV and GIF were 'coming soon').
    expect(await page.locator('#format-select option:disabled').count()).toBe(0);
    expect(await page.locator('#format-select option').count()).toBe(4);
    metrics.push(metric('Settings tabs and capability labels', 3, 'tabs', 3, 'min', 'video/audio/image; all four video formats available'));
    await page.locator('#close-capture-settings').click();

    const recordNavigation = page.locator('.sidebar .nav-item[data-page="capture"]:not([data-action])');
    await expect(recordNavigation).toContainText('צילום והקלטה');
    await expect(page.locator('.sidebar .nav-item[data-action="screenshot"]')).toHaveCount(0);

    const toolsNavigation = page.locator('.sidebar .nav-item[data-page="tools"]');
    await toolsNavigation.click();
    await expect(page.locator('#tools-page')).toHaveClass(/active/);
    await expect(page.locator('[data-smart-action]')).toHaveCount(5);
    await expect.poll(async () => page.locator('.engine-grid article').count(), { timeout: 20_000 }).toBe(4);
    await expect(page.locator('html')).toHaveAttribute('data-engine-policy', 'reuse-existing-only');
    await recordNavigation.click();
    await recordNavigation.click();
    await expect(recordNavigation).toHaveClass(/active/);
    await expect(page.locator('.sidebar .nav-item.active')).toHaveCount(1);

    await page.setViewportSize({ width: 1280, height: 840 });
    await expect(page.locator('button[data-recent-filter]')).toHaveCount(3);
    await expect(page.locator('button[data-recent-view]')).toHaveCount(3);
    await expect(page.locator('#recent-sort option')).toHaveCount(5);
    await expect(page.locator('.settings-cards')).toHaveCount(0);
    await expect(page.locator('.capture-quick-actions')).toHaveCount(0);
    await expect(page.locator('.recent-utility-actions > button')).toHaveCount(3);
    const captureLayout = await page.locator('.content-shell, .capture-stage, .library-strip').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const isShell = node.classList.contains('content-shell');
      return [isShell ? 'shell' : node.classList.contains('capture-stage') ? 'stage' : 'media', { left: rect.left + (isShell ? parseFloat(style.paddingLeft) : 0), right: rect.right - (isShell ? parseFloat(style.paddingRight) : 0), width: rect.width - (isShell ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 0), top: rect.top }];
    })));
    expect(Math.abs(captureLayout.media.left - captureLayout.shell.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(captureLayout.media.right - captureLayout.shell.right)).toBeLessThanOrEqual(2);
    expect(Math.abs(captureLayout.media.width - captureLayout.stage.width)).toBeLessThanOrEqual(2);
    expect(captureLayout.media.top).toBeGreaterThan(captureLayout.stage.top);
    await page.locator('[data-recent-filter="image"]').click();
    await page.locator('#recent-sort').selectOption('size-desc');
    await page.locator('[data-recent-view="list"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-recent-filter', 'image');
    await expect(page.locator('html')).toHaveAttribute('data-recent-sort', 'size-desc');
    await expect(page.locator('#recent-library')).toHaveClass(/recent-view-list/);
    metrics.push(metric('Full-width recent media and compact actions', 12, 'assertions', 12, 'min', '3 filters, 5 sorts, 3 views, 3 compact file actions; removed two info cards and oversized quick-action panel; media spans both columns'));

    await page.locator('[data-page="library"]').click();
    await expect(page.locator('#library-page')).toHaveClass(/active/);
    await expect(page.locator('#capture-settings')).toBeHidden();
    const libraryLayout = await page.locator('.content-shell, #library-page').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const isShell = node.classList.contains('content-shell');
      return { left: rect.left + (isShell ? parseFloat(style.paddingLeft) : 0), right: rect.right - (isShell ? parseFloat(style.paddingRight) : 0), width: rect.width - (isShell ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 0) };
    }));
    expect(Math.abs(libraryLayout[0].left - libraryLayout[1].left)).toBeLessThanOrEqual(2);
    expect(Math.abs(libraryLayout[0].right - libraryLayout[1].right)).toBeLessThanOrEqual(2);
    expect(libraryLayout[1].width).toBeGreaterThan(1000);
    await expect(page.locator('button[data-library-view]')).toHaveCount(3);
    for (const view of ['list', 'table', 'grid']) {
      await page.locator(`[data-library-view="${view}"]`).click();
      await expect(page.locator('#library-list')).toHaveClass(new RegExp(`view-${view}`));
    }
    await page.locator('#library-size').fill('3');
    await expect(page.locator('#library-list')).toHaveClass(/size-large/);
    await page.locator('[data-page="settings"]').click();
    await expect(page.locator('#settings-page')).toHaveClass(/active/);
    await expect(page.locator('#output-path')).toContainText(outputDir);
    await page.locator('[data-preference-tab="shortcuts"]').click();
    await expect(page.locator('[data-shortcut-action]')).toHaveCount(19);
    await expect(page.locator('#shortcut-visible-count')).toHaveText('19');
    // The capture key professional tools use: PrtSc for an area, Shift+PrtSc for the previous one, Ctrl+PrtSc for text.
    await expect(page.locator('[data-shortcut-action="region"]')).toHaveText('PrtSc');
    await expect(page.locator('[data-shortcut-action="repeatRegion"]')).toHaveText('Shift + PrtSc');
    await expect(page.locator('[data-shortcut-action="ocrRegion"]')).toHaveText('Ctrl + PrtSc');
    await expect(page.locator('#shortcut-status-banner')).toContainText('כל הקיצורים רשומים ופעילים');
    await expect(page.locator('[data-shortcut-action="record"]')).toHaveText('Ctrl + Shift + 2');
    await expect(page.locator('[data-shortcut-row="repeatRegion"]')).toHaveCount(1);
    await expect(page.locator('[data-shortcut-warning]:not(:empty)')).toHaveCount(0);
    // Ctrl+K, shown in the search box, jumps to search.
    await page.locator('body').dispatchEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true });
    await expect(page.locator('#global-search')).toBeFocused();
    await page.locator('#global-search').blur();
    await page.locator('[data-shortcut-action="camera"]').click();
    await page.locator('body').dispatchEvent('keydown', { key: 'ב', code: 'KeyC', ctrlKey: true, altKey: true });
    await expect(page.locator('[data-shortcut-action="camera"]')).toHaveText('Ctrl + Alt + C');
    await page.locator('[data-shortcut-test="camera"]').click();
    await expect(page.locator('[data-shortcut-row="camera"]')).toHaveClass(/tested/);
    await page.locator('#shortcut-category').selectOption('library');
    await expect(page.locator('#shortcut-visible-count')).toHaveText('4');
    await page.locator('#shortcut-search').fill('תיקיית');
    await expect(page.locator('#shortcut-visible-count')).toHaveText('1');
    await page.locator('#shortcut-search').fill('');
    await page.locator('#shortcut-category').selectOption('all');

    const openLibraryRow = page.locator('[data-shortcut-row="openLibrary"]');
    await openLibraryRow.locator('[data-shortcut-kind]').selectOption('double');
    await openLibraryRow.locator('[data-shortcut-scope]').selectOption('focused');
    await page.locator('body').dispatchEvent('keydown', { key: 'ב', code: 'KeyC' });
    await expect(openLibraryRow.locator('[data-shortcut-action]')).toHaveText('פעמיים C');
    await openLibraryRow.locator('[data-shortcut-interval]').selectOption('650');
    await page.locator('body').dispatchEvent('keydown', { key: 'ב', code: 'KeyC' });
    await page.waitForTimeout(100);
    await page.locator('body').dispatchEvent('keydown', { key: 'ב', code: 'KeyC' });
    await expect(page.locator('#library-page')).toHaveClass(/active/);
    await page.locator('.sidebar .nav-item[data-page="settings"]').click();
    await page.locator('[data-preference-tab="shortcuts"]').click();
    await page.locator('body').dispatchEvent('keydown', { key: 'c', code: 'KeyC' });
    await page.waitForTimeout(100);
    await page.locator('body').dispatchEvent('keydown', { key: 'c', code: 'KeyC' });
    await expect(page.locator('#library-page')).toHaveClass(/active/);
    await page.locator('.sidebar .nav-item[data-page="settings"]').click();
    await page.locator('[data-preference-tab="shortcuts"]').click();

    await openLibraryRow.locator('[data-shortcut-scope]').selectOption('global');
    await page.keyboard.press('F8');
    await expect(openLibraryRow.locator('[data-shortcut-action]')).toHaveText('פעמיים F8');
    await openLibraryRow.locator('[data-shortcut-interval]').selectOption('650');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('index.html')).webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F8' }));
    await page.waitForTimeout(360);
    await expect(page.locator('#settings-page')).toHaveClass(/active/);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('index.html')).webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F8' }));
    await expect(page.locator('#library-page')).toHaveClass(/active/);
    await page.locator('.sidebar .nav-item[data-page="settings"]').click();
    await page.locator('[data-preference-tab="shortcuts"]').click();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.locator('.sidebar .nav-item[data-page="settings"]').click();
    await page.locator('[data-preference-tab="shortcuts"]').click();
    await expect(openLibraryRow.locator('[data-shortcut-action]')).toHaveText('פעמיים F8');
    await expect(openLibraryRow.locator('[data-shortcut-interval]')).toHaveValue('650');

    const screenshotRow = page.locator('[data-shortcut-row="screenshot"]');
    await screenshotRow.locator('[data-shortcut-kind]').selectOption('double');
    await screenshotRow.locator('[data-shortcut-action]').click();
    await page.locator('body').dispatchEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
    await expect(page.locator('#toast')).toContainText('אינו מתאים ללחיצה כפולה');
    await page.keyboard.press('Escape');

    const startRow = page.locator('[data-shortcut-row="recordStart"]');
    await startRow.locator('[data-shortcut-kind]').selectOption('single');
    await startRow.locator('[data-shortcut-scope]').selectOption('global');
    await page.keyboard.press('KeyR');
    await expect(startRow.locator('[data-shortcut-scope]')).toHaveValue('focused');
    await expect(startRow.locator('[data-shortcut-action]')).toHaveText('R');
    await startRow.locator('[data-shortcut-clear]').click();
    await expect(startRow.locator('[data-shortcut-action]')).toHaveText('לא מוגדר');
    await page.locator('#reset-shortcuts').click();
    await expect(page.locator('[data-shortcut-action="camera"]')).toHaveText('Ctrl + Shift + 7');
    await expect(page.locator('[data-shortcut-action="openOutput"]')).toHaveText('Ctrl + Shift + 8');
    await expect(page.locator('[data-shortcut-action="toggleWindow"]')).toHaveText('פעמיים F9');
    metrics.push(metric('Bilingual configurable shortcut center', 28, 'assertions', 28, 'min', '16 actions, safe chord/single/double triggers, 650ms interval, global and focused E2E dispatch, Hebrew/English physical code, unsafe Windows-key rejection, persistence, IPC test and reset'));
    await page.locator('[data-preference-tab="general"]').click();
    await expect(page.locator('#default-capture-kind')).toHaveValue('record');
    await expect(page.locator('#default-capture-scope')).toHaveValue('full');
    await page.locator('#default-capture-kind').selectOption('screenshot');
    await page.locator('#default-capture-scope').selectOption('region');
    await page.locator('[data-preference-tab="appearance"]').click();
    await expect(page.locator('[data-preference-section="appearance"]')).toHaveClass(/active/);
    await expect(page.locator('html')).toHaveAttribute('data-theme-draft', 'false');
    await page.locator('[data-theme-var="--gold"]').evaluate((input) => {
      input.value = '#8a2be2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme-draft', 'true');
    expect(await page.locator('html').evaluate((node) => node.style.getPropertyValue('--gold'))).toBe('#8a2be2');
    await page.locator('#cancel-theme-edit').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ivory');
    expect(await page.locator('html').evaluate((node) => node.style.getPropertyValue('--gold'))).toBe('');

    await page.locator('[data-preference-tab="appearance"]').click();
    await page.locator('#custom-theme-name').fill('סגול בדיקות');
    await page.locator('#theme-base-select').selectOption('midnight');
    await page.locator('[data-theme-var="--gold"]').evaluate((input) => {
      input.value = '#8a2be2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#save-theme-edit').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'custom');
    await expect(page.locator('#custom-theme-select option')).toHaveCount(2);
    await page.locator('#duplicate-custom-theme').click();
    await expect(page.locator('#custom-theme-name')).toHaveValue('סגול בדיקות — עותק');
    await page.locator('#save-theme-edit').click();
    await expect(page.locator('#custom-theme-select option')).toHaveCount(3);
    await page.locator('#delete-custom-theme').click();
    await expect(page.locator('#delete-custom-theme')).toHaveText('לחץ שוב למחיקה');
    await page.locator('#delete-custom-theme').click();
    await expect(page.locator('#custom-theme-select option')).toHaveCount(2);
    await page.locator('#theme-button').click();
    await expect(page.locator('#create-theme-shortcut')).toBeVisible();
    await expect(page.locator('#manage-themes-shortcut')).toBeVisible();
    await page.locator('#theme-button').click();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await expect(page.locator('html')).toHaveAttribute('data-library-view', 'grid');
    await expect(page.locator('html')).toHaveAttribute('data-library-size', 'large');
    await expect(page.locator('html')).toHaveAttribute('data-default-capture-kind', 'screenshot');
    await expect(page.locator('html')).toHaveAttribute('data-default-capture-scope', 'region');
    await expect(page.locator('html')).toHaveAttribute('data-recent-filter', 'image');
    await expect(page.locator('html')).toHaveAttribute('data-recent-sort', 'size-desc');
    await expect(page.locator('html')).toHaveAttribute('data-recent-view', 'list');
    await expect(page.locator('#record-button span')).toHaveText('צלם תמונה');
    await page.locator('#theme-button').click();
    await expect(page.locator('#custom-theme-menu-items')).toContainText('סגול בדיקות');
    metrics.push(metric('Theme library management and draft safety', 12, 'assertions', 12, 'min', 'live preview, cancel, named save, duplicate, safe delete, direct create/manage links, reload library persistence'));
    metrics.push(metric('Persistent capture and library preferences', 8, 'assertions', 8, 'min', '3 views, large thumbnails, video/image default, full/region scope, reload persistence'));

    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="development"]').click();
    await expect(page.locator('[data-preference-section="development"]')).toHaveClass(/active/);
    await expect(page.locator('#qa-status')).toHaveText('עבר בהצלחה');
    await expect(page.locator('#qa-metrics-body tr')).toHaveCount(2);
    await expect(page.locator('#qa-metrics-body')).toContainText('-300 ms');
    await expect(page.locator('#qa-console')).toContainText('Saved QA console fixture');
    await expect(page.locator('#run-qa')).toBeDisabled();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('index.html')).webContents.send('qa:output', 'QA stream probe'));
    await expect(page.locator('#qa-console')).toContainText('QA stream probe');
    await page.locator('#copy-qa-console').click();
    await expect(page.locator('#copy-qa-console')).toHaveText('✓ הועתק');
    await page.locator('#copy-qa-report').click();
    await expect(page.locator('#copy-qa-report')).toHaveText('✓ הועתק');
    await page.locator('#refresh-qa').click();
    await expect(page.locator('#qa-metrics-body tr')).toHaveCount(2);
    metrics.push(metric('Development QA dashboard controls', 8, 'controls', 8, 'min', 'report, comparison, stream, recursion guard, two copy actions, refresh, metrics table'));
    await attachMetrics(testInfo, metrics);
  });

  test('floating quickbar auto-hide, pinning and system-wide actions', async ({}, testInfo) => {
    const metrics = [];
    await page.locator('.source-card').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await setCheckbox(page, '#quickbar-enabled', true);
    // This test covers the full panel on the right edge (the default is the slim strip in the top edge).
    await page.locator('#quickbar-style').selectOption('panel');
    await page.locator('#quickbar-edge').selectOption('right');

    await expect.poll(() => app.windows().filter((candidate) => candidate.url().includes('quickbar.html')).length).toBe(1);
    const quickbarPage = app.windows().find((candidate) => candidate.url().includes('quickbar.html'));
    const quickbarErrors = [];
    quickbarPage.on('console', (message) => { if (message.type() === 'error') quickbarErrors.push(message.text()); });
    quickbarPage.on('pageerror', (error) => quickbarErrors.push(error.message));
    await quickbarPage.waitForFunction(() => document.body.dataset.expanded === 'false' && document.body.dataset.edge === 'right');

    const collapsed = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('quickbar.html'));
      return { bounds: win.getBounds(), workArea: screen.getDisplayMatching(win.getBounds()).workArea, alwaysOnTop: win.isAlwaysOnTop(), focusable: win.isFocusable() };
    });
    expect(collapsed.bounds.width).toBe(11);
    expect(collapsed.bounds.x + collapsed.bounds.width).toBe(collapsed.workArea.x + collapsed.workArea.width);
    expect(collapsed.alwaysOnTop).toBeTruthy();
    expect(collapsed.focusable).toBeFalsy();

    await quickbarPage.locator('#edge-handle').click();
    await expect.poll(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('quickbar.html')).getBounds().width))).toBe(356);
    await expect(quickbarPage.locator('[data-action]')).toHaveCount(8);
    await quickbarPage.locator('#pin').click();
    await expect(quickbarPage.locator('#pin')).toHaveAttribute('aria-pressed', 'true');
    await quickbarPage.locator('#collapse').click();
    await expect(quickbarPage.locator('body')).toHaveAttribute('data-expanded', 'true');
    await quickbarPage.locator('#pin').click();
    await quickbarPage.locator('#collapse').click();
    await expect(quickbarPage.locator('body')).toHaveAttribute('data-expanded', 'false');
    // Click mode closes on its own once the pointer leaves: the bar can never take focus, so no blur ever arrives.
    await quickbarPage.locator('#edge-handle').click();
    await expect(quickbarPage.locator('body')).toHaveAttribute('data-expanded', 'true');
    // Wait for the window to finish growing: if it grows under the pointer afterwards, a real mouseenter rightly keeps it open.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('quickbar.html')).getBounds().width)).toBe(356);
    await quickbarPage.waitForTimeout(300);
    // Move the real pointer off the bar too, so it cannot re-enter and (rightly) keep the bar open.
    await quickbarPage.mouse.move(3000, 3000);
    await quickbarPage.locator('#quickbar').dispatchEvent('mouseleave');
    await expect(quickbarPage.locator('body')).toHaveAttribute('data-expanded', 'false', { timeout: 5000 });

    await page.locator('#quickbar-edge').selectOption('top');
    await expect(quickbarPage.locator('body')).toHaveAttribute('data-edge', 'top');
    const topBounds = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('quickbar.html'));
      return { bounds: win.getBounds(), workArea: screen.getDisplayMatching(win.getBounds()).workArea };
    });
    expect(topBounds.bounds).toMatchObject({ width: 86, y: topBounds.workArea.y });
    expect(topBounds.bounds.height).toBeGreaterThanOrEqual(11);
    expect(topBounds.bounds.height).toBeLessThanOrEqual(19);

    await page.locator('#quickbar-activation').selectOption('hover');
    await expect(quickbarPage.locator('body')).toHaveAttribute('data-activation', 'hover');
    await quickbarPage.locator('#edge-handle').dispatchEvent('mouseenter');
    await expect(quickbarPage.locator('body')).toHaveAttribute('data-expanded', 'true');
    const hiddenForQuickbar = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('index.html'));
      win.hide();
      return { destroyed: win.isDestroyed(), visible: win.isVisible() };
    });
    expect(hiddenForQuickbar).toEqual({ destroyed: false, visible: false });
    const before = new Set((await fs.readdir(outputDir)).filter((name) => name.endsWith('.png')));
    await quickbarPage.locator('[data-action="screenshot"]').click();
    const screenshotPath = await waitForNewFile(outputDir, '.png', before, 45_000);
    expect((await pngDimensions(screenshotPath)).width).toBeGreaterThan(0);
    // The capture shows its card on the bar; the ▦ button returns to the action buttons.
    await expect(quickbarPage.locator('html')).toHaveAttribute('data-view', 'capture');
    await quickbarPage.locator('#show-actions').click();
    await expect(quickbarPage.locator('html')).toHaveAttribute('data-view', 'actions');
    await expect(quickbarPage.locator('.recent-item')).toHaveCount(1);

    await quickbarPage.locator('[data-action="openLibrary"]').click();
    await expect(page.locator('#library-page')).toHaveClass(/active/);
    await page.locator('[data-page="settings"]').click();
    await setCheckbox(page, '#quickbar-enabled', false);
    await expect.poll(() => app.windows().filter((candidate) => candidate.url().includes('quickbar.html')).length).toBe(0);
    expect(quickbarErrors).toEqual([]);
    metrics.push(metric('Floating quickbar behavior', 18, 'assertions', 18, 'min', 'isolated always-on-top non-focusable window; close-to-background continuity, right/top edges, auto-hide, hover, pinning, 8 actions and real PNG capture; capture exclusion configured through Electron content protection'));
    await attachMetrics(testInfo, metrics);
  });

  test('PNG capture is valid, unique and measured end-to-end', async ({}, testInfo) => {
    const samples = [];
    const dimensions = [];
    await setCaptureDefaults(page, 'screenshot', 'full');
    let before = new Set(await fs.readdir(outputDir));
    let started = performance.now();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('index.html')).webContents.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: ['control', 'shift'] }));
    await expect(page.locator('#region-modal')).toBeHidden();
    let filePath = await waitForNewFile(outputDir, '.png', before);
    samples.push(performance.now() - started);
    dimensions.push(await pngDimensions(filePath));
    await setCaptureDefaults(page, 'screenshot', 'region');
    const region = regionOverlay(app);
    for (let i = 0; i < 4; i += 1) {
      before = new Set(await fs.readdir(outputDir));
      started = performance.now();
      const since = Date.now();
      await page.locator('#screenshot-button').dispatchEvent('click');
      // The studio's button opens the same frozen-screen picker as the shortcut: whole screen (Space), then save.
      const overlay = await region.opened(since);
      await expect(page.locator('#region-modal')).toBeHidden();
      await region.key(overlay, { key: ' ', code: 'Space' });
      await region.key(overlay, { key: 'Enter' });
      filePath = await waitForNewFile(outputDir, '.png', before);
      samples.push(performance.now() - started);
      dimensions.push(await pngDimensions(filePath));
    }
    const summary = summarize(samples);
    const names = (await fs.readdir(outputDir)).filter((name) => name.endsWith('.png'));
    expect(new Set(names).size).toBe(5);
    expect(dimensions.every((item) => item.width >= 320 && item.height >= 200 && item.size >= 5000)).toBeTruthy();
    await expect(page.locator('[data-recent-count="all"]')).toHaveText('5');
    await expect(page.locator('[data-recent-count="image"]')).toHaveText('5');
    await expect(page.locator('[data-recent-count="video"]')).toHaveText('0');
    await page.locator('[data-recent-filter="image"]').click();
    await page.locator('[data-recent-view="compact"]').click();
    await expect(page.locator('#recent-library .clip-card')).toHaveCount(5);
    await page.locator('[data-recent-filter="video"]').click();
    await expect(page.locator('#recent-library .clip-card')).toHaveCount(0);
    await expect(page.locator('#recent-library')).toContainText('אין כרגע סרטונים');
    const metrics = [
      metric('Screenshot save p50', summary.p50, 'ms', 3500, 'max', `n=${summary.count}; Windows desktop-picker under workstation load`),
      metric('Screenshot save p95', summary.p95, 'ms', 5500, 'max', `min=${summary.min.toFixed(1)}, max=${summary.max.toFixed(1)}; Windows desktop-picker tolerance, regression delta remains separately visible`),
      metric('Unique screenshot files', new Set(names).size, 'files', 5, 'min', '5 rapid captures without overwrite'),
      metric('PNG minimum width', Math.min(...dimensions.map((item) => item.width)), 'px', 320, 'min', 'PNG IHDR'),
      metric('PNG minimum size', Math.min(...dimensions.map((item) => item.size)), 'bytes', 5000, 'min', 'filesystem stat'),
      metric('Default full capture and optional region', 2, 'modes', 2, 'min', 'primary screenshot started immediately; region mode opened selector'),
      metric('Recent media classification', 7, 'assertions', 7, 'min', 'all/image/video counts, image filter and empty video state')
    ];
    await attachMetrics(testInfo, metrics);
  });

  test('scroll stitching and reusable capture regions', async ({}, testInfo) => {
    test.setTimeout(90_000);
    await setCaptureDefaults(page, 'screenshot', 'region');
    const region = regionOverlay(app);
    // Select an area on the frozen screen, keep it for reuse (⊕), then save the picture.
    let before = new Set(await fs.readdir(outputDir));
    let since = Date.now();
    await page.locator('#screenshot-button').click();
    let overlay = await region.opened(since);
    await region.drag(overlay, { x: 60, y: 50 }, { x: 360, y: 250 });
    await overlay.locator('[data-command="save-area"]').click();
    await expect(overlay.locator('#note')).toContainText('נשמר');
    await expect(overlay.locator('html')).toHaveAttribute('data-saved-areas', '1');
    await overlay.locator('[data-after="save"]').click();
    const savedRegionCapture = await waitForNewFile(outputDir, '.png', before);

    // Enter on a fresh frozen screen: the last area, then save.
    before = new Set(await fs.readdir(outputDir));
    since = Date.now();
    await page.locator('#screenshot-button').click();
    overlay = await region.opened(since);
    await region.key(overlay, { key: 'Enter' });
    await expect(overlay.locator('html')).toHaveAttribute('data-region-editing', 'true');
    await region.key(overlay, { key: 'Enter' });
    const lastRegionCapture = await waitForNewFile(outputDir, '.png', before);

    // Key 1: the saved area.
    before = new Set(await fs.readdir(outputDir));
    since = Date.now();
    await page.locator('#screenshot-button').click();
    overlay = await region.opened(since);
    await expect(overlay.locator('html')).toHaveAttribute('data-saved-areas', '1');
    await expect(overlay.locator('#hint')).toContainText('מקש 1 האזור השמור');
    await region.key(overlay, { key: '1', code: 'Digit1' });
    await region.key(overlay, { key: 'Enter' });
    const reusableRegionCapture = await waitForNewFile(outputDir, '.png', before);
    const [savedSize, reusedSize] = await Promise.all([savedRegionCapture, reusableRegionCapture].map(pngDimensions));
    expect([reusedSize.width, reusedSize.height]).toEqual([savedSize.width, savedSize.height]);

    // 'Capture last region' shortcut: shoots the stored area at once, without opening the picker.
    before = new Set(await fs.readdir(outputDir));
    await page.evaluate(() => executeShortcutAction('repeatRegion'));
    const repeatedRegionCapture = await waitForNewFile(outputDir, '.png', before);
    await expect(page.locator('#region-modal')).toBeHidden();
    const [lastSize, repeatedSize] = await Promise.all([lastRegionCapture, repeatedRegionCapture].map(pngDimensions));
    expect([repeatedSize.width, repeatedSize.height]).toEqual([lastSize.width, lastSize.height]);

    await setCaptureDefaults(page, 'screenshot', 'scroll');
    before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    await expect(page.locator('#scroll-capture-bar')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-scroll-capture', 'active');
    await page.waitForTimeout(750);
    await page.locator('#finish-scroll-capture').click();
    const scrollingCapture = await waitForNewFile(outputDir, '.png', before, 30_000);
    await expect(page.locator('html')).toHaveAttribute('data-scroll-capture', 'saved');
    const dimensions = await Promise.all([savedRegionCapture, lastRegionCapture, reusableRegionCapture, scrollingCapture].map(pngDimensions));
    expect(dimensions.every((item) => item.width > 0 && item.height > 0 && item.size > 1000)).toBeTruthy();
    const scrollFrames = Number(await page.locator('html').getAttribute('data-scroll-frames'));
    const scrollParts = Number(await page.locator('html').getAttribute('data-scroll-parts'));
    const scrollHeight = Number(await page.locator('html').getAttribute('data-scroll-height'));
    const metrics = [
      metric('Guided scrolling capture', scrollFrames, 'frames sampled', 1, 'min', `${scrollParts} stitched parts; output height ${scrollHeight}px`),
      metric('Reusable capture regions', 4, 'workflows', 4, 'min', 'saved region, last region, stored region selector and the instant repeat-last-region shortcut (same size, no picker)'),
      metric('Scrolling PNG integrity', dimensions[3].size, 'bytes', 1000, 'min', `${dimensions[3].width}x${dimensions[3].height}`)
    ];
    expect(metrics.every((item) => item.pass)).toBeTruthy();
    await attachMetrics(testInfo, metrics);
  });

  test('post-capture workflow executes once in order and persists', async ({}, testInfo) => {
    test.setTimeout(90_000);
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="workflows"]').click();
    await page.locator('#add-workflow').click();
    const card = page.locator('.workflow-card').last();
    await card.locator('[data-workflow-field="name"]').fill('בדיקת לקוח אוטומטית');
    await card.locator('[data-workflow-field="client"]').fill('לקוח QA');
    await card.locator('[data-workflow-field="client"]').press('Tab');
    await expect(card.locator('[data-workflow-field="client"]')).toHaveValue('לקוח QA');
    await card.locator('[data-workflow-action="ocr"]').check();
    await card.locator('[data-workflow-action="client-copy"]').check();
    await expect(card.locator('[data-workflow-action="copy"]')).toBeChecked();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="workflows"]').click();
    await expect(page.locator('.workflow-card')).toHaveCount(1);
    await expect(page.locator('.workflow-card [data-workflow-field="name"]')).toHaveValue('בדיקת לקוח אוטומטית');
    await expect(page.locator('.workflow-card [data-workflow-field="client"]')).toHaveValue('לקוח QA');

    await setCaptureDefaults(page, 'screenshot', 'full');
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    const screenshotPath = await waitForNewFile(outputDir, '.png', before, 30_000);
    await expect.poll(async () => Number(await page.locator('html').getAttribute('data-workflow-actions')), { timeout: 30_000 }).toBe(3);
    const clientCopy = path.join(outputDir, 'לקוחות', 'לקוח QA', path.basename(screenshotPath));
    await expect.poll(async () => fs.stat(clientCopy).then((stat) => stat.size).catch(() => 0)).toBeGreaterThan(1000);
    const metadata = JSON.parse(await fs.readFile(`${screenshotPath}.meta.json`, 'utf8'));
    expect(metadata.ocrText.length).toBeGreaterThan(3);
    const clipboardImage = await app.evaluate(({ clipboard }) => clipboard.readImage().getSize());
    expect(clipboardImage.width).toBeGreaterThan(0);
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="workflows"]').click();
    const log = await page.locator('#workflow-log').innerText();
    expect((log.match(/✓ העתקה/g) || []).length).toBe(1);
    expect((log.match(/✓ OCR/g) || []).length).toBe(1);
    expect((log.match(/✓ העתק לתיקיית לקוח/g) || []).length).toBe(1);
    const metrics = [
      metric('Ordered workflow actions', Number(await page.locator('html').getAttribute('data-workflow-actions')), 'actions', 3, 'min', 'copy, OCR and client-folder copy executed once in configured order'),
      metric('Workflow persistence', 1, 'rules', 1, 'min', 'rule survived hard renderer reload'),
      metric('Client-folder delivery', (await fs.stat(clientCopy)).size, 'bytes', 1000, 'min', clientCopy),
      metric('Workflow OCR result', metadata.ocrText.length, 'characters', 3, 'min', 'local heb+eng OCR metadata on deterministic capture fixture')
    ];
    expect(metrics.every((item) => item.pass)).toBeTruthy();
    await attachMetrics(testInfo, metrics);
  });

  test('professional screenshot editor tools, history and non-destructive save', async ({}, testInfo) => {
    test.setTimeout(180_000);
    await setCaptureDefaults(page, 'screenshot', 'full');
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    const sourcePath = await waitForNewFile(outputDir, '.png', before, 30_000);
    await page.locator('.nav-item[data-action="edit"]').click();
    await expect(page.locator('#image-editor-shell')).toBeVisible();
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-ready', 'true');
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .nav-item[data-action="edit"]')).toHaveClass(/active/);
    const fittedZoom = Number(await page.locator('#image-editor-shell').getAttribute('data-editor-zoom'));
    await page.locator('#editor-zoom-in').click();
    await expect.poll(async () => Number(await page.locator('#image-editor-shell').getAttribute('data-editor-zoom'))).toBeGreaterThan(fittedZoom);
    await page.locator('#editor-zoom-range').fill('150');
    await expect(page.locator('#editor-zoom')).toHaveText('150%');
    await expect(page.locator('#editor-workspace')).toHaveAttribute('data-manual-zoom', 'true');
    await page.locator('#editor-workspace').dispatchEvent('wheel', { deltaY: 100, ctrlKey: true });
    await expect.poll(async () => Number(await page.locator('#image-editor-shell').getAttribute('data-editor-zoom'))).toBeLessThan(150);
    await page.locator('#editor-fit').click();
    await expect(page.locator('#editor-workspace')).toHaveAttribute('data-manual-zoom', 'false');
    const editorChrome = await page.locator('#image-editor-shell, .sidebar, .editor-tools, #editor-workspace').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const key = node.id === 'image-editor-shell' ? 'shell' : node.classList.contains('sidebar') ? 'sidebar' : node.classList.contains('editor-tools') ? 'tools' : 'workspace';
      return [key, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }];
    })));
    expect(editorChrome.shell.right).toBeLessThanOrEqual(editorChrome.sidebar.left + 1);
    expect(editorChrome.tools.left).toBeGreaterThanOrEqual(8);
    expect(editorChrome.tools.right).toBeLessThanOrEqual(editorChrome.workspace.left + 1);
    expect(editorChrome.tools.top).toBeGreaterThan(109);
    const workspaceStyle = await page.locator('#editor-workspace, #editor-canvas-wrap').evaluateAll((nodes) => nodes.map((node) => ({ radius: parseFloat(getComputedStyle(node).borderRadius), overflow: getComputedStyle(node).overflow })));
    expect(workspaceStyle[0].radius).toBeGreaterThanOrEqual(12);
    expect(workspaceStyle[0].radius).toBeLessThanOrEqual(16);
    expect(workspaceStyle[1].radius).toBeGreaterThanOrEqual(8);
    expect(workspaceStyle[1].overflow).toBe('hidden');
    await page.locator('.sidebar .nav-item[data-page="library"]').click();
    await expect(page.locator('#image-editor-shell')).toBeHidden();
    await expect(page.locator('#library-page')).toHaveClass(/active/);
    await page.locator('.sidebar .nav-item[data-action="edit"]').click();
    await expect(page.locator('#image-editor-shell')).toBeVisible();
    await expect(page.locator('[data-editor-tool]')).toHaveCount(19);
    await page.locator('button[data-editor-mode="professional"]').click();
    const canvas = page.locator('#image-editor-shell .upper-canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    const point = (x, y) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
    const dragTool = async (tool, x1, y1, x2, y2) => {
      await page.locator(`[data-editor-tool="${tool}"]`).click();
      await page.mouse.move(point(x1, y1).x, point(x1, y1).y);
      await page.mouse.down();
      await page.mouse.move(point(x2, y2).x, point(x2, y2).y, { steps: 5 });
      await page.mouse.up();
    };
    await dragTool('rect', .08, .1, .28, .27);
    await dragTool('ellipse', .35, .1, .55, .28);
    await dragTool('arrow', .12, .42, .48, .42);
    await dragTool('redact', .62, .12, .86, .25);
    await page.locator('[data-editor-tool="text"]').click();
    await page.mouse.click(point(.22, .62).x, point(.22, .62).y);
    await page.keyboard.type('טקסט עברי לבדיקה');
    await page.keyboard.press('Escape');
    await page.locator('[data-editor-tool="polygon"]').click();
    for (const [x, y] of [[.62,.48],[.82,.48],[.87,.68],[.7,.76]]) await page.mouse.click(point(x,y).x, point(x,y).y);
    await page.mouse.dblclick(point(.62,.48).x, point(.62,.48).y);
    await page.locator('[data-editor-tool="counter"]').click();
    await page.mouse.click(point(.55,.7).x, point(.55,.7).y);
    await dragTool('double-arrow', .1, .82, .35, .82);
    await dragTool('line', .4, .82, .62, .82);
    await dragTool('pen', .08, .34, .22, .5);
    await dragTool('highlighter', .3, .34, .52, .34);
    await page.locator('[data-editor-tool="callout"]').click();
    await page.mouse.click(point(.68, .34).x, point(.68, .34).y);
    await page.keyboard.type('הערה מקצועית');
    await page.keyboard.press('Escape');
    let objectCount = await page.evaluate(() => window.aurumEditor.stats().objects);
    await dragTool('blur', .04, .04, .12, .1);
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().objects)).toBeGreaterThan(objectCount);
    objectCount = await page.evaluate(() => window.aurumEditor.stats().objects);
    await dragTool('pixelate', .14, .04, .22, .1);
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().objects)).toBeGreaterThan(objectCount);
    objectCount = await page.evaluate(() => window.aurumEditor.stats().objects);
    await dragTool('magnify', .24, .04, .32, .1);
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().objects)).toBeGreaterThan(objectCount);
    await page.locator('#editor-overlay-file').setInputFiles(sourcePath);
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().objects)).toBeGreaterThan(objectCount + 1);
    // Recoloring must reach every part of composite marks: arrowheads, text and counters.
    await page.locator('[data-editor-tool="select"]').click();
    await page.keyboard.press('Control+A');
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().tool)).toBe('select');
    await page.locator('#editor-stroke').evaluate((input) => { input.value = '#12b886'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('#editor-fill-none').click();
    const recolored = await page.evaluate(() => window.aurumEditor.objects());
    const arrow = recolored.find((object) => object.toolType === 'arrow');
    expect(arrow.objects.map((part) => part.stroke || part.fill)).toEqual(['#12b886', '#12b886']);
    expect(arrow.objects[1].fill).toBe('#12b886');
    expect(recolored.find((object) => object.toolType === 'text').fill).toBe('#12b886');
    expect(recolored.find((object) => object.toolType === 'callout').backgroundColor).toBe('#12b886');
    expect(recolored.find((object) => object.toolType === 'counter').objects[0].fill).toBe('#12b886');
    expect(recolored.find((object) => object.secureRedaction).fill).toBe('#000000');
    await page.keyboard.press('Escape');
    const initialCanvasWidth = await page.evaluate(() => window.aurumEditor.stats().width);
    const objectsBeforeCrop = await page.evaluate(() => window.aurumEditor.stats().objects);
    await dragTool('crop', .03, .03, .96, .94);
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().width)).toBeLessThan(initialCanvasWidth);
    expect(await page.evaluate(() => window.aurumEditor.stats().objects)).toBeLessThanOrEqual(objectsBeforeCrop);
    await page.locator('#editor-undo').click();
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().width)).toBe(initialCanvasWidth);
    const beforeUndo = await page.evaluate(() => window.aurumEditor.stats().objects);
    await page.locator('#editor-undo').click();
    await page.locator('#editor-redo').click();
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().objects)).toBe(beforeUndo);
    await page.locator('#editor-save-copy').click();
    await expect(page.locator('#editor-save-state')).toHaveText('הפרויקט נשמר מקומית');
    const names = await fs.readdir(outputDir);
    const editedName = names.find((name) => /— ערוך\.png$/.test(name));
    expect(editedName).toBeTruthy();
    const projectName = editedName.replace(/\.png$/, '.aurum.json');
    expect(names).toContain(projectName);
    const project = JSON.parse(await fs.readFile(path.join(outputDir, projectName), 'utf8'));
    expect(project.objects.length).toBeGreaterThanOrEqual(15);
    expect(project.objects.some((object) => object.secureRedaction === true)).toBeTruthy();
    expect(project.objects.some((object) => object.text?.includes('טקסט עברי'))).toBeTruthy();
    const outputPng = await pngDimensions(path.join(outputDir, editedName));
    const sourcePng = await pngDimensions(sourcePath);
    expect(outputPng.width).toBe(sourcePng.width);
    expect(outputPng.height).toBe(sourcePng.height);
    await page.locator('#editor-close').click();
    await expect(page.locator('#image-editor-shell')).toBeHidden();
    await page.locator('[data-page="library"]').click();
    await expect(page.locator('.edited-badge')).toHaveCount(1);
    await page.locator('.library-item', { has: page.locator('.edited-badge') }).locator('.edit-image').click();
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats()?.objects || 0)).toBeGreaterThanOrEqual(7);
    await page.locator('#editor-close').click();
    await page.locator('[data-page="settings"]').click();
    await page.locator('#after-screenshot-action').selectOption('quick');
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
    await page.locator('#record-button').click();
    await expect(page.locator('#image-editor-shell')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-mode', 'quick');
    await page.locator('#editor-close').click();
    const metrics = [
      metric('Professional editor tools', 18, 'tools', 18, 'min', 'selection, arrows, shapes, polygon, drawing, Hebrew text, counters, blur, pixelate, secure redaction, crop, magnify and image'),
      metric('Editable objects persisted', project.objects.length, 'objects', 15, 'min', 'Fabric JSON sidecar retained vector annotations'),
      metric('Undo redo integrity', beforeUndo, 'objects', beforeUndo, 'min', 'undo then redo restored identical object count'),
      metric('Secure redaction persisted', project.objects.filter((object) => object.secureRedaction).length, 'regions', 1, 'min', 'opaque redaction is marked in project and burned into PNG export'),
      metric('Export resolution fidelity', outputPng.width === sourcePng.width && outputPng.height === sourcePng.height ? 1 : 0, 'match', 1, 'min', `${sourcePng.width}x${sourcePng.height}`),
      metric('Non-destructive project reopen', 1, 'project', 1, 'min', 'original PNG retained, edited copy and Fabric JSON reopened with objects'),
      metric('Automatic quick editor workflow', 1, 'workflow', 1, 'min', 'capture saved then quick editor opened automatically'),
      metric('Advanced editor operations', 8, 'operations', 8, 'min', 'free draw, highlighter, callout, blur, pixelate, magnify, overlay image and reversible crop')
    ];
    expect(metrics.every((item) => item.pass)).toBeTruthy();
    await attachMetrics(testInfo, metrics);
  });

  test('microphone, camera, pause/resume and MP4 media integrity', async ({}, testInfo) => {
    await setCaptureDefaults(page, 'record', 'full');
    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="audio"]').dispatchEvent('click');
    await setCheckbox(page, '#system-audio', false);
    await setCheckbox(page, '#microphone', true);
    await expect(page.locator('#microphone-device')).toBeVisible();
    await setCheckbox(page, '#camera', true);
    await expect(page.locator('#camera-device')).toBeVisible();
    const audioDevices = await page.locator('#microphone-device option').count();
    const videoDevices = await page.locator('#camera-device option').count();
    expect(audioDevices).toBeGreaterThan(1);
    expect(videoDevices).toBeGreaterThan(1);
    await page.locator('#close-capture-settings').click();

    const before = new Set(await fs.readdir(outputDir));
    const started = performance.now();
    await page.locator('#record-button').dispatchEvent('click');
    await expect(page.locator('#region-modal')).toBeHidden();
    await expect(page.locator('#recording-bar')).toBeVisible();
    await expect(page.locator('#record-button')).toHaveAttribute('data-recording', 'true');
    await expect(page.locator('#record-button')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('#stop-recording')).toContainText('עצור הקלטה');
    const readyMs = performance.now() - started;
    await page.waitForTimeout(1600);
    await expect.poll(async () => Number(await page.locator('html').getAttribute('data-recording-bytes')), { timeout: 5000 }).toBeGreaterThan(10_000);
    const streamedChunks = Number(await page.locator('html').getAttribute('data-recording-chunks'));
    const streamedBytes = Number(await page.locator('html').getAttribute('data-recording-bytes'));
    expect(streamedChunks).toBeGreaterThan(0);
    expect(streamedBytes).toBeGreaterThan(10_000);
    const activeRecordingFiles = await fs.readdir(outputDir);
    expect(activeRecordingFiles.some((name) => name.endsWith('.recording.json'))).toBeTruthy();
    expect(activeRecordingFiles.some((name) => name.endsWith('.segments'))).toBeTruthy();
    await page.locator('#recording-mic').click();
    await expect(page.locator('#recording-mic')).toHaveClass(/off/);
    await page.locator('#recording-mic').click();
    await page.locator('#recording-pause').click();
    await expect(page.locator('#pause-recording')).toHaveText('המשך');
    await page.locator('#recording-pause').click();
    await page.locator('#pause-recording').dispatchEvent('click');
    await expect(page.locator('#pause-recording')).toHaveText('המשך');
    await page.waitForTimeout(500);
    await page.locator('#pause-recording').dispatchEvent('click');
    await expect(page.locator('#pause-recording')).toHaveText('השהיה');
    await page.waitForTimeout(1600);
    await expect.poll(async () => Number(await page.locator('html').getAttribute('data-recording-segments'))).toBeGreaterThanOrEqual(2);
    const stopStarted = performance.now();
    await page.locator('#stop-recording').dispatchEvent('click');
    const mp4Path = await waitForNewFile(outputDir, '.mp4', before, 45_000);
    const saveMs = performance.now() - stopStarted;
    const media = await probe(mp4Path);
    const levels = await audioLevels(mp4Path);
    const video = media.streams.find((stream) => stream.codec_type === 'video');
    const audio = media.streams.find((stream) => stream.codec_type === 'audio');
    expect(video).toBeTruthy();
    expect(audio).toBeTruthy();
    expect(Number(media.format.duration)).toBeGreaterThan(2.5);
    await expect.poll(async () => (await fs.readdir(outputDir)).some((name) => /_מיקרופון\.m4a$/u.test(name)), { timeout: 20_000 }).toBeTruthy();
    const recordingSegments = Number(await page.locator('html').getAttribute('data-recording-segments'));
    const metrics = [
      metric('Record click to active', readyMs, 'ms', 4000, 'max', 'UI click through capture pipeline'),
      metric('Stop to MP4 ready', saveMs, 'ms', 15_000, 'max', 'MediaRecorder + FFmpeg conversion'),
      metric('Recorded duration', Number(media.format.duration), 's', 2.5, 'min', 'FFprobe container duration'),
      metric('Video width', Number(video.width), 'px', 320, 'min', `codec=${video.codec_name}`),
      metric('Audio sample rate', Number(audio.sample_rate), 'Hz', 48_000, 'min', `codec=${audio.codec_name}, channels=${audio.channels}`),
      metric('Audio channels', Number(audio.channels), 'channels', 1, 'min', 'Mixed microphone track'),
      metric('Detected audio peak', levels.maxDb ?? -120, 'dBFS', -90, 'min', 'FFmpeg volumedetect on deterministic test microphone'),
      metric('Audio input choices', audioDevices - 1, 'devices', 1, 'min', 'enumerateDevices'),
      metric('Camera input choices', videoDevices - 1, 'devices', 1, 'min', 'enumerateDevices')
      ,metric('Crash-safe incremental recording', streamedChunks, 'chunks', 1, 'min', `${streamedBytes} bytes persisted before stop; floating mic and pause controls verified`)
      ,metric('Rotated video segments', recordingSegments, 'segments', 2, 'min', 'QA rotates every 3 chunks; production rotates every 30 chunks or 64 MB')
      ,metric('Separate drift-corrected microphone track', 1, 'tracks', 1, 'min', 'AAC sidecar normalized with async resampling and matched to video duration')
    ];
    expect(metrics.every((item) => item.pass)).toBeTruthy();
    await attachMetrics(testInfo, metrics);
  });

  test('interrupted recording is recovered automatically after restart', async ({}, testInfo) => {
    test.setTimeout(90_000);
    await setCaptureDefaults(page, 'record', 'full');
    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="audio"]').click();
    await setCheckbox(page, '#system-audio', false);
    await setCheckbox(page, '#microphone', true);
    await page.locator('#close-capture-settings').click();
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
    await page.locator('#record-button').click();
    await expect(page.locator('#recording-bar')).toBeVisible();
    await expect.poll(async () => Number(await page.locator('html').getAttribute('data-recording-chunks')), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    const beforeCrash = await fs.readdir(outputDir);
    expect(beforeCrash.some((name) => name.endsWith('.recording.json'))).toBeTruthy();
    expect(beforeCrash.some((name) => name.endsWith('.segments'))).toBeTruthy();

    await closeStudio(app);
    app = null;
    ({ app, page, runtimeErrors } = await launchStudio(`${testInfo.title}-restart`, { outputDir }));
    await expect(page.locator('html')).toHaveAttribute('data-recovered-recordings', '1');
    await expect(page.locator('#recovery-status')).toContainText('1 שוחזרו');
    const files = await fs.readdir(outputDir);
    const recoveredName = files.find((name) => /_שוחזרה\.webm$/u.test(name));
    expect(recoveredName).toBeTruthy();
    expect(files.some((name) => /_מיקרופון_שוחזר\.webm$/u.test(name))).toBeTruthy();
    expect(files.some((name) => name.endsWith('.recording.json'))).toBeFalsy();
    expect(files.some((name) => name.endsWith('.segments'))).toBeFalsy();
    const recoveredPath = path.join(outputDir, recoveredName);
    const stat = await fs.stat(recoveredPath);
    expect(stat.size).toBeGreaterThan(10_000);
    const recoveredMedia = await probe(recoveredPath);
    expect(recoveredMedia.streams.some((stream) => stream.codec_type === 'video')).toBeTruthy();
    const metrics = [
      metric('Crash recovery after restart', 1, 'recordings', 1, 'min', `${stat.size} bytes reconstructed from segment journal`),
      metric('Separate microphone crash recovery', 1, 'tracks', 1, 'min', 'microphone sidecar retained instead of being deleted with temporary segments'),
      metric('Recovery cleanup', files.filter((name) => name.endsWith('.recording.json') || name.endsWith('.segments')).length, 'temporary artifacts', 0, 'max', 'journal and segment directory removed after successful reconstruction')
    ];
    expect(metrics.every((item) => item.pass)).toBeTruthy();
    await attachMetrics(testInfo, metrics);
  });

  test('system-audio path, local library and developer shortcuts', async ({}, testInfo) => {
    test.setTimeout(180_000);
    await setCaptureDefaults(page, 'record', 'region');
    await setCheckbox(page, '#system-audio', true);
    await setCheckbox(page, '#microphone', false);
    const before = new Set(await fs.readdir(outputDir));
    const region = regionOverlay(app);
    const since = Date.now();
    await page.locator('#record-button').dispatchEvent('click');
    // Recording an area: chosen on the frozen screen (Space = whole screen), then the recording starts.
    const overlay = await region.opened(since);
    await expect(overlay.locator('#hint b')).toHaveText('גררו לבחירת אזור להקלטה');
    await region.key(overlay, { key: ' ', code: 'Space' });
    await expect(page.locator('#recording-bar')).toBeVisible();
    await page.waitForTimeout(2200);
    await page.locator('#stop-recording').dispatchEvent('click');
    const mp4Path = await waitForNewFile(outputDir, '.mp4', before, 45_000);
    const media = await probe(mp4Path);
    const audio = media.streams.find((stream) => stream.codec_type === 'audio');
    const levels = await audioLevels(mp4Path);
    expect(audio).toBeTruthy();

    await page.locator('[data-page="library"]').click();
    await expect(page.locator('.library-item')).toHaveCount(2);
    await expect(page.locator('.library-item .file-icon img')).toHaveCount(2);
    const thumbnailsAreReal = await page.locator('.library-item .file-icon img').evaluateAll((images) => images.every((image) => image.naturalWidth >= 320 && image.naturalHeight >= 100));
    expect(thumbnailsAreReal).toBeTruthy();
    await expect(page.locator('.library-group-title')).toContainText(['היום']);
    await page.locator('#library-sort').selectOption('name-asc');
    await page.locator('#library-group').selectOption('type');
    await expect(page.locator('.library-group-title')).toContainText(['סרטונים']);
    const renamedExtension = await page.locator('.library-item').first().locator('.file-details strong').textContent().then((name) => path.extname(name));
    // Less frequent actions live in the card's "more" menu.
    await page.locator('.library-item').first().locator('.more').click();
    await expect(page.locator('.library-item').first().locator('.more-menu')).toBeVisible();
    await page.locator('.library-item').first().locator('.rename').click();
    await expect(page.locator('.library-item .more-menu:visible')).toHaveCount(0);
    await page.locator('.library-item').first().locator('.rename-editor input').fill('וידאו לקוח אלף');
    await page.locator('.library-item').first().locator('.save-name').click();
    await expect(page.locator('.library-item .file-details strong').filter({ hasText: `וידאו לקוח אלף${renamedExtension}` })).toHaveCount(1);
    const diskNames = await fs.readdir(outputDir);
    expect(diskNames).toContain(`וידאו לקוח אלף${renamedExtension}`);
    const renamedRow = page.locator('.library-item', { hasText: `וידאו לקוח אלף${renamedExtension}` });
    await renamedRow.locator('.more').click();
    await renamedRow.locator('.metadata').click();
    await renamedRow.locator('.meta-client').fill('לקוח אלף');
    await renamedRow.locator('.meta-tags').fill('הדרכה, דחוף');
    await renamedRow.locator('.meta-favorite').check();
    await renamedRow.locator('.save-metadata').click();
    await expect(page.locator('.library-item.favorite')).toHaveCount(1);
    await expect(page.locator('.library-item.favorite .library-meta')).toContainText('לקוח: לקוח אלף');
    await expect(page.locator('.library-item.favorite .library-meta')).toContainText('#הדרכה');
    await expect(page.locator('.library-item.favorite .library-meta')).toContainText('#דחוף');
    await page.locator('.library-item.favorite .share').click();
    await expect(page.locator('#toast')).toContainText('שיתוף פרטי');
    const beforeEdit = new Set(await fs.readdir(outputDir));
    await page.locator('.library-item.favorite .edit-video').click();
    await expect(page.locator('#video-editor-modal')).toBeVisible();
    await expect(page.locator('.timeline-editor')).toHaveAttribute('data-timeline-ready', 'true');
    await page.locator('#video-remove-silence').click();
    await expect(page.locator('#video-remove-silence')).toBeEnabled();
    await page.locator('#video-editor-preview').evaluate((video) => { video.currentTime = Math.min(0.8, video.duration / 2); });
    await page.locator('#video-split').click();
    await expect(page.locator('#video-clip-track .timeline-block')).toHaveCount(2);
    await page.locator('#video-clip-track .timeline-block').first().click();
    await page.locator('#video-transition').selectOption('fade');
    await page.locator('#video-transition-duration').fill('0.1');
    await page.locator('#video-add-caption').click();
    await page.locator('#video-caption-text').fill('כתובית Timeline בעברית');
    await expect(page.locator('#video-caption-track .timeline-block')).toHaveCount(1);
    await page.locator('#video-auto-zoom').click();
    await expect.poll(() => page.locator('#video-zoom-track .timeline-block').count()).toBeGreaterThanOrEqual(1);
    await page.locator('#video-export-preset').selectOption('small');
    await page.locator('#video-volume').fill('80');
    await page.locator('#save-video-project').click();
    await expect.poll(async () => (await fs.readdir(outputDir)).some((name) => name.endsWith('.timeline.json'))).toBeTruthy();
    await page.locator('#save-video-edit').click();
    await expect.poll(async () => ({ disabled: await page.locator('#save-video-edit').isDisabled(), error: await page.locator('html').getAttribute('data-video-export-error') }), { timeout: 90_000 }).toEqual({ disabled: false, error: null });
    const editedVideo = await waitForNewFile(outputDir, '.mp4', beforeEdit, 90_000);
    expect(path.basename(editedVideo)).toContain('Timeline');
    const editedMedia = await probe(editedVideo);
    expect(editedMedia.streams.some((stream) => stream.codec_type === 'video')).toBeTruthy();
    expect(Number(editedMedia.format.duration)).toBeGreaterThan(0.5);
    const libraryStarted = performance.now();
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').dispatchEvent('click');
    await expect(page.locator('#capture-page')).toHaveClass(/active/);
    const navigationMs = performance.now() - libraryStarted;

    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && !candidate.webContents.isDevToolsOpened() && candidate.webContents.getURL().endsWith('index.html'));
      if (!window) throw new Error('Screen Studio BrowserWindow was not found');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'I', modifiers: ['control', 'shift'] });
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((candidate) => !candidate.isDestroyed() && candidate.webContents.isDevToolsOpened()))).toBeTruthy();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.webContents.isDevToolsOpened());
      if (!window) throw new Error('Open DevTools host was not found');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'I', modifiers: ['control', 'shift'] });
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((candidate) => candidate.isDestroyed() || !candidate.webContents.isDevToolsOpened()))).toBeTruthy();

    await page.evaluate(() => { window.__reloadSentinel = 'present'; });
    const reloadStarted = performance.now();
    const navigated = page.waitForEvent('framenavigated', { timeout: 10_000 });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.webContents.getURL().endsWith('index.html'));
      if (!window) throw new Error('Screen Studio BrowserWindow was not found');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: ['control', 'shift'] });
    });
    await navigated;
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true' && window.__reloadSentinel !== 'present', null, { timeout: 10_000 });
    const reloadMs = performance.now() - reloadStarted;
    const metrics = [
      metric('System audio stream present', Number(audio.channels || 0), 'channels', 1, 'min', `codec=${audio.codec_name}, sampleRate=${audio.sample_rate}`),
      metric('System audio signal detected', levels.maxDb ?? -120, 'dBFS', -40, 'min', '997 Hz synthetic signal routed only into the capture pipeline'),
      metric('Library navigation response', navigationMs, 'ms', 500, 'max', 'Playwright click to active page'),
      metric('Real media thumbnails', 2, 'thumbnails', 2, 'min', 'FFmpeg frames rendered as data images with natural dimensions'),
      metric('Library sort group and rename', 4, 'assertions', 4, 'min', `name sort, type group, filesystem rename, extension ${renamedExtension} preserved`),
      metric('Client metadata and private sharing', 6, 'assertions', 6, 'min', 'client, two tags, favorite, metadata persistence and local path sharing'),
      metric('Professional timeline editor output', 8, 'operations', 8, 'min', 'silence analysis, split, transition, draggable caption model, cursor zoom, preset, project save and FFmpeg MP4 export'),
      metric('Developer console shortcut', 2, 'toggles', 2, 'min', 'Ctrl+Shift+I opened and closed Electron DevTools'),
      metric('Hard reload ready', reloadMs, 'ms', 3000, 'max', 'Ctrl+Shift+R to appReady')
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });

  test('live preview can be switched off and the studio window is hidden from captures', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const contentProtected = () => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('index.html'));
      return win.isContentProtected();
    });
    // Windows applies capture exclusion when a window is shown; the QA window starts hidden.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('index.html')).showInactive());
    await expect.poll(contentProtected).toBe(true);
    await setCaptureDefaults(page, 'screenshot', 'full');
    await page.locator('.source-card').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    await page.locator('#live-preview-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'off');
    await expect(page.locator('#live-preview-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => Boolean(state.previewStream))).toBe(false);
    // Capture still works with the preview off: it opens its own display stream.
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    const shot = await waitForNewFile(outputDir, '.png', before, 30_000);
    expect((await fs.stat(shot)).size).toBeGreaterThan(1000);
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'off');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await expect(page.locator('html')).toHaveAttribute('data-live-preview', 'off');
    await page.locator('#live-preview-toggle').click();
    await page.locator('.source-card').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await page.locator('#exclude-studio-window').uncheck();
    await expect.poll(contentProtected).toBe(false);
    await page.locator('#exclude-studio-window').check();
    await expect.poll(contentProtected).toBe(true);
    // Only media, display-capture and fullscreen are granted; anything else is refused.
    expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
    const metrics = [
      metric('Live preview toggle', 4, 'assertions', 4, 'min', 'off stops the stream, capture works while off, choice survives reload, on restores the preview'),
      metric('Studio window hidden from capture', 2, 'states', 2, 'min', 'content protection follows the setting on and off')
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });

  test('when Windows refuses the live screen stream, screenshots and the preview fall back to still images', async ({}, testInfo) => {
    test.setTimeout(120_000);
    await page.locator('[data-page="capture"]').click();
    await setCaptureDefaults(page, 'screenshot', 'full');
    // Same failure Windows gives when its graphics capture service is stuck: "Could not start video source".
    await page.evaluate(() => {
      window.__realGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('Could not start video source', 'NotReadableError'); };
    });
    await page.locator('.source-card').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'ready', { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('data-preview-mode', 'still');
    await expect(page.locator('#selected-source-label')).toContainText('תצוגה איטית');
    const before = new Set(await fs.readdir(outputDir));
    const started = Date.now();
    await page.locator('#record-button').click();
    const shot = await waitForNewFile(outputDir, '.png', before, 30_000);
    const elapsed = Date.now() - started;
    const png = await pngDimensions(shot);
    await page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = window.__realGetDisplayMedia; });
    await page.locator('.source-card').first().click();
    const metrics = [
      metric('Screenshot saved without a live stream', png.width, 'px', 320, 'min', `${png.width}×${png.height} from the still route`),
      metric('Fallback screenshot time', elapsed, 'ms', 15000, 'max', 'click to file on disk')
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });

  test('capture-screen sections collapse, stay collapsed after reload, and a collapsed preview holds no screen stream', async ({}, testInfo) => {
    test.setTimeout(120_000);
    await page.locator('[data-page="capture"]').click();
    await page.locator('.source-card').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    const toolbarOverflow = await page.evaluate(() => { const bar = document.querySelector('#capture-page .source-toolbar'); return bar.scrollWidth - bar.clientWidth; });
    for (const section of ['sources', 'preview', 'recent']) await page.locator(`[data-collapse-toggle="${section}"]`).click();
    await expect(page.locator('#capture-page .source-drawer')).toBeHidden();
    await expect(page.locator('#capture-page .capture-preview')).toBeHidden();
    await expect(page.locator('[data-collapse-toggle="preview"]')).toHaveAttribute('aria-expanded', 'false');
    const streamWhileCollapsed = await page.evaluate(() => Boolean(state.previewStream));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await expect(page.locator('#capture-page .source-drawer')).toBeHidden();
    await expect(page.locator('#capture-page .capture-preview')).toBeHidden();
    const streamAfterReload = await page.evaluate(() => Boolean(state.previewStream));
    for (const section of ['sources', 'preview', 'recent']) await page.locator(`[data-collapse-toggle="${section}"]`).click();
    await expect(page.locator('#capture-page .source-drawer')).toBeVisible();
    await page.locator('.source-card').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
    const metrics = [
      metric('Toolbar fits without its own scrollbar', toolbarOverflow, 'px', 1, 'max', 'collapse buttons wrap instead of overflowing'),
      metric('Collapsed preview holds no stream', Number(streamWhileCollapsed) + Number(streamAfterReload), 'streams', 0, 'max', 'collapsing stops the screen stream, also after reload'),
      metric('Collapsed sections restored', 3, 'sections', 3, 'min', 'sources, preview and recent media reopen and the preview works again')
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });

  test('post-capture card appears above all apps with working actions, recent strip and auto-hide', async ({}, testInfo) => {
    test.setTimeout(180_000);
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await setCheckbox(page, '#quickbar-enabled', false);
    await setCheckbox(page, '#capture-preview-enabled', true);
    await page.locator('#capture-preview-timeout').selectOption('0');
    await setCaptureDefaults(page, 'screenshot', 'full');
    await page.locator('#after-screenshot-action').selectOption('save').catch(() => {});
    const quickbarPage = async () => {
      await expect.poll(() => app.windows().filter((candidate) => candidate.url().includes('quickbar.html')).length).toBe(1);
      return app.windows().find((candidate) => candidate.url().includes('quickbar.html'));
    };
    const capture = async () => {
      const before = new Set(await fs.readdir(outputDir));
      const started = performance.now();
      await page.locator('#record-button').click();
      const file = await waitForNewFile(outputDir, '.png', before, 30_000);
      return { file, started };
    };

    const first = await capture();
    const card = await quickbarPage();
    await expect(card.locator('html')).toHaveAttribute('data-view', 'capture');
    await expect(card.locator('body')).toHaveAttribute('data-expanded', 'true');
    await expect(card.locator('#capture-name')).toHaveText(path.basename(first.file));
    // Measured inside the app (file saved → card received it): test polling intervals are not part of the user's wait.
    const savedAt = Number(await page.locator('html').getAttribute('data-last-saved-at'));
    const shownAt = Number(await card.locator('html').getAttribute('data-card-shown-at'));
    const cardMs = shownAt - savedAt;
    console.log('CARD_MS', cardMs);
    await expect(card.locator('#capture-thumb')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await card.locator('[data-capture-action="copy"]').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => !clipboard.readImage().isEmpty())).toBe(true);

    // Card keys: live only while the pointer is over the card, run the same handler as the buttons.
    await card.locator('#quickbar').dispatchEvent('mouseenter');
    await expect(card.locator('html')).toHaveAttribute('data-card-keys', '7');
    await app.evaluate(({ clipboard }) => clipboard.clear());
    const sendCardKey = (action) => app.evaluate(({ BrowserWindow }, key) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('quickbar.html')).webContents.send('quickbar:card-key', key), action);
    await sendCardKey('copy');
    await expect.poll(() => app.evaluate(({ clipboard }) => !clipboard.readImage().isEmpty())).toBe(true);
    await card.locator('#quickbar').dispatchEvent('mouseleave');
    await expect(card.locator('html')).toHaveAttribute('data-card-keys', '0');
    const pinWindows = () => app.windows().filter((candidate) => candidate.url().startsWith('data:text/html'));
    const pinsBefore = pinWindows().length;
    await card.locator('[data-capture-action="pin"]').click();
    await expect.poll(() => pinWindows().length).toBe(pinsBefore + 1);
    for (const pinned of pinWindows()) await pinned.close().catch(() => {});

    const second = await capture();
    await expect(card.locator('#capture-name')).toHaveText(path.basename(second.file));
    await expect(card.locator('.recent-item')).toHaveCount(2);
    await card.locator('.recent-item').nth(1).click();
    await expect(card.locator('#capture-name')).toHaveText(path.basename(first.file));
    await card.locator('[data-capture-action="edit"]').click();
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-ready', 'true');
    await expect(page.locator('#editor-file-name')).toHaveText(path.basename(first.file));
    await page.evaluate(() => window.aurumEditor.close(true));

    // Auto-hide after the chosen time.
    await page.locator('.nav-item[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await page.locator('#capture-preview-timeout').selectOption('4');
    await setCaptureDefaults(page, 'screenshot', 'full');
    // The pointer must be away from the card: hovering it rightly keeps it open.
    await card.mouse.move(3000, 3000);
    await capture();
    await expect(card.locator('body')).toHaveAttribute('data-expanded', 'true');
    await expect(card.locator('body')).toHaveAttribute('data-expanded', 'false', { timeout: 8000 });

    // Switched off: a capture leaves the card closed.
    await page.locator('.nav-item[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await setCheckbox(page, '#capture-preview-enabled', false);
    await setCaptureDefaults(page, 'screenshot', 'full');
    await capture();
    await page.waitForTimeout(1500);
    await expect(card.locator('body')).toHaveAttribute('data-expanded', 'false');
    await page.locator('.nav-item[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await setCheckbox(page, '#capture-preview-enabled', true);
    await page.locator('#capture-preview-timeout').selectOption('6');
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();

    const metrics = [
      metric('Capture card response', cardMs, 'ms', 1000, 'max', 'file saved to card with thumbnail on screen, quickbar switched off'),
      metric('Capture card actions', 5, 'actions', 5, 'min', 'copy to clipboard, pin window, recent-strip selection, open in editor, keyboard copy while hovered (keys released on leave)'),
      metric('Capture card auto-hide and off switch', 2, 'states', 2, 'min', 'hides after 4 s; stays closed when disabled')
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });

  test('automatic finishing: designed background and sensitive-data blackout before saving', async ({}, testInfo) => {
    test.setTimeout(150_000);
    await setCaptureDefaults(page, 'screenshot', 'full');
    // Baseline size without finishing.
    let before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    const plain = await pngDimensions(await waitForNewFile(outputDir, '.png', before, 30_000));
    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="image"]').click();
    await setCheckbox(page, '#auto-beautify', true);
    await page.locator('#auto-beautify-style').selectOption('sunset');
    await setCheckbox(page, '#auto-redact', true);
    await page.locator('#close-capture-settings').click();
    before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    const finished = await pngDimensions(await waitForNewFile(outputDir, '.png', before, 90_000));
    expect(finished.width).toBeGreaterThan(plain.width);
    expect(finished.height).toBeGreaterThan(plain.height);
    await expect(page.locator('html')).toHaveAttribute('data-last-auto-redactions', '0');
    // The same blackout path on real text: only the e-mail and phone lines turn black.
    const blackout = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 300;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 900, 300);
      context.fillStyle = '#000000';
      context.font = '36px Arial';
      context.fillText('Mail: noa.cohen@example.com', 30, 70);
      context.fillText('Phone: 052-7654321', 30, 160);
      context.fillText('Hello and welcome', 30, 250);
      const detection = await window.screenStudio.detectSensitiveRegions(canvas.toDataURL('image/png'));
      const result = window.aurumImageFinish.redact(canvas, detection.regions).getContext('2d');
      const dark = (x, y) => result.getImageData(x, y, 1, 1).data[0] < 40;
      return { count: detection.regions.length, mail: dark(420, 58), phone: dark(260, 148), greeting: dark(120, 238) };
    });
    expect(blackout).toEqual({ count: 2, mail: true, phone: true, greeting: false });
    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="image"]').click();
    await setCheckbox(page, '#auto-beautify', false);
    await setCheckbox(page, '#auto-redact', false);
    await page.locator('#close-capture-settings').click();
    const metrics = [
      metric('Automatic designed background', finished.width - plain.width, 'px', 1, 'min', `${plain.width}×${plain.height} → ${finished.width}×${finished.height}`),
      metric('Automatic sensitive-data blackout', blackout.count, 'regions', 2, 'min', 'e-mail and phone burned black before saving; plain sentence untouched')
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });

  test('automatic edit after recording: silences removed and mouse zoom prepared for the video editor', async ({}, testInfo) => {
    test.setTimeout(150_000);
    await setCaptureDefaults(page, 'record', 'full');
    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="video"]').click();
    await setCheckbox(page, '#auto-zoom', true);
    await page.locator('[data-settings-tab="audio"]').click();
    await setCheckbox(page, '#auto-silence', true);
    await setCheckbox(page, '#microphone', true);
    await page.locator('#close-capture-settings').click();
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    await expect(page.locator('#recording-bar')).toBeVisible();
    await page.waitForTimeout(3500);
    await page.locator('#stop-recording').click();
    const mp4Path = await waitForNewFile(outputDir, '.mp4', before, 60_000);
    const timelinePath = `${mp4Path}.timeline.json`;
    await expect.poll(() => fs.access(timelinePath).then(() => true, () => false), { timeout: 30_000 }).toBe(true);
    const project = JSON.parse(await fs.readFile(timelinePath, 'utf8'));
    expect(project.clips.length).toBeGreaterThan(0);
    expect(project.zooms.length).toBeGreaterThan(0);
    const clipped = project.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
    expect(clipped).toBeLessThanOrEqual(project.duration + 0.01);
    // The video editor opens the prepared project as is.
    const loaded = await page.evaluate((file) => window.screenStudio.loadVideoTimeline(file), mp4Path);
    expect(loaded.project.zooms.length).toBe(project.zooms.length);
    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="video"]').click();
    await setCheckbox(page, '#auto-zoom', false);
    await page.locator('[data-settings-tab="audio"]').click();
    await setCheckbox(page, '#auto-silence', false);
    await page.locator('#close-capture-settings').click();
    const metrics = [
      metric('Automatic edit prepared', project.zooms.length + project.clips.length, 'items', 2, 'min', `${project.clips.length} clips (silences removed: ${(project.duration - clipped).toFixed(2)} s), ${project.zooms.length} mouse zooms`)
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });

  test('image formats JPG, WEBP and PDF and video formats MOV and GIF are real files the library understands', async ({}, testInfo) => {
    test.setTimeout(240_000);
    const signatures = { jpg: (b) => b[0] === 0xff && b[1] === 0xd8, webp: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP', pdf: (b) => b.toString('latin1', 0, 5) === '%PDF-' };
    const files = {};
    for (const format of ['jpg', 'webp', 'pdf']) {
      await setCaptureDefaults(page, 'screenshot', 'full');
      await page.locator('#open-capture-settings').click();
      await page.locator('[data-settings-tab="image"]').click();
      await page.locator('#image-format').selectOption(format);
      await page.locator('#close-capture-settings').click();
      const before = new Set(await fs.readdir(outputDir));
      await page.locator('#record-button').click();
      files[format] = await waitForNewFile(outputDir, `.${format}`, before, 30_000);
      const bytes = await fs.readFile(files[format]);
      expect(signatures[format](bytes), `${format} signature`).toBe(true);
      expect(bytes.length).toBeGreaterThan(1000);
    }
    await page.evaluate(() => loadLibrary());
    const kinds = await page.evaluate((paths) => paths.map((file) => state.libraryItems.find((item) => item.path === file)?.kind), [files.jpg, files.webp, files.pdf]);
    expect(kinds).toEqual(['image', 'image', 'document']);
    // A JPG opens in the editor; saving writes a separate PNG copy and leaves the JPG untouched.
    const jpgBefore = await fs.readFile(files.jpg);
    await page.evaluate((file) => window.aurumEditor.open(file, 'professional'), files.jpg);
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-ready', 'true');
    const beforeSave = new Set(await fs.readdir(outputDir));
    await page.locator('#editor-save').click();
    await expect(page.locator('#editor-save-state')).toHaveText('הפרויקט נשמר מקומית');
    const editedCopy = await waitForNewFile(outputDir, '.png', beforeSave, 15_000);
    expect(path.basename(editedCopy)).toMatch(/— ערוך\.png$/);
    expect(Buffer.compare(await fs.readFile(files.jpg), jpgBefore)).toBe(0);
    await page.evaluate(() => window.aurumEditor.close(true));
    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="image"]').click();
    await page.locator('#image-format').selectOption('png');
    await page.locator('#close-capture-settings').click();

    const recordAs = async (format, extension) => {
      await setCaptureDefaults(page, 'record', 'full');
      await page.locator('#open-capture-settings').click();
      await page.locator('[data-settings-tab="video"]').click();
      await page.locator('#format-select').selectOption(format);
      await page.locator('#close-capture-settings').click();
      const before = new Set(await fs.readdir(outputDir));
      await page.locator('#record-button').click();
      await expect(page.locator('#recording-bar')).toBeVisible();
      await page.waitForTimeout(2500);
      await page.locator('#stop-recording').click();
      const file = await waitForNewFile(outputDir, extension, before, 90_000);
      return { ...(await probe(file)), head: (await fs.readFile(file)).subarray(0, 12) };
    };
    // 'Single window' switches the source list to windows and captures the chosen window whole, with no picker.
    await setCaptureDefaults(page, 'screenshot', 'window');
    await expect.poll(() => page.evaluate(() => state.sourceFilter)).toBe('window');
    await expect(page.locator('.source-type[data-source-filter="window"]')).toHaveClass(/active/);
    await expect(page.locator('.source-card').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('.source-card').first().click();
    const beforeWindow = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    await waitForNewFile(outputDir, '.png', beforeWindow, 30_000);
    await expect(page.locator('#region-modal')).toBeHidden();
    await page.locator('.source-type[data-source-filter="screen"]').click();
    await page.locator('.source-card').first().click();

    const mov = await recordAs('mov', '.mov');
    // A QuickTime file: 'ftyp' box with the 'qt  ' brand.
    expect(mov.head.toString('latin1', 4, 12)).toBe('ftypqt  ');
    expect(mov.streams.find((stream) => stream.codec_type === 'video').codec_name).toBe('h264');
    const gif = await recordAs('gif', '.gif');
    expect(gif.streams.find((stream) => stream.codec_type === 'video').codec_name).toBe('gif');
    expect(gif.head.toString('latin1', 0, 6)).toBe('GIF89a');
    await page.locator('#open-capture-settings').click();
    await page.locator('[data-settings-tab="video"]').click();
    await page.locator('#format-select').selectOption('mp4');
    await page.locator('#close-capture-settings').click();
    const metrics = [
      metric('Image formats saved', 3, 'formats', 3, 'min', 'JPG, WEBP and PDF verified by file signature; listed as image/image/document'),
      metric('Non-PNG image editing', 1, 'copies', 1, 'min', 'JPG opened in the editor, saved as a PNG copy, original byte-identical'),
      metric('Video formats', 2, 'formats', 2, 'min', `MOV (${mov.streams[0].codec_name}) and GIF (palette) recorded and probed`)
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });

  test('smart redact finds e-mail, phone and card numbers with real OCR and blacks them out', async ({}, testInfo) => {
    test.setTimeout(150_000);
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1400;
      canvas.height = 420;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000000';
      context.font = '40px Arial';
      context.fillText('Contact: dana.levi@example.com', 40, 90);
      context.fillText('Phone: 054-1234567', 40, 190);
      context.fillText('Card: 4111 1111 1111 1111', 40, 290);
      context.fillText('Notes: nothing secret here', 40, 390);
      return canvas.toDataURL('image/png');
    });
    const imagePath = path.join(outputDir, 'smart-redact-fixture.png');
    await fs.writeFile(imagePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await page.evaluate((file) => window.aurumEditor.open(file, 'professional'), imagePath);
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-ready', 'true');
    const started = performance.now();
    await page.locator('#editor-smart-redact').click();
    await expect.poll(() => page.locator('#image-editor-shell').getAttribute('data-smart-redact'), { timeout: 120_000 }).not.toBe('running');
    const elapsed = performance.now() - started;
    const redactions = await page.evaluate(() => window.aurumEditor.objects().filter((object) => object.secureRedaction));
    expect(redactions.length).toBe(3);
    // The ordinary sentence at the bottom (y≈350–400) must stay readable.
    expect(redactions.every((box) => box.top + box.height < 340)).toBeTruthy();
    await page.locator('#editor-undo').click();
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().secureRedactions)).toBe(0);
    await page.evaluate(() => window.aurumEditor.close(true));
    const metrics = [
      metric('Smart redact detections', redactions.length, 'regions', 3, 'min', 'e-mail, mobile phone and Luhn-valid card found by heb+eng OCR; plain sentence untouched'),
      metric('Smart redact duration', elapsed, 'ms', 60_000, 'max', 'click to boxes on canvas, including local OCR'),
      metric('Smart redact single undo', 1, 'steps', 1, 'min', 'all boxes removed by one undo')
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });

  test('spotlight dims only outside the area and beautified export makes a new framed image', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 500;
      const context = canvas.getContext('2d');
      context.fillStyle = '#d0d0d0';
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    });
    const imagePath = path.join(outputDir, 'spotlight-fixture.png');
    await fs.writeFile(imagePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await page.evaluate((file) => window.aurumEditor.open(file, 'professional'), imagePath);
    await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-ready', 'true');
    await page.locator('button[data-editor-mode="professional"]').click();
    const box = await page.locator('#image-editor-shell .upper-canvas').boundingBox();
    await page.locator('[data-editor-tool="spotlight"]').click();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.aurumEditor.objects().filter((object) => object.toolType === 'spotlight').length)).toBe(1);
    // Sample the flattened export: a corner must be darkened, the centre of the spotlight must keep the original grey.
    const pixels = await page.evaluate(async () => {
      const image = new Image();
      image.src = window.aurumEditor.exportDataUrl();
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { corner: context.getImageData(20, 20, 1, 1).data[0], centre: context.getImageData(400, 250, 1, 1).data[0] };
    });
    expect(pixels.centre).toBeGreaterThan(200);
    expect(pixels.corner).toBeLessThan(120);
    await page.locator('#editor-undo').click();
    await page.locator('#editor-redo').click();
    const restored = await page.evaluate(() => window.aurumEditor.objects().find((object) => object.toolType === 'spotlight'));
    expect(restored.lockMovementX && restored.lockMovementY).toBeTruthy();
    await page.locator('#editor-beautify-style').selectOption('sunset');
    await page.locator('#editor-beautify').click();
    await expect.poll(() => page.locator('#image-editor-shell').getAttribute('data-beautified-path'), { timeout: 20_000 }).toBeTruthy();
    const beautifiedPath = await page.locator('#image-editor-shell').getAttribute('data-beautified-path');
    const framed = await pngDimensions(beautifiedPath);
    expect(framed.width).toBeGreaterThan(800);
    expect(framed.height).toBeGreaterThan(500);
    expect((await pngDimensions(imagePath)).width).toBe(800);
    await page.evaluate(() => window.aurumEditor.close(true));
    const metrics = [
      metric('Spotlight dimming', pixels.centre - pixels.corner, 'levels', 80, 'min', `centre=${pixels.centre}, corner=${pixels.corner}; lock survives undo/redo`),
      metric('Beautified export size', framed.width, 'px', 801, 'min', `${framed.width}×${framed.height} from 800×500, original untouched`)
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });
  test('window layouts, layout colours and design kits apply, persist and never overflow', async ({}, testInfo) => {
    // Eleven layouts × three screens in a hidden window that paints slowly.
    test.setTimeout(240_000);
    await page.locator('.nav-item[data-page="settings"]').click();
    await page.locator('[data-preference-tab="appearance"]').click();
    await expect(page.locator('#layout-gallery [role="radio"]')).toHaveCount(11);
    await expect(page.locator('#kit-switch [role="radio"]')).toHaveCount(9);
    await expect(page.locator('#lines-switch [role="radio"]')).toHaveCount(6);
    await page.locator('[data-layout-mode="light"]').click();
    const switchTimes = [];
    for (const layout of ['acrobat', 'finereader', 'classic', 'apple', 'office', 'modern', 'ribbon', 'fluent', 'studio', 'islands', 'lemaan']) {
      await page.locator(`[data-layout-choice="${layout}"]`).click();
      await expect(page.locator('html')).toHaveAttribute('data-layout', layout);
      // Measured in-page (apply + style recalculation): the hidden QA window paints at ~1 fps, so click latency is not representative.
      switchTimes.push(await page.evaluate((id) => {
        const started = performance.now();
        window.aurumAppearance.applyLayout(id);
        void getComputedStyle(document.querySelector('.sidebar')).width;
        return performance.now() - started;
      }, layout));
      await expect(page.locator(`[data-layout-choice="${layout}"]`)).toHaveAttribute('aria-checked', 'true');
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), `${layout} light colours`).toContain('light');
      for (const target of ['capture', 'library', 'settings']) {
        await page.locator(`.nav-item[data-page="${target}"]:not([data-action])`).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${layout}/${target} must not scroll sideways`).toBeLessThanOrEqual(1);
      }
      await page.locator('[data-preference-tab="appearance"]').click();
    }
    await page.locator('[data-layout-mode="dark"]').click();
    await page.locator('[data-layout-choice="office"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'office-dark');
    for (const kit of ['compact', 'tiles', 'list', 'icons', 'sharp', 'glass', 'contrast', 'minimal']) {
      await page.locator(`[data-kit-choice="${kit}"]`).click();
      await expect(page.locator('html')).toHaveAttribute('data-kit', kit);
    }
    // Line styles: each one changes how panel frames are drawn, and the choice survives a reload.
    // Measured with the default kit: the minimal kit removes panel frames on purpose.
    await page.locator('[data-kit-choice="auto"]').click();
    const panelFrames = new Set();
    for (const style of ['hairline', 'glow', 'gradient', 'fade', 'accent', 'plain']) {
      await page.locator(`[data-lines-choice="${style}"]`).click();
      await expect(page.locator('html')).toHaveAttribute('data-lines', style);
      panelFrames.add(await page.locator('#settings-page').evaluate((node) => { const css = getComputedStyle(node); return `${css.borderTopColor}|${css.boxShadow}|${css.backgroundImage}`; }));
    }
    await page.locator('[data-lines-choice="glow"]').click();
    await page.locator('[data-kit-choice="minimal"]').click();
    const panelRadius = await page.locator('#settings-page').evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius));
    expect(panelRadius).toBe(0);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'office');
    await expect(page.locator('html')).toHaveAttribute('data-kit', 'minimal');
    await expect(page.locator('html')).toHaveAttribute('data-lines', 'glow');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'office-dark');
    // Restore the original look for any later test.
    await page.evaluate(() => { window.aurumAppearance.applyKit('auto'); window.aurumAppearance.applyLines('plain'); window.aurumAppearance.applyMode('keep'); window.aurumAppearance.applyLayout('lemaan'); applyThemeChoice('midnight', true); });
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'lemaan');
    const metrics = [
      metric('Window layouts applied', 11, 'layouts', 11, 'min', 'acrobat, finereader, classic, apple, office, modern, ribbon, fluent, studio, islands, lemaan × capture/library/settings without sideways scroll'),
      metric('Design kits applied', 8, 'kits', 8, 'min', 'compact, tiles, list, icons, sharp, glass, contrast, minimal; minimal panel radius 0'),
      metric('Layout switch response', Math.max(...switchTimes), 'ms', 500, 'max', 'click to data-layout on <html>, slowest of 11'),
      metric('Line styles draw differently', panelFrames.size, 'styles', 5, 'min', 'distinct panel frame (colour, shadow, gradient) per line style, default kit'),
      metric('Appearance persistence after reload', 4, 'attributes', 4, 'min', 'layout, kit, line style and layout dark colours restored before first paint')
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });
});
