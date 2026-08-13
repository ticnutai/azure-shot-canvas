const { startDevServer } = require('./dev-server-lib.cjs');

(async () => {
  const instance = await startDevServer();
  process.stdout.write(`\nAurum localhost: ${instance.url}\nHealth: ${instance.url}/__health\nLive reload: active\n`);
  if (instance.reused) {
    process.stdout.write('נעשה שימוש בשרת Aurum שכבר פעיל — לא נוצרה כפילות.\n');
    return;
  }
  const close = async () => { await instance.close(); process.exit(0); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  const npmParent = process.ppid;
  const parentWatch = setInterval(() => {
    try { process.kill(npmParent, 0); } catch { clearInterval(parentWatch); close(); }
  }, 1500);
})().catch((error) => { console.error(error); process.exitCode = 1; });
