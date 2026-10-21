const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// Shortcuts shown during a recording (video options): a label at the bottom of the recorded screen.
//   1  off by default: a recording shows no keys
//   2  on: the label window opens with the recording, shortcuts appear in Hebrew, plain typing never does
//   3  the recording ends: the label window closes and no more keys are taken
test.describe.serial('keys shown while recording', () => {
  let app;
  let page;
  let outputDir;

  test.beforeAll(async () => {
    ({ app, page, outputDir } = await launchStudio('key-echo'));
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await page.locator('#default-capture-kind').selectOption('record');
    await page.locator('#default-capture-scope').selectOption('full');
    await page.locator('.nav-item[data-page="capture"]:not([data-action])').click();
  });
  test.afterAll(async () => closeStudio(app));

  const echo = () => app.evaluate(() => globalThis.__aurumQa.keyEcho);
  const record = async () => {
    await page.locator('#record-button').click();
    // A busy machine (the full test run) can take a while to start a recording.
    await expect.poll(() => page.evaluate(() => state.recorder?.state || ''), { timeout: 20_000 }).toBe('recording');
  };
  const stop = async () => {
    // A recording needs a moment of picture before it can be saved.
    await page.waitForTimeout(2000);
    const before = new Set(await fs.readdir(outputDir));
    await page.locator('#stop-recording').dispatchEvent('click');
    await expect.poll(async () => (await fs.readdir(outputDir)).some((name) => /\.(mp4|webm)$/.test(name) && !before.has(name)), { timeout: 60_000 }).toBe(true);
  };

  test('1 · off by default: a recording shows no keys', async () => {
    expect(await page.evaluate(() => document.querySelector('#show-keys').checked)).toBe(false);
    await record();
    expect((await echo()).active).toBe(false);
    await stop();
  });

  test('2 · on: the label opens with the recording; shortcuts appear in Hebrew, plain typing never does', async () => {
    await page.locator('#show-keys').evaluate((input) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(await page.evaluate(() => localStorage.getItem('aurum-show-keys'))).toBe('on');
    await record();
    await expect.poll(async () => (await echo()).open, { timeout: 15_000 }).toBe(true);
    await app.evaluate(() => {
      const press = globalThis.__aurumQa.pressKey;
      press('key 67 c');   // Control + C
      press('key 65 ');    // the letter A, typed
      press('key 65 s');   // Shift + A, typed
      press('key 13 ');    // Enter
      press('key 9 a');    // Alt + Tab
    });
    expect((await echo()).shown).toEqual(['קונטרול + C', 'אנטר', 'אלט + טאב']);
  });

  test('3 · the recording ends: the label window closes and no more keys are taken', async () => {
    await stop();
    await expect.poll(async () => (await echo()).active).toBe(false);
    expect((await echo()).open).toBe(false);
    await app.evaluate(() => globalThis.__aurumQa.pressKey('key 86 c'));
    expect((await echo()).shown).not.toContain('קונטרול + V');
  });
});
