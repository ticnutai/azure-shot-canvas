const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeTransition, nextCanvasHeight, rowSignature } = require('../src/scroll-capture-engine.js');

function stripedFrame(start, width = 64, height = 120) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const value = ((start + y) * 17 + Math.floor((start + y) / 7) * 31) % 256;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = (value + x * 3) % 256;
      data[index + 1] = (value * 2 + x) % 256;
      data[index + 2] = (value * 3 + x * 2) % 256;
      data[index + 3] = 255;
    }
  }
  return { data, width, height };
}

test('scroll capture detects duplicate frames numerically', () => {
  const frame = stripedFrame(0);
  const signature = rowSignature(frame, frame.width, frame.height, 1);
  assert.equal(analyzeTransition(signature, signature).kind, 'duplicate');
});

test('scroll capture detects vertical overlap and appended height', () => {
  const first = stripedFrame(0);
  const second = stripedFrame(40);
  const transition = analyzeTransition(rowSignature(first, first.width, first.height, 1), rowSignature(second, second.width, second.height, 1));
  assert.equal(transition.kind, 'append');
  assert.ok(Math.abs(transition.overlapPixels - 80) <= 2, `overlap=${transition.overlapPixels}`);
  assert.equal(nextCanvasHeight(120, 120, transition.overlapPixels), 160);
});

test('scroll capture rejects frames without reliable overlap and caps height', () => {
  const first = stripedFrame(0);
  const unrelated = stripedFrame(1000);
  const transition = analyzeTransition(rowSignature(first, first.width, first.height, 1), rowSignature(unrelated, unrelated.width, unrelated.height, 1), { matchThreshold: 2 });
  assert.equal(transition.kind, 'unmatched');
  assert.equal(nextCanvasHeight(29_900, 500, 10), 30_000);
});
