const { _electron: electron } = require('@playwright/test');
const path = require('node:path');

(async () => {
  const app = await electron.launch({
    args: ['.'], cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, SCREEN_STUDIO_HEADLESS: '1' }, timeout: 30_000
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="development"]').click();
    await page.locator('#run-qa').click();
    await page.waitForFunction(() => document.querySelector('#run-qa').disabled === false, null, { timeout: 180_000 });
    const consoleText = await page.locator('#qa-console').textContent();
    const status = await page.locator('#qa-status').textContent();
    if (!consoleText.includes('Scientific QA passed') || status !== 'עבר בהצלחה') {
      throw new Error(`QA dashboard run did not finish cleanly. status=${status}`);
    }
    process.stdout.write('QA dashboard real-run verification passed.\n');
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
