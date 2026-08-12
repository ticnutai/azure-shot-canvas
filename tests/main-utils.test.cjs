const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureFilePath, developerShortcut, fileStamp, qualityPreset, safeExtension } = require('../src/main-utils.cjs');

test('fileStamp creates a stable filesystem-safe timestamp', () => {
  assert.equal(fileStamp(new Date(2026, 7, 11, 9, 5, 3, 42)), '2026-08-11_09-05-03-042');
});

test('captureFilePath uses Hebrew labels and approved extension', () => {
  assert.equal(captureFilePath('C:\\Videos', 'screenshot', '.png', new Date(2026, 0, 2, 3, 4, 5, 6)), path.join('C:\\Videos', 'צילום_2026-01-02_03-04-05-006.png'));
});

test('unsafe extensions are rejected', () => {
  assert.throws(() => safeExtension('exe'), /Unsupported/);
});

test('quality presets preserve text sharpness and motion smoothness', () => {
  assert.equal(qualityPreset('text').fps, 15);
  assert.equal(qualityPreset('motion').fps, 60);
  assert.equal(qualityPreset('missing').fps, 30);
});

test('Electron developer shortcuts are recognized explicitly', () => {
  assert.equal(developerShortcut({ type: 'keyDown', control: true, shift: true, key: 'R' }), 'hard-reload');
  assert.equal(developerShortcut({ type: 'keyDown', control: true, shift: true, key: 'I' }), 'toggle-devtools');
  assert.equal(developerShortcut({ type: 'keyDown', control: true, shift: true, key: 'ר', code: 'KeyR' }), 'hard-reload');
  assert.equal(developerShortcut({ type: 'keyDown', control: true, shift: true, key: 'ן', code: 'KeyI' }), 'toggle-devtools');
  assert.equal(developerShortcut({ type: 'keyDown', control: true, shift: true, key: 'Unidentified', code: 'KeyR' }), 'hard-reload');
  assert.equal(developerShortcut({ type: 'keyDown', control: true, shift: true, key: 'Unidentified', code: 'KeyI' }), 'toggle-devtools');
  assert.equal(developerShortcut({ type: 'keyDown', key: 'F12' }), 'toggle-devtools');
  assert.equal(developerShortcut({ type: 'keyUp', control: true, shift: true, key: 'R' }), null);
});
