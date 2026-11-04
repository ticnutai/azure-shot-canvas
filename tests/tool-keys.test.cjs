const test = require('node:test');
const assert = require('node:assert/strict');
const { check, defaults, keyLabel, normalize, toolForKey } = require('../src/region-tool-keys.js');

test('nothing saved: the usual keys', () => {
  assert.deepEqual(normalize(null), defaults());
  assert.equal(normalize({}).rect, 'KeyR');
});

test('a saved choice stays, including a tool left without a key', () => {
  const keys = normalize({ rect: 'KeyQ', arrow: '' });
  assert.equal(keys.rect, 'KeyQ');
  assert.equal(keys.arrow, '');
  assert.equal(toolForKey(keys, 'KeyQ'), 'rect');
  assert.equal(toolForKey(keys, 'KeyR'), null);
});

test('an unsound saved value takes the default, and a key claimed twice stays with the first', () => {
  assert.equal(normalize({ rect: 'Enter' }).rect, 'KeyR');
  assert.equal(normalize({ rect: 7 }).rect, 'KeyR');
  const keys = normalize({ arrow: 'KeyQ', rect: 'KeyQ' });
  assert.equal(keys.arrow, 'KeyQ');
  assert.equal(keys.rect, '');
});

test('a key is refused when another tool has it or it cannot be used', () => {
  const keys = defaults();
  assert.equal(check(keys, 'rect', 'KeyQ').ok, true);
  assert.equal(check(keys, 'rect', 'KeyR').ok, true);
  assert.match(check(keys, 'rect', 'KeyA').message, /"חץ"/);
  for (const code of ['Enter', 'NumpadEnter', 'Escape', 'Delete', 'Backspace', 'ShiftLeft', 'ControlRight', 'PrintScreen', 'CapsLock']) assert.equal(check(keys, 'rect', code).ok, false);
  for (const code of ['Digit5', 'F2', 'F12', 'Minus', 'Equal', 'Comma', 'Space', 'Tab', 'ArrowUp', 'Home', 'PageDown', 'Numpad7', 'NumpadSubtract']) assert.equal(check(keys, 'rect', code).ok, true, code);
});

test('keys are shown plainly', () => {
  assert.equal(keyLabel('KeyR'), 'R');
  assert.equal(keyLabel('Digit5'), '5');
  assert.equal(keyLabel('F2'), 'F2');
  assert.equal(keyLabel(''), '');
  assert.equal(keyLabel('Minus'), '-');
  assert.equal(keyLabel('Space'), 'רווח');
  assert.equal(keyLabel('Numpad7'), 'מספרים 7');
  assert.equal(keyLabel('NumpadSubtract'), 'מספרים -');
});

test('a saved key of the new kinds stays, and works', () => {
  const keys = normalize({ rect: 'Minus', pen: 'NumpadAdd' });
  assert.equal(toolForKey(keys, 'Minus'), 'rect');
  assert.equal(toolForKey(keys, 'NumpadAdd'), 'pen');
});
