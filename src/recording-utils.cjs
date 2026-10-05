const path = require('node:path');
const { fileStamp } = require('./main-utils.cjs');

function recordingPaths(directory, date = new Date()) {
  const stem = `הקלטה_${fileStamp(date)}`;
  return {
    stem,
    partialPath: path.join(directory, `${stem}.partial.webm`),
    journalPath: path.join(directory, `${stem}.recording.json`),
    segmentDirectory: path.join(directory, `.${stem}.segments`),
    finalPath: path.join(directory, `${stem}.webm`),
    recoveredPath: path.join(directory, `${stem}_שוחזרה.webm`)
  };
}

function recordingSegmentPath(segmentDirectory, index) {
  const number = Math.max(1, Math.trunc(Number(index) || 1));
  return path.join(segmentDirectory, `video-${String(number).padStart(5, '0')}.part`);
}

function recordingAudioPath(segmentDirectory, kind) {
  if (!['system', 'microphone'].includes(kind)) throw new Error('Unsupported audio source');
  return path.join(segmentDirectory, `${kind}.partial.webm`);
}

function recoveryPathFor(partialPath) {
  if (!/\.partial\.webm$/i.test(partialPath)) throw new Error('Not a partial recording');
  return partialPath.replace(/\.partial\.webm$/i, '_שוחזרה.webm');
}

function storageLevel(freeBytes) {
  if (!Number.isFinite(freeBytes) || freeBytes < 0) return 'unknown';
  if (freeBytes < 1024 ** 3) return 'critical';
  if (freeBytes < 5 * 1024 ** 3) return 'warning';
  return 'healthy';
}

module.exports = { recordingAudioPath, recordingPaths, recordingSegmentPath, recoveryPathFor, storageLevel };
