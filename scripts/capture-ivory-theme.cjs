const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const output = path.resolve('artifacts/current/ivory-clean-theme.png');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, SCREEN_STUDIO_HEADLESS: '1' }
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.locator('#theme-button').click();
    await page.locator('[data-theme-choice="ivory"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'ivory');
    await page.screenshot({ path: output });
    process.stdout.write(`${output}\n`);
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
