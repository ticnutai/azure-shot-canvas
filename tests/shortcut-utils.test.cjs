const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SHORTCUTS,
  acceleratorForBinding,
  actionForInput,
  bindingFromInput,
  normalizeBinding,
  reservedShortcutConflicts,
  shortcutConflicts
} = require('../src/shortcut-utils.cjs');

test('physical shortcut codes are independent of English and Hebrew key values', () => {
  for (const key of ['2', 'Unidentified']) {
    assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'Digit2' }), 'record');
  }
  for (const key of ['P', 'פ', 'Unidentified']) {
    assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'KeyP' }), 'pause');
  }
  for (const key of ['M', 'צ', 'Unidentified']) {
    assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'KeyM' }), 'microphone');
  }
});

test('all default shortcuts are unique and valid Electron accelerators', () => {
  assert.deepEqual(shortcutConflicts(DEFAULT_SHORTCUTS), []);
  for (const binding of Object.values(DEFAULT_SHORTCUTS)) {
    assert.ok(normalizeBinding(binding));
    assert.match(acceleratorForBinding(binding), /CommandOrControl\+Shift\+/);
  }
});

test('shortcut input rejects modifier-only and key-up events', () => {
  assert.equal(bindingFromInput({ type: 'keyDown', control: true, code: 'ControlLeft' }), null);
  assert.equal(bindingFromInput({ type: 'keyUp', control: true, code: 'KeyR' }), null);
});

test('shortcut conflicts are reported deterministically', () => {
  const shortcuts = { ...DEFAULT_SHORTCUTS, camera: DEFAULT_SHORTCUTS.record };
  assert.deepEqual(shortcutConflicts(shortcuts), [['record', 'camera', 'Ctrl+Shift+Digit2']]);
});

test('developer shortcuts remain reserved', () => {
  assert.deepEqual(reservedShortcutConflicts({ ...DEFAULT_SHORTCUTS, camera: 'Ctrl+Shift+KeyR' }), [['camera', 'רענון עמוק', 'Ctrl+Shift+KeyR']]);
});
