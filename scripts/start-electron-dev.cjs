const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { startDevServer } = require('./dev-server-lib.cjs');

(async () => {
  const server = await startDevServer();
  const electronPath = require('electron');
  const project = path.resolve(__dirname, '..');
  let child;
  let restarting = false;
  let closing = false;
  let restartTimer;

  const launch = () => {
    process.stdout.write(`Electron + localhost: ${server.url}\n`);
    child = spawn(electronPath, ['.'], {
      cwd: project, stdio: 'inherit', windowsHide: false,
      env: { ...process.env, SCREEN_STUDIO_DEV_URL: server.url, SCREEN_STUDIO_DEV_PARENT_PID: String(process.pid) }
    });
    child.on('close', async (code) => {
      if (restarting) { restarting = false; return launch(); }
      if (!closing) {
        closing = true;
        if (!server.reused) await server.close();
        process.exitCode = code || 0;
      }
    });
  };

  const restartElectron = (filename) => {
    if (!/^(main|preload|main-utils|qa-utils)\.cjs$/i.test(path.basename(filename || ''))) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (!child || child.killed) return;
      restarting = true;
      process.stdout.write(`מפעיל מחדש את Electron בעקבות שינוי ב-${filename}\n`);
      child.kill();
    }, 250);
  };
  const watcher = fs.watch(path.join(project, 'src'), { recursive: false }, (_event, filename) => restartElectron(filename));
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    watcher.close();
    child?.kill();
    if (!server.reused) await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  launch();
})().catch((error) => { console.error(error); process.exitCode = 1; });
