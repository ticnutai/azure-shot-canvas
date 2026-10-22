const test = require('node:test');
const assert = require('node:assert/strict');
const { FEATURES, defaults, normalizeFeatures, loopbackAddress } = require('../src/features-defs.js');

test('every extra starts off, with the default value of each of its settings', () => {
  const start = defaults();
  assert.equal(Object.keys(start.enabled).length, FEATURES.length);
  assert.ok(Object.values(start.enabled).every((value) => value === false));
  assert.equal(start.values.intervalCapture.seconds, 30);
  assert.equal(start.values.perKeyAfter.region, 'default');
  assert.equal(start.values.translate.address, 'http://127.0.0.1:11434');
});

test('switches change one by one and nothing else', () => {
  const one = normalizeFeatures({ enabled: { clickRipple: true } });
  assert.equal(one.enabled.clickRipple, true);
  assert.equal(one.enabled.textIndex, false);
  const two = normalizeFeatures({ enabled: { textIndex: true } }, one);
  assert.equal(two.enabled.clickRipple, true);
  assert.equal(two.enabled.textIndex, true);
  assert.equal(normalizeFeatures({ enabled: { unknown: true } }).enabled.unknown, undefined);
});

test('numbers stay inside their range and keep the old value when empty or not a number', () => {
  const set = (values, current) => normalizeFeatures({ values: { intervalCapture: values } }, current).values.intervalCapture;
  assert.equal(set({ seconds: 5 }).seconds, 5);
  assert.equal(set({ seconds: 0 }).seconds, 1);
  assert.equal(set({ seconds: 999999 }).seconds, 86400);
  assert.equal(set({ count: 12.4 }).count, 12);
  const kept = normalizeFeatures({ values: { intervalCapture: { seconds: 7 } } });
  assert.equal(normalizeFeatures({ values: { intervalCapture: { seconds: '' } } }, kept).values.intervalCapture.seconds, 7);
  assert.equal(normalizeFeatures({ values: { intervalCapture: { seconds: 'abc' } } }, kept).values.intervalCapture.seconds, 7);
});

test('a choice outside its list is refused', () => {
  assert.equal(normalizeFeatures({ values: { perKeyAfter: { region: 'ocr' } } }).values.perKeyAfter.region, 'ocr');
  assert.equal(normalizeFeatures({ values: { perKeyAfter: { region: 'delete-everything' } } }).values.perKeyAfter.region, 'default');
  assert.equal(normalizeFeatures({ values: { clickRipple: { color: 'purple' } } }).values.clickRipple.color, 'gold');
});

test('the translation engine must be on this computer: only a loopback address is accepted', () => {
  assert.equal(loopbackAddress('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.equal(loopbackAddress('http://localhost:8080'), 'http://localhost:8080');
  assert.equal(loopbackAddress('http://[::1]:11434'), 'http://[::1]:11434');
  assert.equal(loopbackAddress('http://192.168.1.5:11434'), null);
  assert.equal(loopbackAddress('https://example.com'), null);
  assert.equal(loopbackAddress('http://127.0.0.1.evil.com:11434'), null);
  assert.equal(loopbackAddress('not an address'), null);
  const kept = normalizeFeatures({ values: { translate: { address: 'http://127.0.0.1:9999' } } });
  assert.equal(kept.values.translate.address, 'http://127.0.0.1:9999');
  assert.equal(normalizeFeatures({ values: { translate: { address: 'http://evil.example:11434' } } }, kept).values.translate.address, 'http://127.0.0.1:9999');
});

test('text settings are trimmed and cut to a sane length', () => {
  const model = normalizeFeatures({ values: { translate: { model: `  ${'x'.repeat(200)}  ` } } }).values.translate.model;
  assert.equal(model.length, 80);
  assert.equal(normalizeFeatures({ values: { translate: { model: '  llama3  ' } } }).values.translate.model, 'llama3');
});
