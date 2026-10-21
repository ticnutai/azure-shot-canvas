const test = require('node:test');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const { readCode, isOpenableLink } = require('../src/code-reader.cjs');

// A QR code drawn as a screen would show it: blue-green-red-alpha pixels, `cell` pixels per square, a quiet margin,
// optionally light on dark, placed inside a larger "screen".
function screenWithCode(text, { cell = 4, inverted = false, screen = 400 } = {}) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = (modules.size + 8) * cell;
  const bitmap = Buffer.alloc(screen * screen * 4, 0xee);
  const offset = 40;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const mx = Math.floor(x / cell) - 4;
    const my = Math.floor(y / cell) - 4;
    const dark = Boolean(mx >= 0 && my >= 0 && mx < modules.size && my < modules.size && modules.get(my, mx));
    const value = dark !== inverted ? 0x10 : 0xf8;
    const index = ((y + offset) * screen + x + offset) * 4;
    bitmap[index] = value; bitmap[index + 1] = value; bitmap[index + 2] = value; bitmap[index + 3] = 255;
  }
  return { bitmap, width: screen, height: screen };
}

test('1 · a code on a capture is read, also a Hebrew text', () => {
  for (const text of ['https://example.com/שלום?a=1', 'טקסט בעברית בתוך קוד']) {
    const { bitmap, width, height } = screenWithCode(text);
    assert.equal(readCode(bitmap, width, height), text);
  }
});

test('2 · a light-on-dark code (dark themes) is read too', () => {
  const { bitmap, width, height } = screenWithCode('https://example.org', { inverted: true });
  assert.equal(readCode(bitmap, width, height), 'https://example.org');
});

test('3 · no code: nothing is returned', () => {
  assert.equal(readCode(Buffer.alloc(200 * 200 * 4, 0xee), 200, 200), null);
  assert.equal(readCode(null, 0, 0), null);
});

test('4 · only web and mail addresses are offered to open', () => {
  assert.equal(isOpenableLink('https://example.com'), true);
  assert.equal(isOpenableLink('mailto:a@b.co'), true);
  assert.equal(isOpenableLink('file:///C:/Windows/system32/calc.exe'), false);
  assert.equal(isOpenableLink('javascript:alert(1)'), false);
  assert.equal(isOpenableLink('https://a.com and more'), false);
});
