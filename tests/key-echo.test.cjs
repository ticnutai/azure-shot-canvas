const test = require('node:test');
const assert = require('node:assert/strict');
const { keyLabel } = require('../src/key-echo.cjs');

test('1 · shortcuts are shown with Hebrew names, modifiers first', () => {
  assert.equal(keyLabel(0x43, 'c'), 'קונטרול + C');
  assert.equal(keyLabel(0x53, 'cs'), 'קונטרול + שיפט + S');
  assert.equal(keyLabel(0x09, 'a'), 'אלט + טאב');
  assert.equal(keyLabel(0x44, 'w'), 'חלונות + D');
  assert.equal(keyLabel(0x5a, 'c'), 'קונטרול + Z');
  assert.equal(keyLabel(0xbb, 'c'), 'קונטרול + =');
});

test('2 · special keys are shown on their own', () => {
  assert.equal(keyLabel(0x0d), 'אנטר');
  assert.equal(keyLabel(0x1b), 'אסקייפ');
  assert.equal(keyLabel(0x74), 'F5');
  assert.equal(keyLabel(0x25), '←');
  assert.equal(keyLabel(0x2e), 'מחיקה');
});

test('3 · plain typing is never shown — not letters, digits, symbols or space, not even with Shift', () => {
  for (const vk of [0x41, 0x5a, 0x30, 0x39, 0xbe, 0x20, 0x61]) {
    assert.equal(keyLabel(vk), null, `key ${vk}`);
    assert.equal(keyLabel(vk, 's'), null, `Shift + key ${vk}`);
  }
});

test('4 · modifier keys alone and unknown codes are not shown', () => {
  for (const vk of [0x10, 0x11, 0x12, 0x5b, 0xa0, 0xa2]) assert.equal(keyLabel(vk, 'c'), null);
  assert.equal(keyLabel(0xff, 'c'), null);
  assert.equal(keyLabel('nonsense', 'c'), null);
});
