const test = require('node:test');
const assert = require('node:assert/strict');
const { existingExecutable, qualitySummary, rationalNumber, srtTimestamp, wordsToSrt } = require('../src/studio-tools.cjs');

test('rationalNumber parses ffprobe frame rates', () => {
  assert.equal(rationalNumber('60000/1001').toFixed(3), '59.940');
  assert.equal(rationalNumber('30/1'), 30);
});

test('existing OCR engine path is reused on Windows', () => {
  if (process.platform === 'win32') assert.match(existingExecutable('tesseract'), /Tesseract-OCR\\tesseract\.exe$/i);
});

test('qualitySummary reports numerical video and A/V sync metrics', () => {
  const result = qualitySummary({ format: { duration: '10', bit_rate: '2000000' }, streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '60/1', nb_frames: '598', start_time: '0.000' },
    { codec_type: 'audio', codec_name: 'aac', channels: 2, start_time: '0.040' }
  ] });
  assert.equal(result.valid, true);
  assert.equal(result.expectedFrames, 600);
  assert.equal(result.droppedFramesEstimate, 2);
  assert.equal(result.avSyncOffsetMs, 40);
  assert.equal(result.score, 96);
});

test('wordsToSrt creates deterministic subtitle blocks', () => {
  const output = wordsToSrt([{ word: 'שלום', start: 0, end: 0.4 }, { word: 'עולם', start: 0.5, end: 1.2 }], 2);
  assert.match(output, /00:00:00,000 --> 00:00:01,200/);
  assert.match(output, /שלום עולם/);
  assert.equal(srtTimestamp(3661.125), '01:01:01,125');
});
