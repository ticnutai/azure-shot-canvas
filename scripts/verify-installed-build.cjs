const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const executablePath = path.join(process.env.LOCALAPPDATA, 'Programs', 'hebrew-screen-studio', 'אולפן צילום מסך.exe');
  const screenshot = path.resolve('artifacts/current/installed-theme-menu.png');
  await fs.mkdir(path.dirname(screenshot), { recursive: true });
  const app = await electron.launch({ executablePath, env: { ...process.env, SCREEN_STUDIO_HEADLESS: '1' } });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    const themeButtonText = (await page.locator('#theme-button').innerText()).trim();
    if (!themeButtonText.includes('ערכות נושא')) throw new Error(`Theme label missing: ${themeButtonText}`);
    await page.locator('#theme-button').click();
    const themes = await page.locator('[data-theme-choice]').evaluateAll((items) => items.map((item) => item.dataset.themeChoice));
    if (themes.length < 6 || !themes.includes('ivory')) throw new Error(`Ivory theme missing: ${themes.join(',')}`);
    await page.screenshot({ path: screenshot });
    await page.locator('[data-theme-choice="ivory"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'ivory');
    const fontWeight = Number(await page.locator('.wordmark h1').evaluate((node) => getComputedStyle(node).fontWeight));
    if (fontWeight > 400) throw new Error(`Ivory font is not thin: ${fontWeight}`);

    await page.locator('[data-page="library"]').click();
    const libraryViews = await page.locator('button[data-library-view]').evaluateAll((items) => items.map((item) => item.dataset.libraryView));
    if (libraryViews.join(',') !== 'grid,list,table') throw new Error(`Library views missing: ${libraryViews.join(',')}`);
    await page.locator('button[data-library-view="table"]').click();
    await page.locator('#library-size').fill('3');
    if (await page.locator('html').getAttribute('data-library-view') !== 'table') throw new Error('Table view did not activate');
    if (await page.locator('html').getAttribute('data-library-size') !== 'large') throw new Error('Large library size did not activate');
    await page.locator('[data-page="settings"]').click();
    await page.locator('#default-capture-kind').selectOption('screenshot');
    await page.locator('#default-capture-scope').selectOption('region');
    if (await page.locator('html').getAttribute('data-default-capture-kind') !== 'screenshot') throw new Error('Screenshot default did not activate');
    if (await page.locator('html').getAttribute('data-default-capture-scope') !== 'region') throw new Error('Region default did not activate');
    if (await page.locator('[data-editor-tool]').count() !== 18) throw new Error('Professional image editor tools are missing');
    if (await page.locator('.nav-item[data-action="edit"]:not([disabled])').count() !== 1) throw new Error('Main editor navigation button is not active');
    if (await page.locator('#edit-latest-image').count() !== 1) throw new Error('Library editor shortcut is missing');
    if (!await page.evaluate(() => Boolean(window.AurumImageEditorEngine && window.aurumEditor))) throw new Error('Image editor engine did not load');

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'I', modifiers: ['control', 'shift'] });
    });
    await page.waitForTimeout(500);
    const devtoolsOpened = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((item) => !item.isDestroyed() && item.webContents.isDevToolsOpened()));
    if (!devtoolsOpened) throw new Error('Ctrl+Shift+I did not open DevTools');
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && item.webContents.isDevToolsOpened());
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'I', modifiers: ['control', 'shift'] });
    });

    await page.evaluate(() => { window.__installedReloadSentinel = true; });
    const navigated = page.waitForEvent('framenavigated', { timeout: 10_000 });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: ['control', 'shift'] });
    });
    await navigated;
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true' && !window.__installedReloadSentinel);
    await page.locator('[data-page="library"]').click();
    await page.locator('button[data-library-view="grid"]').click();
    await page.locator('#library-size').fill('2');
    await page.locator('[data-page="settings"]').click();
    await page.locator('#default-capture-kind').selectOption('record');
    await page.locator('#default-capture-scope').selectOption('full');
    process.stdout.write(JSON.stringify({ executablePath, themes, ivoryFontWeight: fontWeight, libraryViews, librarySize: 'large', captureKinds: ['record', 'screenshot'], captureScopes: ['full', 'region'], editorTools: 18, editorEngine: true, editorNavigation: true, devtoolsOpened, hardReload: true, screenshot }));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
