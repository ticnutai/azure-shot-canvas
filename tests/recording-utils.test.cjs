const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { recordingPaths, recoveryPathFor, storageLevel } = require('../src/recording-utils.cjs');

test('recording recovery paths remain inside the output directory', () => {
  const directory = 'C:\\Videos\\אולפן צילום מסך';
  const paths = recordingPaths(directory, new Date(2026, 7, 12, 10, 11, 12, 13));
  for (const value of Object.values(paths)) assert.equal(path.dirname(value), directory);
  assert.match(paths.partialPath, /\.partial\.webm$/);
  assert.match(recoveryPathFor(paths.partialPath), /_שוחזרה\.webm$/);
});

test('storage levels use stable safety thresholds', () => {
  assert.equal(storageLevel(512 * 1024 ** 2), 'critical');
  assert.equal(storageLevel(3 * 1024 ** 3), 'warning');
  assert.equal(storageLevel(20 * 1024 ** 3), 'healthy');
  assert.equal(storageLevel(Number.NaN), 'unknown');
});
