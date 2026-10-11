const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The image editor fills the screen in every layout, and its tool bar can sit on any side, show chosen tools in any
// order, fold similar tools into one button and change its icon look — each tool shown in one place only.
//   1  the editor meets the studio menu exactly, in every layout, and stays inside the window
//   2  the picture uses the whole work area
//   3  the bar on each of the four sides; top and bottom lie across
//   4  grouping: one button per group, each tool in exactly one place, the flyout shows the group, the choice sticks
//   5  hidden tools and the order survive a reload; the selection tool can never be hidden
//   6  icon looks and colours
//   7  focus on the picture (F) folds both side panels and brings them back
//   8  the tool-view window: each choice has exactly one control, and it opens away from the bar
test.describe.serial('image editor tool bar and full-screen layout', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  let imagePath;

  test.beforeAll(async () => {
    ({ app, page, outputDir, runtimeErrors } = await launchStudio('editor-toolbar'));
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const context = canvas.getContext('2d');
      context.fillStyle = '#3a7bd5';
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    });
    imagePath = path.join(outputDir, 'editor-toolbar-fixture.png');
    await fs.writeFile(imagePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  });
  test.afterAll(async () => closeStudio(app));

  const shell = () => page.locator('#image-editor-shell');
  const openEditor = async () => {
    await page.evaluate((file) => window.aurumEditor.open(file, 'professional'), imagePath);
    await expect(shell()).toHaveAttribute('data-editor-ready', 'true');
  };
  const boxes = (selectors) => page.evaluate((list) => Object.fromEntries(list.map((selector) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return [selector, box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height } : null];
  })), selectors);
  const setBar = (patch) => page.evaluate((value) => window.aurumEditorToolbar.set(value), patch);

  test('1 · the editor meets the studio menu exactly, in every layout, and stays inside the window', async () => {
    test.setTimeout(120_000);
    await openEditor();
    const ids = ['lemaan', 'acrobat', 'finereader', 'classic', 'apple', 'office', 'modern', 'ribbon', 'fluent', 'studio', 'islands', 'canvas'];
    const problems = [];
    for (const id of ids) {
      await page.evaluate((layout) => window.aurumAppearance.applyLayout(layout), id);
      await page.waitForTimeout(250);
      const result = await page.evaluate(() => {
        const menu = document.querySelector('.sidebar').getBoundingClientRect();
        const editor = document.querySelector('#image-editor-shell').getBoundingClientRect();
        const width = document.documentElement.clientWidth;
        const height = window.innerHeight;
        const upright = menu.height >= menu.width;
        const gap = upright ? (menu.left > width / 2 ? menu.left - editor.right : editor.left - menu.right) : editor.top - menu.bottom;
        const overlap = !(editor.right <= menu.left + 1 || editor.left >= menu.right - 1 || editor.bottom <= menu.top + 1 || editor.top >= menu.bottom - 1);
        return { gap: Math.round(gap), overlap, inside: editor.left >= -1 && editor.top >= -1 && editor.right <= width + 1 && editor.bottom <= height + 1 };
      });
      if (Math.abs(result.gap) > 1 || result.overlap || !result.inside) problems.push({ id, ...result });
    }
    expect(problems).toEqual([]);
    await page.evaluate(() => window.aurumAppearance.applyLayout('lemaan'));
  });

  test('2 · the picture uses the whole work area', async () => {
    await page.waitForTimeout(300);
    const box = await boxes(['#editor-workspace', '#editor-canvas-wrap']);
    const work = box['#editor-workspace'];
    const picture = box['#editor-canvas-wrap'];
    // 12 px padding on each side and a 1 px frame: the picture reaches the edge on its limiting side.
    const widthUse = picture.width / (work.width - 26);
    const heightUse = picture.height / (work.height - 26);
    expect(Math.max(widthUse, heightUse)).toBeGreaterThan(0.97);
  });

  test('3 · the bar on each of the four sides; top and bottom lie across', async () => {
    const check = async (position) => {
      await setBar({ position });
      await page.waitForTimeout(150);
      const box = await boxes(['.editor-tools', '#editor-workspace']);
      return { bar: box['.editor-tools'], work: box['#editor-workspace'], orientation: await page.locator('.editor-tools').getAttribute('aria-orientation') };
    };
    let result = await check('left');
    expect(result.bar.right).toBeLessThanOrEqual(result.work.left + 1);
    expect(result.orientation).toBe('vertical');
    result = await check('right');
    expect(result.bar.left).toBeGreaterThanOrEqual(result.work.right - 1);
    result = await check('top');
    expect(result.bar.bottom).toBeLessThanOrEqual(result.work.top + 1);
    expect(result.bar.width).toBeGreaterThan(result.bar.height);
    expect(result.orientation).toBe('horizontal');
    result = await check('bottom');
    expect(result.bar.top).toBeGreaterThanOrEqual(result.work.bottom - 1);
    await setBar({ position: 'left' });
  });

  test('4 · grouping: one button per group, each tool in exactly one place; the flyout shows the group; the choice sticks', async () => {
    await setBar({ grouped: true });
    const census = await page.evaluate(() => {
      const bar = document.querySelector('.editor-tools');
      const ids = [...bar.querySelectorAll('[data-editor-tool], [data-toolbar-item]')].map((button) => button.dataset.editorTool || button.dataset.toolbarItem);
      const shown = [...bar.querySelectorAll('[data-editor-tool], [data-toolbar-item]')].filter((button) => button.offsetParent !== null).length;
      return { ids, unique: new Set(ids).size, slots: bar.querySelectorAll(':scope > .tool-group, :scope > button').length, shown, total: document.querySelectorAll('[data-editor-tool]').length };
    });
    expect(census.unique).toBe(census.ids.length);
    expect(census.total).toBe(19);
    expect(census.slots).toBe(8);
    expect(census.shown).toBe(8);
    await page.locator('.tool-group[data-group="shapes"] .group-more').click();
    const flyout = page.locator('.tool-group.open .group-members > button');
    await expect(flyout).toHaveCount(3);
    await page.locator('.tool-group.open [data-editor-tool="ellipse"]').click();
    await expect(page.locator('.tool-group.open')).toHaveCount(0);
    await expect(page.locator('.tool-group[data-group="shapes"] .group-current')).toHaveAttribute('data-editor-tool', 'ellipse');
    expect(await page.evaluate(() => window.aurumEditor.stats().tool)).toBe('ellipse');
    // Keyboard keys reach folded tools too, and the group shows the tool chosen by key.
    await page.keyboard.press('KeyL');
    await expect(page.locator('.tool-group[data-group="lines"] .group-current')).toHaveAttribute('data-editor-tool', 'line');
    await setBar({ grouped: false });
    const separate = await page.evaluate(() => [...document.querySelectorAll('.editor-tools [data-editor-tool], .editor-tools [data-toolbar-item]')].filter((button) => button.offsetParent !== null).map((button) => button.dataset.editorTool || button.dataset.toolbarItem));
    expect(new Set(separate).size).toBe(separate.length);
    expect(separate.length).toBeGreaterThanOrEqual(19);
  });

  test('5 · hidden tools and the order survive a reload; the selection tool can never be hidden', async () => {
    await page.evaluate(() => {
      const bar = window.AurumEditorToolbar;
      let prefs = window.aurumEditorToolbar.preferences();
      prefs = bar.place(prefs, 'text', 'select');
      window.aurumEditorToolbar.set({ order: prefs.order, hidden: ['pen', 'select'], grouped: false });
    });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await openEditor();
    const state = await page.evaluate(() => ({
      prefs: window.aurumEditorToolbar.preferences(),
      first: document.querySelector('.editor-tools > button')?.dataset.editorTool,
      penShown: document.querySelector('[data-editor-tool="pen"]').offsetParent !== null,
      selectShown: document.querySelector('[data-editor-tool="select"]').offsetParent !== null
    }));
    expect(state.prefs.hidden).toEqual(['pen']);
    expect(state.first).toBe('text');
    expect(state.penShown).toBe(false);
    expect(state.selectShown).toBe(true);
    await page.evaluate(() => window.aurumEditorToolbar.reset());
  });

  test('6 · icon looks and colours', async () => {
    const look = (selector) => page.evaluate((target) => {
      const span = document.querySelector(target);
      const style = getComputedStyle(span);
      return { background: style.backgroundColor, color: getComputedStyle(span.closest('button')).color };
    }, selector);
    await setBar({ iconStyle: 'solid', iconColor: 'groups', grouped: false });
    const arrow = await look('[data-editor-tool="arrow"] span');
    const rect = await look('[data-editor-tool="rect"] span');
    expect(arrow.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(arrow.background).not.toBe(rect.background);
    await setBar({ iconStyle: 'tiles', iconColor: 'custom', customColor: '#ff0000' });
    expect((await look('[data-editor-tool="arrow"] span')).color).toBe('rgb(255, 0, 0)');
    await setBar({ iconStyle: 'line', iconColor: 'muted' });
    expect((await look('[data-editor-tool="arrow"] span')).background).toBe('rgba(0, 0, 0, 0)');
    await setBar({ labels: false });
    await expect(page.locator('[data-editor-tool="arrow"] small')).toBeHidden();
    await setBar({ labels: true, size: 'large' });
    const large = (await boxes(['[data-editor-tool="arrow"]']))['[data-editor-tool="arrow"]'];
    await setBar({ size: 'small' });
    const small = (await boxes(['[data-editor-tool="arrow"]']))['[data-editor-tool="arrow"]'];
    expect(large.height).toBeGreaterThan(small.height);
    await page.evaluate(() => window.aurumEditorToolbar.reset());
  });

  test('7 · focus on the picture (F) folds both side panels and brings them back', async () => {
    await page.waitForTimeout(200);
    const before = (await boxes(['#editor-canvas-wrap']))['#editor-canvas-wrap'];
    await page.locator('#editor-workspace').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('KeyF');
    await expect(shell()).toHaveAttribute('data-focus', 'true');
    await expect(page.locator('.editor-tools')).toBeHidden();
    await expect(page.locator('.editor-properties')).toBeHidden();
    await expect.poll(async () => (await boxes(['#editor-canvas-wrap']))['#editor-canvas-wrap'].width).toBeGreaterThan(before.width);
    await page.locator('#editor-focus').click();
    await expect(page.locator('.editor-tools')).toBeVisible();
    await expect(page.locator('.editor-properties')).toBeVisible();
  });

  test('8 · the tool-view window: each choice has exactly one control, and it opens away from the bar', async () => {
    await page.locator('#editor-view-settings').click();
    const panel = page.locator('#editor-view-panel');
    await expect(panel).toBeVisible();
    const controls = await panel.evaluate((node) => ({
      choices: [...node.querySelectorAll('[data-view-choice]')].map((item) => item.dataset.viewChoice),
      toggles: [...node.querySelectorAll('[data-view-toggle]')].map((item) => item.dataset.viewToggle),
      rows: [...node.querySelectorAll('.view-tools li')].map((item) => item.dataset.tool),
      selectLocked: node.querySelector('.view-tools li[data-tool="select"] input').disabled
    }));
    const all = [...controls.choices, ...controls.toggles];
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(controls.rows).size).toBe(controls.rows.length);
    expect(controls.rows.length).toBe(20);
    expect(controls.selectLocked).toBe(true);
    const box = await boxes(['#editor-view-panel', '.editor-tools']);
    expect(box['#editor-view-panel'].left).toBeGreaterThan(box['.editor-tools'].right);
    // Changing the side from the window moves the bar while the window stays open.
    await panel.locator('[data-view-choice="position"] button[data-value="top"]').click();
    await expect(shell()).toHaveAttribute('data-tools-position', 'top');
    await expect(panel).toBeVisible();
    await panel.locator('[data-view-reset]').click();
    await expect(shell()).toHaveAttribute('data-tools-position', 'left');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    expect(runtimeErrors).toEqual([]);
  });
});
