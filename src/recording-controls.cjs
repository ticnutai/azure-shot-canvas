// While recording: a small floating bar (red dot, timer, pause / resume, stop) and, for an area recording,
// a dashed frame around the area. Both are hidden from captures, so they never appear in the recording itself.
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');

const BAR = Object.freeze({ width: 236, height: 46 });

class RecordingControls {
  constructor({ onAction, hidden = false }) {
    this.onAction = onAction;
    this.hidden = hidden;
    this.bar = null;
    this.frame = null;
    this.state = null;
    ipcMain.handle('recording-controls:action', (event, action) => {
      if (!this.bar || event.sender !== this.bar.webContents) throw new Error('בקשה ממקור לא מורשה');
      if (!['pause', 'recordStop'].includes(action)) throw new Error('פעולה לא מוכרת');
      this.onAction(action);
      return true;
    });
    ipcMain.handle('recording-controls:state', (event) => (this.bar && event.sender === this.bar.webContents ? this.state : null));
  }

  // details: { startedAt, pausedMs, paused, pausedAt, displayId, region: { x, y, width, height } (0–1 of that screen) }
  async update(active, details = {}) {
    if (!active) return this.close();
    this.state = { startedAt: Date.now(), pausedMs: 0, paused: false, pausedAt: 0, ...this.state, ...details };
    const display = screen.getAllDisplays().find((item) => String(item.id) === String(this.state.displayId)) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = areaOnScreen(display, this.state.region);
    await this.showBar(display, area);
    this.showFrame(area);
    this.bar?.webContents.send('recording-controls:state', this.state);
  }

  async showBar(display, area) {
    if (!this.bar || this.bar.isDestroyed()) {
      this.bar = new BrowserWindow({
        ...barBounds(display, area), show: false, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false,
        fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false, title: 'שליטה בהקלטה',
        webPreferences: { preload: path.join(__dirname, 'recording-controls-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false }
      });
      this.bar.setAlwaysOnTop(true, 'screen-saver');
      this.bar.setContentProtection(true);
      this.bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.bar.webContents.on('will-navigate', (event) => event.preventDefault());
      this.bar.on('closed', () => { this.bar = null; });
      await this.bar.loadFile(path.join(__dirname, 'recording-controls.html'));
    }
    if (!this.hidden && !this.bar.isVisible()) this.bar.showInactive();
  }

  showFrame(area) {
    // Whole-screen recordings need no frame.
    if (!area || area.whole) { this.frame?.destroy(); this.frame = null; return; }
    const margin = 3;
    const bounds = { x: area.x - margin, y: area.y - margin, width: area.width + margin * 2, height: area.height + margin * 2 };
    if (!this.frame || this.frame.isDestroyed()) {
      this.frame = new BrowserWindow({
        ...bounds, show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
        alwaysOnTop: true, hasShadow: false, enableLargerThanScreen: true, title: 'אזור ההקלטה', webPreferences: { contextIsolation: true, sandbox: true }
      });
      this.frame.setIgnoreMouseEvents(true);
      this.frame.setAlwaysOnTop(true, 'screen-saver');
      this.frame.setContentProtection(true);
      this.frame.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}div{position:fixed;inset:0;border:2px dashed #f13c50;box-shadow:0 0 0 1px #ffffff99}</style><div></div>')}`);
      this.frame.on('closed', () => { this.frame = null; });
    }
    this.frame.setBounds(bounds);
    if (!this.hidden && !this.frame.isVisible()) this.frame.showInactive();
  }

  close() {
    this.state = null;
    for (const window of [this.bar, this.frame]) if (window && !window.isDestroyed()) window.destroy();
    this.bar = null;
    this.frame = null;
    return true;
  }

  // Test hook: what is on screen right now.
  snapshot() {
    return { bar: Boolean(this.bar && !this.bar.isDestroyed()), frame: this.frame && !this.frame.isDestroyed() ? this.frame.getBounds() : null, state: this.state };
  }
}

// The recorded area in screen points; whole: true when it is (almost) the full screen.
function areaOnScreen(display, region) {
  const bounds = display.bounds;
  if (!region || !['x', 'y', 'width', 'height'].every((field) => Number.isFinite(region[field]))) return { ...bounds, whole: true };
  const area = {
    x: Math.round(bounds.x + region.x * bounds.width), y: Math.round(bounds.y + region.y * bounds.height),
    width: Math.round(region.width * bounds.width), height: Math.round(region.height * bounds.height)
  };
  return { ...area, whole: region.width > 0.97 && region.height > 0.97 };
}

// Under the area (centred), above it when there is no room, inside its top edge as a last resort;
// for a whole-screen recording: centred at the top of the screen.
function barBounds(display, area) {
  const work = display.workArea;
  const clampX = (x) => Math.round(Math.min(Math.max(work.x + 6, x), work.x + work.width - BAR.width - 6));
  if (!area || area.whole) return { ...BAR, x: clampX(work.x + (work.width - BAR.width) / 2), y: work.y + 10 };
  const x = clampX(area.x + (area.width - BAR.width) / 2);
  if (area.y + area.height + 10 + BAR.height <= work.y + work.height) return { ...BAR, x, y: area.y + area.height + 10 };
  if (area.y - 10 - BAR.height >= work.y) return { ...BAR, x, y: area.y - 10 - BAR.height };
  return { ...BAR, x, y: area.y + 10 };
}

module.exports = { RecordingControls, areaOnScreen, barBounds };
