const path = require('node:path');
const fs = require('node:fs/promises');
const { launchStudio, closeStudio } = require('../tests/helpers/electron-app.cjs');

(async () => {
  const output = path.resolve('artifacts/current/capture-default-preferences.png');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const { app, page } = await launchStudio('capture-preferences-visual-proof');
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-page="settings"]').click();
    await page.screenshot({ path: output, fullPage: true });
    process.stdout.write(`${output}\n`);
  } finally { await closeStudio(app); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
