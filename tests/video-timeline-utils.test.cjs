const test = require('node:test');
const assert = require('node:assert/strict');
const { clipsWithoutSilence, cursorZooms, normalizeTimelineProject, splitClip } = require('../src/video-timeline-utils.cjs');

test('timeline project normalizes clips captions and export preset', () => {
  const project = normalizeTimelineProject({ captions: [{ text: 'שלום', start: 1, end: 3, x: 2, y: -1 }], preset: 'social' }, 10);
  assert.equal(project.clips.length, 1); assert.equal(project.captions[0].x, .95); assert.equal(project.captions[0].y, .05); assert.equal(project.preset, 'social');
});

test('timeline split creates two lossless source ranges', () => {
  const project = normalizeTimelineProject({}, 10); const result = splitClip(project, project.clips[0].id, 4.25);
  assert.equal(result.split, true); assert.deepEqual(result.clips.map((clip) => [clip.start, clip.end]), [[0, 4.25], [4.25, 10]]);
});

test('silence removal produces only audible ranges with padding', () => {
  const clips = clipsWithoutSilence(10, [{ start: 2, end: 4 }, { start: 6, end: 8 }], 0);
  assert.deepEqual(clips.map((clip) => [clip.start, clip.end]), [[0, 2], [4, 6], [8, 10]]);
});

test('cursor samples become bounded automatic zoom segments', () => {
  const zooms = cursorZooms([{ at: 1, x: .1, y: .2 }, { at: 1.2, x: .11, y: .21 }, { at: 4, x: .8, y: .7 }], 6);
  assert.equal(zooms.length, 2); assert.ok(zooms.every((zoom) => zoom.start >= 0 && zoom.end <= 6));
});
