const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');
const { pngDimensions } = require('../helpers/media.cjs');

//   1  two chosen captures are compared: a new capture with both side by side and the change framed; equal ones say so
//   2  the captures window finds a recording by what was said in it
//   3  the smart tools page shows the start-and-close journal, newest first
test.describe.serial('compare two captures, search in speech, the journal screen', () => {
  let app;
  let page;
  let outputDir;
  let workspace;
  let runtimeErrors;

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('compare-search-journal'));
    // Two pictures of the same screen: the second has a dark box that the first has not.
    const make = (withBox) => page.evaluate((box) => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 240;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 400, 240);
      context.fillStyle = '#2563eb';
      context.fillRect(20, 20, 120, 40);
      if (box) { context.fillStyle = '#111111'; context.fillRect(250, 130, 90, 60); }
      return canvas.toDataURL('image/png').split(',')[1];
    }, withBox);
    await fs.writeFile(path.join(outputDir, 'צילום_2026-11-01_10-00-00-000.png'), Buffer.from(await make(false), 'base64'));
    await fs.writeFile(path.join(outputDir, 'צילום_2026-11-01_10-00-05-000.png'), Buffer.from(await make(true), 'base64'));
    await fs.utimes(path.join(outputDir, 'צילום_2026-11-01_10-00-00-000.png'), new Date('2026-11-01T10:00:00'), new Date('2026-11-01T10:00:00'));
    // A recording with a transcript in its details (the picture inside does not matter here).
    await fs.writeFile(path.join(outputDir, 'הקלטה_2026-11-01_11-00-00-000.webm'), Buffer.from('not a real video'));
    await fs.writeFile(path.join(outputDir, 'הקלטה_2026-11-01_11-00-00-000.webm.meta.json'), JSON.stringify({ transcriptText: 'היום נלמד על חשבונית מס חודשית', summary: 'הסבר על הנהלת חשבונות' }));
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
    workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await expect(workspace.locator('.item')).toHaveCount(3);
  });
  test.afterAll(async () => closeStudio(app));

  test('1 · two captures compared: side by side, the change framed; a capture against itself is "the same"', async () => {
    const images = (await fs.readdir(outputDir)).filter((name) => name.endsWith('.png')).map((name) => path.join(outputDir, name));
    const result = await workspace.evaluate((paths) => window.workspaceApi.compare(paths), images);
    expect(result).toMatchObject({ same: false, frames: 1, resized: false });
    expect(await pngDimensions(result.path)).toMatchObject({ width: 816, height: 240 });
    expect(path.basename(result.path)).toMatch(/^השוואה_/);
    const same = await workspace.evaluate((file) => window.workspaceApi.compare([file, file]), images[0]);
    expect(same).toEqual({ same: true, frames: 0 });
    await expect(workspace.evaluate((file) => window.workspaceApi.compare([file]), images[0])).rejects.toThrow(/שני צילומים/);
  });

  test('2 · a recording is found by a word that was said in it, and by its summary', async () => {
    await workspace.evaluate(() => window.dispatchEvent(new Event('focus')));
    await workspace.locator('#search').fill('חשבונית');
    await expect(workspace.locator('.item')).toHaveCount(1);
    await expect(workspace.locator('.item').first()).toContainText('הקלטה_');
    await workspace.locator('#search').fill('הנהלת חשבונות');
    await expect(workspace.locator('.item')).toHaveCount(1);
    await workspace.locator('#search').fill('');
  });

  test('3 · the journal screen: the last runs, newest first', async () => {
    await page.locator('.sidebar .nav-item[data-page="tools"]').click();
    await page.locator('#journal-panel summary').click();
    await expect.poll(() => page.locator('#journal-list').getAttribute('data-entries').then(Number), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.locator('#journal-list li').first()).toContainText('הפעלה');
    expect(runtimeErrors).toEqual([]);
  });
});
