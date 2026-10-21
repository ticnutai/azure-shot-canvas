// The keys shown during a recording: a small dark label at the bottom middle of the recorded screen (or area),
// showing the last shortcut ("קונטרול + C"), fading after a moment; the same keys again show "×2", "×3"…
// Unlike the recording bar and frame, this window is meant to appear in the recording.
const { BrowserWindow, screen } = require('electron');

const PAGE = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif}
#key{position:fixed;left:50%;bottom:10px;transform:translateX(-50%) translateY(6px);opacity:0;transition:opacity .18s,transform .18s;
padding:10px 18px;border-radius:14px;background:#0b1220e6;color:#fff;font-size:26px;font-weight:600;white-space:nowrap;
box-shadow:0 8px 24px #0007;border:1px solid #ffffff2a}
#key.on{opacity:1;transform:translateX(-50%) translateY(0)}
#key b{color:#ffd36a;font-weight:600;margin-inline-start:8px}
</style></head><body><div id="key"></div><script>
let timer=0,last='',count=0;
window.showKey=(label)=>{const box=document.getElementById('key');count=label===last?count+1:1;last=label;
box.textContent=label;if(count>1){const times=document.createElement('b');times.textContent='×'+count;box.append(times);}
box.classList.add('on');clearTimeout(timer);timer=setTimeout(()=>{box.classList.remove('on');last='';count=0;},1500);};
</script></body></html>`;

class KeyOverlay {
  constructor() { this.window = null; this.shown = []; }

  // area: { x, y, width, height } in screen points (the recorded screen, or the chosen area on it).
  async open(area) {
    this.close();
    const width = Math.min(640, Math.max(320, Math.round(area.width * 0.6)));
    const height = 90;
    const bounds = { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + area.height - height - 24), width, height };
    this.window = new BrowserWindow({
      ...bounds, show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
      hasShadow: false, alwaysOnTop: true, webPreferences: { contextIsolation: true, sandbox: true }
    });
    this.window.setIgnoreMouseEvents(true);
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.on('closed', () => { this.window = null; });
    await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
    if (process.env.SCREEN_STUDIO_QA !== '1' && process.env.SCREEN_STUDIO_HEADLESS !== '1') this.window?.showInactive();
  }

  show(label) {
    this.shown.push(label);
    if (this.shown.length > 50) this.shown.shift();
    if (this.window && !this.window.isDestroyed()) this.window.webContents.executeJavaScript(`window.showKey(${JSON.stringify(label)})`).catch(() => {});
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  // The recorded screen (by id) or the area on it, in screen points.
  static areaFor(displayId, region) {
    const display = screen.getAllDisplays().find((item) => String(item.id) === String(displayId)) || screen.getPrimaryDisplay();
    const bounds = display.bounds;
    if (!region || !(region.width > 0)) return bounds;
    return { x: bounds.x + region.x * bounds.width, y: bounds.y + region.y * bounds.height, width: region.width * bounds.width, height: region.height * bounds.height };
  }
}

module.exports = { KeyOverlay };
