const { test, expect } = require('@playwright/test');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// A shortcut changed from the button that runs the action (right-click → "שינוי קיצור…"), in every window:
//   1  every action button shows its keys in its hint, in the bar, the captures window and the studio
//   2  a right-click on a button opens the shortcut menu of its action (and only on action buttons)
//   3  the small window records new keys, warns about a taken combination, and saves; the studio keeps it like a choice
//      made in its settings, and every window's hint follows
//   4  "ללא קיצור" really leaves the action without keys (it used to fall back to the default), "חזרה לברירת המחדל" restores
test.describe.serial('shortcut from a button', () => {
  let app;
  let page;
  let runtimeErrors;
  const byUrl = (part) => app.windows().find((candidate) => candidate.url().includes(part));
  const qa = (name, ...args) => app.evaluate((_electron, [key, values]) => {
    const value = globalThis.__aurumQa[key];
    return typeof value === 'function' ? value(...values) : value;
  }, [name, args]);

  test.beforeAll(async () => {
    ({ app, page, runtimeErrors } = await launchStudio('shortcut-from-button'));
    await expect.poll(() => Boolean(byUrl('quickbar.html')), { timeout: 15_000 }).toBe(true);
  });
  test.afterAll(async () => closeStudio(app));

  test('every action button shows its keys in its hint', async () => {
    const strip = byUrl('quickbar.html');
    await expect.poll(() => strip.locator('[data-strip-action="region"]').getAttribute('title')).toContain('קיצור: PrtSc');
    await expect.poll(() => page.locator('#screenshot-button').getAttribute('title')).toMatch(/קיצור: Ctrl \+ Shift \+ 1/);
    await strip.evaluate(() => window.quickbarApi.openWorkspace());
    await expect.poll(() => Boolean(byUrl('workspace.html')), { timeout: 15_000 }).toBe(true);
    const workspace = byUrl('workspace.html');
    await expect.poll(() => workspace.locator('[data-action="region"]').first().getAttribute('title')).toContain('קיצור: PrtSc');
  });

  test('a right-click on an action button opens its shortcut menu', async () => {
    const strip = byUrl('quickbar.html');
    await strip.locator('[data-strip-action="record"]').dispatchEvent('contextmenu', { bubbles: true, cancelable: true });
    await expect.poll(() => qa('lastShortcutMenu')).toMatchObject({ action: 'record' });
    const menu = await qa('lastShortcutMenu');
    expect(menu.items).toEqual(expect.arrayContaining(['שינוי קיצור…', 'ללא קיצור', 'חזרה לברירת המחדל']));
    expect(menu.items[0]).toContain('Ctrl + Shift + 2');
  });

  test('the small window records new keys, warns about a taken one, and saves', async () => {
    await qa('openShortcutEditor', 'record');
    await expect.poll(() => Boolean(byUrl('shortcut-editor.html')), { timeout: 10_000 }).toBe(true);
    const editor = byUrl('shortcut-editor.html');
    await expect(editor.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect(editor.locator('#action-label')).toHaveText('התחלה / עצירת הקלטה');
    // Taken by "צילום מסך מלא": saving is blocked, with the reason.
    await editor.keyboard.press('Control+Shift+Digit1');
    await expect(editor.locator('#note')).toContainText('צילום מסך מלא');
    await expect(editor.locator('#save')).toBeDisabled();
    // A free combination saves with Enter and the window closes.
    await editor.keyboard.press('Control+Shift+Digit9');
    await expect(editor.locator('#save')).toBeEnabled();
    // The window closes on the key going down, before the key comes back up: a closed page here is the expected end.
    await editor.keyboard.press('Enter').catch(() => {});
    await expect.poll(() => qa('shortcutEditorOpen')).toBe(false);
    expect(await qa('activeShortcut', 'record')).toMatchObject({ code: 'Digit9', modifiers: ['Ctrl', 'Shift'] });
    // In force (test runs never grab real system keys, so the hint the program builds from the keys in force is checked).
    expect((await qa('shortcutLabels')).record).toBe('Ctrl + Shift + 9');
    // The studio keeps it as its own choice, and the hints follow.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aurum-shortcuts') || '{}').record?.code)).toBe('Digit9');
    await expect.poll(() => byUrl('quickbar.html').locator('[data-strip-action="record"]').getAttribute('title')).toContain('Ctrl + Shift + 9');
    await expect.poll(() => page.locator('#record-button').getAttribute('title')).toContain('Ctrl + Shift + 9');
  });

  test('"no shortcut" leaves the action without keys; the default comes back on request', async () => {
    await qa('changeShortcut', 'record', null);
    expect(await qa('activeShortcut', 'record')).toBeNull();
    await expect.poll(() => page.locator('#record-button').getAttribute('title')).toContain('אין קיצור');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aurum-shortcuts') || '{}').record)).toBeNull();
    await qa('changeShortcut', 'record', 'default');
    expect(await qa('activeShortcut', 'record')).toMatchObject({ code: 'Digit2' });
    expect(runtimeErrors).toEqual([]);
  });
});
