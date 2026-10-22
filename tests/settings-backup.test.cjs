const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBackup, readBackup } = require('../src/settings-backup.cjs');

test('a backup holds the known files and only the program own browser-storage keys', () => {
  const backup = buildBackup({
    files: { 'quickbar-preferences.json': { edge: 'top' }, 'features.json': { enabled: {} }, 'evil.json': { x: 1 } },
    local: { 'aurum-theme': 'dark', 'other-site': 'x', 'aurum-big': 'y'.repeat(500_000), 'aurum-number': 5 },
    version: '0.18.3'
  });
  assert.equal(backup.format, 'aurum-settings');
  assert.deepEqual(Object.keys(backup.files).sort(), ['features.json', 'quickbar-preferences.json']);
  assert.deepEqual(backup.local, { 'aurum-theme': 'dark' });
  assert.equal(backup.version, '0.18.3');
});

test('reading a backup gives back exactly what was put in', () => {
  const backup = buildBackup({ files: { 'workspace-window.json': { onTop: true } }, local: { 'aurum-capture-delay': '3' } });
  const back = readBackup(JSON.stringify(backup));
  assert.deepEqual(back.files, { 'workspace-window.json': { onTop: true } });
  assert.deepEqual(back.local, { 'aurum-capture-delay': '3' });
});

test('anything that is not a backup of this program is refused with a clear message', () => {
  assert.throws(() => readBackup('not json'), /אינו קובץ גיבוי תקין/);
  assert.throws(() => readBackup('{"format":"something-else"}'), /לא קובץ גיבוי של התוכנה/);
  assert.throws(() => readBackup(JSON.stringify({ format: 'aurum-settings', files: {}, local: {} })), /אין הגדרות/);
  assert.throws(() => readBackup('null'), /לא קובץ גיבוי/);
});

test('a hostile backup cannot write other files or other keys', () => {
  const back = readBackup(JSON.stringify({
    format: 'aurum-settings',
    files: { '../../evil.json': { a: 1 }, 'quickbar-preferences.json': { edge: 'left' }, 'features.json': [1, 2] },
    local: { 'aurum-ok': '1', 'aurum-UPPER': '2', 'other': '3', 'aurum-x/../y': '4', 'aurum-num': 7 }
  }));
  assert.deepEqual(Object.keys(back.files), ['quickbar-preferences.json']);
  assert.deepEqual(back.local, { 'aurum-ok': '1' });
});
