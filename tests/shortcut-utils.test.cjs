const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTION_DEFINITIONS, DEFAULT_SHORTCUTS, acceleratorForBinding, actionForInput, bindingFromInput,
  bindingSignature, inputMatchesBinding, normalizeBinding, normalizeShortcutMap,
  reservedShortcutConflicts, shortcutConflicts
} = require('../src/shortcut-utils.cjs');

test('physical shortcut codes are independent of English and Hebrew key values', () => {
  for (const key of ['2', 'Unidentified']) assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'Digit2' }), 'record');
  for (const key of ['P', 'פ', 'Unidentified']) assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'KeyP' }), 'pause');
  for (const key of ['M', 'צ', 'Unidentified']) assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'KeyM' }), 'microphone');
});

test('legacy shortcut strings migrate to structured trigger bindings', () => {
  assert.deepEqual(normalizeBinding('Ctrl+Shift+KeyC'), { kind: 'chord', code: 'KeyC', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 });
  assert.equal(normalizeShortcutMap({ camera: 'Ctrl+Alt+KeyC' }).camera.modifiers.join('+'), 'Ctrl+Alt');
});

test('catalog exposes recording capture audio camera library and window actions', () => {
  assert.equal(Object.keys(ACTION_DEFINITIONS).length, 15);
  assert.deepEqual(new Set(Object.values(ACTION_DEFINITIONS).map((item) => item.category)), new Set(['recording', 'capture', 'audio', 'camera', 'library', 'window']));
  assert.equal(Object.keys(DEFAULT_SHORTCUTS).length, 15);
});

test('single and double press bindings normalize and produce accelerators', () => {
  const single = normalizeBinding({ kind: 'single', code: 'F10', scope: 'global' });
  const double = normalizeBinding({ kind: 'double', code: 'F9', scope: 'global', intervalMs: 320 });
  assert.equal(acceleratorForBinding(single), 'F10');
  assert.equal(acceleratorForBinding(double), 'F9');
  assert.match(bindingSignature(double), /^\|F9\|global$/);
  assert.equal(normalizeBinding({ kind: 'single', code: 'KeyR', scope: 'global' }).scope, 'focused');
});

test('unreliable modifier-only double presses are rejected', () => {
  for (const code of ['ShiftLeft', 'ControlLeft', 'AltLeft', 'MetaLeft']) {
    assert.equal(bindingFromInput({ type: 'keyDown', code }, { kind: 'double', scope: 'focused' }), null);
    assert.equal(normalizeBinding({ kind: 'double', code, scope: 'focused', intervalMs: 500 }), null);
  }
});

test('double press interval is configurable and safely clamped', () => {
  assert.equal(normalizeBinding({ kind: 'double', code: 'F8', scope: 'global', intervalMs: 650 }).intervalMs, 650);
  assert.equal(normalizeBinding({ kind: 'double', code: 'F8', scope: 'global', intervalMs: 900 }).intervalMs, 700);
  assert.equal(normalizeBinding({ kind: 'double', code: 'F8', scope: 'global', intervalMs: 100 }).intervalMs, 180);
});

test('shortcut input rejects modifier-only chord and key-up events', () => {
  assert.equal(bindingFromInput({ type: 'keyDown', control: true, code: 'ControlLeft' }, { kind: 'chord' }), null);
  assert.equal(bindingFromInput({ type: 'keyUp', control: true, code: 'KeyR' }, { kind: 'chord' }), null);
});

test('shortcut conflicts and developer reservations are deterministic', () => {
  const shortcuts = { ...DEFAULT_SHORTCUTS, camera: DEFAULT_SHORTCUTS.record };
  assert.equal(shortcutConflicts(shortcuts)[0][0], 'record');
  assert.equal(shortcutConflicts(shortcuts)[0][1], 'camera');
  const reserved = { ...DEFAULT_SHORTCUTS, camera: { kind: 'chord', code: 'KeyR', modifiers: ['Ctrl', 'Shift'], scope: 'global' } };
  assert.equal(reservedShortcutConflicts(reserved)[0][1], 'רענון עמוק');
});
