const test = require('node:test');
const assert = require('node:assert/strict');
const { compareReports } = require('../src/qa-utils.cjs');

test('QA comparison marks slower maximum metrics as regressions', () => {
  const previous = { tests: [{ title: 'flow', metrics: [{ name: 'latency', value: 100, direction: 'max' }] }] };
  const current = { tests: [{ title: 'flow', metrics: [{ name: 'latency', value: 125, direction: 'max', pass: true }] }] };
  const [comparison] = compareReports(current, previous);
  assert.equal(comparison.delta, 25);
  assert.equal(comparison.regression, true);
});

test('QA comparison marks higher minimum metrics as improvements', () => {
  const previous = { tests: [{ title: 'media', metrics: [{ name: 'width', value: 1920, direction: 'min' }] }] };
  const current = { tests: [{ title: 'media', metrics: [{ name: 'width', value: 2880, direction: 'min', pass: true }] }] };
  const [comparison] = compareReports(current, previous);
  assert.equal(comparison.delta, 960);
  assert.equal(comparison.regression, false);
});
