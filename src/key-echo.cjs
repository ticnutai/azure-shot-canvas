// Keys shown on screen during a recording (for tutorials): only shortcuts and special keys, never plain typing —
// letters, digits and symbols on their own (or with Shift) could be a password, so they are not shown.
const MODIFIER_KEYS = new Set([0x10, 0x11, 0x12, 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]);
const SPECIAL = {
  0x08: 'מחיקה אחורה', 0x09: 'טאב', 0x0d: 'אנטר', 0x1b: 'אסקייפ', 0x20: 'רווח', 0x21: 'עמוד למעלה', 0x22: 'עמוד למטה',
  0x23: 'סוף', 0x24: 'בית', 0x25: '←', 0x26: '↑', 0x27: '→', 0x28: '↓', 0x2c: 'צילום מסך', 0x2d: 'הוספה', 0x2e: 'מחיקה'
};
// Keys that are named only together with a modifier (alone they are typing).
const PLAIN = { 0xba: ';', 0xbb: '=', 0xbc: ',', 0xbd: '-', 0xbe: '.', 0xbf: '/', 0xc0: '`', 0xdb: '[', 0xdc: '\\', 0xdd: ']', 0xde: "'" };

function keyName(vk) {
  if (SPECIAL[vk]) return SPECIAL[vk];
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`;
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk);
  if (vk >= 0x60 && vk <= 0x69) return String(vk - 0x60);
  return PLAIN[vk] || null;
}

// vk: the Windows key code; modifiers: a string of letters — c (Control), a (Alt), s (Shift), w (Windows).
// Returns the label to show, or null when the key must not be shown.
function keyLabel(vk, modifiers = '') {
  const code = Number(vk);
  if (!Number.isInteger(code) || MODIFIER_KEYS.has(code)) return null;
  const name = keyName(code);
  if (!name) return null;
  const control = modifiers.includes('c');
  const alt = modifiers.includes('a');
  const windows = modifiers.includes('w');
  const shift = modifiers.includes('s');
  const special = Boolean(SPECIAL[code]) || (code >= 0x70 && code <= 0x87);
  // Typing (with or without Shift) is never shown; a space while typing is typing too.
  if (!control && !alt && !windows && (!special || code === 0x20)) return null;
  const parts = [];
  if (windows) parts.push('חלונות');
  if (control) parts.push('קונטרול');
  if (alt) parts.push('אלט');
  if (shift) parts.push('שיפט');
  parts.push(name);
  return parts.join(' + ');
}

module.exports = { keyLabel };
