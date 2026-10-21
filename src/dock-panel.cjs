// A frameless window that is either free (moved, sized, optionally above the others) or hidden in a screen edge like
// the top bar: folded it is a small tab; pointing at it opens the window against that edge; it folds again once the
// pointer has been away for a moment (not while the page reports it is busy — a dialog, a menu, a drop-down list).
// Pinned, it stays open. The tab can be dragged anywhere along the left, right or top edge, of any screen.
// Place, size, edge and pin are kept in a small file of its own. The captures window and its separate tools window
// are both made of this.
const { BrowserWindow, screen } = require('electron');
const fs = require('node:fs/promises');
const { dockedPanelBounds, edgeForPointer, offsetForPointer } = require('./quickbar-utils.cjs');

const quietRun = () => process.env.SCREEN_STUDIO_QA === '1' || process.env.SCREEN_STUDIO_HEADLESS === '1';
async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return null; }
}

// The folded window is cut to the tab's own shape — a thin line along the edge and a small tab in its middle — so
// nothing else of the (non-transparent) window shows. An empty list gives the whole window back. With the "line" tab
// style (chosen for the top bar in the settings) every tab of the program is the thin line only.
function tabShape(edge, style = 'tab') {
  if (style === 'line') return edge === 'top' ? [{ x: 0, y: 0, width: 120, height: 5 }] : [{ x: edge === 'left' ? 0 : 13, y: 0, width: 5, height: 120 }];
  if (edge === 'top') return [{ x: 0, y: 0, width: 120, height: 5 }, { x: 36, y: 0, width: 48, height: 18 }];
  return [{ x: edge === 'left' ? 0 : 13, y: 0, width: 5, height: 120 }, { x: 0, y: 36, width: 18, height: 48 }];
}

class DockPanel {
  // options: statePath() · page · query · preload · title · icon() · size · min · place(area, size) · defaultDock · tabStyle() · onClosed()
  constructor(options) {
    this.options = options;
    this.window = null;
    this.dock = this.readDock({});
    this.normal = { bounds: null, onTop: false };
    // Anything else the owner keeps in the same file (the captures window: whether it is split in two).
    this.extra = {};
    this.busy = false;
    this.pointerTimer = null;
    this.dragTimer = null;
    this.resizeTimer = null;
  }

  readDock(saved) {
    const fallback = this.options.defaultDock || {};
    return {
      enabled: Boolean(saved.enabled), edge: ['left', 'right', 'top'].includes(saved.edge) ? saved.edge : (fallback.edge || 'right'),
      offset: Number.isFinite(Number(saved.offset)) ? Number(saved.offset) : (fallback.offset ?? 0.5), pinned: Boolean(saved.pinned),
      expanded: false, size: saved.size && saved.size.width ? saved.size : null
    };
  }
  isOpen() { return Boolean(this.window && !this.window.isDestroyed()); }
  owns(webContents) { return this.isOpen() && this.window.webContents === webContents; }
  send(channel, ...values) { if (this.isOpen()) this.window.webContents.send(channel, ...values); }
  state() { const { enabled, expanded, edge, pinned } = this.dock; return { enabled, expanded, edge, pinned }; }

  async open() {
    if (this.isOpen()) {
      if (this.window.isMinimized()) this.window.restore();
      // Hidden in an edge: asked for again, it opens out of its edge.
      if (this.dock.enabled && !this.dock.expanded) this.setExpanded(true);
      if (!quietRun()) { this.window.show(); this.window.focus(); }
      return { opened: true, existing: true };
    }
    const { bounds: savedBounds, onTop, dock: savedDock, ...extra } = await readJson(this.options.statePath()) || {};
    this.normal = { bounds: savedBounds || null, onTop: Boolean(onTop) };
    this.dock = this.readDock(savedDock || {});
    this.extra = extra;
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const size = { width: Math.min(this.options.size.width, area.width), height: Math.min(this.options.size.height, area.height) };
    // Saved place only while it is still on a connected screen; otherwise the owner's spot on the current one.
    const savedOnScreen = savedBounds && screen.getAllDisplays().some((display) => {
      const { x, y, width, height } = display.workArea;
      return savedBounds.x + 80 > x && savedBounds.y + 40 > y && savedBounds.x + 80 < x + width && savedBounds.y + 40 < y + height;
    });
    const bounds = savedOnScreen ? savedBounds : { ...size, ...this.options.place(area, size) };
    const { min } = this.options;
    const win = new BrowserWindow({
      ...bounds, minWidth: min.width, minHeight: min.height, frame: false, show: false, title: this.options.title, backgroundColor: '#5c5c5c', icon: this.options.icon(),
      alwaysOnTop: Boolean(onTop), webPreferences: { preload: this.options.preload, contextIsolation: true, nodeIntegration: false, sandbox: false }
    });
    this.window = win;
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    let saveTimer = null;
    const remember = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!this.isOpen() || this.window.isMaximized()) return;
        const box = this.window.getBounds();
        // In an edge only the open size is kept (resized by the user); a free window keeps its place and size.
        if (this.dock.enabled) { if (this.dock.expanded && box.width >= min.width) this.dock.size = { width: box.width, height: box.height }; }
        else this.normal = { bounds: box, onTop: this.window.isAlwaysOnTop() };
        this.save();
      }, 400);
    };
    win.on('move', remember);
    win.on('resize', remember);
    win.on('closed', () => { this.window = null; this.busy = false; this.watchPointer(false); this.dragTab(false); this.resizeFrom(null); this.options.onClosed?.(); });
    await win.loadFile(this.options.page, this.options.query ? { query: this.options.query } : undefined);
    if (!this.isOpen()) return { opened: false };
    // Hidden in an edge last time: back in its edge, open for a moment so it is clear where it went.
    if (this.dock.enabled) {
      this.dock.size = this.dock.size || { width: bounds.width, height: bounds.height };
      win.setAlwaysOnTop(true, 'floating');
      this.setExpanded(true);
    } else this.sendDock();
    if (!quietRun()) win.show();
    return { opened: true, existing: false };
  }
  close() { if (this.isOpen()) this.window.close(); }

  area(point = null) {
    if (point) return screen.getDisplayNearestPoint(point).workArea;
    const box = this.window.getBounds();
    return screen.getDisplayNearestPoint({ x: box.x + box.width / 2, y: box.y + box.height / 2 }).workArea;
  }
  save() {
    if (!this.isOpen()) return;
    const { enabled, edge, offset, pinned, size } = this.dock;
    fs.writeFile(this.options.statePath(), JSON.stringify({ ...this.extra, bounds: this.normal.bounds, onTop: this.normal.onTop, dock: { enabled, edge, offset, pinned, size } }), 'utf8').catch(() => {});
  }
  sendDock() { this.send('workspace:dock', this.state()); }

  setOnTop(onTop) {
    this.normal.onTop = Boolean(onTop);
    // In an edge the window is always above the others; the choice applies again once it is a free window.
    if (!this.dock.enabled && this.isOpen()) this.window.setAlwaysOnTop(this.normal.onTop);
    this.save();
    return this.normal.onTop;
  }
  // The page asks for the height its content needs (the tools window: its buttons, wrapped to the width the user
  // chose). Not while folded into its tab or made full screen.
  fitHeight(contentHeight) {
    if (!this.isOpen() || this.window.isMaximized() || (this.dock.enabled && !this.dock.expanded)) return;
    const box = this.window.getBounds();
    const height = Math.round(Math.min(this.area().height, Math.max(this.options.min.height, Number(contentHeight) || 0)));
    if (height === box.height) return;
    if (this.dock.enabled) {
      this.dock.size = { width: box.width, height };
      this.window.setBounds(dockedPanelBounds(this.area(), this.dock, this.dock.size, true, this.options.min));
    } else this.window.setBounds({ ...box, height });
  }
  toggleMaximize() {
    if (!this.isOpen()) return false;
    if (this.window.isMaximized()) this.window.unmaximize(); else this.window.maximize();
    return this.window.isMaximized();
  }

  watchPointer(active) {
    clearInterval(this.pointerTimer);
    this.pointerTimer = null;
    if (!active) return;
    let outsideSince = 0;
    this.pointerTimer = setInterval(() => {
      if (!this.isOpen() || !this.dock.expanded || this.dock.pinned) return this.watchPointer(false);
      if (this.busy) { outsideSince = 0; return; }
      const point = screen.getCursorScreenPoint();
      const box = this.window.getBounds();
      const inside = point.x >= box.x - 6 && point.x <= box.x + box.width + 6 && point.y >= box.y - 6 && point.y <= box.y + box.height + 6;
      if (inside) { outsideSince = 0; return; }
      if (!outsideSince) { outsideSince = Date.now(); return; }
      if (Date.now() - outsideSince > 700) this.setExpanded(false);
    }, 250);
    this.pointerTimer.unref?.();
  }
  shape(folded) {
    if (typeof this.window?.setShape !== 'function') return;
    try { this.window.setShape(folded ? tabShape(this.dock.edge, this.options.tabStyle?.()) : []); } catch {}
  }
  // The tab style was changed in the settings: a folded tab takes the new shape at once.
  refreshShape() { if (this.isOpen() && this.dock.enabled && !this.dock.expanded) this.shape(true); }
  setExpanded(expanded) {
    if (!this.isOpen() || !this.dock.enabled) return;
    const { min } = this.options;
    this.dock.expanded = Boolean(expanded);
    const area = this.area();
    if (this.dock.expanded) {
      this.shape(false);
      this.window.setResizable(true);
      this.window.setMaximizable(true);
      this.window.setMinimizable(true);
      this.window.setMinimumSize(min.width, min.height);
      this.window.setBounds(dockedPanelBounds(area, this.dock, this.dock.size, true, min));
    } else {
      // A resizable window is kept at least ~40 wide by Windows: the folded tab is not resizable.
      this.window.setResizable(false);
      this.window.setMaximizable(false);
      this.window.setMinimizable(false);
      this.window.setMinimumSize(1, 1);
      this.window.setBounds(dockedPanelBounds(area, this.dock, this.dock.size, false, min));
      this.shape(true);
    }
    this.sendDock();
    this.watchPointer(this.dock.expanded && !this.dock.pinned);
  }
  setDock(patch = {}) {
    if (!this.isOpen()) return this.state();
    const { min } = this.options;
    if ('pinned' in patch) this.dock.pinned = Boolean(patch.pinned);
    if ('enabled' in patch && Boolean(patch.enabled) !== this.dock.enabled) {
      if (patch.enabled) {
        // Into the edge: remember where the free window was, keep its size for the open state, stay above other windows.
        if (!this.window.isMaximized()) this.normal.bounds = this.window.getBounds();
        if (this.window.isMaximized()) this.window.unmaximize();
        this.dock.size = this.dock.size || { width: this.window.getBounds().width, height: this.window.getBounds().height };
        this.dock.enabled = true;
        this.window.setAlwaysOnTop(true, 'floating');
        this.setExpanded(true);
      } else {
        this.dock.enabled = false;
        this.dock.expanded = false;
        this.watchPointer(false);
        this.shape(false);
        this.window.setResizable(true);
        this.window.setMaximizable(true);
        this.window.setMinimizable(true);
        this.window.setMinimumSize(min.width, min.height);
        if (this.normal.bounds) this.window.setBounds(this.normal.bounds);
        this.window.setAlwaysOnTop(Boolean(this.normal.onTop));
        this.sendDock();
      }
    } else if ('expanded' in patch) this.setExpanded(patch.expanded);
    else if ('pinned' in patch) { this.sendDock(); this.watchPointer(this.dock.expanded && !this.dock.pinned); }
    this.save();
    return this.state();
  }
  // A handle on a side or a corner is being dragged: the window grows or shrinks from that side, following the
  // pointer (the title bar moves the window, so the system's own resize border does not reach the top). Not while
  // folded or full screen. `grip` is n, s, e, w or a corner (ne, nw, se, sw); null lets go.
  resizeFrom(grip) {
    clearInterval(this.resizeTimer);
    this.resizeTimer = null;
    if (!grip || !/^(n|s|e|w|ne|nw|se|sw)$/.test(grip) || !this.isOpen() || this.window.isMaximized() || (this.dock.enabled && !this.dock.expanded)) return;
    const start = this.window.getBounds();
    const from = screen.getCursorScreenPoint();
    const { min } = this.options;
    this.resizeTimer = setInterval(() => {
      if (!this.isOpen()) return this.resizeFrom(null);
      const point = screen.getCursorScreenPoint();
      const dx = point.x - from.x;
      const dy = point.y - from.y;
      let { x, y, width, height } = start;
      if (grip.includes('e')) width = Math.max(min.width, start.width + dx);
      if (grip.includes('w')) { width = Math.max(min.width, start.width - dx); x = start.x + start.width - width; }
      if (grip.includes('s')) height = Math.max(min.height, start.height + dy);
      if (grip.includes('n')) { height = Math.max(min.height, start.height - dy); y = start.y + start.height - height; }
      const now = this.window.getBounds();
      if (now.x !== x || now.y !== y || now.width !== width || now.height !== height) this.window.setBounds({ x, y, width, height });
    }, 16);
  }
  // Dragging the folded tab: it follows the pointer along the nearest edge (left, right or top) of any screen.
  dragTab(active) {
    clearInterval(this.dragTimer);
    this.dragTimer = null;
    if (!this.isOpen() || !this.dock.enabled) return;
    if (!active) { this.save(); this.sendDock(); return; }
    if (this.dock.expanded) this.setExpanded(false);
    this.dragTimer = setInterval(() => {
      if (!this.isOpen()) return this.dragTab(false);
      const point = screen.getCursorScreenPoint();
      const area = this.area(point);
      const edge = edgeForPointer(area, point);
      const offset = offsetForPointer(area, edge, point);
      if (edge === this.dock.edge && offset === this.dock.offset) return;
      const edgeChanged = edge !== this.dock.edge;
      this.dock.edge = edge;
      this.dock.offset = offset;
      this.window.setBounds(dockedPanelBounds(area, this.dock, this.dock.size, false, this.options.min));
      if (edgeChanged) { this.shape(true); this.sendDock(); }
    }, 16);
  }
}

module.exports = { DockPanel, tabShape };
