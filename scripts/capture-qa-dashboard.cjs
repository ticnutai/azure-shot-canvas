const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const output = path.resolve('artifacts/qa/qa-dashboard.png');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const app = await electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '..'), env: { ...process.env, SCREEN_STUDIO_HEADLESS: '1' } });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="development"]').click();
    await page.locator('#qa-metrics-body tr').first().waitFor();
    await page.screenshot({ path: output, fullPage: true });
    process.stdout.write(`${output}\n`);
  } finally { await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
