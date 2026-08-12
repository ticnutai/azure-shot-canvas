const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const host = '127.0.0.1';
const root = path.resolve(__dirname, '../src');
const marker = 'aurum-screen-studio-dev';
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

function probe(port) {
  return new Promise((resolve) => {
    const request = http.get({ host, port, path: '/__health', timeout: 700 }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(response.statusCode === 200 && body.includes(marker)));
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}

async function startDevServer(options = {}) {
  const requestedPort = Number(options.port || process.env.SCREEN_STUDIO_PORT || 4173);
  if (await probe(requestedPort)) return { url: `http://${host}:${requestedPort}`, port: requestedPort, reused: true, close: async () => {} };
  const clients = new Set();
  let selectedPort;
  let server;
  for (let port = requestedPort; port < requestedPort + 20; port += 1) {
    try {
      server = http.createServer(async (request, response) => {
        const url = new URL(request.url, `http://${host}`);
        if (url.pathname === '/__health') {
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          return response.end(JSON.stringify({ ok: true, service: marker, port: selectedPort, pid: process.pid }));
        }
        if (url.pathname === '/__events') {
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          response.write('event: ready\ndata: connected\n\n');
          clients.add(response);
          request.on('close', () => clients.delete(response));
          return;
        }
        const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^[/\\]+/, '');
        const filePath = path.resolve(root, relative);
        if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
          response.writeHead(403); return response.end('Forbidden');
        }
        try {
          const data = await fsp.readFile(filePath);
          response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store, max-age=0' });
          response.end(data);
        } catch {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found');
        }
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      selectedPort = port;
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  if (!server?.listening) throw new Error(`לא נמצא פורט פנוי בטווח ${requestedPort}-${requestedPort + 19}`);
  let reloadTimer;
  const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      for (const client of clients) client.write(`event: reload\ndata: ${JSON.stringify(filename)}\n\n`);
    }, 120);
  });
  return {
    url: `http://${host}:${selectedPort}`, port: selectedPort, reused: false,
    close: () => new Promise((resolve) => { watcher.close(); for (const client of clients) client.end(); server.close(resolve); })
  };
}

module.exports = { host, marker, probe, startDevServer };
