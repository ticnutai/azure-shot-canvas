const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPTURE_CARD_KEYS, DEFAULT_QUICKBAR_PREFERENCES, addRecentCapture, normalizeQuickbarPreferences, offsetForPointer, quickbarBounds, shouldHideMainWindowOnClose } = require('../src/quickbar-utils.cjs');

test('quickbar preferences reject unknown values and unpin when disabled', () => {
  const normalized = normalizeQuickbarPreferences({ enabled: true, edge: 'left', activation: 'hover', display: 'primary', pinned: true });
  assert.deepEqual(normalized, { enabled: true, style: 'strip', edge: 'left', offset: 0.5, activation: 'hover', display: 'primary', pinned: true, capturePreview: true, captureTimeout: 6, regionMarkup: true, captureDelay: 0, autoCopy: false, laptopCaptureKey: true });
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

test('the bar is on by default as a slim strip in the top edge, and saves where it was dragged', () => {
  assert.equal(DEFAULT_QUICKBAR_PREFERENCES.enabled, true);
  assert.equal(DEFAULT_QUICKBAR_PREFERENCES.style, 'strip');
  assert.equal(DEFAULT_QUICKBAR_PREFERENCES.edge, 'top');
  assert.equal(normalizeQuickbarPreferences({ style: 'panel' }).style, 'panel');
  assert.equal(normalizeQuickbarPreferences({ style: 'huge' }).style, 'strip');
  assert.equal(normalizeQuickbarPreferences({ offset: 1.7 }).offset, 1);
  assert.equal(normalizeQuickbarPreferences({ offset: -2 }).offset, 0);
  assert.equal(normalizeQuickbarPreferences({ offset: 0.33333 }).offset, 0.333);
  assert.equal(normalizeQuickbarPreferences({ offset: 'x' }).offset, 0.5);
  assert.equal(normalizeQuickbarPreferences({ offset: null }).offset, 0.5);
});

test('strip hugs its edge at the dragged position, grows inward for a menu and never leaves the work area', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const top = quickbarBounds(workArea, { style: 'strip', edge: 'top', offset: 0.5 }, true);
  assert.deepEqual(top, { x: 810, y: 0, width: 300, height: 64 });
  assert.equal(quickbarBounds(workArea, { style: 'strip', edge: 'top', offset: 0.5 }, true, { menu: true }).height, 408);
  assert.equal(quickbarBounds(workArea, { style: 'strip', edge: 'top', offset: 0 }, true).x, 0);
  assert.equal(quickbarBounds(workArea, { style: 'strip', edge: 'top', offset: 1 }, true).x, 1620);
  assert.deepEqual(quickbarBounds(workArea, { style: 'strip', edge: 'top', offset: 0.25 }, false), { x: 437, y: 0, width: 86, height: 11 });
  const right = quickbarBounds(workArea, { style: 'strip', edge: 'right', offset: 0.5 }, true, { menu: true });
  assert.deepEqual(right, { x: 1580, y: 348, width: 340, height: 344 });
  const left = quickbarBounds(workArea, { style: 'strip', edge: 'left', offset: 0.5 }, true);
  assert.deepEqual(left, { x: 0, y: 370, width: 64, height: 300 });
  for (const edge of ['top', 'left', 'right']) for (const offset of [0, 0.5, 1]) for (const view of ['actions', 'capture', 'history']) {
    const small = { x: 30, y: 50, width: 240, height: 140 };
    const bounds = quickbarBounds(small, { style: 'strip', edge, offset }, true, { view, menu: true });
    assert.ok(bounds.x >= small.x && bounds.y >= small.y && bounds.x + bounds.width <= small.x + small.width && bounds.y + bounds.height <= small.y + small.height, `${edge} ${offset} ${view}`);
  }
  assert.deepEqual(quickbarBounds(workArea, { style: 'strip', edge: 'top' }, true, { view: 'history' }), { x: 764, y: 6, width: 392, height: 470 });
});

test('dragging maps the pointer to a 0–1 position along the edge', () => {
  const workArea = { x: 100, y: 40, width: 1000, height: 800 };
  assert.equal(offsetForPointer(workArea, 'top', { x: 600, y: 10 }), 0.5);
  assert.equal(offsetForPointer(workArea, 'top', { x: -50, y: 10 }), 0);
  assert.equal(offsetForPointer(workArea, 'left', { x: 0, y: 840 }), 1);
  assert.equal(offsetForPointer(workArea, 'right', { x: 0, y: 240 }), 0.25);
});
test('region capture options: marks toolbar on, no delay and no automatic copy by default; only known delays', () => {
  assert.equal(DEFAULT_QUICKBAR_PREFERENCES.regionMarkup, true);
  assert.equal(normalizeQuickbarPreferences({ regionMarkup: false }).regionMarkup, false);
  assert.equal(normalizeQuickbarPreferences({ captureDelay: 5 }).captureDelay, 5);
  assert.equal(normalizeQuickbarPreferences({ captureDelay: 7 }).captureDelay, 0);
  assert.equal(normalizeQuickbarPreferences({ autoCopy: true }).autoCopy, true);
});