// Drawing on the screen during a recording (an extra): a see-through window over the recorded screen. Unlike the recording
// bar and frame it is meant to appear in the recording. A small hint window, hidden from captures, lists the keys.
// The drawing window never takes the keyboard (the program being explained keeps it), so while drawing the few keys below
// are held globally; they go back the moment drawing ends. Between drawings the mouse passes through to the screen.
const { BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');

const KEYS = Object.freeze({ Escape: 'exit', 1: 'pen', 2: 'arrow', 3: 'rect', 4: 'color', Z: 'undo', C: 'clear' });
const COLORS = Object.freeze(['#f13c50', '#ffc929', '#2f80ed', '#27ae60', '#111111']);
const HINT = 'מצב ציור · 1 עט · 2 חץ · 3 מלבן · 4 צבע · Z ביטול · C ניקוי · אסקייפ סיום';
const HINT_PAGE = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif}
div{position:fixed;inset:4px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:#0b1220e6;color:#fff;font-size:13px;font-weight:600;white-space:nowrap;border:1px solid #ffffff2a}
</style></head><body><div>${HINT}</div></body></html>`;

class LiveDraw {
  // onChange(drawing): drawing mode turned on or off. raise(): brings the recording bar back above the drawing window.
  constructor({ hidden = false, onChange = () => {}, raise = () => {} } = {}) {
    Object.assign(this, { hidden, onChange, raise });
    this.window = null;
    this.hint = null;
    this.drawing = false;
    this.tool = 'pen';
    this.color = COLORS[0];
    this.held = [];
    ipcMain.on('live-draw:ready', (event) => { if (this.window && event.sender === this.window.webContents) this.sendState(); });
  }

  get isOpen() { return Boolean(this.window && !this.window.isDestroyed()); }

  sendState() {
    if (this.isOpen) this.window.webContents.send('live-draw:state', { drawing: this.drawing, tool: this.tool, color: this.color });
  }

  // bounds: the whole recorded screen, in screen points.
  async open(bounds, color) {
    if (color) this.color = color;
    if (this.isOpen) return;
    this.window = new BrowserWindow({
      ...bounds, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, enableLargerThanScreen: true, title: 'ציור על המסך',
      webPreferences: { preload: path.join(__dirname, 'live-draw-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    // Windows opens it above the taskbar only; the whole screen can be drawn on.
    this.window.setBounds(bounds, false);
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setIgnoreMouseEvents(true);
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', (event) => event.preventDefault());
    this.window.on('closed', () => { this.window = null; });
    await this.window.loadFile(path.join(__dirname, 'live-draw.html'));
    if (!this.hidden) this.window?.showInactive();
    this.openHint(bounds);
  }

  openHint(bounds) {
    if (this.hint && !this.hint.isDestroyed()) return;
    const width = Math.min(560, bounds.width);
    const height = 44;
    this.hint = new BrowserWindow({
      x: Math.round(bounds.x + (bounds.width - width) / 2), y: Math.round(bounds.y + bounds.height - height - 16), width, height,
      show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
      title: 'מקשי הציור', webPreferences: { contextIsolation: true, sandbox: true }
    });
    this.hint.setAlwaysOnTop(true, 'screen-saver');
    this.hint.setIgnoreMouseEvents(true);
    this.hint.setContentProtection(true);
    this.hint.on('closed', () => { this.hint = null; });
    this.hint.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HINT_PAGE)}`);
  }

  holdKeys() {
    for (const [key, command] of Object.entries(KEYS)) {
      // A key some other part of the program already holds stays with it.
      if (globalShortcut.isRegistered(key)) continue;
      if (globalShortcut.register(key, () => this.command(command))) this.held.push(key);
    }
  }

  releaseKeys() {
    for (const key of this.held) globalShortcut.unregister(key);
    this.held = [];
  }

  setDrawing(on) {
    if (!this.isOpen || on === this.drawing) return this.drawing;
    this.drawing = on;
    this.window.setIgnoreMouseEvents(!on);
    if (on) {
      this.holdKeys();
      if (!this.hidden) { this.window.moveTop(); this.hint?.showInactive(); this.hint?.moveTop(); this.raise(); }
    } else {
      this.releaseKeys();
      this.hint?.hide();
    }
    this.sendState();
    this.onChange(on);
    return on;
  }

  command(name) {
    if (!this.isOpen) return;
    if (name === 'exit') { this.setDrawing(false); return; }
    if (name === 'pen' || name === 'arrow' || name === 'rect') { this.tool = name; this.sendState(); return; }
    if (name === 'color') { this.color = COLORS[(COLORS.indexOf(this.color) + 1) % COLORS.length]; this.sendState(); return; }
    if (name === 'undo' || name === 'clear') this.window.webContents.send('live-draw:command', name);
  }

  close() {
    const was = this.drawing;
    this.drawing = false;
    this.releaseKeys();
    if (this.hint && !this.hint.isDestroyed()) this.hint.destroy();
    this.hint = null;
    if (this.isOpen) this.window.destroy();
    this.window = null;
    if (was) this.onChange(false);
  }
}

module.exports = { COLORS, KEYS, LiveDraw };
