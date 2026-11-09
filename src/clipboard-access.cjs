// The clipboard, in one place. Since Electron 44 the clipboard follows the web's model: every call returns a promise,
// and a picture is written and read as a PNG item (writeImage / readImage are gone). Windows still gets an ordinary
// bitmap too, so a copied picture pastes into every program.
const { clipboard, nativeImage, ClipboardItem } = require('electron');

const pngOf = (image) => (Buffer.isBuffer(image) || image instanceof Uint8Array ? Buffer.from(image) : image.toPNG());

// image: a nativeImage, or PNG bytes.
async function writeImage(image) {
  const png = pngOf(image);
  if (!png.length) return;
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
}

// The picture on the clipboard as a nativeImage (empty when there is none).
async function readImage() {
  try {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = await item.getType('image/png');
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
    }
  } catch {}
  return nativeImage.createEmpty();
}

const writeText = (text) => clipboard.writeText(String(text ?? ''));
const readText = () => clipboard.readText().catch(() => '');
const clear = () => clipboard.clear();

module.exports = { clear, readImage, readText, writeImage, writeText };
