const test = require('node:test');
const assert = require('node:assert/strict');
const { TextIndexer } = require('../src/text-index.cjs');

function clock() {
  const waiting = [];
  return {
    setTimer: (fn, ms) => { const timer = { fn, ms }; waiting.push(timer); return timer; },
    clearTimer: (timer) => { const at = waiting.indexOf(timer); if (at >= 0) waiting.splice(at, 1); },
    waiting,
    async fire() { const timer = waiting.shift(); await timer.fn(); }
  };
}

test('pictures are recognised one at a time, newest first, with a pause between them', async () => {
  const time = clock();
  const todo = ['c.png', 'b.png', 'a.png'];
  const done = [];
  const indexer = new TextIndexer({ pending: async () => [...todo], index: async (path) => { done.push(path); todo.splice(todo.indexOf(path), 1); }, ...time });
  indexer.start();
  await time.fire();
  assert.deepEqual(done, ['c.png']);
  assert.equal(time.waiting[0].ms, 2500);
  await time.fire();
  await time.fire();
  assert.deepEqual(done, ['c.png', 'b.png', 'a.png']);
  // Nothing left: it rests, no timer runs, until the next capture.
  await time.fire();
  assert.equal(time.waiting.length, 0);
  assert.equal(indexer.done, 3);
});

test('it waits while the computer is busy and goes on after', async () => {
  const time = clock();
  let busy = true;
  const done = [];
  const indexer = new TextIndexer({ pending: async () => ['a.png'], index: async (path) => { done.push(path); }, busy: () => busy, ...time });
  indexer.start();
  await time.fire();
  assert.deepEqual(done, []);
  assert.equal(time.waiting[0].ms, 15_000);
  busy = false;
  await time.fire();
  assert.deepEqual(done, ['a.png']);
});

test('a picture that fails is skipped, the others go on', async () => {
  const time = clock();
  const done = [];
  const indexer = new TextIndexer({
    pending: async () => ['bad.png', 'good.png'],
    index: async (path) => { if (path === 'bad.png') throw new Error('x'); done.push(path); },
    ...time
  });
  indexer.start();
  await time.fire();
  await time.fire();
  assert.deepEqual(done, ['good.png']);
  assert.ok(indexer.skipped.has('bad.png'));
});

test('a new capture wakes it up; stopping clears everything', async () => {
  const time = clock();
  let list = [];
  const indexer = new TextIndexer({ pending: async () => [...list], index: async (path) => { list = list.filter((item) => item !== path); }, ...time });
  indexer.start();
  await time.fire();
  assert.equal(time.waiting.length, 0);
  list = ['new.png'];
  indexer.kick();
  assert.equal(time.waiting.length, 1);
  assert.equal(time.waiting[0].ms, 1500);
  indexer.stop();
  assert.equal(time.waiting.length, 0);
  indexer.kick();
  assert.equal(time.waiting.length, 0, 'stopped: a capture does not wake it');
});

test('starting twice does not run two loops', async () => {
  const time = clock();
  const indexer = new TextIndexer({ pending: async () => [], index: async () => {}, ...time });
  indexer.start();
  indexer.start();
  assert.equal(time.waiting.length, 1);
});
