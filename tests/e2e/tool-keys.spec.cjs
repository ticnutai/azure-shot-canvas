const { test, expect } = require('@playwright/test');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The keys of the marking tools on the frozen screen: changed by a right-click on a tool or from the keyboard icon,
// refused when taken, kept for the next capture, and back to the usual keys on request.
test.describe.serial('the tools\' keys on the frozen screen', () => {
  let app;
  let overlay;
  let runtimeErrors;
  const byUrl = (part) => app.windows().filter((candidate) => candidate.url().includes(part));
  const open = async () => {
    const stamps = await Promise.all(byUrl('region-overlay.html').map((c) => c.evaluate(() => Number(document.documentElement.dataset.regionReady || 0))));
    const since = Math.max(0, ...stamps);
    await byUrl('quickbar.html')[0].evaluate(() => window.quickbarApi.runAction('region'));
    await expect.poll(() => byUrl('region-overlay.html').length, { timeout: 15_000 }).toBeGreaterThan(0);
    for (const candidate of byUrl('region-overlay.html')) {
      if (await candidate.waitForFunction((after) => Number(document.documentElement.dataset.regionReady || 0) > after, since, { timeout: 8_000 }).then(() => true).catch(() => false)) {
        overlay = candidate;
        await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('region-overlay.html')) win.showInactive(); });
        await overlay.evaluate(() => {
          const fire = (type, x, y, buttons) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, pointerId: 1 }));
          fire('pointermove', 200, 200, 0); fire('pointerdown', 200, 200, 1); fire('pointermove', 800, 500, 1); fire('pointerup', 800, 500, 0);
        });
        await expect(overlay.locator('#toolbar')).toBeVisible();
        return;
      }
    }
    throw new Error('no frozen screen');
  };
  const press = (code, extra = {}) => overlay.evaluate(([value, more]) => window.dispatchEvent(new KeyboardEvent('keydown', { code: value, key: value.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true, ...more })), [code, extra]);
  const pressed = (tool) => overlay.locator(`button[data-tool="${tool}"]`).getAttribute('aria-pressed');
  const rowKey = (tool) => overlay.locator(`[data-key-tool="${tool}"] kbd`);
  const rightClick = (tool) => overlay.locator(`button[data-tool="${tool}"]`).evaluate((button) => button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  const escape = () => press('Escape', { key: 'Escape' });

  test.beforeAll(async () => {
    ({ app, runtimeErrors } = await launchStudio('tool-keys'));
    await expect.poll(() => byUrl('quickbar.html').length, { timeout: 15_000 }).toBe(1);
    await byUrl('quickbar.html')[0].evaluate(() => window.quickbarApi.setPreferences({ regionMarkup: true }));
  });
  test.afterAll(async () => closeStudio(app));

  test('a right-click on a tool: the new key works, the old one no longer does', async () => {
    await open();
    await press('KeyR');
    expect(await pressed('rect')).toBe('true');
    await press('KeyV');
    await expect(overlay.locator('#keys-panel')).toBeHidden();

    await rightClick('rect');
    await expect(overlay.locator('#keys-panel')).toBeVisible();
    await expect(overlay.locator('[data-key-tool="rect"]')).toHaveAttribute('data-listening', 'true');
    await press('KeyQ');
    await expect(rowKey('rect')).toHaveText('Q');
    await expect(overlay.locator('button[data-tool="rect"]')).toHaveAttribute('title', /\(Q\)/);

    await press('KeyR');
    expect(await pressed('move')).toBe('true');
    await press('KeyQ');
    expect(await pressed('rect')).toBe('true');
  });

  test('a key another tool has is refused, with the reason; Escape only leaves the listening', async () => {
    await rightClick('pen');
    await press('KeyA');
    await expect(overlay.locator('#keys-note')).toContainText('"חץ"');
    await expect(rowKey('pen')).toHaveText('…');
    await escape();
    await expect(rowKey('pen')).toHaveText('P');
    // The next Escape closes the list, and the frozen screen stays open.
    await escape();
    await expect(overlay.locator('#keys-panel')).toBeHidden();
    await expect(overlay.locator('#toolbar')).toBeVisible();
  });

  test('the keyboard icon lists every tool; a row changes it, Delete leaves a tool without a key', async () => {
    await overlay.locator('[data-command="tool-keys"]').evaluate((button) => button.click());
    await expect(overlay.locator('[data-key-tool]')).toHaveCount(13);
    await overlay.locator('[data-key-tool="arrow"]').evaluate((row) => row.click());
    await press('Delete', { key: 'Delete' });
    await expect(rowKey('arrow')).toHaveText('אין');
    await overlay.locator('[data-key-tool="pen"]').evaluate((row) => row.click());
    await press('Digit5');
    await expect(rowKey('pen')).toHaveText('5');
    await overlay.locator('[data-command="tool-keys"]').evaluate((button) => button.click());
    await press('KeyA');
    expect(await pressed('arrow')).toBe('false');
    await escape();
  });

  test('other keys too: minus, the number pad, the space bar; the reserved ones are refused; the panel has an X', async () => {
    const realKey = (keyCode) => app.evaluate(({ BrowserWindow }, value) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('region-overlay.html') && candidate.isVisible());
      win.webContents.focus();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: value });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: value });
    }, keyCode);
    await open();
    await rightClick('blur');
    await realKey('-');
    await expect(rowKey('blur')).toHaveText('-');
    await rightClick('number');
    await press('NumpadSubtract', { key: '-' });
    await expect(rowKey('number')).toHaveText('מספרים -');
    await rightClick('text');
    await realKey('Space');
    await expect(rowKey('text')).toHaveText('רווח');
    await rightClick('move');
    await press('Enter', { key: 'Enter' });
    await expect(overlay.locator('#keys-note')).toContainText('שמור');
    await escape();
    await overlay.locator('[data-command="keys-close"]').evaluate((button) => button.click());
    await expect(overlay.locator('#keys-panel')).toBeHidden();
    await expect(overlay.locator('#toolbar')).toBeVisible();

    await realKey('-');
    expect(await pressed('blur')).toBe('true');
    await press('NumpadSubtract', { key: '-' });
    expect(await pressed('number')).toBe('true');
    await realKey('Space');
    expect(await pressed('text')).toBe('true');
    await expect(overlay.locator('#toolbar')).toBeVisible();
    await escape();
  });

  test('the "+" panel adds a tool to the toolbar; the new marks draw, with the chosen thickness', async () => {
    const drag = (x1, y1, x2, y2) => overlay.evaluate(([a, b, c, d]) => {
      const fire = (type, x, y, buttons) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, pointerId: 1 }));
      fire('pointerdown', a, b, 1); fire('pointermove', (a + c) / 2, (b + d) / 2, 1); fire('pointermove', c, d, 1); fire('pointerup', c, d, 0);
    }, [x1, y1, x2, y2]);
    const active = () => overlay.evaluate(() => [document.documentElement.dataset.activeShape, document.documentElement.dataset.activeWidth]);
    await open();
    await expect(overlay.locator('button[data-tool="ellipse"]')).toBeHidden();
    await overlay.locator('[data-command="tool-keys"]').evaluate((button) => button.click());
    await overlay.locator('[data-show-tool="ellipse"]').evaluate((button) => button.click());
    await expect(overlay.locator('button[data-tool="ellipse"]')).toBeVisible();
    await expect(overlay.locator('[data-show-tool="move"]')).toBeDisabled();
    await overlay.locator('[data-width="thick"]').evaluate((button) => button.click());
    await overlay.locator('[data-command="keys-close"]').evaluate((button) => button.click());
    await overlay.locator('button[data-tool="ellipse"]').evaluate((button) => button.click());
    await drag(300, 250, 420, 330);
    expect(await active()).toEqual(['ellipse', '7']);
    // A tool not on the toolbar still works by its key.
    await press('KeyL');
    expect(await pressed('line')).toBe('true');
    await drag(300, 400, 600, 420);
    expect(await active()).toEqual(['line', '7']);
    await press('KeyD');
    await drag(320, 450, 620, 450);
    expect((await active())[0]).toBe('darrow');
    await press('KeyH');
    await drag(330, 260, 520, 290);
    expect((await active())[0]).toBe('highlight');
    await escape();
    await escape();
    // Kept for the next capture.
    await open();
    await expect(overlay.locator('button[data-tool="ellipse"]')).toBeVisible();
    await overlay.locator('[data-command="tool-keys"]').evaluate((button) => button.click());
    await overlay.locator('[data-show-tool="ellipse"]').evaluate((button) => button.click());
    await overlay.locator('[data-width="medium"]').evaluate((button) => button.click());
    await expect(overlay.locator('button[data-tool="ellipse"]')).toBeHidden();
    await escape();
    await escape();
  });

  test('the smart pen straightens a hand-drawn circle and line; the arrows move the chosen mark', async () => {
    const stroke = (points) => overlay.evaluate((pts) => {
      const fire = (type, p, buttons) => window.dispatchEvent(new PointerEvent(type, { clientX: p[0], clientY: p[1], button: 0, buttons, bubbles: true, pointerId: 1 }));
      fire('pointerdown', pts[0], 1);
      for (const p of pts.slice(1)) fire('pointermove', p, 1);
      fire('pointerup', pts[pts.length - 1], 0);
    }, points);
    const circle = Array.from({ length: 50 }, (_, i) => { const t = i / 48 * Math.PI * 2; return [450 + 80 * Math.cos(t) + Math.sin(i) * 2, 330 + 78 * Math.sin(t)]; });
    await open();
    await expect(overlay.locator('button[data-tool="smartpen"]')).toBeVisible();
    await overlay.locator('button[data-tool="smartpen"]').evaluate((b) => b.click());
    await stroke(circle);
    await expect.poll(() => overlay.evaluate(() => document.documentElement.dataset.lastSmartShape)).toBe('ellipse');
    expect(await overlay.evaluate(() => document.documentElement.dataset.activeShape)).toBe('ellipse');
    // מסגרת הסימון שנבחר נכתבת בציור הבא של המסך – מחכים לה
    await expect.poll(() => overlay.evaluate(() => document.documentElement.dataset.activeBounds || '')).not.toBe('');
    const before = await overlay.evaluate(() => document.documentElement.dataset.activeBounds.split(',').map(Number));
    // החיצים: שלוש לחיצות עם שיפט (30 נקודות ימינה) ושתיים למטה
    for (let i = 0; i < 3; i += 1) await press('ArrowRight', { key: 'ArrowRight', shiftKey: true });
    for (let i = 0; i < 2; i += 1) await press('ArrowDown', { key: 'ArrowDown' });
    const after = await overlay.evaluate(() => document.documentElement.dataset.activeBounds.split(',').map(Number));
    expect(after[0] - before[0]).toBe(30);
    expect(after[1] - before[1]).toBe(2);
    // ביטול אחד מחזיר את כל ההזזה
    await press('KeyZ', { key: 'z', ctrlKey: true });
    // קו ישר ביד הופך לקו
    await stroke(Array.from({ length: 30 }, (_, i) => [300 + i * 10, 420 + Math.sin(i) * 2]));
    await expect.poll(() => overlay.evaluate(() => document.documentElement.dataset.lastSmartShape)).toBe('line');
    // קו עם ראש חץ שצויר ביד הופך לחץ
    // (בתוך האזור שנבחר: מ-200,200 עד 800,500 – מחוצה לו הנקודות נעצרות בקצה)
    const shaft = Array.from({ length: 26 }, (_, i) => [220 + i * 12, 250 + Math.sin(i) * 2]);
    const head = [[515, 236], [500, 224], [515, 236], [520, 250], [504, 266]];
    await stroke([...shaft, ...head]);
    await expect.poll(() => overlay.evaluate(() => document.documentElement.dataset.lastSmartShape)).toBe('arrow');
    expect(await overlay.evaluate(() => document.documentElement.dataset.activeShape)).toBe('arrow');
    // וי (✓) הופך לסימן וי נקי
    const tick = [...Array.from({ length: 8 }, (_, i) => [620 + i * 5, 330 + i * 6]), ...Array.from({ length: 16 }, (_, i) => [660 + i * 7, 372 - i * 8])];
    await stroke(tick);
    await expect.poll(() => overlay.evaluate(() => document.documentElement.dataset.lastSmartShape)).toBe('check');
    await escape();
    await escape();
  });

  test('the choice is kept for the next capture, and the usual keys come back on request', async () => {
    await open();
    await press('KeyQ');
    expect(await pressed('rect')).toBe('true');
    await press('Digit5');
    expect(await pressed('pen')).toBe('true');
    await overlay.locator('[data-command="tool-keys"]').evaluate((button) => button.click());
    await overlay.locator('[data-command="keys-reset"]').evaluate((button) => button.click());
    await expect(rowKey('rect')).toHaveText('R');
    await expect(rowKey('arrow')).toHaveText('A');
    await escape();
    await press('KeyA');
    expect(await pressed('arrow')).toBe('true');
    await escape();
    expect(runtimeErrors).toEqual([]);
  });
});
