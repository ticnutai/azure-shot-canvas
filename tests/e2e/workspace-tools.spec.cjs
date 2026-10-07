const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

const run = (file, args) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout))));

// Captures window tools: folders by project, a numbered steps guide (PDF and Word), and quick video trimming.
test.describe.serial('captures window tools', () => {
  let app;
  let outputDir;
  let workspace;

  test.beforeAll(async () => {
    ({ app, outputDir } = await launchStudio('workspace-tools'));
    const baseline = path.resolve(__dirname, '..', 'visual', '__baseline__');
    const samples = (await fs.readdir(baseline)).filter((name) => name.endsWith('.png')).slice(0, 3);
    for (const [index, name] of samples.entries()) {
      const target = path.join(outputDir, `צילום_2026-10-08_10-0${index}-00-000.png`);
      await fs.copyFile(path.join(baseline, name), target);
      // Oldest first in the guide: stamp the files a minute apart.
      const when = new Date(Date.now() - (10 - index) * 60_000);
      await fs.utimes(target, when, when);
    }
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-t', '4', '-pix_fmt', 'yuv420p', path.join(outputDir, 'הקלטה_2026-10-08_10-05-00-000.mp4')]);
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
    workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await workspace.evaluate(() => { localStorage.setItem('aurum-ws-theme', 'office'); });
    await workspace.reload();
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await expect(workspace.locator('.item')).toHaveCount(4);
  });
  test.afterAll(async () => closeStudio(app));

  const pick = async (...indexes) => {
    await workspace.locator('.item').nth(indexes[0]).click();
    for (const index of indexes.slice(1)) await workspace.locator('.item').nth(index).click({ modifiers: ['Control'] });
  };
  const images = () => workspace.locator('.item[data-kind="image"]');

  test('folders: tag captures, filter by folder, remove the tag; files stay where they are', async () => {
    await images().nth(0).click();
    await images().nth(1).click({ modifiers: ['Control'] });
    await workspace.locator('.ribbon [data-item-action="folder"]').click();
    await expect(workspace.locator('html')).toHaveAttribute('data-dialog', 'folder');
    await workspace.locator('#dialog input[type="text"]').fill('לקוח כהן');
    await workspace.locator('#dialog .primary').click();
    await expect(workspace.locator('#folder-filter option')).toHaveCount(3);
    await workspace.locator('#folder-filter').selectOption('לקוח כהן');
    await expect(workspace.locator('.item')).toHaveCount(2);
    await expect(workspace.locator('.item .folder-tag').first()).toHaveText('לקוח כהן');
    await workspace.locator('#folder-filter').selectOption('');
    await expect(workspace.locator('.item')).toHaveCount(2);
    await workspace.locator('#folder-filter').selectOption('*');
    await expect(workspace.locator('.item')).toHaveCount(4);
    expect((await fs.readdir(outputDir)).filter((name) => name.endsWith('.png'))).toHaveLength(3);
    // Remove the tag from one: the folder shows one capture.
    await workspace.locator('.item .folder-tag').first().locator('..').click();
    await workspace.locator('.ribbon [data-item-action="folder"]').click();
    await workspace.locator('#dialog button', { hasText: 'הסרה מתיקייה' }).click();
    await workspace.locator('#folder-filter').selectOption('לקוח כהן');
    await expect(workspace.locator('.item')).toHaveCount(1);
    await workspace.locator('#folder-filter').selectOption('*');
  });

  test('steps guide: the chosen pictures, oldest first, as a PDF and as a Word document', async () => {
    test.setTimeout(90_000);
    await images().nth(0).click();
    await images().nth(1).click({ modifiers: ['Control'] });
    await images().nth(2).click({ modifiers: ['Control'] });
    await workspace.locator('.ribbon [data-item-action="guide"]').click();
    await expect(workspace.locator('#dialog h2')).toHaveText('מדריך צעדים מ־3 צילומים');
    await workspace.locator('#dialog input[type="text"]').fill('התקנת התוכנה');
    await workspace.locator('#dialog .primary').click();
    await expect.poll(() => workspace.evaluate(() => document.documentElement.dataset.lastGuide || ''), { timeout: 30_000 }).toMatch(/התקנת התוכנה_.*\.pdf$/);
    const pdf = await workspace.evaluate(() => document.documentElement.dataset.lastGuide);
    const pdfBytes = await fs.readFile(pdf);
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfBytes.length).toBeGreaterThan(20_000);
    await workspace.locator('.ribbon [data-item-action="guide"]').click();
    await workspace.locator('#dialog button', { hasText: 'יצירת מסמך וורד' }).click();
    await expect.poll(() => workspace.evaluate(() => document.documentElement.dataset.lastGuide || ''), { timeout: 30_000 }).toMatch(/\.docx$/);
    const docx = await fs.readFile(await workspace.evaluate(() => document.documentElement.dataset.lastGuide));
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    expect(docx.length).toBeGreaterThan(20_000);
  });

  test('video trim: the chosen part saved as a new file, the original untouched', async () => {
    test.setTimeout(90_000);
    const video = workspace.locator('.item[data-kind="video"]');
    await expect(video).toHaveCount(1);
    await video.click();
    await expect(workspace.locator('.ribbon [data-item-action="trim"]')).toBeEnabled();
    await workspace.locator('.ribbon [data-item-action="trim"]').click();
    await expect(workspace.locator('html')).toHaveAttribute('data-dialog', 'trim');
    await workspace.waitForFunction(() => Number(document.querySelector('#dialog input[aria-label="סוף"]')?.max || 0) > 3);
    await workspace.evaluate(() => {
      const [start, end] = document.querySelectorAll('#dialog input[type="range"]');
      start.value = '1'; start.dispatchEvent(new Event('input'));
      end.value = '3'; end.dispatchEvent(new Event('input'));
    });
    await workspace.locator('#dialog .primary').click();
    await expect.poll(async () => (await fs.readdir(outputDir)).filter((name) => name.includes('— קטע')).length, { timeout: 60_000 }).toBe(1);
    const piece = path.join(outputDir, (await fs.readdir(outputDir)).find((name) => name.includes('— קטע')));
    const duration = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', piece]));
    expect(duration).toBeGreaterThan(1.5);
    expect(duration).toBeLessThan(2.6);
    await expect(workspace.locator('.item[data-kind="video"]')).toHaveCount(2);
  });
});
