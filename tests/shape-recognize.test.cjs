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

test('a scribble, a V with equal arms or a tiny dot stays as drawn', () => {
  const scribble = Array.from({ length: 40 }, (_, i) => ({ x: i * 8, y: (i % 2) * 60 }));
  assert.equal(recognize(scribble), null);
  const vee = [...line({ x: 0, y: 0 }, { x: 60, y: 100 }, 15), ...line({ x: 60, y: 100 }, { x: 120, y: 0 }, 15).slice(1)];
  assert.equal(recognize(vee), null);
  assert.equal(recognize([{ x: 1, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 4 }, { x: 5, y: 5 }]), null);
});

test('a check mark becomes a clean three-point check, drawn either way', () => {
  const tick = [...line({ x: 0, y: 50 }, { x: 40, y: 100 }, 10), ...line({ x: 40, y: 100 }, { x: 140, y: 0 }, 20).slice(1)];
  const shape = recognize(tick);
  assert.equal(shape.type, 'check');
  assert.equal(shape.points.length, 3);
  assert.ok(Math.abs(shape.points[1].y - 100) < 6);
  const backwards = [...line({ x: 140, y: 50 }, { x: 100, y: 100 }, 10), ...line({ x: 100, y: 100 }, { x: 0, y: 0 }, 20).slice(1)];
  assert.equal(recognize(backwards).type, 'check');
});

test('a line with a hand-drawn arrowhead becomes an arrow to the tip', () => {
  // shaft, then one barb back from the tip
  const oneBarb = [...line({ x: 20, y: 200 }, { x: 300, y: 60 }, 30), ...line({ x: 300, y: 60 }, { x: 255, y: 58 }, 6).slice(1)];
  const a = recognize(oneBarb);
  assert.equal(a.type, 'arrow');
  assert.ok(Math.abs(a.to.x - 300) < 8 && Math.abs(a.to.y - 60) < 8);
  // shaft, barb, back to the tip, other barb
  const head = [...line({ x: 20, y: 100 }, { x: 320, y: 104 }, 30), ...line({ x: 320, y: 104 }, { x: 290, y: 80 }, 5).slice(1),
    ...line({ x: 290, y: 80 }, { x: 320, y: 104 }, 5).slice(1), ...line({ x: 320, y: 104 }, { x: 290, y: 128 }, 5).slice(1)];
  const b = recognize(head);
  assert.equal(b.type, 'arrow');
  assert.equal(b.from.y, b.to.y); // almost level → level
  // a plain line with a tiny wobble at the end stays a line
  assert.equal(recognize(line({ x: 10, y: 10 }, { x: 300, y: 160 })).type, 'line');
});
