const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const output = path.resolve('artifacts/current/aurum-current-1440x1100.png');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const app = await electron.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '.'],
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, SCREEN_STUDIO_QA: '1' }
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.screenshot({ path: output, fullPage: true });
    process.stdout.write(`${output}\n`);
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
