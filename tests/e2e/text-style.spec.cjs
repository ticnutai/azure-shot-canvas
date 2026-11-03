const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// Font and bold for text on captures (the editor and the frozen screen), and the keyboard icon on the floating bar:
//   1  the icon lists the bar's actions with their keys; a row opens the change window, the last row the settings tab
//   2  frozen screen: font and bold change the drawn text and are remembered for the next capture
//   3  editor: font and bold change the chosen text and are remembered
test.describe.serial('font, bold and the shortcuts icon', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  const byUrl = (part) => app.windows().filter((candidate) => candidate.url().includes(part));
  const strip = () => byUrl('quickbar.html')[0];

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('text-style'));
    await expect.poll(() => byUrl('quickbar.html').length, { timeout: 15_000 }).toBe(1);
    await strip().evaluate(() => window.quickbarApi.setPreferences({ regionMarkup: true }));
  });
  test.afterAll(async () => closeStudio(app));

  test('the keyboard icon on the bar: its actions, their keys, and the way to change them', async () => {
    const icon = strip().locator('#strip-shortcuts');
    // Open the bar the way a touch of its edge tab does.
    await strip().locator('#edge-handle').hover();
    await strip().waitForFunction(() => document.body.dataset.expanded === 'true');
    await expect.poll(() => icon.evaluate((button) => button.getBoundingClientRect().width)).toBeGreaterThan(15);
    // All the small buttons fit in the bar, none on top of another.
    const boxes = await strip().evaluate(() => ['#strip-history', '#strip-shortcuts', '#strip-pin', '#strip-hide'].map((selector) => {
      const { left, top, right, bottom, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    }));
    for (const [index, box] of boxes.entries()) {
      expect(box.width).toBeGreaterThan(15);
      expect(box.height).toBeGreaterThan(15);
      for (const other of boxes.slice(index + 1)) expect(box.right <= other.left || other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top).toBe(true);
    }
    await icon.evaluate((button) => button.click());
    await expect(strip().locator('body')).toHaveAttribute('data-menu-name', 'shortcuts');
    await expect(strip().locator('#strip-menu [data-menu-action="record"] small')).toHaveText('Ctrl + Shift + 2');
    await strip().locator('#strip-menu [data-menu-action="record"]').evaluate((row) => row.click());
    await expect.poll(() => byUrl('shortcut-editor.html').length, { timeout: 10_000 }).toBe(1);
    await expect(byUrl('shortcut-editor.html')[0].locator('#action-label')).toHaveText('התחלה / עצירת הקלטה');
    await byUrl('shortcut-editor.html')[0].locator('#cancel').evaluate((button) => button.click()).catch(() => {});
    await expect.poll(() => app.evaluate(() => globalThis.__aurumQa.shortcutEditorOpen())).toBe(false);

    await icon.evaluate((button) => button.click());
    await expect(strip().locator('body')).toHaveAttribute('data-menu-open', 'true');
    await strip().locator('#strip-menu button').last().evaluate((row) => row.click());
    await expect(page.locator('[data-preference-tab="shortcuts"]')).toHaveClass(/active/);
    await expect(page.locator('[data-preference-section="shortcuts"]')).toHaveClass(/active/);
  });

  const openFrozen = async () => {
    const stamps = await Promise.all(byUrl('region-overlay.html').map((c) => c.evaluate(() => Number(document.documentElement.dataset.regionReady || 0))));
    const since = Math.max(0, ...stamps);
    await strip().evaluate(() => window.quickbarApi.runAction('region'));
    await expect.poll(() => byUrl('region-overlay.html').length, { timeout: 15_000 }).toBeGreaterThan(0);
    for (const candidate of byUrl('region-overlay.html')) {
      if (await candidate.waitForFunction((after) => Number(document.documentElement.dataset.regionReady || 0) > after, since, { timeout: 8_000 }).then(() => true).catch(() => false)) {
        await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('region-overlay.html')) win.showInactive(); });
        return candidate;
      }
    }
    throw new Error('no frozen screen');
  };
  // One text mark, drawn at the same place; returns a picture of the marks.
  const writeText = (overlay) => overlay.evaluate(async () => {
    const fire = (type, x, y) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, pointerId: 1 }));
    fire('pointerdown', 400, 300);
    fire('pointerup', 400, 300);
    const input = document.querySelector('#text-input');
    input.value = 'שלום עולם Hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const picture = document.querySelector('#marks').toDataURL();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true }));
    return picture;
  });

  test('the frozen screen: font and bold change the text, and are remembered', async () => {
    let overlay = await openFrozen();
    await overlay.evaluate(() => {
      const fire = (type, x, y, buttons) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, pointerId: 1 }));
      fire('pointermove', 200, 200, 0); fire('pointerdown', 200, 200, 1); fire('pointermove', 800, 600, 1); fire('pointerup', 800, 600, 0);
    });
    await expect(overlay.locator('#toolbar')).toBeVisible();
    await expect(overlay.locator('.text-style')).toBeHidden();
    await overlay.locator('[data-tool="text"]').evaluate((button) => button.click());
    await expect(overlay.locator('.text-style')).toBeVisible();
    await expect(overlay.locator('#bold-button')).toHaveAttribute('aria-pressed', 'true');
    const usual = await writeText(overlay);

    await overlay.locator('#bold-button').evaluate((button) => button.click());
    await expect(overlay.locator('#bold-button')).toHaveAttribute('aria-pressed', 'false');
    const thin = await writeText(overlay);
    expect(thin).not.toBe(usual);

    await overlay.locator('#font-button').evaluate((button) => button.click());
    await expect(overlay.locator('#font-menu')).toBeVisible();
    // Only fonts this computer has, and more than one of them.
    expect(await overlay.locator('#font-menu button').count()).toBeGreaterThan(1);
    await overlay.locator('#font-menu [data-font="Times New Roman"]').evaluate((button) => button.click());
    await expect(overlay.locator('#font-menu')).toBeHidden();
    await expect(overlay.locator('#font-button')).toContainText('טיימס');
    expect(await writeText(overlay)).not.toBe(thin);
    await overlay.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    overlay = await openFrozen();
    await overlay.evaluate(() => {
      const fire = (type, x, y, buttons) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, pointerId: 1 }));
      fire('pointermove', 200, 200, 0); fire('pointerdown', 200, 200, 1); fire('pointermove', 800, 600, 1); fire('pointerup', 800, 600, 0);
    });
    await overlay.locator('[data-tool="text"]').evaluate((button) => button.click());
    await expect(overlay.locator('#font-button')).toContainText('טיימס');
    await expect(overlay.locator('#bold-button')).toHaveAttribute('aria-pressed', 'false');
    await overlay.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  });

  test('the program\'s own font and bold: every open window follows at once, and back to the design', async () => {
    const look = (target, selector) => target.locator(selector).evaluate((element) => { const { fontFamily, fontWeight } = getComputedStyle(element); return { fontFamily, fontWeight }; });
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="general"]').click();
    const before = await look(page, '.nav-item[data-page="library"]');
    await page.locator('#ui-font').selectOption('Times New Roman');
    await page.locator('#ui-bold').check();
    expect(await look(page, '.nav-item[data-page="library"]')).toEqual({ fontFamily: expect.stringContaining('Times New Roman'), fontWeight: '600' });
    await expect.poll(() => look(strip(), '#strip-history')).toEqual({ fontFamily: expect.stringContaining('Times New Roman'), fontWeight: '600' });
    await page.locator('#ui-font').selectOption('');
    await page.locator('#ui-bold').uncheck();
    expect(await look(page, '.nav-item[data-page="library"]')).toEqual(before);
    await expect.poll(async () => (await look(strip(), '#strip-history')).fontWeight).not.toBe('600');
  });

  test('the editor: font and bold change the chosen text, and are remembered', async () => {
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1000; canvas.height = 600;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 1000, 600);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    const file = path.join(outputDir, 'text-style-source.png');
    await fs.writeFile(file, Buffer.from(bytes));
    await app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('index.html')).webContents.send('app:open-editor', target);
    }, file);
    await expect(page.locator('#editor-canvas-wrap canvas').first()).toBeVisible({ timeout: 20_000 });
    expect(await page.locator('#editor-font option').count()).toBeGreaterThan(1);
    expect(await page.locator('#editor-bold').isChecked()).toBe(false);

    await page.locator('[data-editor-tool="text"]').click();
    const box = await page.locator('#editor-canvas-wrap .upper-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.keyboard.type('טקסט לבדיקה');
    await page.keyboard.press('Escape');
    const picture = async () => {
      await page.waitForTimeout(150);
      return page.locator('#editor-canvas-wrap .lower-canvas').evaluate((canvas) => canvas.toDataURL());
    };
    const usual = await picture();

    await page.locator('#editor-bold').check();
    const bold = await picture();
    expect(bold).not.toBe(usual);
    await page.locator('#editor-font').selectOption('Times New Roman');
    expect(await picture()).not.toBe(bold);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aurum-editor-text')))).toEqual({ font: 'Times New Roman', bold: true });
    expect(runtimeErrors).toEqual([]);
  });
});
