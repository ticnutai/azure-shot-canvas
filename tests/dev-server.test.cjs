const test = require('node:test');
const assert = require('node:assert/strict');
const { startDevServer } = require('../scripts/dev-server-lib.cjs');

test('localhost server exposes health, no-cache files and reuses an existing instance', async () => {
  const requestedPort = 45000 + Math.floor(Math.random() * 1000);
  const first = await startDevServer({ port: requestedPort });
  try {
    const health = await fetch(`${first.url}/__health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'aurum-screen-studio-dev');
    const page = await fetch(first.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('cache-control'), /no-store/);
    assert.match(await page.text(), /browser-api\.js/);
    const reused = await startDevServer({ port: first.port });
    assert.equal(reused.reused, true);
    assert.equal(reused.url, first.url);
  } finally { await first.close(); }
});
