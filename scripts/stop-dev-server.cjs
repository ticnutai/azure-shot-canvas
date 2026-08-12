const http = require('node:http');

function health(port) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/__health', timeout: 500 }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.service === 'aurum-screen-studio-dev' ? data : null);
        } catch { resolve(null); }
      });
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => { request.destroy(); resolve(null); });
  });
}

(async () => {
  let stopped = 0;
  const base = Number(process.env.SCREEN_STUDIO_PORT || 4173);
  for (let port = base; port < base + 20; port += 1) {
    const server = await health(port);
    if (!server?.pid || server.pid === process.pid) continue;
    try {
      process.kill(server.pid, 'SIGTERM');
      process.stdout.write(`נסגר שרת Aurum מאומת בפורט ${port}, PID ${server.pid}\n`);
      stopped += 1;
    } catch (error) { process.stderr.write(`לא ניתן לסגור PID ${server.pid}: ${error.message}\n`); }
  }
  if (!stopped) process.stdout.write('לא נמצא שרת Aurum פעיל.\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });
