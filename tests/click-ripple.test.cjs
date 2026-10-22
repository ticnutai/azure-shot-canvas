const test = require('node:test');
const assert = require('node:assert/strict');
const { LIFE_MS, parseClickEvent, rippleFrame } = require('../src/click-ripple.js');

test('a click line from the helper is read, anything else is refused', () => {
  assert.deepEqual(parseClickEvent('click 120 340 l'), { x: 120, y: 340, button: 'left' });
  assert.deepEqual(parseClickEvent('click -5 7 r'), { x: -5, y: 7, button: 'right' });
  assert.deepEqual(parseClickEvent(' click 1 2 l '), { x: 1, y: 2, button: 'left' });
  for (const bad of ['click 1 2', 'click a b l', 'key 65 c', 'click 1 2 m', 'click 1 2 l extra', '', null, undefined]) assert.equal(parseClickEvent(bad), null, String(bad));
});

test('the ring starts small and bright, widens and fades, and is gone after its short life', () => {
  const first = rippleFrame(0, 1920);
  const middle = rippleFrame(LIFE_MS / 2, 1920);
  assert.ok(middle.radius > first.radius);
  assert.ok(middle.lineWidth < first.lineWidth);
  const alpha = (frame) => Number(/,([0-9.]+)\)$/.exec(frame.stroke)[1]);
  assert.ok(alpha(middle) < alpha(first));
  assert.equal(rippleFrame(LIFE_MS, 1920), null);
  assert.equal(rippleFrame(LIFE_MS + 100, 1920), null);
  assert.equal(rippleFrame(-1, 1920), null);
  assert.equal(rippleFrame(NaN, 1920), null);
});

test('the ring grows with the size of the picture and never gets too small to see', () => {
  assert.ok(rippleFrame(300, 3840).radius > rippleFrame(300, 1280).radius);
  assert.ok(rippleFrame(0, 200).radius >= 10);
  assert.ok(rippleFrame(0, 200).lineWidth >= 2.9);
});

test('the colour is chosen from a short list; an unknown one falls back to gold', () => {
  assert.ok(rippleFrame(100, 1920, 'red').stroke.startsWith('rgba(239,91,104'));
  assert.ok(rippleFrame(100, 1920, 'white').stroke.startsWith('rgba(255,255,255'));
  assert.ok(rippleFrame(100, 1920, 'nonsense').stroke.startsWith('rgba(244,188,63'));
});
