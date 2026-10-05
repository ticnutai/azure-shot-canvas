// Captures every window layout (light + dark) and every design kit from the real Electron app,
// so each combination can be reviewed by eye. Output: artifacts/design-shots/*.png
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchStudio, closeStudio } = require('../tests/helpers/electron-app.cjs');

const outputDirectory = path.resolve(__dirname, '..', 'artifacts', 'design-shots');
const only = process.argv.slice(2);

(async () => {
  await fs.mkdir(outputDirectory, { recursive: true });
  const { app, page, runtimeErrors } = await launchStudio('design-shots');
  try {
    const window = await app.browserWindow(page);
    // QA mode keeps the window hidden, and hidden windows do not repaint reliably before a capture.
    await window.evaluate((win) => { win.setSize(1366, 860); win.center(); win.showInactive(); });
    await page.waitForTimeout(400);
    const shoot = async (name) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(outputDirectory, `${name}.png`) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const active = await page.evaluate(() => [...document.querySelectorAll('.sidebar .nav-item.active')].map((node) => node.dataset.page).join(',') + ' / ' + document.querySelector('.page.active')?.id + ' / hover=' + (document.querySelector('.sidebar .nav-item:hover')?.dataset.page || '-'));
      console.log(`${name}  [${active}]${overflow > 1 ? `  ⚠ גלילה אופקית ${overflow}px` : ''}`);
    };
    const layouts = await page.evaluate(() => window.aurumAppearance.layouts.map((layout) => layout.id));
    for (const layout of layouts) {
      if (only.length && !only.includes(layout)) continue;
      for (const mode of ['light', 'dark']) {
        await page.evaluate(([id, colourMode]) => { window.aurumAppearance.applyMode(colourMode); window.aurumAppearance.applyLayout(id); }, [layout, mode]);
        await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
        await shoot(`layout-${layout}-${mode}`);
        if (mode === 'light') {
          await page.locator('.nav-item[data-page="library"]').click();
          await shoot(`layout-${layout}-${mode}-library`);
          await page.locator('[data-page="settings"]').click();
          await shoot(`layout-${layout}-${mode}-settings`);
        }
      }
    }
    if (!only.length || only.includes('kits')) {
      await page.evaluate(() => { window.aurumAppearance.applyMode('light'); window.aurumAppearance.applyLayout('office'); });
      const kits = await page.evaluate(() => window.aurumAppearance.kits.map((kit) => kit.id));
      for (const kit of kits) {
        await page.evaluate((id) => window.aurumAppearance.applyKit(id), kit);
        await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
        await shoot(`kit-${kit}-capture`);
      }
      await page.evaluate(() => window.aurumAppearance.applyKit('auto'));
    }
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="appearance"]').click();
    await shoot('appearance-picker');
    if (runtimeErrors.length) console.log('שגיאות בזמן ריצה:', JSON.stringify(runtimeErrors, null, 2));
  } finally {
    await closeStudio(app);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
