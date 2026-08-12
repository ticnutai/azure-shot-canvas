const path = require('node:path');

function assertEditableImagePath(filePath, outputDirectory) {
  const resolved = path.resolve(String(filePath || ''));
  const library = path.resolve(outputDirectory);
  if (path.dirname(resolved).toLowerCase() !== library.toLowerCase()) throw new Error('ניתן לערוך רק תמונה מהספרייה המקומית');
  if (path.extname(resolved).toLowerCase() !== '.png') throw new Error('עורך התמונות תומך כרגע בקובצי PNG');
  return resolved;
}

function projectPathFor(imagePath) { return imagePath.replace(/\.png$/i, '.aurum.json'); }

function editedCopyPath(imagePath, exists = () => false) {
  const directory = path.dirname(imagePath);
  const stem = path.basename(imagePath, path.extname(imagePath));
  let index = 1;
  let candidate = path.join(directory, `${stem} — ערוך.png`);
  while (exists(candidate)) candidate = path.join(directory, `${stem} — ערוך ${++index}.png`);
  return candidate;
}

function dataUrlBytes(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('נתוני התמונה הערוכה אינם תקינים');
  return Buffer.from(match[1], 'base64');
}

module.exports = { assertEditableImagePath, dataUrlBytes, editedCopyPath, projectPathFor };
