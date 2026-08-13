const { chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const outputDir = path.resolve('artifacts/reference');
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    colorScheme: 'dark'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('https://azure-shot-canvas.lovable.app', { waitUntil: 'networkidle', timeout: 60_000 });
  if (!response?.ok()) throw new Error(`Reference returned HTTP ${response?.status()}`);
  await page.screenshot({ path: path.join(outputDir, 'aurum-baseline-1440x1100.png'), fullPage: true });
  const geometry = await page.evaluate(() => ({
    title: document.title,
    direction: document.documentElement.dir || document.body.dir,
    viewport: { width: innerWidth, height: innerHeight },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    headings: [...document.querySelectorAll('h1,h2,h3')].map((node) => node.textContent.trim()),
    buttons: [...document.querySelectorAll('button')].map((node) => node.textContent.trim()).filter(Boolean)
  }));
  await fs.writeFile(path.join(outputDir, 'aurum-baseline.json'), JSON.stringify({ geometry, errors }, null, 2));
  await browser.close();
  if (errors.length) throw new Error(`Reference console errors: ${errors.join(' | ')}`);
  process.stdout.write(`${JSON.stringify(geometry)}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
