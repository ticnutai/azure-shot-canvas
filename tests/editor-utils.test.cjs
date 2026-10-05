const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertEditableImagePath, dataUrlBytes, editedCopyPath, imageMimeType, projectPathFor } = require('../src/editor-utils.cjs');

test('editor accepts only images directly inside the local library', () => {
  const library = path.resolve('C:\\Videos\\Aurum');
  assert.equal(assertEditableImagePath(path.join(library, 'צילום.png'), library), path.join(library, 'צילום.png'));
  assert.throws(() => assertEditableImagePath(path.join(library, 'child', 'צילום.png'), library), /ספרייה/);
  assert.equal(assertEditableImagePath(path.join(library, 'צילום.jpg'), library), path.join(library, 'צילום.jpg'));
  assert.throws(() => assertEditableImagePath(path.join(library, 'וידאו.mp4'), library), /PNG/);
  assert.throws(() => assertEditableImagePath(path.join(library, 'מסמך.pdf'), library), /PNG/);
});

test('editor project and copy names are stable and collision safe', () => {
  const image = path.resolve('C:\\Videos\\Aurum\\צילום.png');
  assert.equal(projectPathFor(image), image.replace(/\.png$/, '.aurum.json'));
  const first = editedCopyPath(image, () => false);
  assert.match(first, /צילום — ערוך\.png$/);
  const second = editedCopyPath(image, (candidate) => candidate === first);
  assert.match(second, /צילום — ערוך 2\.png$/);
});

test('PNG data URLs decode and reject arbitrary input', () => {
  assert.deepEqual(dataUrlBytes('data:image/png;base64,aGVsbG8='), Buffer.from('hello'));
  assert.throws(() => dataUrlBytes('data:text/html;base64,AAA='), /אינם תקינים/);
});

test('project file never shares the image path, for every image format', () => {
  for (const name of ['a.png', 'b.jpg', 'c.webp', 'd.PNG']) {
    const image = path.resolve('C:\\Videos', name);
    assert.notEqual(projectPathFor(image), image);
    assert.match(projectPathFor(image), /\.aurum\.json$/);
  }
  assert.equal(imageMimeType('x.jpg'), 'image/jpeg');
  assert.equal(imageMimeType('x.webp'), 'image/webp');
  assert.equal(imageMimeType('x.png'), 'image/png');
});
