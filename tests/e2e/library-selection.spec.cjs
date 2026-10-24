const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

const powershell = (script) => new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout))));

// Choosing several files everywhere, with one "choose all" button that clears when pressed again; and a library that
// opens at once.
//   1  library page: the box, Control + click, Shift + click; "choose all" and again "clear"; the bar of actions
//   2  library page: copy puts all the chosen files on the clipboard; the recycle bin takes them all in one go
//   3  recent media on the capture page: the same box and button
//   4  speed: thumbnails come as short addresses (not the whole picture), and an unchanged list is not drawn again
//   5  captures window: the "choose all" button and Control + A, both clearing when pressed again
//   6  the bar's history: the "choose all" button
test.describe.serial('choosing several files, and a fast library', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  const rows = () => page.locator('#library-list .library-item');
  const chosenRows = () => page.locator('#library-list .library-item.is-chosen');

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('library-selection'));
    const baseline = path.resolve(__dirname, '..', 'visual', '__baseline__');
    const samples = (await fs.readdir(baseline)).filter((name) => name.endsWith('.png'));
    for (let i = 0; i < 12; i += 1) await fs.copyFile(path.join(baseline, samples[i % samples.length]), path.join(outputDir, `צילום_2026-10-24_10-${String(i).padStart(2, '0')}-00-000.png`));
    await page.locator('.nav-item[data-page="library"]').click();
    await expect(rows()).toHaveCount(12);
  });
  test.afterAll(async () => closeStudio(app));

  test('1 · library page: the box, Control and Shift; "choose all" and again "clear"; the bar of actions', async () => {
    await expect(page.locator('#library-selection')).toBeHidden();
    await expect(page.locator('#library-select-all')).toHaveText('בחירת הכל');
    await page.locator('#library-select-all').click();
    await expect(chosenRows()).toHaveCount(12);
    await expect(page.locator('#library-selection')).toBeVisible();
    await expect(page.locator('#library-selected-count')).toHaveText('12 נבחרו');
    await expect(page.locator('#library-select-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#library-select-all')).toHaveText('ניקוי הבחירה');
    await page.locator('#library-select-all').click();
    await expect(chosenRows()).toHaveCount(0);
    await expect(page.locator('#library-selection')).toBeHidden();
    // The box chooses one; Shift + click on the box takes the range; Control + click on the row adds or removes.
    await rows().nth(1).locator('.pick').click();
    await expect(page.locator('#library-selected-count')).toHaveText('פריט אחד נבחר');
    await rows().nth(4).locator('.pick').click({ modifiers: ['Shift'] });
    await expect(chosenRows()).toHaveCount(4);
    await rows().nth(6).locator('.file-details small').click({ modifiers: ['Control'] });
    await expect(chosenRows()).toHaveCount(5);
    await rows().nth(6).locator('.file-details small').click({ modifiers: ['Control'] });
    await expect(chosenRows()).toHaveCount(4);
    // A plain click on a row's own button still does its job and does not choose.
    await expect(rows().nth(0)).not.toHaveClass(/is-chosen/);
    // Control + A on the page: everything (again: clear); Escape lets the choice go.
    await page.locator('#library-list').click({ position: { x: 2, y: 2 } }).catch(() => {});
    await page.keyboard.press('Control+A');
    await expect(chosenRows()).toHaveCount(12);
    await page.keyboard.press('Control+A');
    await expect(chosenRows()).toHaveCount(0);
    await page.locator('#library-select-all').click();
    await page.keyboard.press('Escape');
    await expect(chosenRows()).toHaveCount(0);
  });

  test('1b · a click anywhere on a card chooses it; its name opens for renaming; Control + wheel zooms', async () => {
    await page.locator('#library-select-all').click();
    await page.locator('#library-select-all').click();
    await expect(chosenRows()).toHaveCount(0);
    // A plain click on the card (not its picture): chosen; again: let go.
    await rows().nth(3).locator('.file-details small').click();
    await expect(rows().nth(3)).toHaveClass(/is-chosen/);
    await rows().nth(5).locator('.file-details small').click();
    await expect(chosenRows()).toHaveCount(2);
    await rows().nth(3).locator('.file-details small').click();
    await expect(chosenRows()).toHaveCount(1);
    // The picture opens the capture in the studio's own editor (no Windows "open with" question), and chooses nothing.
    await rows().nth(4).locator('.file-icon').click();
    await expect(page.locator('#image-editor-shell')).toBeVisible();
    await expect(chosenRows()).toHaveCount(1);
    await page.evaluate(() => window.aurumEditor.close(true));
    await expect(page.locator('#image-editor-shell')).toBeHidden();
    // With Control held, the picture chooses instead.
    await rows().nth(4).locator('.file-icon').click({ modifiers: ['Control'] });
    await expect(chosenRows()).toHaveCount(2);
    // A button of the card does its job and does not choose.
    await rows().nth(7).locator('.more').click();
    await expect(rows().nth(7)).not.toHaveClass(/is-chosen/);
    // Escape closes the menu and lets the choice go.
    await page.keyboard.press('Escape');
    await expect(chosenRows()).toHaveCount(0);
    // The name: a box with the name (no extension). Escape puts it back; Enter renames the file on the disk.
    const name = rows().nth(2).locator('.file-name');
    const before = (await name.textContent()).trim();
    await name.click();
    const box = rows().nth(2).locator('.name-in-place');
    await expect(box).toBeFocused();
    expect(await box.inputValue()).toBe(before.replace(/\.png$/, ''));
    await expect(chosenRows()).toHaveCount(0);
    await box.press('Escape');
    await expect(name).toHaveText(before);
    await name.click();
    await rows().nth(2).locator('.name-in-place').fill('שם חדש מהכרטיס');
    await rows().nth(2).locator('.name-in-place').press('Enter');
    await expect(page.locator('#library-list .file-name', { hasText: 'שם חדש מהכרטיס.png' })).toHaveCount(1);
    expect(await fs.readdir(outputDir)).toContain('שם חדש מהכרטיס.png');
    // Control + wheel over the pictures: bigger, then smaller; remembered.
    const width = () => rows().first().evaluate((row) => row.getBoundingClientRect().width);
    const start = await width();
    await rows().first().hover();
    await page.mouse.wheel(0, -100);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(width).toBeGreaterThan(start);
    expect(await page.evaluate(() => localStorage.getItem('aurum-library-zoom'))).not.toBeNull();
    await page.keyboard.down('Control');
    for (let i = 0; i < 8; i += 1) await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    await expect.poll(width).toBeLessThan(start);
    // The slider takes over again.
    await page.locator('#library-size').fill('2');
    expect(await page.evaluate(() => localStorage.getItem('aurum-library-zoom'))).toBeNull();
  });

  test('2 · copy puts all the chosen files on the clipboard; the recycle bin takes them all in one go', async () => {
    await rows().nth(0).locator('.pick').click();
    await rows().nth(2).locator('.pick').click({ modifiers: ['Shift'] });
    // Control + C copies the chosen files (paste brings all of them), like the copy button.
    const copied = () => powershell('(Get-Clipboard -Format FileDropList).FullName').then((text) => text.trim().split(/\r?\n/).filter(Boolean).length);
    await page.keyboard.press('Control+C');
    await expect.poll(copied, { timeout: 15_000 }).toBe(3);
    await powershell('Set-Clipboard -Value x');
    await expect.poll(copied).toBe(0);
    await page.locator('#library-copy').click();
    await expect.poll(copied, { timeout: 15_000 }).toBe(3);
    const names = await chosenRows().evaluateAll((items) => items.map((item) => item.dataset.path));
    await page.locator('#library-trash').click();
    await expect(rows()).toHaveCount(9);
    for (const name of names) await expect.poll(() => fs.access(name).then(() => true, () => false)).toBe(false);
    await expect(page.locator('#library-selection')).toBeHidden();
  });

  test('3 · recent media on the capture page: the same box and "choose all" button', async () => {
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
    const cards = page.locator('#recent-library .clip-card');
    await expect.poll(() => cards.count()).toBeGreaterThan(0);
    const count = await cards.count();
    await page.locator('#recent-select-all').click();
    await expect(page.locator('#recent-library .clip-card.is-chosen')).toHaveCount(count);
    await expect(page.locator('#recent-selection')).toBeVisible();
    await page.locator('#recent-select-all').click();
    await expect(page.locator('#recent-library .clip-card.is-chosen')).toHaveCount(0);
    await cards.first().locator('.pick').click();
    await expect(page.locator('#recent-selected-count')).toHaveText('פריט אחד נבחר');
    await page.locator('#recent-select-clear').click();
    await expect(page.locator('#recent-selection')).toBeHidden();
  });

  test('4 · speed: short thumbnail addresses that really show, and an unchanged list is not drawn again', async () => {
    const items = await page.evaluate(() => window.screenStudio.listLibrary());
    expect(items.every((item) => String(item.thumbnail).startsWith('aurum-thumb://'))).toBe(true);
    expect(JSON.stringify(items).length).toBeLessThan(20_000);
    await page.locator('.nav-item[data-page="library"]').click();
    await expect.poll(() => page.locator('#library-list img').evaluateAll((images) => images.filter((image) => image.complete && image.naturalWidth > 0).length), { timeout: 15_000 }).toBeGreaterThan(0);
    // The same list again: the rows are the very same elements (nothing rebuilt).
    await page.evaluate(() => { document.querySelector('#library-list .library-item').dataset.marker = 'kept'; });
    await page.evaluate(() => loadLibrary());
    expect(await page.locator('#library-list .library-item[data-marker="kept"]').count()).toBe(1);
    // A new file: drawn again.
    const baseline = path.resolve(__dirname, '..', 'visual', '__baseline__');
    const sample = (await fs.readdir(baseline)).find((name) => name.endsWith('.png'));
    await fs.copyFile(path.join(baseline, sample), path.join(outputDir, 'צילום_2026-10-24_11-00-00-000.png'));
    await page.evaluate(() => loadLibrary());
    await expect(rows()).toHaveCount(10);
    // Opening the page costs little: the main-thread work of a fresh load and draw stays short.
    const took = await page.evaluate(async () => { const started = performance.now(); await loadLibrary(); return performance.now() - started; });
    expect(took).toBeLessThan(400);
    // A thumbnail address can only reach the thumbnail folder.
    const statuses = await app.evaluate(async ({ net }, good) => Promise.all([good, 'aurum-thumb://t/..%2F..%2Fsecret.jpg', 'aurum-thumb://t/C:%5CWindows%5Cwin.ini'].map((url) => net.fetch(url).then((response) => response.status, () => 'blocked'))), items[0].thumbnail);
    expect(statuses[0]).toBe(200);
    expect([404, 'blocked']).toContain(statuses[1]);
    expect([404, 'blocked']).toContain(statuses[2]);
  });

  test('5 · captures window: "choose all" and Control + A, both clearing when pressed again', async () => {
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
    const workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const total = await workspace.locator('.item').count();
    await workspace.locator('#select-all').click();
    await expect(workspace.locator('.item[aria-selected="true"]')).toHaveCount(total);
    await expect(workspace.locator('#select-all')).toHaveAttribute('aria-pressed', 'true');
    await workspace.locator('#select-all').click();
    await expect(workspace.locator('.item[aria-selected="true"]')).toHaveCount(0);
    await workspace.locator('#grid').focus();
    await workspace.keyboard.press('Control+A');
    await expect(workspace.locator('.item[aria-selected="true"]')).toHaveCount(total);
    await workspace.keyboard.press('Control+A');
    await expect(workspace.locator('.item[aria-selected="true"]')).toHaveCount(0);
    // Delete on several: all go in one go.
    await workspace.locator('.item').nth(0).click();
    await workspace.locator('.item').nth(1).click({ modifiers: ['Control'] });
    await workspace.keyboard.press('Delete');
    await expect(workspace.locator('.item')).toHaveCount(total - 2);
  });

  test('6 · the bar\'s history: the "choose all" button', async () => {
    const strip = app.windows().find((candidate) => candidate.url().includes('quickbar.html'));
    await strip.evaluate(() => window.quickbarApi.setPreferences({ historyStyle: 'panel' }));
    if (await strip.locator('body').getAttribute('data-expanded') !== 'true') await strip.locator('#edge-handle').dispatchEvent('pointerup');
    await strip.evaluate(() => { document.documentElement.dataset.view = 'actions'; });
    await strip.locator('#strip-history').click();
    await expect(strip.locator('html')).toHaveAttribute('data-view', 'history');
    const tiles = strip.locator('.history-item');
    await expect.poll(() => tiles.count()).toBeGreaterThan(0);
    const total = await tiles.count();
    await strip.locator('#history-select-all').click();
    await expect(strip.locator('.history-item[aria-selected="true"]')).toHaveCount(total);
    await expect(strip.locator('#history-selection')).toBeVisible();
    await strip.locator('#history-select-all').click();
    await expect(strip.locator('.history-item[aria-selected="true"]')).toHaveCount(0);
    await expect(strip.locator('#history-selection')).toBeHidden();
    expect(runtimeErrors.map((error) => error.text.slice(0, 160))).toEqual([]);
  });
});
