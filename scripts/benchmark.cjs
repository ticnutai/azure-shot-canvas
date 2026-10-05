// Measures how fast the main user-facing functions respond in the real Electron app.
// Each operation runs several times; the report shows median and worst time in milliseconds.
// Output: console table + artifacts/benchmark/latest.json
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchStudio, closeStudio } = require('../tests/helpers/electron-app.cjs');

const RUNS = 5;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

(async () => {
  const startedLaunch = performance.now();
  const { app, page, outputDir } = await launchStudio('benchmark');
  const results = [{ name: 'פתיחת האפליקציה עד שהיא מוכנה', runs: [performance.now() - startedLaunch], budget: 10_000 }];
  const measure = async (name, budget, action, setup = async () => {}) => {
    const runs = [];
    for (let index = 0; index < RUNS; index += 1) {
      await setup(index);
      const started = performance.now();
      try { await action(index); } catch (error) { results.push({ name, runs, budget, error: error.message.split('\n')[0] }); return; }
      runs.push(performance.now() - started);
    }
    results.push({ name, runs, budget });
  };
  try {
    // A hidden QA window paints at ~1 fps; show it so timings match what a user sees.
    const window = await app.browserWindow(page);
    await window.evaluate((win) => { win.setSize(1366, 860); win.showInactive(); });
    await page.waitForTimeout(500);
    const nav = (target) => page.locator(`.nav-item[data-page="${target}"]:not([data-action])`).click();
    await measure('מעבר למסך הספרייה', 300, async () => { await nav('library'); await page.locator('#library-page.active').waitFor(); }, () => nav('capture'));
    await measure('מעבר למסך ההגדרות', 300, async () => { await nav('settings'); await page.locator('#settings-page.active').waitFor(); }, () => nav('capture'));
    await measure('מעבר חזרה למסך הצילום', 600, async () => { await nav('capture'); await page.locator('#capture-page.active').waitFor(); }, () => nav('library'));
    await nav('capture');

    const before = new Set(await fs.readdir(outputDir));
    await page.evaluate(() => { document.querySelector('#default-capture-kind') && (document.querySelector('#default-capture-kind').value = 'screenshot'); });
    await measure('צילום מסך מלא ושמירה לקובץ', 3000, async () => {
      const count = (await fs.readdir(outputDir)).filter((name) => name.endsWith('.png')).length;
      await page.evaluate(() => executeShortcutAction('screenshot'));
      const deadline = Date.now() + 15_000;
      while ((await fs.readdir(outputDir)).filter((name) => name.endsWith('.png')).length <= count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    }, async () => { await page.waitForFunction(() => !document.querySelector('#image-editor-shell') || document.querySelector('#image-editor-shell').classList.contains('hidden')); });
    const shot = (await fs.readdir(outputDir)).find((name) => name.endsWith('.png') && !before.has(name));
    const shotPath = path.join(outputDir, shot);

    await measure('פתיחת עורך התמונות', 1500, async () => {
      await page.evaluate((file) => window.aurumEditor.open(file, 'professional'), shotPath);
    }, async () => { await page.evaluate(() => window.aurumEditor.isOpen() && window.aurumEditor.close(true)); });
    const canvas = page.locator('#image-editor-shell .upper-canvas');
    const box = await canvas.boundingBox();
    const drag = async (tool, x1, y1, x2, y2) => {
      await page.locator(`[data-editor-tool="${tool}"]`).click();
      await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 4 });
      await page.mouse.up();
    };
    const objects = () => page.evaluate(() => window.aurumEditor.stats().objects);
    await measure('ציור מלבן בעורך', 250, async (index) => { const n = await objects(); await drag('rect', .1 + index * .05, .1, .2 + index * .05, .2); await page.waitForFunction((count) => window.aurumEditor.stats().objects > count, n); });
    await measure('ציור חץ בעורך', 250, async (index) => { const n = await objects(); await drag('arrow', .1, .3 + index * .05, .4, .3 + index * .05); await page.waitForFunction((count) => window.aurumEditor.stats().objects > count, n); });
    await measure('טשטוש אזור בעורך', 600, async (index) => { const n = await objects(); await drag('blur', .5, .1 + index * .1, .7, .18 + index * .1); await page.waitForFunction((count) => window.aurumEditor.stats().objects > count, n); });
    await measure('ביטול פעולה (Ctrl+Z)', 300, async () => { const n = await objects(); await page.locator('#editor-undo').click(); await page.waitForFunction((count) => window.aurumEditor.stats().objects < count, n); });
    await measure('ביצוע מחדש (Ctrl+Y)', 300, async () => { const n = await objects(); await page.locator('#editor-redo').click(); await page.waitForFunction((count) => window.aurumEditor.stats().objects > count, n); });
    await measure('שמירת עותק ערוך', 2500, async () => {
      await page.locator('#editor-save-copy').click();
      await page.waitForFunction(() => document.querySelector('#editor-save-state').textContent === 'הפרויקט נשמר מקומית');
    }, async () => { await drag('ellipse', .6, .6, .7, .7); });
    await page.evaluate(() => window.aurumEditor.close(true));

    await measure('טעינת הספרייה', 800, async () => { await page.evaluate(() => loadLibrary()); });
    await measure('החלפת פריסת חלון', 200, async (index) => {
      await page.evaluate((id) => window.aurumAppearance.applyLayout(id), ['office', 'modern', 'acrobat', 'classic', 'lemaan'][index]);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    });
  } finally {
    await closeStudio(app);
  }
  const rows = results.filter((item) => item.runs.length).map((item) => ({
    'פעולה': item.name,
    'חציון (אלפיות)': Math.round(median(item.runs)),
    'הכי איטי': Math.round(Math.max(...item.runs)),
    'יעד': item.budget,
    'מצב': Math.max(...item.runs) <= item.budget ? 'תקין' : 'איטי'
  }));
  console.table(rows);
  for (const item of results.filter((entry) => entry.error)) console.log(`לא הושלם: ${item.name} — ${item.error}`);
  const directory = path.resolve(__dirname, '..', 'artifacts', 'benchmark');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'latest.json'), JSON.stringify({ measuredAt: new Date().toISOString(), runs: RUNS, rows }, null, 2), 'utf8');
})().catch((error) => { console.error(error); process.exitCode = 1; });
