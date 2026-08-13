const { execFile } = require('node:child_process');
const { startDevServer } = require('./dev-server-lib.cjs');

(async () => {
  const server = await startDevServer();
  process.stdout.write(`פותח localhost בלבד: ${server.url}\n`);
  if (process.platform === 'win32') execFile('explorer.exe', [server.url], { windowsHide: true });
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [server.url]);
  if (!server.reused) {
    const close = async () => { await server.close(); process.exit(0); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
