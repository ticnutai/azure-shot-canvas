const test = require('node:test');
const assert = require('node:assert/strict');
const { boundsOf, handleAt, handlesOf, moveShape, resizeShape, shapeAt } = require('../src/region-shape-edit.js');

const box = (x, y, right, bottom, type = 'rect') => ({ type, color: '#f13c50', from: { x, y }, to: { x: right, y: bottom } });
const AREA = { x: 0, y: 0, width: 1000, height: 800 };

test('a box and a blur have a handle on every side and corner, an arrow on each end, text and numbers none', () => {
  assert.deepEqual(handlesOf(box(100, 100, 200, 300)).map(({ name }) => name), ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  assert.equal(handlesOf(box(1, 1, 50, 50, 'blur')).length, 8);
  assert.equal(handlesOf({ type: 'pen', points: [{ x: 0, y: 0 }, { x: 20, y: 30 }] }).length, 8);
  assert.deepEqual(handlesOf(box(1, 2, 30, 40, 'arrow')).map(({ name }) => name), ['from', 'to']);
  assert.equal(handlesOf({ type: 'number', from: { x: 5, y: 5 } }).length, 0);
  assert.equal(handlesOf({ type: 'text', from: { x: 5, y: 5 }, text: 'א' }).length, 0);
});

test('a handle is found near the pointer, also for a box drawn from its far corner', () => {
  const drawnBackward = box(200, 300, 100, 100);
  assert.equal(handleAt(drawnBackward, { x: 103, y: 97 }), 'nw');
  assert.equal(handleAt(drawnBackward, { x: 200, y: 200 }), 'e');
  assert.equal(handleAt(drawnBackward, { x: 150, y: 200 }), null);
});

test('a side changes one direction only, a corner both', () => {
  const base = box(100, 100, 200, 300);
  assert.deepEqual(boundsOf({ ...base, ...resizeShape(base, 'e', { x: 260, y: 999 }) }), { x: 100, y: 100, width: 160, height: 200 });
  assert.deepEqual(boundsOf({ ...base, ...resizeShape(base, 'n', { x: 999, y: 150 }) }), { x: 100, y: 150, width: 100, height: 150 });
  assert.deepEqual(boundsOf({ ...base, ...resizeShape(base, 'w', { x: 50, y: 0 }) }), { x: 50, y: 100, width: 150, height: 200 });
  assert.deepEqual(boundsOf({ ...base, ...resizeShape(base, 'sw', { x: 120, y: 200 }) }), { x: 120, y: 100, width: 80, height: 100 });
});

test('a mark does not turn over past its opposite side', () => {
  const base = box(100, 100, 200, 300);
  const size = boundsOf({ ...base, ...resizeShape(base, 'e', { x: 10, y: 0 }) });
  assert.equal(size.x, 100);
  assert.equal(size.width, 6);
});

test('a drawn line keeps its form when resized, and one with no height does not break', () => {
  const pen = { type: 'pen', points: [{ x: 100, y: 100 }, { x: 150, y: 120 }, { x: 200, y: 200 }] };
  const wide = resizeShape(pen, 'e', { x: 300, y: 0 }).points;
  assert.deepEqual(wide, [{ x: 100, y: 100 }, { x: 200, y: 120 }, { x: 300, y: 200 }]);
  const flat = { type: 'pen', points: [{ x: 0, y: 50 }, { x: 40, y: 50 }] };
  for (const { x, y } of resizeShape(flat, 'e', { x: 80, y: 50 }).points) assert.ok(Number.isFinite(x) && Number.isFinite(y));
});

test('an arrow end moves by itself', () => {
  const arrow = box(10, 10, 100, 100, 'arrow');
  assert.deepEqual(resizeShape(arrow, 'to', { x: 300, y: 40 }), { to: { x: 300, y: 40 } });
  assert.deepEqual(resizeShape(arrow, 'from', { x: 5, y: 6 }), { from: { x: 5, y: 6 } });
});

test('a click finds the mark: inside a box, on a line, the small one inside the big one', () => {
  const big = box(0, 0, 500, 500);
  const small = box(100, 100, 150, 150);
  const arrow = box(600, 100, 800, 100, 'arrow');
  const shapes = [small, big, arrow];
  assert.equal(shapeAt(shapes, { x: 300, y: 300 }), big);
  assert.equal(shapeAt(shapes, { x: 120, y: 120 }), small);
  assert.equal(shapeAt(shapes, { x: 700, y: 105 }), arrow);
  assert.equal(shapeAt(shapes, { x: 700, y: 200 }), null);
  const pen = { type: 'pen', points: [{ x: 10, y: 600 }, { x: 200, y: 600 }] };
  assert.equal(shapeAt([pen], { x: 100, y: 604 }), pen);
  assert.equal(shapeAt([{ type: 'pen', points: [{ x: 10, y: 600 }] }], { x: 12, y: 602 })?.type, 'pen');
});

test('text is found to the left of its point, where Hebrew runs', () => {
  const text = { type: 'text', from: { x: 300, y: 100 }, text: 'שלום', width: 80, height: 26 };
  assert.equal(shapeAt([text], { x: 250, y: 110 }), text);
  assert.equal(shapeAt([text], { x: 400, y: 110 }), null);
});

test('a mark moves, and stays inside the area', () => {
  const base = box(100, 100, 200, 200);
  assert.deepEqual(moveShape(base, 50, 20, AREA), { from: { x: 150, y: 120 }, to: { x: 250, y: 220 } });
  assert.deepEqual(boundsOf({ ...base, ...moveShape(base, -500, -500, AREA) }), { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(boundsOf({ ...base, ...moveShape(base, 5000, 5000, AREA) }), { x: 900, y: 700, width: 100, height: 100 });
  assert.deepEqual(moveShape({ type: 'number', from: { x: 100, y: 100 } }, 10, 10, AREA), { from: { x: 110, y: 110 } });
  assert.deepEqual(moveShape({ type: 'pen', points: [{ x: 100, y: 100 }] }, 10, 0, AREA), { points: [{ x: 110, y: 100 }] });
});
