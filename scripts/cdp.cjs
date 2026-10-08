// Live inspection of the running studio through the browser debugging protocol — reads state and runs code inside
// its pages without bringing any window to the front and without restarting it.
//
// Start the studio with a debugging port (once):
//   set SCREEN_STUDIO_DEBUG_PORT=9333 && "%LOCALAPPDATA%\Programs\hebrew-screen-studio\אולפן צילום מסך.exe" --hidden
//
// Use:
//   node scripts/cdp.cjs targets                       list of the pages (studio, bar, captures window, …)
//   node scripts/cdp.cjs eval "<js>"                   run in the studio page (index.html)
//   node scripts/cdp.cjs eval "<js>" --page=quickbar   run in another page (part of its address)
//   node scripts/cdp.cjs metrics                       processor and memory of every part of the program
const port = process.env.SCREEN_STUDIO_DEBUG_PORT || '9333';
const host = `http://127.0.0.1:${port}`;

async function targets() {
  const response = await fetch(`${host}/json/list`).catch(() => null);
  if (!response) {
    console.error(`אין חיבור ל-${host}. הפעילו את התוכנה עם SCREEN_STUDIO_DEBUG_PORT=${port}.`);
    process.exit(1);
  }
  return (await response.json()).filter((target) => target.type === 'page');
}

// One request over the page's debugging socket (WebSocket is built into Node 22+).
function send(socketUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error('אין תשובה מהעמוד')); }, 20_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(message);
    });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('החיבור לעמוד נכשל')); });
  });
}

(async () => {
  const [command = 'targets', expression] = process.argv.slice(2);
  const pageArgument = process.argv.find((item) => item.startsWith('--page='));
  const wanted = pageArgument ? pageArgument.slice(7) : 'index.html';
  const list = await targets();
  if (command === 'targets') {
    list.forEach((target, index) => console.log(`${index}  ${target.url.split('/').pop()}  ${target.title}`));
    return;
  }
  const target = list.find((item) => item.url.includes(wanted));
  if (!target) { console.error(`לא נמצא עמוד שכתובתו כוללת "${wanted}"`); process.exit(1); }
  if (command === 'eval') {
    const reply = await send(target.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.result?.exceptionDetails) { console.error('שגיאה:', reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text); process.exit(1); }
    console.log(JSON.stringify(reply.result?.result?.value ?? null, null, 2));
    return;
  }
  if (command === 'metrics') {
    const reply = await send(target.webSocketDebuggerUrl, 'Performance.getMetrics');
    const wantedMetrics = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'JSHeapUsedSize', 'Nodes'];
    for (const metric of reply.result?.metrics || []) if (wantedMetrics.includes(metric.name)) console.log(metric.name, metric.value);
    return;
  }
  console.error('פקודה לא מוכרת: targets | eval | metrics');
  process.exit(1);
})().catch((error) => { console.error(error.message); process.exit(1); });
