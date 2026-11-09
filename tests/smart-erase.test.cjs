const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, erase, growMask, rectMask, toHex, METHOD_NAMES } = require('../src/smart-erase.js');

// A picture as plain pixels, painted by a function of (x, y) → [r, g, b].
function picture(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set([...paint(x, y), 255], (y * width + x) * 4);
  return { width, height, data };
}
const at = (image, x, y) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
const close = (a, b, tolerance) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
const WHITE = [246, 247, 249];

test('a word on a plain background: found as plain, erased to exactly that colour, nothing outside touched', () => {
  const image = picture(120, 60, (x, y) => (x >= 40 && x < 80 && y >= 20 && y < 34 && (x + y) % 3 ? [20, 20, 20] : WHITE));
  const before = at(image, 10, 10);
  const mask = rectMask(120, 60, { x: 38, y: 18, width: 44, height: 18 });
  const done = erase(image, mask);
  assert.equal(done.method, 'solid');
  assert.equal(done.hex, toHex(WHITE));
  for (let y = 18; y < 36; y += 1) for (let x = 38; x < 82; x += 1) assert.deepEqual(at(image, x, y), WHITE);
  assert.deepEqual(at(image, 10, 10), before);
});

test('a frame line crossing the place goes on through it; a gradient stays a gradient', () => {
  // A white panel with a grey line at y = 30 and a blue band below it.
  const image = picture(100, 60, (x, y) => (y === 30 ? [150, 150, 150] : y > 40 ? [40, 90, 200] : WHITE));
  const mask = rectMask(100, 60, { x: 40, y: 24, width: 20, height: 24 });
  const done = erase(image, mask);
  assert.equal(done.method, 'lines');
  assert.ok(close(at(image, 50, 30), [150, 150, 150], 40), `line: ${at(image, 50, 30)}`);
  assert.ok(close(at(image, 50, 26), WHITE, 30), `above: ${at(image, 50, 26)}`);
  assert.ok(close(at(image, 50, 46), [40, 90, 200], 30), `below: ${at(image, 50, 46)}`);

  const ramp = picture(100, 40, (x) => [x * 2, 100, 255 - x * 2]);
  const done2 = erase(ramp, rectMask(100, 40, { x: 40, y: 10, width: 20, height: 20 }), { method: 'lines' });
  assert.equal(done2.method, 'lines');
  assert.ok(close(at(ramp, 50, 20), [100, 100, 155], 6), `gradient: ${at(ramp, 50, 20)}`);
});

test('a busy photo-like background is filled smoothly from its surroundings, with no hole and no wild colour', () => {
  const image = picture(80, 80, (x, y) => [128 + Math.round(60 * Math.sin(x / 3)), 128 + Math.round(60 * Math.cos(y / 4)), (x * 7 + y * 13) % 256]);
  const mask = rectMask(80, 80, { x: 30, y: 30, width: 16, height: 16 });
  for (let y = 30; y < 46; y += 1) for (let x = 30; x < 46; x += 1) image.data.set([255, 0, 255, 255], (y * 80 + x) * 4);
  const found = analyze(image, mask);
  assert.equal(found.method, 'smooth');
  erase(image, mask);
  for (let y = 30; y < 46; y += 1) {
    for (let x = 30; x < 46; x += 1) {
      const [r, g, b] = at(image, x, y);
      assert.ok(!(r > 240 && g < 15 && b > 240), `left over at ${x},${y}`);
      assert.ok(r >= 60 && r <= 196 && g >= 60 && g <= 196, `out of range at ${x},${y}: ${r},${g},${b}`);
    }
  }
});

test('the user may choose the way and the colour', () => {
  const image = picture(40, 40, () => WHITE);
  const done = erase(image, rectMask(40, 40, { x: 10, y: 10, width: 10, height: 10 }), { method: 'solid', color: [255, 0, 0, 255] });
  assert.equal(done.hex, '#FF0000');
  assert.deepEqual(at(image, 15, 15), [255, 0, 0]);
  assert.ok(METHOD_NAMES.smooth && METHOD_NAMES.lines && METHOD_NAMES.solid);
});

test('masks: a rectangle grows and stays inside the picture; an empty mask does nothing', () => {
  const mask = rectMask(20, 20, { x: -5, y: 15, width: 10, height: 10 }, 2);
  assert.equal(mask[0], 0);
  assert.equal(mask[19 * 20 + 0], 1);
  const grown = growMask(rectMask(10, 10, { x: 4, y: 4, width: 1, height: 1 }), 10, 10, 2);
  assert.equal(grown.reduce((a, b) => a + b, 0), 13);
  assert.equal(erase(picture(10, 10, () => WHITE), new Uint8Array(100)), null);
});

test('a large place is filled quickly', () => {
  const image = picture(1600, 900, (x, y) => [(x + y) % 256, 120, 90]);
  const started = Date.now();
  erase(image, rectMask(1600, 900, { x: 200, y: 100, width: 1000, height: 600 }));
  assert.ok(Date.now() - started < 4000, `${Date.now() - started} ms`);
});

test('a thin line across a plain panel keeps its colour through the place, and the panel stays plain', () => {
  const image = picture(200, 80, (x, y) => (y >= 40 && y <= 42 ? [154, 160, 168] : y >= 30 && y <= 50 && x >= 90 && x <= 110 ? [10, 10, 10] : WHITE));
  const done = erase(image, rectMask(200, 80, { x: 80, y: 25, width: 40, height: 30 }));
  assert.equal(done.method, 'lines');
  assert.ok(close(at(image, 100, 41), [154, 160, 168], 12), `line: ${at(image, 100, 41)}`);
  assert.ok(close(at(image, 100, 32), WHITE, 6), `panel: ${at(image, 100, 32)}`);
});
