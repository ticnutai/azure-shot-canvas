const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyClipboard, clampOpacity, escapeHtml, parseColor, pinPage, pinSize, zoomedBounds } = require('../src/pin-window.cjs');

test('a colour is recognised only when the text is nothing but a colour', () => {
  for (const good of ['#fff', '#FFAA00', '#11223344', 'rgb(1, 2, 3)', 'rgba(255,0,0,.5)', 'hsl(200, 50%, 40%)', '  #abc  ']) assert.ok(parseColor(good), good);
  for (const bad of ['red', '#ggg', '#12345', 'rgb(1,2)', 'color: #fff', '#fff; background:url(x)', 'rgb(1,2,3);x', '']) assert.equal(parseColor(bad), null, bad);
});

test('the clipboard is pinned as a picture first, then a colour, then text; empty gives nothing', () => {
  assert.deepEqual(classifyClipboard({ hasImage: true, text: 'abc' }), { kind: 'image' });
  assert.deepEqual(classifyClipboard({ text: '#ff0000' }), { kind: 'color', color: '#ff0000' });
  assert.deepEqual(classifyClipboard({ text: '  שלום עולם  ' }), { kind: 'text', text: 'שלום עולם' });
  assert.deepEqual(classifyClipboard({ text: '   ' }), { kind: 'none' });
  assert.deepEqual(classifyClipboard({}), { kind: 'none' });
  assert.equal(classifyClipboard({ text: 'x'.repeat(9000) }).text.length, 4000);
});

test('text in a pin is escaped: nothing the user copied can become a page', () => {
  const page = pinPage({ kind: 'text', text: '<script>alert(1)</script><img src=x onerror=alert(2)> & "q"' });
  assert.ok(!page.includes('<script>alert'));
  assert.ok(!page.includes('<img src=x'));
  assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('a colour pin shows a valid colour only; anything else falls back to grey', () => {
  assert.ok(pinPage({ kind: 'color', color: '#336699' }).includes('background:#336699'));
  const bad = pinPage({ kind: 'color', color: 'red;}</style><script>x()</script>' });
  assert.ok(!bad.includes('<script>x()'));
  assert.ok(bad.includes('#cccccc'));
});

test('the wheel script is part of the page only for the improved pin', () => {
  assert.ok(!pinPage({ kind: 'image', dataUrl: 'data:image/png;base64,AA' }).includes('pinApi'));
  const plus = pinPage({ kind: 'image', dataUrl: 'data:image/png;base64,AA', plus: true });
  assert.ok(plus.includes('pinApi.resize') && plus.includes('pinApi.opacity') && plus.includes('pinApi.reset'));
  assert.ok(plus.includes('src="data:image/png;base64,AA"'));
});

test('sizes: pictures keep their shape within 900 by 700, text grows with its length', () => {
  assert.deepEqual(pinSize('image', { width: 1800, height: 1400 }), { width: 900, height: 700 });
  assert.deepEqual(pinSize('image', { width: 100, height: 50 }), { width: 260, height: 180 });
  assert.deepEqual(pinSize('color'), { width: 240, height: 170 });
  assert.ok(pinSize('text', { text: 'x'.repeat(2000) }).height > pinSize('text', { text: 'x' }).height);
  assert.ok(pinSize('text', { text: 'x'.repeat(4000) }).height <= 620);
});

test('zooming keeps the centre and the shape and stays inside the screen', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const bigger = zoomedBounds({ x: 700, y: 400, width: 400, height: 200 }, 2, area);
  assert.equal(bigger.width, 800);
  assert.equal(bigger.height, 400);
  assert.equal(bigger.x + bigger.width / 2, 900);
  assert.equal(bigger.y + bigger.height / 2, 500);
  assert.equal(zoomedBounds({ x: 100, y: 100, width: 200, height: 100 }, 0.1, area).width, 120);
  const huge = zoomedBounds({ x: 900, y: 500, width: 1000, height: 500 }, 10, area);
  assert.ok(huge.width <= 1920 && huge.height <= 1080 && huge.x >= 0 && huge.y >= 0 && huge.x + huge.width <= 1920 && huge.y + huge.height <= 1080);
  assert.equal(huge.height / huge.width, 0.5);
});

test('opacity stays between a fifth and fully visible', () => {
  assert.equal(clampOpacity(0.05), 0.2);
  assert.equal(clampOpacity(1.4), 1);
  assert.equal(clampOpacity(0.555), 0.56);
});
