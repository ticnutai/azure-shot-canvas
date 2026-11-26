const test = require('node:test');
const assert = require('node:assert/strict');
const { recognize } = require('../src/shape-recognize.js');

// A hand-drawn stroke: points along a path with a little shake.
const shake = (i) => Math.sin(i * 1.7) * 2.5;
const line = (a, b, n = 30) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n + shake(i), y: a.y + (b.y - a.y) * i / n + shake(i + 3) }));
const ellipse = (cx, cy, rx, ry, n = 60, turn = 1.03) => Array.from({ length: n + 1 }, (_, i) => {
  const t = (i / n) * Math.PI * 2 * turn;
  return { x: cx + rx * Math.cos(t) + shake(i), y: cy + ry * Math.sin(t) + shake(i + 5) };
});
const rectangle = (x, y, w, h) => [...line({ x, y }, { x: x + w, y }, 15), ...line({ x: x + w, y }, { x: x + w, y: y + h }, 10).slice(1),
  ...line({ x: x + w, y: y + h }, { x, y: y + h }, 15).slice(1), ...line({ x, y: y + h }, { x: x + 3, y: y + 4 }, 10).slice(1)];

test('a shaky straight stroke becomes a line, and an almost level one is made level', () => {
  const shape = recognize(line({ x: 10, y: 10 }, { x: 300, y: 160 }));
  assert.equal(shape.type, 'line');
  const level = recognize(line({ x: 10, y: 100 }, { x: 300, y: 112 }));
  assert.equal(level.type, 'line');
  assert.equal(level.from.y, level.to.y);
});

test('a loop that is round becomes a true circle; a wide one an ellipse', () => {
  const circle = recognize(ellipse(200, 200, 80, 76));
  assert.equal(circle.type, 'ellipse');
  assert.ok(Math.abs((circle.to.x - circle.from.x) - (circle.to.y - circle.from.y)) < 0.01);
  const wide = recognize(ellipse(200, 200, 150, 60));
  assert.equal(wide.type, 'ellipse');
  assert.ok(wide.to.x - wide.from.x > (wide.to.y - wide.from.y) * 2);
});

test('a box drawn by hand becomes a rectangle', () => {
  const box = recognize(rectangle(50, 60, 240, 140));
  assert.equal(box.type, 'rect');
  assert.ok(Math.abs(box.from.x - 50) < 8 && Math.abs(box.to.y - 200) < 8);
});

test('a scribble, a tick or a tiny dot stays as drawn', () => {
  const scribble = Array.from({ length: 40 }, (_, i) => ({ x: i * 8, y: (i % 2) * 60 }));
  assert.equal(recognize(scribble), null);
  const tick = [...line({ x: 0, y: 50 }, { x: 40, y: 100 }, 10), ...line({ x: 40, y: 100 }, { x: 140, y: 0 }, 20).slice(1)];
  assert.equal(recognize(tick), null);
  assert.equal(recognize([{ x: 1, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 4 }, { x: 5, y: 5 }]), null);
});
