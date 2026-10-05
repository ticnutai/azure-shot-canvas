const path = require('node:path');
const { IMAGE_FILE } = require('./main-utils.cjs');

function assertEditableImagePath(filePath, outputDirectory) {
  const resolved = path.resolve(String(filePath || ''));
  const library = path.resolve(outputDirectory);
  if (path.dirname(resolved).toLowerCase() !== library.toLowerCase()) throw new Error('ניתן לערוך רק תמונה מהספרייה המקומית');
  if (!IMAGE_FILE.test(resolved)) throw new Error('עורך התמונות פותח רק תמונות (PNG, JPG, WEBP)');
  return resolved;
}

// Any image extension is replaced. (Replacing only '.png' returned a JPG's own path, so saving the project would overwrite the image.)
function projectPathFor(imagePath) { return imagePath.replace(/\.[^.\\/]+$/, '.aurum.json'); }

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
function imageMimeType(imagePath) { return IMAGE_MIME[path.extname(imagePath).slice(1).toLowerCase()] || 'image/png'; }

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

module.exports = { assertEditableImagePath, dataUrlBytes, editedCopyPath, imageMimeType, projectPathFor };
