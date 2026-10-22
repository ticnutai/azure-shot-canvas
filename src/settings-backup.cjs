// A backup of every setting in one file, to move to another computer or to come back to after a reinstall:
// the small settings files of the program plus the choices the settings page keeps in the browser storage.
// Only known file names and only keys that start with "aurum-" are ever written back, whatever the file says.
const FORMAT = 'aurum-settings';
const FILES = ['quickbar-preferences.json', 'workspace-window.json', 'workspace-tools.json', 'features.json'];
const MAX_VALUE = 400_000;
const MAX_KEYS = 200;

function buildBackup({ files = {}, local = {}, version = '' } = {}) {
  const kept = {};
  for (const name of FILES) if (files[name] && typeof files[name] === 'object') kept[name] = files[name];
  const stored = {};
  for (const [key, value] of Object.entries(local)) if (key.startsWith('aurum-') && typeof value === 'string' && value.length <= MAX_VALUE) stored[key] = value;
  return { format: FORMAT, version: String(version), at: new Date().toISOString(), files: kept, local: stored };
}

// Throws a short Hebrew message for anything that is not a backup of this program.
function readBackup(text) {
  let data;
  try { data = JSON.parse(String(text)); } catch { throw new Error('הקובץ אינו קובץ גיבוי תקין'); }
  if (!data || data.format !== FORMAT) throw new Error('זה לא קובץ גיבוי של התוכנה');
  const files = {};
  for (const name of FILES) if (data.files && data.files[name] && typeof data.files[name] === 'object' && !Array.isArray(data.files[name])) files[name] = data.files[name];
  const local = {};
  let count = 0;
  for (const [key, value] of Object.entries(data.local && typeof data.local === 'object' ? data.local : {})) {
    if (!/^aurum-[a-z0-9-]{1,60}$/.test(key) || typeof value !== 'string' || value.length > MAX_VALUE) continue;
    if (++count > MAX_KEYS) break;
    local[key] = value;
  }
  if (!Object.keys(files).length && !Object.keys(local).length) throw new Error('בקובץ הגיבוי אין הגדרות');
  return { files, local, version: String(data.version || '') };
}

module.exports = { FILES, FORMAT, buildBackup, readBackup };
