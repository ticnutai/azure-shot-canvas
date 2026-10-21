const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { encodePng, encodeInBackground } = require('../src/png-encode.cjs');

// Reads back what encodePng wrote: the size, and every pixel after undoing the left-neighbour filter.
function decode(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(png.readUInt32BE(offset + 8 + length), zlib.crc32(png.subarray(offset + 4, offset + 8 + length)) >>> 0, `${type} check sum`);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); }
    if (type === 'IDAT') data.push(body);
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const line = raw.subarray(row * (width * 4 + 1), (row + 1) * (width * 4 + 1));
    assert.equal(line[0], 1);
    for (let index = 0; index < width * 4; index += 1) {
      const left = index >= 4 ? pixels[row * width * 4 + index - 4] : 0;
      pixels[row * width * 4 + index] = (line[index + 1] + left) & 0xff;
    }
  }
  return { width, height, pixels };
}

// A 5×3 screen of blue-green-red-alpha pixels with distinct values.
const width = 5;
const height = 3;
const bitmap = Buffer.alloc(width * height * 4);
for (let index = 0; index < width * height; index += 1) bitmap.set([index * 3, index * 5 + 1, index * 7 + 2, 255], index * 4);
const expected = (x, y) => { const at = (y * width + x) * 4; return [bitmap[at + 2], bitmap[at + 1], bitmap[at], bitmap[at + 3]]; };

test('1 · a whole screen becomes a valid PNG with exactly the same pixels (colour order turned to red-green-blue)', () => {
  const picture = decode(encodePng(bitmap, width, height));
  assert.deepEqual([picture.width, picture.height], [5, 3]);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) assert.deepEqual([...picture.pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)], expected(x, y));
});

test('2 · an area is cut exactly', () => {
  const picture = decode(encodePng(bitmap, width, height, { x: 1, y: 1, width: 3, height: 2 }));
  assert.deepEqual([picture.width, picture.height], [3, 2]);
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 3; x += 1) assert.deepEqual([...picture.pixels.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4)], expected(x + 1, y + 1));
});

test('3 · the background thread gives the same picture, and keeps working for the next ones', async () => {
  const direct = encodePng(bitmap, width, height, { x: 0, y: 0, width: 4, height: 3 });
  const first = await encodeInBackground(bitmap, width, height, { x: 0, y: 0, width: 4, height: 3 });
  const second = await encodeInBackground(bitmap, width, height, { x: 0, y: 0, width: 4, height: 3 });
  assert.deepEqual(first, direct);
  assert.deepEqual(second, direct);
});
