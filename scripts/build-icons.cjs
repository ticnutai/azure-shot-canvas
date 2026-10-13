// Draws build/icon.svg into the icon files the program needs (run again after changing the drawing):
//   build/icon.ico            installer, program file and taskbar (16 … 256)
//   build/icon.png            512 × 512
//   src/assets/app-icon.png   window icon (256)
//   src/assets/tray.png       tray icon next to the clock (16, with tray@2x.png 32 and tray@3x.png 48)
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

// An .ico file may hold PNG pictures directly: a 6-byte header, a 16-byte entry per picture, then the pictures.
function icoFrom(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

(async () => {
  const svg = await fs.readFile(path.join(root, 'build', 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="256" height="256"', `width="${size}" height="${size}"`)}</body></html>`);
    return page.locator('svg').screenshot({ omitBackground: true });
  };
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, png: await render(size) });
  await fs.mkdir(path.join(root, 'src', 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'build', 'icon.ico'), icoFrom(images));
  await fs.writeFile(path.join(root, 'build', 'icon.png'), await render(512));
  await fs.writeFile(path.join(root, 'src', 'assets', 'app-icon.png'), await render(256));
  await fs.writeFile(path.join(root, 'src', 'assets', 'tray.png'), await render(16));
  await fs.writeFile(path.join(root, 'src', 'assets', 'tray@2x.png'), await render(32));
  await fs.writeFile(path.join(root, 'src', 'assets', 'tray@3x.png'), await render(48));
  await browser.close();
  console.log(`icons written: ${ICO_SIZES.join(', ')} + 512`);
})().catch((error) => { console.error(error); process.exit(1); });
