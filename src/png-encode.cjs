// Turns raw screen pixels (blue-green-red-alpha, as Windows hands them over) into a PNG picture, away from the
// program's main work: crop and compression run in a background thread, so a capture never freezes the program.
const { Worker, isMainThread, parentPort } = require('node:worker_threads');
const zlib = require('node:zlib');

// The picture itself: rows of red-green-blue-alpha, each row with the "difference from the pixel to the left"
// filter (makes screen pictures much smaller), packed with the standard PNG wrapping.
function encodePng(bitmap, width, height, rect = { x: 0, y: 0, width, height }) {
  const rowBytes = rect.width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const source = ((rect.y + row) * width + rect.x) * 4;
    const target = row * (rowBytes + 1);
    raw[target] = 1; // filter: difference from the left neighbour
    for (let column = 0; column < rect.width; column += 1) {
      const from = source + column * 4;
      const to = target + 1 + column * 4;
      const red = bitmap[from + 2];
      const green = bitmap[from + 1];
      const blue = bitmap[from];
      const alpha = bitmap[from + 3];
      if (column === 0) { raw[to] = red; raw[to + 1] = green; raw[to + 2] = blue; raw[to + 3] = alpha; continue; }
      const left = from - 4;
      raw[to] = (red - bitmap[left + 2]) & 0xff;
      raw[to + 1] = (green - bitmap[left + 1]) & 0xff;
      raw[to + 2] = (blue - bitmap[left]) & 0xff;
      raw[to + 3] = (alpha - bitmap[left + 3]) & 0xff;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(rect.width, 0);
  header.writeUInt32BE(rect.height, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 6; // red-green-blue-alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

if (!isMainThread && parentPort) {
  parentPort.on('message', ({ id, bitmap, width, height, rect }) => {
    try { parentPort.postMessage({ id, png: encodePng(Buffer.from(bitmap), width, height, rect) }); }
    catch (error) { parentPort.postMessage({ id, error: error.message }); }
  });
}

// One background thread, started on first use and kept for the next captures.
let worker = null;
let sequence = 0;
const waiting = new Map();
function encodeInBackground(bitmap, width, height, rect) {
  if (!worker) {
    worker = new Worker(__filename);
    worker.on('message', ({ id, png, error }) => {
      const pending = waiting.get(id);
      waiting.delete(id);
      if (!pending) return;
      if (error) pending.reject(new Error(error)); else pending.resolve(Buffer.from(png));
    });
    worker.on('error', (error) => { for (const pending of waiting.values()) pending.reject(error); waiting.clear(); worker = null; });
    // After the listeners (adding one would hold the program open again): an idle thread never keeps it running.
    worker.unref();
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    const copy = Uint8Array.from(bitmap);
    worker.postMessage({ id, bitmap: copy, width, height, rect }, [copy.buffer]);
  });
}

module.exports = { encodePng, encodeInBackground };
