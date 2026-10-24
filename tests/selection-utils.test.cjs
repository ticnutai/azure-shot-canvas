const test = require('node:test');
const assert = require('node:assert/strict');
const { allChosen, clickItem, countLabel, rangeOf, toggleAll, toggleLabel } = require('../src/selection-utils.js');

const shown = ['a', 'b', 'c', 'd', 'e'];

test('the "choose all" button chooses everything shown, and pressed again clears the choice', () => {
  const all = toggleAll(new Set(), shown);
  assert.deepEqual([...all], shown);
  assert.equal(allChosen(all, shown), true);
  assert.deepEqual([...toggleAll(all, shown)], []);
  // Part chosen: the button completes the choice.
  assert.deepEqual([...toggleAll(new Set(['b']), shown)], shown);
  // Nothing shown: nothing to choose, and the button is not "all chosen".
  assert.deepEqual([...toggleAll(new Set(), [])], []);
  assert.equal(allChosen(new Set(), []), false);
});

test('a choice hidden by a filter is let go by the button, so nothing invisible stays chosen', () => {
  const chosen = new Set(['z']);
  assert.deepEqual([...toggleAll(chosen, ['a', 'b'])], ['a', 'b']);
});

test('the button words follow the state', () => {
  assert.equal(toggleLabel(new Set(), shown), 'בחירת הכל');
  assert.equal(toggleLabel(new Set(shown), shown), 'ניקוי הבחירה');
  assert.equal(countLabel(1), 'פריט אחד נבחר');
  assert.equal(countLabel(4), '4 נבחרו');
});

test('a range goes from the anchor to the target in either direction', () => {
  assert.deepEqual(rangeOf(shown, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeOf(shown, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeOf(shown, 'gone', 'c'), ['c']);
  assert.deepEqual(rangeOf(shown, 'a', 'gone'), []);
});

test('clicks: the box or Control adds and removes one; Shift adds the range; a plain click chooses one where asked', () => {
  let state = { chosen: new Set(), anchor: null };
  state = clickItem(state, shown, 'b', { adding: true });
  assert.deepEqual([...state.chosen], ['b']);
  state = clickItem(state, shown, 'd', { range: true });
  assert.deepEqual([...state.chosen].sort(), ['b', 'c', 'd']);
  state = clickItem(state, shown, 'c', { adding: true });
  assert.deepEqual([...state.chosen].sort(), ['b', 'd']);
  // A plain click changes nothing unless the place chooses on a plain click.
  assert.deepEqual([...clickItem(state, shown, 'e').chosen].sort(), ['b', 'd']);
  assert.deepEqual([...clickItem(state, shown, 'e', { plainChooses: true }).chosen], ['e']);
  // The original set is never changed in place.
  const before = new Set(['a']);
  clickItem({ chosen: before, anchor: 'a' }, shown, 'b', { adding: true });
  assert.deepEqual([...before], ['a']);
});
