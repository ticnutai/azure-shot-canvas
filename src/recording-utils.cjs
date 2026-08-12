const path = require('node:path');
const { fileStamp } = require('./main-utils.cjs');

function recordingPaths(directory, date = new Date()) {
  const stem = `הקלטה_${fileStamp(date)}`;
  return {
    partialPath: path.join(directory, `${stem}.partial.webm`),
    journalPath: path.join(directory, `${stem}.recording.json`),
    finalPath: path.join(directory, `${stem}.webm`),
    recoveredPath: path.join(directory, `${stem}_שוחזרה.webm`)
  };
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

module.exports = { recordingPaths, recoveryPathFor, storageLevel };
