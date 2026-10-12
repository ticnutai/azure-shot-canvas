const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The captures window: long real names stay inside their card, everything works from the keyboard, and the action
// bar can shrink to one row, to icons, or disappear.
//   1  a long real name stays inside its card, on at most two lines; the page never scrolls sideways
//   2  arrows, Home and End move the choice; Shift stretches it
//   3  Space shows the picture large; F2 renames the file on disk
//   4  the number keys run the bar's actions (3 = full screen → a new picture)
//   5  Control + 1…4 switch the view, Control + plus / minus the picture size
//   6  the bar: full, one row, icons, hidden — each smaller than the one before; Control + F1 hides and brings back
//   7  the keys window lists every key once, and no key is bound twice
test.describe.serial('captures window: names, keys and bar looks', () => {
  let app;
  let outputDir;
  let workspace;
  const longName = 'כרום – חוק התכנון והבניה, תשכ ה-1965_2026-10-11_13-19-22-534 — ערוך — ערוך';

  test.beforeAll(async () => {
    ({ app, outputDir } = await launchStudio('workspace-keys'));
    const baseline = path.resolve(__dirname, '..', 'visual', '__baseline__');
    const samples = (await fs.readdir(baseline)).filter((name) => name.endsWith('.png')).slice(0, 5);
    for (const [index, name] of samples.entries()) {
      const target = path.join(outputDir, index === 0 ? `${longName}.png` : `צילום_2026-10-08_10-0${index}-00-000.png`);
      await fs.copyFile(path.join(baseline, name), target);
      const when = new Date(Date.now() - index * 60_000);
      await fs.utimes(target, when, when);
    }
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
    workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await workspace.evaluate(() => { localStorage.setItem('aurum-ws-theme', 'lines'); localStorage.setItem('aurum-ws-view', 'large'); localStorage.setItem('aurum-ws-thumb', '360'); localStorage.setItem('aurum-ws-bar', 'full'); });
    await workspace.reload();
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await expect(workspace.locator('.item')).toHaveCount(5);
  });
  test.afterAll(async () => closeStudio(app));

  const key = (name) => workspace.keyboard.press(name);
  const selected = () => workspace.evaluate(() => [...document.querySelectorAll('.item')].map((tile, index) => (tile.getAttribute('aria-selected') === 'true' ? index : -1)).filter((index) => index >= 0));

  test('1 · a long real name stays inside its card, on at most two lines; the page never scrolls sideways', async () => {
    const result = await workspace.evaluate(() => {
      const tile = document.querySelector('.item');
      const card = tile.getBoundingClientRect();
      const name = tile.querySelector('.name').getBoundingClientRect();
      const grid = document.querySelector('#grid');
      const line = parseFloat(getComputedStyle(tile.querySelector('.name')).lineHeight);
      return { inside: name.left >= card.left - 1 && name.right <= card.right + 1, lines: Math.round(name.height / line), sideways: grid.scrollWidth - grid.clientWidth, full: tile.title };
    });
    expect(result.inside).toBe(true);
    expect(result.lines).toBeLessThanOrEqual(2);
    expect(result.sideways).toBeLessThanOrEqual(0);
    expect(result.full).toContain('חוק התכנון');
  });

  test('2 · arrows, Home and End move the choice; Shift stretches it', async () => {
    await workspace.locator('#grid').focus();
    await key('Home');
    expect(await selected()).toEqual([0]);
    await key('ArrowLeft');
    expect(await selected()).toEqual([1]);
    await key('ArrowRight');
    expect(await selected()).toEqual([0]);
    await key('End');
    expect(await selected()).toEqual([4]);
    await key('Home');
    await key('Shift+ArrowLeft');
    await key('Shift+ArrowLeft');
    expect(await selected()).toEqual([0, 1, 2]);
    const columns = await workspace.evaluate(() => { const tops = [...document.querySelectorAll('.item')].map((tile) => Math.round(tile.getBoundingClientRect().top)); return tops.filter((top) => top === tops[0]).length; });
    await key('Home');
    await key('ArrowDown');
    expect(await selected()).toEqual([Math.min(columns, 4)]);
  });

  test('3 · Space shows the picture large; F2 renames the file on disk', async () => {
    await key('Home');
    await key('Space');
    await expect(workspace.locator('html')).toHaveAttribute('data-dialog', 'preview');
    await expect(workspace.locator('#dialog img')).toBeVisible();
    await key('Space');
    await expect(workspace.locator('#dialog-backdrop')).toBeHidden();
    await key('ArrowLeft');
    await key('F2');
    await expect(workspace.locator('html')).toHaveAttribute('data-dialog', 'rename');
    await workspace.locator('#dialog input').fill('שם חדש לבדיקה');
    await workspace.locator('#dialog input').press('Enter');
    await expect.poll(async () => (await fs.readdir(outputDir)).includes('שם חדש לבדיקה.png'), { timeout: 10_000 }).toBe(true);
    await expect(workspace.locator('.item[title="שם חדש לבדיקה.png"]')).toHaveCount(1);
  });

  test('4 · the number keys run the bar actions (3 = full screen → a new picture)', async () => {
    const before = new Set(await fs.readdir(outputDir));
    await workspace.locator('#grid').focus();
    await key('3');
    await expect.poll(async () => (await fs.readdir(outputDir)).some((name) => name.endsWith('.png') && !before.has(name)), { timeout: 30_000 }).toBe(true);
    const hints = await workspace.evaluate(() => [...document.querySelectorAll('.ribbon [data-key]')].map((button) => `${button.dataset.key}:${button.dataset.action}`));
    expect(hints).toEqual(['1:region', '2:repeatRegion', '3:screenshot', '4:scrollCapture', '5:ocrRegion', '6:recordRegion']);
  });

  test('5 · Control + 1…4 switch the view, Control + plus / minus the picture size', async () => {
    await workspace.locator('#grid').focus();
    for (const [index, view] of ['large', 'grid', 'list', 'table'].entries()) {
      await key(`Control+Digit${index + 1}`);
      await expect(workspace.locator('html')).toHaveAttribute('data-view', view);
    }
    await key('Control+Digit1');
    const size = () => workspace.evaluate(() => Number(document.querySelector('#thumb-size').value));
    const start = await size();
    await key('Control+Equal');
    expect(await size()).toBe(start + 20);
    await key('Control+Minus');
    expect(await size()).toBe(start);
  });

  test('6 · the bar: full, one row, icons, hidden — each smaller; Control + F1 hides and brings back', async () => {
    const heights = {};
    for (const look of ['full', 'compact', 'icons', 'hidden']) {
      await workspace.evaluate((value) => window.aurumWorkspace.setBar(value), look);
      heights[look] = await workspace.evaluate(() => document.querySelector('.ribbon').getBoundingClientRect().height);
    }
    expect(heights.full).toBeGreaterThan(heights.compact);
    expect(heights.compact).toBeGreaterThan(heights.icons);
    expect(heights.hidden).toBe(0);
    await workspace.evaluate(() => window.aurumWorkspace.setBar('compact'));
    await key('Control+F1');
    expect(await workspace.evaluate(() => window.aurumWorkspace.bar())).toBe('hidden');
    await key('Control+F1');
    expect(await workspace.evaluate(() => window.aurumWorkspace.bar())).toBe('compact');
    // The choice lives in one place: the design menu.
    await workspace.locator('#theme-button').click();
    await expect(workspace.locator('#menu [data-bar-choice]')).toHaveCount(4);
    await workspace.locator('#menu [data-bar-choice="full"]').click();
    expect(await workspace.evaluate(() => localStorage.getItem('aurum-ws-bar'))).toBe('full');
  });

  test('7 · the keys window lists every key once, and no key is bound twice', async () => {
    await workspace.locator('#grid').focus();
    await key('F1');
    await expect(workspace.locator('html')).toHaveAttribute('data-dialog', 'keys');
    const listed = await workspace.locator('#dialog table.keys kbd').allTextContents();
    const known = await workspace.evaluate(() => window.aurumWorkspace.keys());
    expect(listed).toEqual(known);
    expect(new Set(listed).size).toBe(listed.length);
    await key('Escape');
    await expect(workspace.locator('#dialog-backdrop')).toBeHidden();
  });
});
