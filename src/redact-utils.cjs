// Finds sensitive values (emails, phones, card numbers, Israeli IDs, IPs, links) in OCR word boxes
// and returns the screen regions to black out. Pure functions — no I/O — so they are unit-testable.

function parseTesseractTsv(tsv) {
  const words = [];
  for (const line of String(tsv || '').split(/\r?\n/).slice(1)) {
    const cells = line.split('\t');
    if (cells.length < 12 || cells[0] !== '5') continue;
    const text = cells.slice(11).join('\t').trim();
    if (!text) continue;
    words.push({
      line: `${cells[2]}.${cells[3]}.${cells[4]}`,
      left: Number(cells[6]), top: Number(cells[7]), width: Number(cells[8]), height: Number(cells[9]),
      confidence: Number(cells[10]), text
    });
  }
  return words;
}

function luhnValid(digits) {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return digits.length >= 13 && digits.length <= 19 && sum % 10 === 0;
}

function israeliIdValid(digits) {
  if (!/^\d{9}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    const step = Number(digits[index]) * ((index % 2) + 1);
    sum += step > 9 ? step - 9 : step;
  }
  return sum % 10 === 0;
}

// Order matters: earlier kinds claim their characters first, so a card number is not also reported as a phone.
const PATTERNS = [
  { kind: 'email', label: 'דוא"ל', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'url', label: 'קישור', regex: /\b(?:https?:\/\/|www\.)[^\s]+/gi },
  { kind: 'card', label: 'כרטיס אשראי', regex: /\b(?:\d[ -]?){12,18}\d\b/g, check: (value) => luhnValid(value.replace(/\D/g, '')) },
  { kind: 'id', label: 'תעודת זהות', regex: /\b\d{9}\b/g, check: israeliIdValid },
  { kind: 'ip', label: 'כתובת רשת', regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: 'phone', label: 'טלפון', regex: /(?:\+972[ -]?|\b0)(?:[2-9]\d?)[ -]?\d{3}[ -]?\d{3,4}\b/g }
];

function findSensitiveRegions(words, { padding = 4, kinds = null } = {}) {
  const lines = new Map();
  for (const word of words) {
    if (!lines.has(word.line)) lines.set(word.line, []);
    lines.get(word.line).push(word);
  }
  const regions = [];
  for (const lineWords of lines.values()) {
    lineWords.sort((a, b) => a.left - b.left);
    let text = '';
    const spans = lineWords.map((word) => {
      if (text) text += ' ';
      const start = text.length;
      text += word.text;
      return { word, start, end: text.length };
    });
    const claimed = new Array(text.length).fill(false);
    for (const pattern of PATTERNS) {
      if (kinds && !kinds.includes(pattern.kind)) continue;
      for (const match of text.matchAll(pattern.regex)) {
        const start = match.index;
        const end = start + match[0].length;
        if (claimed.slice(start, end).some(Boolean)) continue;
        if (pattern.check && !pattern.check(match[0])) continue;
        claimed.fill(true, start, end);
        const covered = spans.filter((span) => span.start < end && span.end > start).map((span) => span.word);
        const left = Math.min(...covered.map((word) => word.left));
        const top = Math.min(...covered.map((word) => word.top));
        const right = Math.max(...covered.map((word) => word.left + word.width));
        const bottom = Math.max(...covered.map((word) => word.top + word.height));
        regions.push({
          kind: pattern.kind, label: pattern.label, text: match[0],
          left: Math.max(0, left - padding), top: Math.max(0, top - padding),
          width: right - left + padding * 2, height: bottom - top + padding * 2
        });
      }
    }
  }
  return regions;
}

function summarizeRegions(regions) {
  const counts = new Map();
  for (const region of regions) counts.set(region.label, (counts.get(region.label) || 0) + 1);
  return [...counts].map(([label, count]) => `${count} ${label}`).join(', ');
}

module.exports = { findSensitiveRegions, israeliIdValid, luhnValid, parseTesseractTsv, summarizeRegions };
