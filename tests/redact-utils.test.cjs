const test = require('node:test');
const assert = require('node:assert/strict');
const { findSensitiveRegions, israeliIdValid, luhnValid, parseTesseractTsv, summarizeRegions } = require('../src/redact-utils.cjs');

// Builds OCR word boxes for one line: each word 20px per character, 10px gap.
function line(text, { lineId = '1.1.1', top = 100 } = {}) {
  let left = 10;
  return text.split(' ').map((word) => {
    const box = { line: lineId, left, top, width: word.length * 20, height: 30, confidence: 90, text: word };
    left += box.width + 10;
    return box;
  });
}

test('tesseract TSV word rows are parsed with line keys and boxes', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '4\t1\t1\t1\t1\t0\t10\t20\t300\t30\t-1\t',
    '5\t1\t1\t1\t1\t1\t10\t20\t120\t30\t96.1\tdana@example.com',
    '5\t1\t1\t1\t1\t2\t140\t20\t40\t30\t90\t '
  ].join('\n');
  assert.deepEqual(parseTesseractTsv(tsv), [{ line: '1.1.1', left: 10, top: 20, width: 120, height: 30, confidence: 96.1, text: 'dana@example.com' }]);
});

test('checksums reject random digit runs', () => {
  assert.equal(luhnValid('4580123456789012'), false);
  assert.equal(luhnValid('4111111111111111'), true);
  assert.equal(israeliIdValid('123456782'), true);
  assert.equal(israeliIdValid('123456789'), false);
});

test('email, phone, card, id, ip and link are found and boxed over their words only', () => {
  const words = [
    ...line('מייל dana@example.com טלפון 054-1234567', { lineId: '1.1.1', top: 10 }),
    ...line('כרטיס 4111 1111 1111 1111 ת.ז 123456782', { lineId: '1.1.2', top: 60 }),
    ...line('שרת 192.168.1.20 אתר https://example.com/a', { lineId: '1.1.3', top: 110 })
  ];
  const regions = findSensitiveRegions(words, { padding: 0 });
  assert.deepEqual(regions.map((region) => region.kind).sort(), ['card', 'email', 'id', 'ip', 'phone', 'url']);
  const email = regions.find((region) => region.kind === 'email');
  const emailWord = words.find((word) => word.text === 'dana@example.com');
  assert.deepEqual([email.left, email.top, email.width, email.height], [emailWord.left, emailWord.top, emailWord.width, emailWord.height]);
  const card = regions.find((region) => region.kind === 'card');
  const cardWords = words.filter((word) => /^\d{4}$/.test(word.text));
  assert.equal(card.left, cardWords[0].left);
  assert.equal(card.left + card.width, cardWords[3].left + cardWords[3].width);
});

test('a card number is not double-reported as a phone, and invalid numbers are ignored', () => {
  const regions = findSensitiveRegions(line('4111 1111 1111 1111 וגם 4580123456789012 ו-123456789'), { padding: 0 });
  assert.deepEqual(regions.map((region) => region.kind), ['card']);
});

test('padding grows the box but never below zero; kinds filter and summary', () => {
  const [region] = findSensitiveRegions(line('a@b.co'), { padding: 50 });
  assert.equal(region.left, 0);
  assert.equal(region.top, 50);
  assert.deepEqual(findSensitiveRegions(line('a@b.co 054-1234567'), { kinds: ['phone'] }).map((item) => item.kind), ['phone']);
  assert.equal(summarizeRegions([{ label: 'טלפון' }, { label: 'טלפון' }, { label: 'דוא"ל' }]), '2 טלפון, 1 דוא"ל');
});

test('OCR noise between digit groups does not hide a phone or card number', () => {
  assert.deepEqual(findSensitiveRegions(line('Phone: 052-/7654321')).map((item) => item.kind), ['phone']);
  assert.deepEqual(findSensitiveRegions(line('Card: 4111 /1111 1111 |1111')).map((item) => item.kind), ['card']);
  assert.deepEqual(findSensitiveRegions(line('Order 2026/10/05 total 120.50')), []);
});
