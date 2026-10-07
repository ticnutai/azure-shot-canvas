const test = require('node:test');
const assert = require('node:assert/strict');
const { areaOnScreen, barBounds } = require('../src/recording-controls.cjs');

const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 0, width: 1440, height: 860 } };

test('the recorded area in screen points; a full screen needs no frame', () => {
  assert.deepEqual(areaOnScreen(display, { x: 0.25, y: 0.5, width: 0.5, height: 0.25 }), { x: 360, y: 450, width: 720, height: 225, whole: false });
  assert.equal(areaOnScreen(display, { x: 0, y: 0, width: 1, height: 1 }).whole, true);
  assert.equal(areaOnScreen(display, null).whole, true);
  const second = { bounds: { x: 1440, y: 0, width: 1920, height: 1080 } };
  assert.equal(areaOnScreen(second, { x: 0.5, y: 0, width: 0.25, height: 0.5 }).x, 1440 + 960);
});

test('the floating bar sits under the area, above it when there is no room, or at the top for a full screen', () => {
  const under = barBounds(display, { x: 360, y: 200, width: 720, height: 300 });
  assert.equal(under.y, 510);
  assert.equal(under.x, Math.round(360 + (720 - under.width) / 2));
  const above = barBounds(display, { x: 360, y: 500, width: 720, height: 330 });
  assert.equal(above.y, 500 - 10 - above.height);
  const inside = barBounds(display, { x: 0, y: 0, width: 1440, height: 860, whole: false });
  assert.equal(inside.y, 10);
  const whole = barBounds(display, { whole: true });
  assert.equal(whole.y, 10);
  assert.equal(whole.x, Math.round((1440 - whole.width) / 2));
  // Never off the screen at the edges.
  const edge = barBounds(display, { x: 1400, y: 100, width: 40, height: 40 });
  assert.ok(edge.x + edge.width <= 1440 - 6);
});
