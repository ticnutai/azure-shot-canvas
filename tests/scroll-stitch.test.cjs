const test = require('node:test');
const assert = require('node:assert/strict');
const { cropRows, stitchFrames } = require('../src/scroll-stitch.cjs');

// A tall "page" of distinct rows; each frame is a window of it, as if the page had been scrolled.
const width = 64;
const pageHeight = 600;
const page = Buffer.alloc(width * pageHeight * 4);
for (let y = 0; y < pageHeight; y += 1) {
  // Rows that never repeat (like real text and pictures), from a fixed pseudo-random sequence.
  const shade = ((y * 2654435761) >>> 0) % 251;
  for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    page[index] = shade; page[index + 1] = (shade * 3 + x) & 255; page[index + 2] = (255 - shade); page[index + 3] = 255;
  }
}
const frameAt = (top, height) => cropRows(page, width, { x: 0, y: top, width, height });

test('frames of a scrolled page join into one picture without repeated rows', () => {
  const height = 200;
  const frames = [frameAt(0, height), frameAt(120, height), frameAt(240, height), frameAt(360, height), frameAt(360, height)];
  const result = stitchFrames(frames, width, height);
  assert.equal(result.reachedEnd, true);
  assert.equal(result.parts, 4);
  assert.equal(result.height, 560);
  // The joined picture is exactly the page from the top down.
  assert.ok(result.buffer.equals(page.subarray(0, 560 * width * 4)));
});

test('an unrelated frame stops the joining instead of gluing it on', () => {
  const height = 200;
  const noise = Buffer.alloc(width * height * 4, 7);
  const result = stitchFrames([frameAt(0, height), noise], width, height);
  assert.equal(result.parts, 1);
  assert.equal(result.height, height);
});

test('cutting a rectangle out of a whole-desktop picture', () => {
  const out = cropRows(page, width, { x: 10, y: 5, width: 4, height: 2 });
  assert.equal(out.length, 4 * 2 * 4);
  assert.equal(out[0], page[(5 * width + 10) * 4]);
});

test('a fixed header and status bar appear once; only the page between them is joined', () => {
  const { fixedBands } = require('../src/scroll-stitch.cjs');
  const height = 200;
  const header = Buffer.alloc(width * 30 * 4, 40);
  const footer = Buffer.alloc(width * 20 * 4, 220);
  // Window: 30 rows of header, 150 rows of scrolling page, 20 rows of status bar.
  const windowAt = (top) => Buffer.concat([header, frameAt(top, 150), footer]);
  const frames = [windowAt(0), windowAt(100), windowAt(200), windowAt(300), windowAt(300)];
  assert.deepEqual(fixedBands(frames, width, height), { top: 30, bottom: 20 });
  const result = stitchFrames(frames, width, height);
  assert.equal(result.height, 30 + 450 + 20);
  const rowBytes = width * 4;
  assert.ok(result.buffer.subarray(0, 30 * rowBytes).equals(header));
  assert.ok(result.buffer.subarray(30 * rowBytes, (30 + 450) * rowBytes).equals(page.subarray(0, 450 * rowBytes)));
  assert.ok(result.buffer.subarray((30 + 450) * rowBytes).equals(footer));
});

test('a text page with blank gaps between lines joins without repeating or losing a line', () => {
  // 'Lines of text': 14 rows of ink (different per line) then 26 blank rows, like a document.
  const lineHeight = 40;
  const textHeight = 2000;
  const text = Buffer.alloc(width * textHeight * 4, 250);
  for (let y = 0; y < textHeight; y += 1) {
    const line = Math.floor(y / lineHeight);
    if (y % lineHeight >= 14) continue;
    for (let x = 0; x < width; x += 1) {
      const ink = ((line * 7 + x * 13 + (y % lineHeight) * 3) % 9) < 4;
      if (!ink) continue;
      const index = (y * width + x) * 4;
      text[index] = 20; text[index + 1] = 20; text[index + 2] = 20;
    }
  }
  const height = 300;
  const at = (top) => cropRows(text, width, { x: 0, y: top, width, height });
  // Scroll steps of 117 rows: not a multiple of the line height, like real wheel turns.
  const tops = [0, 117, 234, 351, 468, 585];
  const result = stitchFrames(tops.map(at), width, height);
  assert.equal(result.parts, 6);
  assert.equal(result.height, 585 + height);
  assert.ok(result.buffer.equals(text.subarray(0, (585 + height) * width * 4)));
});
