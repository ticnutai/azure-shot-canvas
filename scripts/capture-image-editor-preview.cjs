const path = require('node:path');
const fs = require('node:fs/promises');
const { launchStudio, closeStudio } = require('../tests/helpers/electron-app.cjs');

(async () => {
  const output = path.resolve('artifacts/current/professional-image-editor.png');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const { app, page, outputDir } = await launchStudio('image-editor-visual-proof');
  try {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.locator('[data-page="settings"]').click();
    await page.locator('#default-capture-kind').selectOption('screenshot');
    await page.locator('#default-capture-scope').selectOption('full');
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
    await page.locator('#record-button').click();
    await page.waitForFunction(() => document.documentElement.dataset.lastSavedPath?.endsWith('.png'), null, { timeout: 30_000 });
    const sourcePath = path.join(outputDir, (await fs.readdir(outputDir)).find((name) => name.endsWith('.png')));
    await page.locator('[data-page="library"]').click();
    await page.locator('.edit-image').click();
    await page.locator('button[data-editor-mode="professional"]').click();
    const canvas = page.locator('#image-editor-shell .upper-canvas');
    const box = await canvas.boundingBox();
    const point = (x, y) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
    const drag = async (tool, from, to) => {
      await page.locator(`[data-editor-tool="${tool}"]`).click();
      await page.mouse.move(point(...from).x, point(...from).y); await page.mouse.down();
      await page.mouse.move(point(...to).x, point(...to).y, { steps: 5 }); await page.mouse.up();
    };
    await drag('rect', [.1,.12], [.36,.3]);
    await drag('arrow', [.12,.45], [.48,.45]);
    await page.locator('[data-editor-tool="text"]').click();
    await page.mouse.click(point(.18,.6).x, point(.18,.6).y);
    await page.keyboard.type('הערה חשובה'); await page.keyboard.press('Escape');
    await page.locator('[data-editor-tool="counter"]').click();
    await page.mouse.click(point(.62,.32).x, point(.62,.32).y);
    await page.screenshot({ path: output });
    process.stdout.write(`${output}\n`);
  } finally { await closeStudio(app); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
