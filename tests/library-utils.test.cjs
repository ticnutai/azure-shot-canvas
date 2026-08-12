const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { renamedLibraryPath, safeLibraryBaseName } = require('../src/library-utils.cjs');

test('library names remove Windows-reserved characters and preserve readable text', () => {
  assert.equal(safeLibraryBaseName('  מצגת: לקוח / גרסה 2  '), 'מצגת לקוח גרסה 2');
});

test('library rename preserves extension and rejects paths outside output', () => {
  const directory = path.resolve('C:/capture-output');
  assert.equal(renamedLibraryPath(path.join(directory, 'old.mp4'), directory, 'שם חדש'), path.join(directory, 'שם חדש.mp4'));
  assert.throws(() => renamedLibraryPath('C:/outside/old.mp4', directory, 'חדש'), /אינו נמצא/);
});
