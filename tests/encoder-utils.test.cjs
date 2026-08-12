const test = require('node:test');
const assert = require('node:assert/strict');
const { encoderCandidates, parseVideoEncoders } = require('../src/encoder-utils.cjs');

test('parses available hardware and software H.264 encoders', () => {
  const encoders = parseVideoEncoders(' V....D h264_nvenc NVIDIA NVENC\n V..... h264_qsv Intel QSV\n V..... libx264 H.264');
  assert.equal(encoders.find((item) => item.id === 'h264_nvenc').available, true);
  assert.equal(encoders.find((item) => item.id === 'h264_amf').available, false);
  assert.deepEqual(encoderCandidates(encoders).map((item) => item.id), ['h264_nvenc', 'h264_qsv', 'libx264']);
});

test('always retains a safe software fallback', () => {
  assert.deepEqual(encoderCandidates(parseVideoEncoders('')).map((item) => item.id), ['libx264']);
});
