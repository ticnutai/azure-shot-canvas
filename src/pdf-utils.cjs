// Minimal single-page PDF that embeds one JPEG as-is (DCTDecode) — no re-encoding, no dependency.
// The page is the image size at 96 dpi (pixels × 0.75 = points), so it prints at its on-screen size.

function pdfFromJpeg(jpeg, width, height) {
  const pageWidth = Number((width * 0.75).toFixed(2));
  const pageHeight = Number((height * 0.75).toFixed(2));
  const content = Buffer.from(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q\n`, 'latin1');
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1'); parts.push(buffer); length += buffer.length; };
  const object = (number, body) => { offsets[number] = length; push(`${number} 0 obj\n`); for (const piece of [].concat(body)) push(piece); push('\nendobj\n'); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
  object(5, [`<< /Length ${content.length} >>\nstream\n`, content, 'endstream']);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

module.exports = { pdfFromJpeg };
