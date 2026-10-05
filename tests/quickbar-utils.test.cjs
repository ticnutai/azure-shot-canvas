const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPTURE_CARD_KEYS, DEFAULT_QUICKBAR_PREFERENCES, addRecentCapture, normalizeQuickbarPreferences, quickbarBounds, shouldHideMainWindowOnClose } = require('../src/quickbar-utils.cjs');

test('quickbar preferences reject unknown values and unpin when disabled', () => {
  const normalized = normalizeQuickbarPreferences({ enabled: true, edge: 'left', activation: 'hover', display: 'primary', pinned: true });
  assert.deepEqual(normalized, { enabled: true, edge: 'left', activation: 'hover', display: 'primary', pinned: true, capturePreview: true, captureTimeout: 6 });
  assert.deepEqual(normalizeQuickbarPreferences({ enabled: false, edge: 'bottom' }, normalized), { ...normalized, enabled: false, pinned: false });
  assert.deepEqual(normalizeQuickbarPreferences({}), DEFAULT_QUICKBAR_PREFERENCES);
});

test('collapsed quickbar handle hugs every supported work-area edge', () => {
  const workArea = { x: -1920, y: 40, width: 1920, height: 1040 };
  assert.deepEqual(quickbarBounds(workArea, { edge: 'left' }, false), { x: -1920, y: 480, width: 11, height: 160 });
  assert.deepEqual(quickbarBounds(workArea, { edge: 'right' }, false), { x: -11, y: 480, width: 11, height: 160 });
  assert.deepEqual(quickbarBounds(workArea, { edge: 'top' }, false), { x: -1003, y: 40, width: 86, height: 11 });
});

test('expanded quickbar stays inside normal and very small work areas', () => {
  for (const workArea of [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 30, y: 50, width: 240, height: 140 }]) {
    for (const edge of ['left', 'right', 'top']) {
      const bounds = quickbarBounds(workArea, { edge }, true);
      assert.ok(bounds.x >= workArea.x && bounds.y >= workArea.y);
      assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
      assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
    }
  }
});

test('closing the main window keeps the quickbar alive only in normal desktop mode', () => {
  const enabled = { enabled: true };
  assert.equal(shouldHideMainWindowOnClose(enabled), true);
  assert.equal(shouldHideMainWindowOnClose(enabled, { qa: true }), false);
  assert.equal(shouldHideMainWindowOnClose(enabled, { headless: true }), false);
  assert.equal(shouldHideMainWindowOnClose(enabled, { quitting: true }), false);
  assert.equal(shouldHideMainWindowOnClose({ enabled: false }), false);
});

test('capture card preferences accept only known timeouts and can be switched off', () => {
  assert.equal(normalizeQuickbarPreferences({ captureTimeout: 10 }).captureTimeout, 10);
  assert.equal(normalizeQuickbarPreferences({ captureTimeout: 0 }).captureTimeout, 0);
  assert.equal(normalizeQuickbarPreferences({ captureTimeout: 7 }).captureTimeout, 6);
  assert.equal(normalizeQuickbarPreferences({ capturePreview: false }).capturePreview, false);
});

test('capture card and recent strip get taller bounds that still fit the work area', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.equal(quickbarBounds(workArea, { edge: 'right' }, true).height, 194);
  assert.equal(quickbarBounds(workArea, { edge: 'right' }, true, { hasRecent: true }).height, 268);
  assert.equal(quickbarBounds(workArea, { edge: 'right' }, true, { view: 'capture' }).height, 382);
  assert.equal(quickbarBounds({ x: 0, y: 0, width: 400, height: 300 }, { edge: 'right' }, true, { view: 'capture' }).height, 300);
});

test('recent captures are newest first, unique per file and capped', () => {
  let list = [];
  for (let index = 0; index < 8; index += 1) list = addRecentCapture(list, { path: `C:\\a\\${index}.png` });
  assert.equal(list.length, 6);
  assert.equal(list[0].path, 'C:\\a\\7.png');
  list = addRecentCapture(list, { path: 'c:\\A\\5.PNG', name: 'again' });
  assert.equal(list.length, 6);
  assert.equal(list[0].name, 'again');
  assert.equal(list.filter((entry) => entry.path.toLowerCase() === 'c:\\a\\5.png').length, 1);
});
test('capture card keys are unique and map only to card actions', () => {
  const accelerators = CAPTURE_CARD_KEYS.map((item) => item.accelerator);
  assert.equal(new Set(accelerators).size, accelerators.length);
  for (const item of CAPTURE_CARD_KEYS) assert.ok(['edit', 'copy', 'pin', 'open-folder', 'trash', 'close'].includes(item.action));
  for (const action of ['edit', 'copy', 'pin', 'open-folder', 'trash', 'close']) assert.ok(CAPTURE_CARD_KEYS.some((item) => item.action === action), action);
});
