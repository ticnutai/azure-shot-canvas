// Reads a QR code from a captured picture (raw screen pixels: blue-green-red-alpha, as Windows gives them).
const jsQR = require('jsqr');

function readCode(bitmap, width, height) {
  if (!bitmap || !width || !height) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = bitmap[index + 2];
    rgba[index + 1] = bitmap[index + 1];
    rgba[index + 2] = bitmap[index];
    rgba[index + 3] = 255;
  }
  // Dark-on-light and light-on-dark codes alike (dark themes show inverted codes).
  const found = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  const text = found?.data?.trim();
  return text ? text : null;
}

// A web or mail address that is safe to offer to open (nothing that could run a program).
const isOpenableLink = (text) => /^(https?:\/\/|mailto:)[^\s]+$/i.test(String(text || ''));

module.exports = { readCode, isOpenableLink };
