const path = require('node:path');

// The one place that knows which files the studio makes and lists. Everything else asks here.
const MEDIA_EXTENSIONS = Object.freeze({ image: ['png', 'jpg', 'webp'], video: ['webm', 'mp4', 'mov', 'gif'], document: ['pdf'] });
const ALLOWED_EXTENSIONS = new Set(Object.values(MEDIA_EXTENSIONS).flat());
const extensionPattern = (extensions) => new RegExp(`\\.(${extensions.join('|')})$`, 'i');
const LIBRARY_FILE = extensionPattern([...ALLOWED_EXTENSIONS]);
const IMAGE_FILE = extensionPattern(MEDIA_EXTENSIONS.image);
// GIF is a finished animation: it can be listed and opened, not cut in the video editor.
const EDITABLE_VIDEO_FILE = extensionPattern(['webm', 'mp4', 'mov']);

function mediaKind(fileNameOrExtension) {
  const extension = String(fileNameOrExtension || '').toLowerCase().replace(/^.*\./, '');
  return Object.keys(MEDIA_EXTENSIONS).find((kind) => MEDIA_EXTENSIONS[kind].includes(extension)) || null;
}

function safeExtension(extension) {
  const normalized = String(extension || '').toLowerCase().replace(/^\./, '');
  if (!ALLOWED_EXTENSIONS.has(normalized)) {
    throw new Error(`Unsupported file extension: ${extension}`);
  }
  return normalized;
}

function fileStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${millis}`;
}

// A window title as a short, safe file name: the program first, then the document — "Word – הצעת מחיר".
// Direction marks, profile names and characters Windows forbids in names are removed; null when nothing is left.
function nameFromWindowTitle(title) {
  const clean = String(title || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const parts = clean.split(/\s+[-–—]\s+/).map((part) => part.trim()).filter((part) => part && !/^(?:פרופיל|profile)\s*\d*$/i.test(part));
  let name = parts.join(' – ');
  if (parts.length > 1 && parts[parts.length - 1].length <= 30) {
    const program = parts[parts.length - 1];
    const documentName = parts.slice(0, -1).join(' – ').replace(/\.[a-z0-9]{2,5}$/i, '');
    name = `${program} – ${documentName}`;
  }
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  if (name.length > 60) name = `${name.slice(0, 59).trim()}…`;
  return name || null;
}

// Capture file name: '<window>_<time>' when the window is known, otherwise 'צילום_<time>' / 'הקלטה_<time>'.
function captureFilePath(outputDirectory, kind, extension, date = new Date(), title = null) {
  const ext = safeExtension(extension);
  const label = nameFromWindowTitle(title) || (kind === 'screenshot' ? 'צילום' : 'הקלטה');
  return path.join(outputDirectory, `${label}_${fileStamp(date)}.${ext}`);
}

function qualityPreset(key) {
  const presets = {
    text: { fps: 15, videoBitsPerSecond: 30_000_000, label: 'מסמכים וטקסט' },
    balanced: { fps: 30, videoBitsPerSecond: 18_000_000, label: 'איכות רגילה' },
    motion: { fps: 60, videoBitsPerSecond: 28_000_000, label: 'תנועה חלקה' }
  };
  return presets[key] || presets.balanced;
}

function developerShortcut(input = {}) {
  if (input.type && input.type !== 'keyDown') return null;
  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  const physicalR = code === 'keyr' || key === 'r' || key === 'ר';
  const physicalI = code === 'keyi' || key === 'i' || key === 'ן';
  if (input.control && input.shift && physicalR) return 'hard-reload';
  if ((input.control && input.shift && physicalI) || key === 'f12' || code === 'f12') return 'toggle-devtools';
  return null;
}

module.exports = { nameFromWindowTitle, EDITABLE_VIDEO_FILE, IMAGE_FILE, LIBRARY_FILE, MEDIA_EXTENSIONS, captureFilePath, developerShortcut, extensionPattern, fileStamp, mediaKind, qualityPreset, safeExtension };
