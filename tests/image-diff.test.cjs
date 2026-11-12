const test = require('node:test');
const assert = require('node:assert/strict');
const { compareBitmaps } = require('../src/image-diff.cjs');

const picture = (width, height, paint = () => {}) => {
  const data = Buffer.alloc(width * height * 4, 255);
  const fill = (x0, y0, w, h, [b, g, r]) => { for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) { const at = (y * width + x) * 4; data[at] = b; data[at + 1] = g; data[at + 2] = r; } };
  paint(fill);
  return data;
};

test('two changed places are found and framed; the same picture has no difference', () => {
  const before = picture(400, 300);
  const after = picture(400, 300, (fill) => { fill(40, 50, 60, 30, [0, 0, 0]); fill(300, 220, 50, 40, [200, 30, 30]); });
  const result = compareBitmaps(before, after, 400, 300);
  assert.equal(result.frames.length, 2);
  const [first, second] = result.frames;
  assert.ok(first.x <= 40 && first.y <= 50 && first.x + first.width >= 100 && first.y + first.height >= 80);
  assert.ok(second.x <= 300 && second.x + second.width >= 350);
  assert.ok(result.changedShare > 0.02 && result.changedShare < 0.2);
  // Side by side with a gap; a frame line is red on both halves (blue-green-red order), the rest is dimmed.
  assert.equal(result.width, 816);
  const pixel = (x, y) => [...result.bitmap.subarray((y * result.width + x) * 4, (y * result.width + x) * 4 + 3)];
  assert.deepEqual(pixel(first.x, first.y), [60, 45, 235]);
  assert.deepEqual(pixel(first.x + 416, first.y), [60, 45, 235]);
  assert.deepEqual(pixel(70, 65), [255, 255, 255], 'before: the place was white');
  assert.deepEqual(pixel(70 + 416, 65), [0, 0, 0], 'after: the place is black, shown as it is');
  assert.deepEqual(compareBitmaps(before, before, 400, 300).frames, []);
});

test('one stray pixel is not a change; thin dark text on a plain ground is', () => {
  const before = picture(200, 100);
  const stray = picture(200, 100, (fill) => fill(100, 50, 1, 1, [0, 0, 0]));
  assert.equal(compareBitmaps(before, stray, 200, 100).frames.length, 0);
  const text = picture(200, 100, (fill) => { for (let x = 20; x < 120; x += 6) fill(x, 40, 1, 10, [0, 0, 0]); });
  assert.equal(compareBitmaps(before, text, 200, 100).frames.length, 1);
});

test('changes that touch are joined into one frame', () => {
  const before = picture(300, 200);
  const after = picture(300, 200, (fill) => { fill(50, 50, 40, 40, [0, 0, 0]); fill(92, 60, 40, 40, [0, 0, 0]); });
  assert.equal(compareBitmaps(before, after, 300, 200).frames.length, 1);
});
