const DEFAULT_SHORTCUTS = Object.freeze({
  record: 'Ctrl+Shift+Digit2',
  screenshot: 'Ctrl+Shift+Digit1',
  region: 'Ctrl+Shift+Digit3',
  pause: 'Ctrl+Shift+KeyP',
  microphone: 'Ctrl+Shift+KeyM',
  camera: 'Ctrl+Shift+KeyC'
});

const ACTION_LABELS = Object.freeze({
  record: 'התחלה / עצירת הקלטה',
  screenshot: 'צילום מסך מלא',
  region: 'צילום אזור',
  pause: 'השהיה / המשך',
  microphone: 'השתקת מיקרופון',
  camera: 'הפעלת מצלמה'
});

const RESERVED_SHORTCUTS = Object.freeze({
  'Ctrl+Shift+KeyR': 'רענון עמוק',
  'Ctrl+Shift+KeyI': 'קונסול מפתחים',
  F12: 'קונסול מפתחים'
});

function normalizeBinding(value) {
  const parts = String(value || '').split('+').filter(Boolean);
  const code = parts.find((part) => /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/.test(part));
  if (!code) return null;
  const modifiers = [];
  if (parts.includes('Ctrl')) modifiers.push('Ctrl');
  if (parts.includes('Alt')) modifiers.push('Alt');
  if (parts.includes('Shift')) modifiers.push('Shift');
  if (parts.includes('Meta')) modifiers.push('Meta');
  if (!modifiers.length && !/^F(?:[1-9]|1[0-2])$/.test(code)) return null;
  return [...modifiers, code].join('+');
}

function bindingFromInput(input = {}) {
  if (input.type && input.type !== 'keyDown') return null;
  const code = String(input.code || '');
  if (!/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/.test(code)) return null;
  const parts = [];
  if (input.control || input.ctrlKey) parts.push('Ctrl');
  if (input.alt || input.altKey) parts.push('Alt');
  if (input.shift || input.shiftKey) parts.push('Shift');
  if (input.meta || input.metaKey) parts.push('Meta');
  parts.push(code);
  return normalizeBinding(parts.join('+'));
}

function bindingLabel(binding) {
  const normalized = normalizeBinding(binding);
  if (!normalized) return 'לא מוגדר';
  return normalized.replace(/Key([A-Z])/g, '$1').replace(/Digit([0-9])/g, '$1').replace(/Ctrl/g, 'Ctrl');
}

function acceleratorForBinding(binding) {
  const normalized = normalizeBinding(binding);
  if (!normalized) return null;
  return normalized
    .replace('Ctrl', 'CommandOrControl')
    .replace(/Key([A-Z])/g, '$1')
    .replace(/Digit([0-9])/g, '$1');
}

function normalizeShortcutMap(candidate = {}) {
  const result = {};
  for (const [action, fallback] of Object.entries(DEFAULT_SHORTCUTS)) {
    result[action] = normalizeBinding(candidate[action]) || fallback;
  }
  return result;
}

function shortcutConflicts(candidate = {}) {
  const shortcuts = normalizeShortcutMap(candidate);
  const seen = new Map();
  const conflicts = [];
  for (const [action, binding] of Object.entries(shortcuts)) {
    if (seen.has(binding)) conflicts.push([seen.get(binding), action, binding]);
    else seen.set(binding, action);
  }
  return conflicts;
}

function reservedShortcutConflicts(candidate = {}) {
  const shortcuts = normalizeShortcutMap(candidate);
  return Object.entries(shortcuts)
    .filter(([, binding]) => RESERVED_SHORTCUTS[binding])
    .map(([action, binding]) => [action, RESERVED_SHORTCUTS[binding], binding]);
}

function actionForInput(input, candidate = DEFAULT_SHORTCUTS) {
  const binding = bindingFromInput(input);
  if (!binding) return null;
  const shortcuts = normalizeShortcutMap(candidate);
  return Object.keys(shortcuts).find((action) => shortcuts[action] === binding) || null;
}

module.exports = {
  ACTION_LABELS,
  DEFAULT_SHORTCUTS,
  RESERVED_SHORTCUTS,
  acceleratorForBinding,
  actionForInput,
  bindingFromInput,
  bindingLabel,
  normalizeBinding,
  normalizeShortcutMap,
  reservedShortcutConflicts,
  shortcutConflicts
};
