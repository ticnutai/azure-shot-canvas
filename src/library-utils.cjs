const path = require('node:path');

function safeLibraryBaseName(value) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error('יש להזין שם קובץ תקין');
  return cleaned;
}

function renamedLibraryPath(currentPath, outputDirectory, requestedName) {
  const resolvedCurrent = path.resolve(currentPath);
  const resolvedDirectory = path.resolve(outputDirectory);
  if (path.dirname(resolvedCurrent).toLowerCase() !== resolvedDirectory.toLowerCase()) throw new Error('הקובץ אינו נמצא בספרייה המקומית');
  const extension = path.extname(resolvedCurrent).toLowerCase();
  if (!/^\.(png|webm|mp4)$/.test(extension)) throw new Error('סוג הקובץ אינו נתמך');
  return path.join(resolvedDirectory, `${safeLibraryBaseName(requestedName)}${extension}`);
}

module.exports = { renamedLibraryPath, safeLibraryBaseName };
