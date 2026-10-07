// Shared by the main process (require) and the studio window (script tag → window.AurumShortcuts): one copy of the shortcut catalog.
(function exposeShortcuts(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AurumShortcuts = api;
})(typeof window !== 'undefined' ? window : null, () => {

const ACTION_DEFINITIONS = Object.freeze({
  record: { category: 'recording', label: 'התחלה / עצירת הקלטה', description: 'מחליף מצב לפי מצב ההקלטה הנוכחי' },
  recordStart: { category: 'recording', label: 'התחלת הקלטה', description: 'מתחיל רק אם אין הקלטה פעילה' },
  recordStop: { category: 'recording', label: 'עצירת הקלטה', description: 'עוצר ושומר רק הקלטה פעילה' },
  recordRegion: { category: 'recording', label: 'הקלטת אזור', description: 'בוחרים אזור או חלון על המסך הקפוא וההקלטה מתחילה' },
  pause: { category: 'recording', label: 'השהיה / המשך', description: 'מחליף בין השהיה להמשך' },
  screenshot: { category: 'capture', label: 'צילום מסך מלא', description: 'מצלם מיד את המקור שנבחר' },
  region: { category: 'capture', label: 'צילום אזור', description: 'פותח בחירת שטח לפני הצילום' },
  repeatRegion: { category: 'capture', label: 'צילום האזור האחרון', description: 'מצלם מיד את האזור שנבחר בפעם הקודמת, בלי לבחור שוב' },
  ocrRegion: { category: 'capture', label: 'העתקת טקסט מאזור', description: 'בוחרים אזור על המסך הקפוא והטקסט שבו, גם בעברית, מועתק ללוח' },
  scrollCapture: { category: 'capture', label: 'צילום עמוד גלילה', description: 'צילום מודרך של עמוד ארוך עם חיבור אוטומטי' },
  screenshotEdit: { category: 'capture', label: 'צילום ופתיחה בעורך', description: 'מצלם ופותח עריכה מקצועית' },
  microphone: { category: 'audio', label: 'השתקת מיקרופון', description: 'הפעלה או השתקה של המיקרופון' },
  systemAudio: { category: 'audio', label: 'קול המחשב', description: 'הפעלה או השתקה של שמע המחשב' },
  camera: { category: 'camera', label: 'הפעלת מצלמה', description: 'הצגה או הסתרה של המצלמה' },
  openOutput: { category: 'library', label: 'פתיחת תיקיית השמירה', description: 'פותח ישירות את תיקיית הקבצים' },
  openLibrary: { category: 'library', label: 'פתיחת הספרייה', description: 'עובר לעמוד כל הצילומים והווידאו' },
  openLatest: { category: 'library', label: 'פתיחת הקובץ האחרון', description: 'פותח את הקובץ האחרון שנשמר' },
  editLatest: { category: 'library', label: 'עריכת הצילום האחרון', description: 'פותח את התמונה האחרונה בעורך' },
  toggleWindow: { category: 'window', label: 'הצגה / הסתרת האפליקציה', description: 'מסתיר או מחזיר את חלון האולפן' }
});

const DEFAULT_SHORTCUTS = Object.freeze({
  record: Object.freeze({ kind: 'chord', code: 'Digit2', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 }),
  recordStart: null,
  recordStop: Object.freeze({ kind: 'single', code: 'F10', modifiers: [], scope: 'global', intervalMs: 300 }),
  // The number row keeps every default clear of common programs (Ctrl+Shift+C/P/M/O belong to terminals, code editors and browsers).
  pause: Object.freeze({ kind: 'chord', code: 'Digit5', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 }),
  screenshot: Object.freeze({ kind: 'chord', code: 'Digit1', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 }),
  // The capture key every professional capture tool uses: PrtSc alone for an area (frozen screen + marks),
  // Shift+PrtSc for the previous area at once, Ctrl+PrtSc to copy the text of an area.
  region: Object.freeze({ kind: 'single', code: 'PrintScreen', modifiers: [], scope: 'global', intervalMs: 300 }),
  repeatRegion: Object.freeze({ kind: 'chord', code: 'PrintScreen', modifiers: ['Shift'], scope: 'global', intervalMs: 300 }),
  ocrRegion: Object.freeze({ kind: 'chord', code: 'PrintScreen', modifiers: ['Ctrl'], scope: 'global', intervalMs: 300 }),
  scrollCapture: null,
  recordRegion: null,
  screenshotEdit: null,
  microphone: Object.freeze({ kind: 'chord', code: 'Digit6', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 }),
  systemAudio: null,
  camera: Object.freeze({ kind: 'chord', code: 'Digit7', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 }),
  openOutput: Object.freeze({ kind: 'chord', code: 'Digit8', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 }),
  openLibrary: null,
  openLatest: null,
  editLatest: null,
  toggleWindow: Object.freeze({ kind: 'double', code: 'F9', modifiers: [], scope: 'global', intervalMs: 500 })
});

const ACTION_LABELS = Object.freeze(Object.fromEntries(Object.entries(ACTION_DEFINITIONS).map(([key, value]) => [key, value.label])));
const RESERVED_SIGNATURES = Object.freeze({
  'Ctrl+Shift|KeyR|global': 'רענון עמוק',
  'Ctrl+Shift|KeyI|global': 'קונסול מפתחים',
  '|F12|global': 'קונסול מפתחים'
});
// System-wide shortcuts that other popular programs rely on: allowed, but the settings screen warns before taking them over.
const COMMON_APP_SHORTCUTS = Object.freeze({
  'Ctrl+Shift|KeyC|global': 'העתקה בחלון הפקודות ובודק הרכיבים בדפדפן',
  'Ctrl+Shift|KeyP|global': 'לוח הפקודות בעורכי קוד וחלון פרטי בדפדפן',
  'Ctrl+Shift|KeyM|global': 'החלפת משתמש בדפדפן',
  'Ctrl+Shift|KeyO|global': 'מנהל הסימניות בדפדפן',
  'Ctrl+Shift|KeyN|global': 'חלון גלישה פרטית ותיקייה חדשה בסייר הקבצים',
  'Ctrl+Shift|KeyT|global': 'פתיחה מחדש של לשונית שנסגרה בדפדפן',
  'Ctrl+Shift|KeyV|global': 'הדבקה בחלון הפקודות',
  'Ctrl+Shift|KeyS|global': 'שמירה בשם בתוכנות משרד',
  'Ctrl+Shift|Escape|global': 'מנהל המשימות של חלונות',
  'Ctrl+Alt|Delete|global': 'מסך האבטחה של חלונות'
});
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const KEY_CODE_PATTERN = /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|PrintScreen|Numpad[0-9]|Space|Enter|Escape|Arrow(?:Up|Down|Left|Right)|(?:Shift|Control|Alt|Meta)(?:Left|Right)|Backslash|Backquote|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash)$/;
// Punctuation keys by physical position (the same key on Hebrew and English layouts), as Electron names them.
const PUNCTUATION_KEYS = Object.freeze({ Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' });

function legacyBinding(value) {
  const parts = String(value || '').split('+').filter(Boolean);
  const code = parts.find((part) => KEY_CODE_PATTERN.test(part));
  if (!code) return null;
  return { kind: 'chord', code, modifiers: MODIFIER_ORDER.filter((modifier) => parts.includes(modifier)), scope: 'global', intervalMs: 300 };
}

function normalizeBinding(value) {
  if (!value) return null;
  if (typeof value === 'string') return normalizeBinding(legacyBinding(value));
  const kind = ['chord', 'single', 'double'].includes(value.kind) ? value.kind : 'chord';
  const code = String(value.code || '');
  if (!KEY_CODE_PATTERN.test(code)) return null;
  const modifiers = kind === 'chord' ? MODIFIER_ORDER.filter((modifier) => Array.isArray(value.modifiers) && value.modifiers.includes(modifier)) : [];
  if (kind === 'chord' && !modifiers.length && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return null;
  if (/^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(code)) return null;
  let scope = value.scope === 'focused' ? 'focused' : 'global';
  if (scope === 'global' && kind !== 'chord' && /^(?:Key[A-Z]|Digit[0-9])$/.test(code)) scope = 'focused';
  if (scope === 'global' && /^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(code)) return null;
  const intervalMs = Math.max(180, Math.min(700, Number(value.intervalMs) || 300));
  return { kind, code, modifiers, scope, intervalMs };
}

function bindingFromInput(input = {}, template = {}) {
  if (input.type && input.type !== 'keyDown') return null;
  const code = String(input.code || '');
  if (!KEY_CODE_PATTERN.test(code)) return null;
  const kind = ['single', 'double'].includes(template.kind) ? template.kind : 'chord';
  const modifiers = [];
  if (kind === 'chord') {
    if (input.control || input.ctrlKey) modifiers.push('Ctrl');
    if (input.alt || input.altKey) modifiers.push('Alt');
    if (input.shift || input.shiftKey) modifiers.push('Shift');
    if (input.meta || input.metaKey) modifiers.push('Meta');
  }
  return normalizeBinding({ kind, code, modifiers, scope: template.scope, intervalMs: template.intervalMs });
}

function electronKey(code) {
  if (PUNCTUATION_KEYS[code]) return PUNCTUATION_KEYS[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'num').replace('Space', 'Space').replace('Enter', 'Return');
}

function bindingLabel(value) {
  const binding = normalizeBinding(value);
  if (!binding) return 'לא מוגדר';
  const key = electronKey(binding.code).replace('PrintScreen', 'PrtSc').replace('ControlLeft', 'Ctrl שמאל').replace('ControlRight', 'Ctrl ימין').replace('ShiftLeft', 'Shift שמאל').replace('ShiftRight', 'Shift ימין');
  const prefix = binding.kind === 'double' ? 'פעמיים ' : '';
  return `${prefix}${[...binding.modifiers, key].join(' + ')}`;
}

function acceleratorForBinding(value) {
  const binding = normalizeBinding(value);
  if (!binding || binding.scope !== 'global' || /^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(binding.code)) return null;
  return [...binding.modifiers.map((modifier) => modifier === 'Ctrl' ? 'CommandOrControl' : modifier), electronKey(binding.code)].join('+');
}

function normalizeShortcutMap(candidate = {}) {
  const result = {};
  for (const action of Object.keys(ACTION_DEFINITIONS)) result[action] = normalizeBinding(candidate[action] ?? DEFAULT_SHORTCUTS[action]);
  return result;
}

function bindingSignature(value) {
  const binding = normalizeBinding(value);
  return binding ? `${binding.modifiers.join('+')}|${binding.code}|${binding.scope}` : null;
}

function shortcutConflicts(candidate = {}) {
  const shortcuts = normalizeShortcutMap(candidate);
  const seen = new Map();
  const conflicts = [];
  for (const [action, binding] of Object.entries(shortcuts)) {
    const signature = bindingSignature(binding);
    if (!signature) continue;
    if (seen.has(signature)) conflicts.push([seen.get(signature), action, signature]);
    else seen.set(signature, action);
  }
  return conflicts;
}

function reservedShortcutConflicts(candidate = {}) {
  const shortcuts = normalizeShortcutMap(candidate);
  return Object.entries(shortcuts).flatMap(([action, binding]) => {
    const signature = bindingSignature(binding);
    return RESERVED_SIGNATURES[signature] ? [[action, RESERVED_SIGNATURES[signature], signature]] : [];
  });
}

function commonAppConflict(value) {
  return COMMON_APP_SHORTCUTS[bindingSignature(value)] || '';
}

function inputMatchesBinding(input, value) {
  const binding = normalizeBinding(value);
  if (!binding || (input.type && input.type !== 'keyDown') || input.code !== binding.code) return false;
  if (binding.kind !== 'chord') {
    if (/^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(binding.code)) return true;
    return !(input.control || input.ctrlKey || input.alt || input.altKey || input.shift || input.shiftKey || input.meta || input.metaKey);
  }
  const actual = bindingFromInput(input, binding);
  return Boolean(actual && bindingSignature(actual) === bindingSignature(binding));
}

function actionForInput(input, candidate = DEFAULT_SHORTCUTS) {
  const shortcuts = normalizeShortcutMap(candidate);
  return Object.keys(shortcuts).find((action) => shortcuts[action]?.kind !== 'double' && inputMatchesBinding(input, shortcuts[action])) || null;
}

return {
  ACTION_DEFINITIONS, ACTION_LABELS, COMMON_APP_SHORTCUTS, DEFAULT_SHORTCUTS, RESERVED_SIGNATURES, commonAppConflict,
  acceleratorForBinding, actionForInput, bindingFromInput, bindingLabel, bindingSignature,
  inputMatchesBinding, normalizeBinding, normalizeShortcutMap, reservedShortcutConflicts, shortcutConflicts
};
});
