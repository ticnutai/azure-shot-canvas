const path = require('node:path');

const ALLOWED_EXTENSIONS = new Set(['png', 'webm', 'mp4']);

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

function captureFilePath(outputDirectory, kind, extension, date = new Date()) {
  const ext = safeExtension(extension);
  const label = kind === 'screenshot' ? 'צילום' : 'הקלטה';
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

module.exports = { captureFilePath, developerShortcut, fileStamp, qualityPreset, safeExtension };
