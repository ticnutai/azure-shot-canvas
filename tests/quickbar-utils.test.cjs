const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_QUICKBAR_PREFERENCES, normalizeQuickbarPreferences, quickbarBounds, shouldHideMainWindowOnClose } = require('../src/quickbar-utils.cjs');

test('quickbar preferences reject unknown values and unpin when disabled', () => {
  const normalized = normalizeQuickbarPreferences({ enabled: true, edge: 'left', activation: 'hover', display: 'primary', pinned: true });
  assert.deepEqual(normalized, { enabled: true, edge: 'left', activation: 'hover', display: 'primary', pinned: true });
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
