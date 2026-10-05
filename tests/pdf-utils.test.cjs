const test = require('node:test');
const assert = require('node:assert/strict');
const { pdfFromJpeg } = require('../src/pdf-utils.cjs');

const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7), Buffer.from([0xff, 0xd9])]);

test('PDF wraps the JPEG unchanged with a page sized at 96 dpi', () => {
  const pdf = pdfFromJpeg(fakeJpeg, 1600, 900);
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/MediaBox \[0 0 1200 675\]/);
  assert.match(text, new RegExp(`/Width 1600 /Height 900 .*?/Filter /DCTDecode /Length ${fakeJpeg.length}`));
  assert.ok(pdf.includes(fakeJpeg), 'JPEG bytes embedded as-is');
});

test('cross-reference table points exactly at every object', () => {
  const pdf = pdfFromJpeg(fakeJpeg, 10, 10);
  const text = pdf.toString('latin1');
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  assert.equal(entries.length, 5);
  entries.forEach((offset, index) => assert.equal(text.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`));
});
