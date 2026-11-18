const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// Sending by e-mail through "שיחה", and captures that stay sharp when enlarged:
//   1  the captures window's "שליחה במייל" (right-click menu) opens Sicha with a Hebrew subject and the chosen files attached
//   2  the studio's settings show Sicha as the mail program, ready
//   3  the library card's menu sends the same way
//   4  enlarged to the window's full width, a picture switches to its original file (no blurry thumbnail)
// A stand-in program plays Sicha: it writes down the arguments it was started with.
test.describe.serial('send by e-mail and sharp enlarged captures', () => {
  let app;
  let page;
  let workspace;
  let outputDir;
  let received;
  const pictures = [];

  test.beforeAll(async () => {
    const stubDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aurum-sicha-stub-'));
    const stub = path.join(stubDirectory, 'sicha-stand-in.cjs');
    received = path.join(stubDirectory, 'received.json');
    await fs.writeFile(stub, "require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)), 'utf8');\n");
    process.env.SCREEN_STUDIO_SICHA_COMPOSE_EXE = process.execPath;
    process.env.SCREEN_STUDIO_SICHA_COMPOSE_ARGS = `"${stub}" "${received}"`;
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screen-studio-mail-'));
    for (const [index, size] of [[1, '2880x1800'], [2, '1280x720']].entries()) {
      const file = path.join(outputDir, `צילום ${size[0]}.png`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${size[1]}:d=1`, '-frames:v', '1', file]);
      const stamp = new Date(Date.now() - (2 - index) * 60_000);
      await fs.utimes(file, stamp, stamp);
      pictures.push(file);
    }
    ({ app, page } = await launchStudio('mail-sharp', { outputDir }));
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('quickbar.html')), { timeout: 15_000 }).toBe(true);
    await app.windows().find((candidate) => candidate.url().includes('quickbar.html')).evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
    workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
    await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('workspace.html')); win.setBounds({ x: 40, y: 40, width: 1100, height: 760 }); win.showInactive(); });
  });
  test.afterAll(async () => {
    delete process.env.SCREEN_STUDIO_SICHA_COMPOSE_EXE;
    delete process.env.SCREEN_STUDIO_SICHA_COMPOSE_ARGS;
    await closeStudio(app);
  });

  const lastSent = async () => JSON.parse(await fs.readFile(received, 'utf8'));

  test('1 · captures window: Sicha opens with the subject and both chosen captures attached', async () => {
    await expect(workspace.locator('.item')).toHaveCount(2, { timeout: 15_000 });
    await workspace.locator('.item').nth(0).click();
    await workspace.locator('.item').nth(1).click({ modifiers: ['Control'] });
    // The right-click menu (always there; the ribbon hides in some designs).
    await workspace.locator('.item').nth(1).click({ button: 'right' });
    await workspace.locator('#menu [data-menu-item="mail"]').click();
    await expect.poll(() => fs.access(received).then(() => true, () => false), { timeout: 15_000 }).toBe(true);
    const args = await lastSent();
    expect(args.slice(0, 2)).toEqual(['--subject', '2 צילומים מאולפן צילום המסך']);
    expect(new Set(args.slice(2).map((file) => path.resolve(file).toLowerCase()))).toEqual(new Set(pictures.map((file) => path.resolve(file).toLowerCase())));
  });

  test('2 · settings: Sicha is the mail program and it is ready', async () => {
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    await expect(page.locator('#mail-client')).toHaveValue('sicha');
    await expect(page.locator('#mail-client-status')).toContainText('נפתחת הודעה חדשה');
    await expect(page.locator('#mail-browse')).toBeHidden();
  });

  test('3 · library card menu: one capture, its name as the subject', async () => {
    await fs.rm(received, { force: true });
    await page.locator('[data-page="library"]').click();
    const card = page.locator('.library-item', { hasText: 'צילום 2' });
    await card.locator('.more').click();
    await card.locator('.more-menu .mail').click();
    await expect.poll(() => fs.access(received).then(() => true, () => false), { timeout: 15_000 }).toBe(true);
    const args = await lastSent();
    expect(args[0]).toBe('--subject');
    expect(args[1]).toBe('צילום מסך: צילום 2.png');
    expect(path.resolve(args[2]).toLowerCase()).toBe(path.resolve(pictures[1]).toLowerCase());
    await expect(page.locator('#toast')).toContainText('נפתחה הודעה חדשה');
  });

  test('4 · enlarged to full width, the picture is the original file and fills the frame', async () => {
    const before = await workspace.locator('.item img').first().evaluate((image) => ({ natural: image.naturalWidth, sharp: image.dataset.sharp }));
    expect(before.sharp).toBe('thumbnail');
    const largest = Number(await workspace.locator('#thumb-size').getAttribute('max'));
    expect(largest).toBeGreaterThan(900);
    await workspace.locator('#thumb-size').evaluate((slider, value) => { slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true })); }, largest);
    const big = workspace.locator('.item img').first();
    await expect.poll(() => big.evaluate((image) => image.naturalWidth), { timeout: 15_000 }).toBeGreaterThanOrEqual(1280);
    const shown = await big.evaluate((image) => ({ sharp: image.dataset.sharp, width: image.clientWidth, frame: image.parentElement.clientWidth, natural: image.naturalWidth }));
    expect(shown.sharp).toBe('full');
    // The picture fills its frame (it was capped at the 480-wide thumbnail before) and is never shown above its own resolution.
    expect(shown.width).toBeGreaterThan(600);
    expect(shown.width).toBeLessThanOrEqual(shown.natural);
  });
});
