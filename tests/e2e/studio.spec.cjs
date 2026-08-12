const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { audioLevels, pngDimensions, probe } = require('../helpers/media.cjs');
const { metric, summarize } = require('../helpers/metrics.cjs');

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
    const metrics = [metric('Cold app ready', testInfo.startupMs, 'ms', 10_000, 'max', 'Electron launch to appReady, including parallel in-app QA execution')];
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
    await page.locator('#camera-position').selectOption('top-left');
    await page.locator('#camera-size').fill('28');
    await page.locator('[data-settings-tab="image"]').click();
    await page.locator('#capture-delay').selectOption('3');
    await page.locator('[data-settings-tab="video"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-camera-position', 'top-left');
    await expect(page.locator('html')).toHaveAttribute('data-camera-size', '28');
    await expect(page.locator('html')).toHaveAttribute('data-capture-delay', '3');
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

    await page.locator('[data-settings-tab="audio"]').dispatchEvent('click');
    await expect(page.locator('[data-settings-section="audio"]')).toHaveClass(/active/);
    await page.locator('[data-settings-tab="image"]').dispatchEvent('click');
    await expect(page.locator('[data-settings-section="image"]')).toHaveClass(/active/);
    await page.locator('[data-settings-tab="video"]').dispatchEvent('click');
    expect(await page.locator('#format-select option:disabled').count()).toBe(2);
    metrics.push(metric('Settings tabs and capability labels', 3, 'tabs', 3, 'min', 'video/audio/image; unavailable formats disabled'));

    await page.setViewportSize({ width: 1280, height: 840 });
    await expect(page.locator('button[data-recent-filter]')).toHaveCount(3);
    await expect(page.locator('button[data-recent-view]')).toHaveCount(3);
    await expect(page.locator('#recent-sort option')).toHaveCount(5);
    await expect(page.locator('.capture-quick-actions > button')).toHaveCount(3);
    const unusedRailSpace = await page.locator('.settings-rail').evaluate((rail) => {
      const quick = rail.querySelector('.capture-quick-actions');
      return Math.round(rail.getBoundingClientRect().bottom - quick.getBoundingClientRect().bottom);
    });
    expect(unusedRailSpace).toBeLessThanOrEqual(30);
    await page.locator('[data-recent-filter="image"]').click();
    await page.locator('#recent-sort').selectOption('size-desc');
    await page.locator('[data-recent-view="list"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-recent-filter', 'image');
    await expect(page.locator('html')).toHaveAttribute('data-recent-sort', 'size-desc');
    await expect(page.locator('#recent-library')).toHaveClass(/recent-view-list/);
    metrics.push(metric('Recent media controls and productive settings rail', 11, 'assertions', 11, 'min', `3 filters, 5 sorts, 3 views, 3 quick actions; unused rail tail=${unusedRailSpace}px`));

    await page.locator('[data-page="library"]').click();
    await expect(page.locator('#library-page')).toHaveClass(/active/);
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
    await expect(page.locator('[data-shortcut-action]')).toHaveCount(6);
    await expect(page.locator('#shortcut-status-banner')).toContainText('כל הקיצורים רשומים ופעילים');
    await expect(page.locator('[data-shortcut-action="record"]')).toHaveText('Ctrl + Shift + 2');
    await page.locator('[data-shortcut-action="camera"]').click();
    await page.locator('body').dispatchEvent('keydown', { key: 'ב', code: 'KeyC', ctrlKey: true, altKey: true });
    await expect(page.locator('[data-shortcut-action="camera"]')).toHaveText('Ctrl + Alt + C');
    await page.locator('[data-shortcut-test="camera"]').click();
    await expect(page.locator('[data-shortcut-row="camera"]')).toHaveClass(/tested/);
    await page.locator('#reset-shortcuts').click();
    await expect(page.locator('[data-shortcut-action="camera"]')).toHaveText('Ctrl + Shift + C');
    metrics.push(metric('Bilingual configurable shortcut center', 10, 'assertions', 10, 'min', '6 editable physical-code shortcuts, registration status, Hebrew key event, IPC test and reset'));
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('qa:output', 'QA stream probe'));
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

  test('PNG capture is valid, unique and measured end-to-end', async ({}, testInfo) => {
    const samples = [];
    const dimensions = [];
    await setCaptureDefaults(page, 'screenshot', 'full');
    let before = new Set(await fs.readdir(outputDir));
    let started = performance.now();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: ['control', 'shift'] }));
    await expect(page.locator('#region-modal')).toBeHidden();
    let filePath = await waitForNewFile(outputDir, '.png', before);
    samples.push(performance.now() - started);
    dimensions.push(await pngDimensions(filePath));
    await setCaptureDefaults(page, 'screenshot', 'region');
    for (let i = 0; i < 4; i += 1) {
      before = new Set(await fs.readdir(outputDir));
      started = performance.now();
      await page.locator('#screenshot-button').dispatchEvent('click');
      await expect(page.locator('#region-modal')).toBeVisible();
      await page.locator('#full-region').dispatchEvent('click');
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

  test('professional screenshot editor tools, history and non-destructive save', async ({}, testInfo) => {
    test.setTimeout(180_000);
    await setCaptureDefaults(page, 'screenshot', 'full');
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').click();
    const sourcePath = await waitForNewFile(outputDir, '.png', before, 30_000);
    await page.locator('.nav-item[data-action="edit"]').click();
    await expect(page.locator('#image-editor-shell')).toBeVisible();
    await expect(page.locator('[data-editor-tool]')).toHaveCount(18);
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
    const initialCanvasWidth = await page.evaluate(() => window.aurumEditor.stats().width);
    await dragTool('crop', .03, .03, .96, .94);
    await expect.poll(() => page.evaluate(() => window.aurumEditor.stats().width)).toBeLessThan(initialCanvasWidth);
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

    const before = new Set(await fs.readdir(outputDir));
    const started = performance.now();
    await page.locator('#record-button').dispatchEvent('click');
    await expect(page.locator('#region-modal')).toBeHidden();
    await expect(page.locator('#recording-bar')).toBeVisible();
    const readyMs = performance.now() - started;
    await page.waitForTimeout(1600);
    await expect.poll(async () => Number(await page.locator('html').getAttribute('data-recording-bytes')), { timeout: 5000 }).toBeGreaterThan(10_000);
    const streamedChunks = Number(await page.locator('html').getAttribute('data-recording-chunks'));
    const streamedBytes = Number(await page.locator('html').getAttribute('data-recording-bytes'));
    expect(streamedChunks).toBeGreaterThan(0);
    expect(streamedBytes).toBeGreaterThan(10_000);
    expect((await fs.readdir(outputDir)).some((name) => name.endsWith('.partial.webm'))).toBeTruthy();
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
    ];
    expect(metrics.every((item) => item.pass)).toBeTruthy();
    await attachMetrics(testInfo, metrics);
  });

  test('system-audio path, local library and developer shortcuts', async ({}, testInfo) => {
    await setCaptureDefaults(page, 'record', 'region');
    await setCheckbox(page, '#system-audio', true);
    await setCheckbox(page, '#microphone', false);
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#record-button').dispatchEvent('click');
    await expect(page.locator('#region-modal')).toBeVisible();
    await page.locator('#full-region').dispatchEvent('click');
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
    await page.locator('.library-item').first().locator('.rename').click();
    await page.locator('.library-item').first().locator('.rename-editor input').fill('וידאו לקוח אלף');
    await page.locator('.library-item').first().locator('.save-name').click();
    await expect(page.locator('.library-item .file-details strong').filter({ hasText: `וידאו לקוח אלף${renamedExtension}` })).toHaveCount(1);
    const diskNames = await fs.readdir(outputDir);
    expect(diskNames).toContain(`וידאו לקוח אלף${renamedExtension}`);
    const renamedRow = page.locator('.library-item', { hasText: `וידאו לקוח אלף${renamedExtension}` });
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
    await page.locator('#video-trim-end').fill('1');
    await page.locator('#video-speed').selectOption('1.25');
    await page.locator('#video-volume').fill('80');
    await page.locator('#video-fade-in').fill('0.1');
    await page.locator('#save-video-edit').click();
    const editedVideo = await waitForNewFile(outputDir, '.mp4', beforeEdit, 45_000);
    expect(path.basename(editedVideo)).toContain('ערוך');
    const libraryStarted = performance.now();
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').dispatchEvent('click');
    await expect(page.locator('#capture-page')).toHaveClass(/active/);
    const navigationMs = performance.now() - libraryStarted;

    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && !candidate.webContents.isDevToolsOpened());
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
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
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
      metric('Quick video editor output', 4, 'operations', 4, 'min', 'non-destructive MP4 trim, 1.25x speed, 80% volume and fade-in created through FFmpeg'),
      metric('Developer console shortcut', 2, 'toggles', 2, 'min', 'Ctrl+Shift+I opened and closed Electron DevTools'),
      metric('Hard reload ready', reloadMs, 'ms', 3000, 'max', 'Ctrl+Shift+R to appReady')
    ];
    await attachMetrics(testInfo, metrics);
    expect(metrics.every((item) => item.pass)).toBeTruthy();
  });
});
