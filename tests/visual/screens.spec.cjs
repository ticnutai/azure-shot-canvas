// Photographs every screen in several looks and requires a pixel-identical match with the baseline.
// Live content (screen thumbnails, video, toasts) is masked so only the app's own styling is compared.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

const LOOKS = [
  { name: 'original', layout: 'lemaan', theme: 'midnight', kit: 'auto' },
  { name: 'porcelain', layout: 'lemaan', theme: 'porcelain', kit: 'auto' },
  { name: 'office-light', layout: 'office', theme: 'office-light', kit: 'list' },
  { name: 'modern-dark', layout: 'modern', theme: 'modern-dark', kit: 'tiles' }
];

test.describe.serial('visual baseline', () => {
  let app;
  let page;
  let outputDir;
  test.beforeAll(async () => {
    ({ app, page, outputDir } = await launchStudio('visual'));
    const win = await app.browserWindow(page);
    await win.evaluate((w) => { w.setSize(1366, 860); w.showInactive(); });
    await page.locator('#live-preview-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-preview-state', 'off');
    const fixture = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 520;
      const context = canvas.getContext('2d');
      context.fillStyle = '#e8edf3';
      context.fillRect(0, 0, 900, 520);
      context.fillStyle = '#1d4ed8';
      context.fillRect(60, 60, 360, 200);
      context.fillStyle = '#111827';
      context.font = '36px Arial';
      context.fillText('Visual baseline fixture', 60, 360);
      return canvas.toDataURL('image/png');
    });
    const fixturePath = path.join(outputDir, 'visual-fixture.png');
    await fs.writeFile(fixturePath, Buffer.from(fixture.split(',')[1], 'base64'));
    // A fixed timestamp keeps the date shown on library cards identical between runs.
    const fixedTime = new Date('2026-01-15T10:30:00');
    await fs.utimes(fixturePath, fixedTime, fixedTime);
  });
  test.afterAll(async () => { await closeStudio(app); });

  const masks = () => [page.locator('.source-card img'), page.locator('#display-video'), page.locator('#toast'), page.locator('.clip-thumb'), page.locator('.library-item img'), page.locator('#output-path'), page.locator('#engine-grid article b'), page.locator('#engine-grid article span')];
  const settle = async () => {
    await page.evaluate(() => { document.querySelector('#toast')?.classList.add('hidden'); document.activeElement?.blur(); });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(350);
  };
  const shot = async (name) => { await settle(); await expect(page).toHaveScreenshot(`${name}.png`, { mask: masks() }); };

  for (const look of LOOKS) {
    test(`all screens — ${look.name}`, async () => {
      await page.evaluate((value) => {
        window.aurumAppearance.applyKit(value.kit);
        window.aurumAppearance.applyMode('keep');
        window.aurumAppearance.applyLayout(value.layout);
        applyThemeChoice(value.theme, true);
      }, look);
      const nav = (target) => page.locator(`.nav-item[data-page="${target}"]:not([data-action])`).click();
      await nav('capture');
      await shot(`${look.name}-capture`);
      await page.locator('#open-capture-settings').click();
      await shot(`${look.name}-capture-settings`);
      await page.locator('#close-capture-settings').click();
      await page.locator('#theme-button').click();
      await shot(`${look.name}-theme-menu`);
      await page.locator('#theme-button').click();
      await nav('library');
      await shot(`${look.name}-library`);
      await nav('tools');
      // The engine scan is asynchronous; wait for the four result cards before photographing.
      await expect(page.locator('#engine-grid article')).toHaveCount(4);
      await shot(`${look.name}-tools`);
      await nav('settings');
      for (const tab of ['general', 'shortcuts', 'appearance', 'workflows']) {
        await page.locator(`[data-preference-tab="${tab}"]`).click();
        await shot(`${look.name}-settings-${tab}`);
      }
      // Opening the appearance tab starts a theme draft; leave it without saving.
      await page.evaluate(() => cancelThemeEditor(false));
      await page.evaluate((file) => window.aurumEditor.open(file, 'professional'), path.join(outputDir, 'visual-fixture.png'));
      await expect(page.locator('#image-editor-shell')).toHaveAttribute('data-editor-ready', 'true');
      await page.locator('button[data-editor-mode="professional"]').click();
      await shot(`${look.name}-image-editor`);
      await page.evaluate(() => window.aurumEditor.close(true));
    });
  }
});
