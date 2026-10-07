const test = require('node:test');
const assert = require('node:assert/strict');
const { clipRect, isDrag, isUsable, normalizeLastRegion, rectFromPoints, targetAt, toImagePixels, windowAt } = require('../src/region-utils.cjs');

test('a drag in any direction gives the same rectangle', () => {
  assert.deepEqual(rectFromPoints({ x: 10, y: 20 }, { x: 110, y: 70 }), { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(rectFromPoints({ x: 110, y: 70 }, { x: 10, y: 20 }), { x: 10, y: 20, width: 100, height: 50 });
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 3, y: 3 }), false);
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 0, y: 4 }), true);
  assert.equal(isUsable({ width: 7, height: 100 }), false);
  assert.equal(isUsable({ width: 8, height: 8 }), true);
});

test('the window under the pointer is the front-most one, cut to the screen', () => {
  const windows = [{ x: 100, y: 100, width: 200, height: 100 }, { x: 0, y: 0, width: 1000, height: 800 }];
  assert.deepEqual(windowAt(windows, { x: 150, y: 150 }), windows[0]);
  assert.deepEqual(windowAt(windows, { x: 50, y: 50 }), windows[1]);
  assert.equal(windowAt(windows, { x: 1500, y: 50 }), null);
  assert.equal(windowAt([], { x: 1, y: 1 }), null);
  assert.deepEqual(clipRect({ x: -20, y: 700, width: 100, height: 300 }, { x: 0, y: 0, width: 1000, height: 800 }), { x: 0, y: 700, width: 80, height: 100 });
  assert.equal(clipRect({ x: 1200, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 1000, height: 800 }), null);
});

test('screen points become whole image pixels on scaled screens, never outside the image', () => {
  assert.deepEqual(toImagePixels({ x: 10, y: 20, width: 100, height: 50 }, 2, { width: 2880, height: 1800 }), { x: 20, y: 40, width: 200, height: 100 });
  assert.deepEqual(toImagePixels({ x: 10.3, y: 0, width: 10, height: 10 }, 1.5, { width: 100, height: 100 }), { x: 15, y: 0, width: 16, height: 15 });
  assert.deepEqual(toImagePixels({ x: 1400, y: 880, width: 100, height: 100 }, 2, { width: 2880, height: 1800 }), { x: 2800, y: 1760, width: 80, height: 40 });
  assert.equal(toImagePixels({ x: 2000, y: 0, width: 10, height: 10 }, 2, { width: 2880, height: 1800 }), null);
});

test('the last region returns on its own screen, or fitted to another one', () => {
  const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } }, { id: 2, bounds: { x: 1440, y: 0, width: 800, height: 600 } }];
  assert.deepEqual(normalizeLastRegion({ displayId: '2', rect: { x: 10, y: 10, width: 100, height: 100 } }, displays), { displayId: 2, rect: { x: 10, y: 10, width: 100, height: 100 } });
  assert.deepEqual(normalizeLastRegion({ displayId: 9, rect: { x: 1000, y: 800, width: 900, height: 300 } }, displays), { displayId: 1, rect: { x: 1000, y: 800, width: 440, height: 100 } });
  assert.equal(normalizeLastRegion({ displayId: 1, rect: { x: 'a' } }, displays), null);
  assert.equal(normalizeLastRegion(null, displays), null);
});

test('a click takes the smallest part of the front window under the pointer; Shift takes the whole window', () => {
  const windows = [{ x: 100, y: 100, width: 800, height: 600, parts: [
    { x: 100, y: 100, width: 800, height: 600 },
    { x: 100, y: 140, width: 250, height: 560 },
    { x: 120, y: 160, width: 200, height: 40 }
  ] }, { x: 0, y: 0, width: 1920, height: 1040, parts: [] }];
  assert.deepEqual(targetAt(windows, { x: 130, y: 170 }), { x: 120, y: 160, width: 200, height: 40 });
  assert.deepEqual(targetAt(windows, { x: 130, y: 400 }), { x: 100, y: 140, width: 250, height: 560 });
  assert.equal(targetAt(windows, { x: 600, y: 400 }), windows[0]);
  assert.equal(targetAt(windows, { x: 130, y: 170 }, { wholeWindow: true }), windows[0]);
  assert.equal(targetAt(windows, { x: 10, y: 10 }), windows[1]);
  assert.equal(targetAt(windows, { x: 3000, y: 10 }), null);
});