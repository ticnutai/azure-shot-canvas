const test = require('node:test');
const assert = require('node:assert/strict');
const { IntervalCapture } = require('../src/interval-capture.cjs');

// A clock the test moves by hand.
function clock() {
  const waiting = [];
  return {
    setTimer: (fn, ms) => { const timer = { fn, ms }; waiting.push(timer); return timer; },
    clearTimer: (timer) => { const at = waiting.indexOf(timer); if (at >= 0) waiting.splice(at, 1); },
    waiting,
    async fire() { const timer = waiting.shift(); await timer.fn(); }
  };
}

test('the first picture is taken at once, then one every interval, until the count is reached', async () => {
  const time = clock();
  const taken = [];
  const stops = [];
  const interval = new IntervalCapture({ capture: async (index) => { taken.push(index); }, onStop: (reason, count) => stops.push([reason, count]), ...time });
  assert.equal(interval.start({ seconds: 10, count: 3 }), true);
  assert.equal(interval.start({ seconds: 10, count: 3 }), false, 'a second start while running does nothing');
  assert.equal(time.waiting[0].ms, 0);
  await time.fire();
  assert.deepEqual(taken, [0]);
  assert.equal(time.waiting[0].ms, 10_000);
  await time.fire();
  await time.fire();
  assert.deepEqual(taken, [0, 1, 2]);
  assert.deepEqual(stops, [['done', 3]]);
  assert.equal(interval.running, false);
  assert.equal(time.waiting.length, 0);
});

test('count 0 goes on until it is stopped', async () => {
  const time = clock();
  const interval = new IntervalCapture({ capture: async () => {}, ...time });
  interval.start({ seconds: 5, count: 0 });
  for (let i = 0; i < 6; i += 1) await time.fire();
  assert.equal(interval.taken, 6);
  assert.equal(interval.running, true);
  assert.equal(interval.stop(), true);
  assert.equal(time.waiting.length, 0);
  assert.equal(interval.stop(), false);
});

test('the wait starts after the picture is finished, so two pictures never overlap', async () => {
  const time = clock();
  let inside = 0;
  let overlap = false;
  const interval = new IntervalCapture({ capture: async () => { inside += 1; if (inside > 1) overlap = true; await Promise.resolve(); inside -= 1; }, ...time });
  interval.start({ seconds: 1 });
  for (let i = 0; i < 4; i += 1) await time.fire();
  assert.equal(overlap, false);
});

test('a single failure is forgiven', async () => {
  const time = clock();
  let attempt = 0;
  const interval = new IntervalCapture({ capture: async () => { attempt += 1; if (attempt === 2) throw new Error('אין מסך'); }, ...time });
  interval.start({ seconds: 1 });
  await time.fire(); await time.fire(); await time.fire();
  assert.equal(interval.running, true);
  assert.equal(interval.taken, 2);
});

test('three failures in a row stop it with the reason', async () => {
  const time = clock();
  const stops = [];
  const interval = new IntervalCapture({ capture: async () => { throw new Error('אין מסך'); }, onStop: (reason) => stops.push(reason), ...time });
  interval.start({ seconds: 1 });
  await time.fire(); await time.fire(); await time.fire();
  assert.equal(interval.running, false);
  assert.match(stops[0], /failed: אין מסך/);
});

test('seconds below one or not numbers become a safe value', () => {
  const time = clock();
  const interval = new IntervalCapture({ capture: async () => {}, ...time });
  interval.start({ seconds: 0 });
  assert.equal(interval.seconds, 30);
  interval.stop();
  interval.start({ seconds: 0.2 });
  assert.equal(interval.seconds, 1);
});
