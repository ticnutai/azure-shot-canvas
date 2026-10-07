const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTION_DEFINITIONS, DEFAULT_SHORTCUTS, acceleratorForBinding, actionForInput, bindingFromInput,
  bindingSignature, inputMatchesBinding, normalizeBinding, normalizeShortcutMap,
  reservedShortcutConflicts, shortcutConflicts
} = require('../src/shortcut-utils.cjs');

test('physical shortcut codes are independent of English and Hebrew key values', () => {
  for (const key of ['2', 'Unidentified']) assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'Digit2' }), 'record');
  for (const key of ['5', '%', 'Unidentified']) assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'Digit5' }), 'pause');
  for (const key of ['6', '^', 'Unidentified']) assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'Digit6' }), 'microphone');
  for (const key of ['M', 'צ']) assert.equal(actionForInput({ type: 'keyDown', control: true, shift: true, key, code: 'KeyM' }), null);
});

test('legacy shortcut strings migrate to structured trigger bindings', () => {
  assert.deepEqual(normalizeBinding('Ctrl+Shift+KeyC'), { kind: 'chord', code: 'KeyC', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 });
  assert.equal(normalizeShortcutMap({ camera: 'Ctrl+Alt+KeyC' }).camera.modifiers.join('+'), 'Ctrl+Alt');
});

test('catalog exposes recording capture audio camera library and window actions', () => {
  assert.equal(Object.keys(ACTION_DEFINITIONS).length, 19);
  assert.deepEqual(new Set(Object.values(ACTION_DEFINITIONS).map((item) => item.category)), new Set(['recording', 'capture', 'audio', 'camera', 'library', 'window']));
  assert.equal(Object.keys(DEFAULT_SHORTCUTS).length, 19);
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

test('default system-wide shortcuts never take over keys that popular programs rely on', () => {
  const { COMMON_APP_SHORTCUTS, commonAppConflict } = require('../src/shortcut-utils.cjs');
  for (const [action, binding] of Object.entries(DEFAULT_SHORTCUTS)) if (binding) assert.equal(commonAppConflict(binding), '', action);
  assert.match(commonAppConflict({ kind: 'chord', code: 'KeyC', modifiers: ['Ctrl', 'Shift'] }), /חלון הפקודות/);
  assert.ok(Object.keys(COMMON_APP_SHORTCUTS).length >= 8);
});

test('the backslash key (as in other capture tools) can be a single global key on every keyboard layout', () => {
  const binding = normalizeBinding({ kind: 'single', code: 'Backslash', scope: 'global' });
  assert.deepEqual(binding, { kind: 'single', code: 'Backslash', modifiers: [], scope: 'global', intervalMs: 300 });
  assert.equal(acceleratorForBinding(binding), '\\');
  assert.equal(acceleratorForBinding({ kind: 'chord', code: 'Slash', modifiers: ['Ctrl', 'Shift'] }), 'CommandOrControl+Shift+/');
  assert.equal(normalizeBinding({ kind: 'chord', code: 'Backslash', modifiers: [] }), null);
  for (const key of ['\\', 'Unidentified']) assert.equal(inputMatchesBinding({ type: 'keyDown', key, code: 'Backslash' }, binding), true);
  assert.equal(inputMatchesBinding({ type: 'keyDown', key: '\\', code: 'Backslash', control: true }, binding), false);
  assert.equal(actionForInput({ type: 'keyDown', key: '\\', code: 'Backslash' }, { region: binding }), 'region');
});

test('a default key held by another program moves to its first free fallback; a key the user chose never moves', () => {
  const { registerWithFallbacks } = require('../src/shortcut-utils.cjs');
  const held = new Set(['Shift|PrintScreen|global', 'Ctrl|PrintScreen|global']);
  const tryRegister = (_action, binding) => !held.has(bindingSignature(binding));
  const outcome = registerWithFallbacks(DEFAULT_SHORTCUTS, tryRegister);
  assert.equal(outcome.registration.region, true);
  assert.equal(outcome.shortcuts.region.code, 'PrintScreen');
  assert.deepEqual(outcome.shortcuts.repeatRegion.modifiers, ['Ctrl', 'Alt']);
  assert.deepEqual(outcome.shortcuts.ocrRegion.modifiers, ['Alt', 'Shift']);
  assert.deepEqual(Object.keys(outcome.fallbacks).sort(), ['ocrRegion', 'repeatRegion']);
  assert.equal(outcome.registration.repeatRegion, true);
  // Nothing free: stays as asked, reported as not registered.
  const none = registerWithFallbacks(DEFAULT_SHORTCUTS, (action) => action !== 'ocrRegion');
  assert.equal(none.registration.ocrRegion, false);
  assert.equal(none.fallbacks.ocrRegion, undefined);
  // A custom key is reported, never replaced.
  const custom = { ...DEFAULT_SHORTCUTS, repeatRegion: { kind: 'chord', code: 'F7', modifiers: ['Ctrl'], scope: 'global' } };
  const kept = registerWithFallbacks(custom, (action) => action !== 'repeatRegion');
  assert.equal(kept.shortcuts.repeatRegion.code, 'F7');
  assert.equal(kept.registration.repeatRegion, false);
  // Two defaults never land on the same fallback.
  const both = registerWithFallbacks(DEFAULT_SHORTCUTS, (_action, binding) => binding.code !== 'PrintScreen' || bindingSignature(binding) === 'Ctrl+Alt|PrintScreen|global');
  assert.notEqual(bindingSignature(both.shortcuts.region), bindingSignature(both.shortcuts.repeatRegion));
});

test('keys saved by an earlier version holding its old defaults move to PrtSc; chosen keys stay', () => {
  const { upgradePreviousDefaults } = require('../src/shortcut-utils.cjs');
  const saved = {
    region: { kind: 'chord', code: 'Digit3', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 },
    repeatRegion: { kind: 'chord', code: 'Digit9', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 },
    record: { kind: 'chord', code: 'Digit2', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 }
  };
  const upgraded = normalizeShortcutMap(upgradePreviousDefaults(saved));
  assert.equal(upgraded.region.code, 'PrintScreen');
  assert.equal(upgraded.repeatRegion.code, 'Digit9');
  assert.equal(upgraded.record.code, 'Digit2');
});
