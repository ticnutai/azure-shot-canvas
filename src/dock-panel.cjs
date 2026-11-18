// A frameless window that is either free (moved, sized, optionally above the others) or a side panel against any of
// the four screen edges, like the top bar: folded it is a small tab; pointing at it opens the panel against that
// edge; it folds again once the pointer has been away for a moment (not while the page reports it is busy — a dialog,
// a menu, a drop-down list). Pinned, it stays open.
// Moving: the tab is dragged to any place on any edge of any screen. The open panel or the free window, dragged by its
// title bar and let go near an edge, stands against that edge; the panel let go far from every edge becomes a free
// window again.
// The folded tab is a small see-through window of its own (dock-tab.html), drawn exactly like the top bar's tab in the
// tab style and colour chosen in the settings; the panel itself is hidden meanwhile. (Cutting the panel's own window
// to the tab's shape did not hold on every computer: the whole window showed as a grey box.)
// Place, size, edge and pin are kept in a small file of its own. The captures window and its separate tools window
// are both made of this.
const { BrowserWindow, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { dockedPanelBounds, panelEdgeForPointer, offsetForPointer } = require('./quickbar-utils.cjs');

const quietRun = () => process.env.SCREEN_STUDIO_QA === '1' || process.env.SCREEN_STUDIO_HEADLESS === '1';
async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return null; }
}

const EDGES = ['left', 'right', 'top', 'bottom'];
const TAB = Object.freeze({ thickness: 18, length: 120 });
// Let go this close to a screen edge (in points), a dragged window stands against it.
const SNAP = 24;

// Which edge a window let go at `point` belongs to: the nearest one when the point is that close to it, else none.
function snapEdge(area, point, reach = SNAP) {
  const edge = panelEdgeForPointer(area, point);
  const distance = { left: point.x - area.x, right: area.x + area.width - point.x, top: point.y - area.y, bottom: area.y + area.height - point.y }[edge];
  return distance <= reach ? edge : null;
}

// A side panel (as long as the whole edge) let go in the middle of the screen becomes a window of the usual size: the
// spot that was held stays under the pointer, and the window stays whole on the screen.
function freeBoundsAt(area, box, point, size) {
  const width = Math.min(box.width, size.width, area.width);
  const height = Math.min(box.height, size.height, area.height);
  const x = Math.round(point.x - (point.x - box.x) * (width / box.width));
  const y = Math.round(point.y - (point.y - box.y) * (height / box.height));
  return {
    x: Math.min(Math.max(area.x, x), area.x + area.width - width),
    y: Math.min(Math.max(area.y, y), area.y + area.height - height),
    width, height
  };
}

// Two tabs on the same edge never cover each other: a tab that would sit over another one (the top bar's tab, the
// other panel's tab) moves along the edge just past it — or just before it when there is no room after it.
function clearOf(tab, others, area, edge) {
  const across = edge === 'top' || edge === 'bottom';
  const gap = 8;
  const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  let place = { ...tab };
  for (let round = 0; round < 3; round += 1) {
    const hit = others.find((other) => other && overlaps(place, other));
    if (!hit) return place;
    if (across) {
      const after = hit.x + hit.width + gap;
      place.x = after + place.width <= area.x + area.width ? after : Math.max(area.x, hit.x - gap - place.width);
    } else {
      const after = hit.y + hit.height + gap;
      place.y = after + place.height <= area.y + area.height ? after : Math.max(area.y, hit.y - gap - place.height);
    }
  }
  return place;
}

class DockPanel {
  // options: statePath() · page · query · preload · title · icon() · size · min · place(area, size) · defaultDock ·
  // tabStyle() · tabColors() ({ light, dark }) · hideFromCaptures() · fill (open against an edge it runs the edge's whole length) ·
  // hideDelay() (milliseconds, or null) · onClosed()
  constructor(options) {
    this.options = options;
    this.window = null;
    this.tab = null;
    this.dock = this.readDock({});
    this.normal = { bounds: null, onTop: false };
    // Anything else the owner keeps in the same file (the captures window: whether it is split in two).
    this.extra = {};
    this.busy = false;
    this.pointerTimer = null;
    this.dragTimer = null;
    this.resizeTimer = null;
    this.resizedAt = 0;
    this.userMoving = false;
    this.lastShape = [];
  }

  readDock(saved) {
    const fallback = this.options.defaultDock || {};
    return {
      enabled: Boolean(saved.enabled), edge: EDGES.includes(saved.edge) ? saved.edge : (fallback.edge || 'right'),
      offset: Number.isFinite(Number(saved.offset)) ? Number(saved.offset) : (fallback.offset ?? 0.5), pinned: Boolean(saved.pinned),
      expanded: false, size: saved.size && saved.size.width ? saved.size : null
    };
  }
  isOpen() { return Boolean(this.window && !this.window.isDestroyed()); }
  tabOpen() { return Boolean(this.tab && !this.tab.isDestroyed()); }
  owns(webContents) { return (this.isOpen() && this.window.webContents === webContents) || (this.tabOpen() && this.tab.webContents === webContents); }
  send(channel, ...values) { if (this.isOpen()) this.window.webContents.send(channel, ...values); }
  state() {
    const { enabled, expanded, edge, pinned } = this.dock;
    return { enabled, expanded, edge, pinned, fill: Boolean(this.options.fill), tabStyle: this.options.tabStyle?.() || 'tab' };
  }
  // Where the folded tab is, and the part of its window that takes the pointer (for the tests).
  tabState() { return { bounds: this.tabOpen() ? this.tab.getBounds() : null, visible: this.tabOpen() && this.tab.isVisible(), shape: this.lastShape }; }

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
        if (!this.isOpen() || this.window.isMaximized() || !this.window.isVisible() && !quietRun()) return;
        const box = this.window.getBounds();
        // Against an edge only the open size is kept (resized by the user); a free window keeps its place and size.
        // (A side panel running the whole edge keeps only its depth: its width on a side, its height on top or bottom.)
        if (this.dock.enabled) {
          if (this.dock.expanded && box.width >= min.width) {
            const along = this.dock.edge === 'top' || this.dock.edge === 'bottom';
            const before = this.dock.size || { width: box.width, height: box.height };
            this.dock.size = !this.options.fill ? { width: box.width, height: box.height } : along ? { width: before.width, height: box.height } : { width: box.width, height: before.height };
          }
        }
        else this.normal = { bounds: box, onTop: this.window.isAlwaysOnTop() };
        this.save();
      }, 400);
    };
    win.on('move', remember);
    win.on('resize', remember);
    // Moved by hand (its title bar): let go near an edge it stands there; the panel let go far from the edges is free.
    win.on('will-move', () => { this.userMoving = true; });
    win.on('moved', () => { if (this.userMoving) { this.userMoving = false; this.dropped(screen.getCursorScreenPoint()); } });
    win.on('closed', () => {
      this.window = null; this.busy = false; this.watchPointer(false); this.dragTab(false); this.resizeFrom(null);
      if (this.tabOpen()) this.tab.destroy();
      this.tab = null;
      this.options.onClosed?.();
    });
    await win.loadFile(this.options.page, this.options.query ? { query: this.options.query } : undefined);
    if (!this.isOpen()) return { opened: false };
    // Against an edge last time: back there, open for a moment so it is clear where it went.
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
  sendDock() {
    const state = this.state();
    this.send('workspace:dock', state);
    if (this.tabOpen()) {
      const colors = this.options.tabColors?.() || {};
      this.tab.webContents.send('dock-tab:state', { edge: state.edge, tabStyle: state.tabStyle, light: colors.light, dark: colors.dark, label: `פתיחת ${this.options.title}` });
    }
  }
  openBounds(area = this.area()) { return dockedPanelBounds(area, this.dock, this.dock.size, true, this.options.min, TAB, Boolean(this.options.fill)); }

  setOnTop(onTop) {
    this.normal.onTop = Boolean(onTop);
    // Against an edge the window is always above the others; the choice applies again once it is a free window.
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
      this.window.setBounds(this.openBounds());
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
      if (this.busy || this.resizeTimer || this.userMoving || Date.now() - this.resizedAt < 1500) { outsideSince = 0; return; }
      const point = screen.getCursorScreenPoint();
      const box = this.window.getBounds();
      const inside = point.x >= box.x - 6 && point.x <= box.x + box.width + 6 && point.y >= box.y - 6 && point.y <= box.y + box.height + 6;
      if (inside) { outsideSince = 0; return; }
      if (!outsideSince) { outsideSince = Date.now(); return; }
      if (Date.now() - outsideSince > (this.options.hideDelay?.() || 700)) this.setExpanded(false);
    }, 120);
    this.pointerTimer.unref?.();
  }

  // ---- The folded tab: a see-through window of its own ----
  async ensureTab() {
    if (this.tabOpen()) return this.tab;
    const tab = new BrowserWindow({
      width: TAB.thickness, height: TAB.length, show: false, frame: false, transparent: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false,
      type: 'toolbar', backgroundColor: '#00000000', title: this.options.title,
      webPreferences: { preload: path.join(__dirname, 'dock-tab-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    this.tab = tab;
    tab.setMenuBarVisibility(false);
    tab.setAlwaysOnTop(true, 'floating');
    // Like the top bar's tab: not part of the user's own screenshots and recordings (unless chosen otherwise).
    tab.setContentProtection(this.options.hideFromCaptures?.() ?? true);
    tab.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    tab.webContents.on('will-navigate', (event) => event.preventDefault());
    tab.on('closed', () => { if (this.tab === tab) this.tab = null; });
    await tab.loadFile(path.join(__dirname, 'dock-tab.html'));
    return tab;
  }
  // The tab where it belongs on its edge, cut to exactly that size (Windows may keep a window a little bigger).
  placeTab(area = this.area()) {
    if (!this.tabOpen()) return;
    const wanted = clearOf(dockedPanelBounds(area, this.dock, this.dock.size, false, this.options.min, TAB), this.options.avoid?.() || [], area, this.dock.edge);
    this.tab.setBounds(wanted);
    const actual = this.tab.getBounds();
    const bigger = actual.width > wanted.width || actual.height > wanted.height;
    this.lastShape = [{ x: Math.max(0, wanted.x - actual.x), y: Math.max(0, wanted.y - actual.y), width: wanted.width, height: wanted.height }];
    if (typeof this.tab.setShape === 'function') { try { this.tab.setShape(bigger ? this.lastShape : []); } catch {} }
    // The page draws the tab in exactly that part of its window (Windows may keep the window itself bigger).
    this.tab.webContents.send('dock-tab:box', this.lastShape[0]);
  }
  async showTab() {
    const area = this.area();
    await this.ensureTab();
    if (!this.tabOpen() || !this.dock.enabled || this.dock.expanded) return;
    this.placeTab(area);
    this.sendDock();
    if (!quietRun()) this.tab.showInactive();
  }
  hideTab() { if (this.tabOpen()) this.tab.hide(); }
  protectTab(hidden) { if (this.tabOpen()) this.tab.setContentProtection(Boolean(hidden)); }
  // The tab style or colour was changed in the settings: a folded tab takes it at once.
  refreshShape() { this.sendDock(); if (this.isOpen() && this.dock.enabled && !this.dock.expanded) this.placeTab(); }

  setExpanded(expanded) {
    if (!this.isOpen() || !this.dock.enabled) return;
    const { min } = this.options;
    this.dock.expanded = Boolean(expanded);
    if (this.dock.expanded) {
      const area = this.tabOpen() && this.tab.isVisible() ? this.area(this.tab.getBounds()) : this.area();
      this.hideTab();
      this.window.setMinimumSize(min.width, min.height);
      this.window.setBounds(this.openBounds(area));
      if (!quietRun() && !this.window.isVisible()) this.window.showInactive();
    } else {
      // The panel steps away; only its tab stays on the edge.
      const area = this.area();
      this.window.setBounds(this.openBounds(area));
      if (!quietRun()) this.window.hide();
      this.showTab();
    }
    this.sendDock();
    this.watchPointer(this.dock.expanded && !this.dock.pinned);
  }
  setDock(patch = {}) {
    if (!this.isOpen()) return this.state();
    const { min } = this.options;
    if ('pinned' in patch) this.dock.pinned = Boolean(patch.pinned);
    if (EDGES.includes(patch.edge)) this.dock.edge = patch.edge;
    if (Number.isFinite(Number(patch.offset)) && 'offset' in patch) this.dock.offset = Math.min(1, Math.max(0, Number(patch.offset)));
    if ('enabled' in patch && Boolean(patch.enabled) !== this.dock.enabled) {
      if (patch.enabled) {
        // Against the edge: remember where the free window was, keep its size for the open state, stay above other windows.
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
        this.hideTab();
        this.window.setMinimumSize(min.width, min.height);
        if (patch.bounds) this.normal.bounds = patch.bounds;
        if (this.normal.bounds) this.window.setBounds(this.normal.bounds);
        this.window.setAlwaysOnTop(Boolean(this.normal.onTop));
        if (!quietRun() && !this.window.isVisible()) this.window.show();
        this.sendDock();
      }
    } else if ('expanded' in patch) this.setExpanded(patch.expanded);
    else if (this.dock.enabled && ('edge' in patch || 'offset' in patch)) this.setExpanded(this.dock.expanded);
    else if ('pinned' in patch) { this.sendDock(); this.watchPointer(this.dock.expanded && !this.dock.pinned); }
    this.save();
    return this.state();
  }
  // The window was let go after being moved by its title bar, the pointer at `point`.
  dropped(point) {
    if (!this.isOpen()) return;
    const area = this.area(point);
    const edge = snapEdge(area, point);
    // Windows makes a window dragged to the top of the screen full screen: here it means "stand along the top".
    if (this.window.isMaximized()) { if (edge !== 'top') return; this.window.unmaximize(); }
    if (edge) {
      // Near an edge: stand against it, centred where it was let go along that edge.
      const box = this.window.getBounds();
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const offset = offsetForPointer(area, edge, centre);
      if (!this.dock.enabled) {
        this.dock.size = { width: box.width, height: box.height };
        this.setDock({ enabled: true, edge, offset });
      } else this.setDock({ edge, offset });
    } else if (this.dock.enabled && this.dock.expanded) {
      // The panel let go far from every edge: a free window where it was let go.
      this.setDock({ enabled: false, bounds: freeBoundsAt(area, this.window.getBounds(), point, this.options.size) });
    }
  }
  // A handle on a side or a corner is being dragged: the window grows or shrinks from that side, following the
  // pointer (the title bar moves the window, so the system's own resize border does not reach the top). Not while
  // folded or full screen. `grip` is n, s, e, w or a corner (ne, nw, se, sw); null lets go.
  resizeFrom(grip) {
    if (this.resizeTimer) this.resizedAt = Date.now();
    clearInterval(this.resizeTimer);
    this.resizeTimer = null;
    if (!grip || !/^(n|s|e|w|ne|nw|se|sw)$/.test(grip) || !this.isOpen() || this.window.isMaximized() || (this.dock.enabled && !this.dock.expanded)) return;
    const start = this.window.getBounds();
    const from = screen.getCursorScreenPoint();
    const { min } = this.options;
    const area = this.area();
    this.resizeTimer = setInterval(() => {
      if (!this.isOpen()) return this.resizeFrom(null);
      const point = screen.getCursorScreenPoint();
      const dx = point.x - from.x;
      const dy = point.y - from.y;
      let { x, y, width, height } = start;
      if (grip.includes('e')) width = Math.min(area.x + area.width - start.x, Math.max(min.width, start.width + dx));
      if (grip.includes('w')) { width = Math.min(start.x + start.width - area.x, Math.max(min.width, start.width - dx)); x = start.x + start.width - width; }
      if (grip.includes('s')) height = Math.min(area.y + area.height - start.y, Math.max(min.height, start.height + dy));
      if (grip.includes('n')) { height = Math.min(start.y + start.height - area.y, Math.max(min.height, start.height - dy)); y = start.y + start.height - height; }
      const now = this.window.getBounds();
      if (now.x !== x || now.y !== y || now.width !== width || now.height !== height) this.window.setBounds({ x, y, width, height });
    }, 16);
  }
  // Dragging the folded tab: it follows the pointer along the nearest of the four edges of any screen.
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
      const edge = panelEdgeForPointer(area, point);
      const offset = offsetForPointer(area, edge, point);
      if (edge === this.dock.edge && offset === this.dock.offset) return;
      const edgeChanged = edge !== this.dock.edge;
      this.dock.edge = edge;
      this.dock.offset = offset;
      this.placeTab(area);
      // Where the panel opens follows the tab (to the same screen too).
      this.window.setBounds(this.openBounds(area));
      if (edgeChanged) this.sendDock();
    }, 16);
  }
}

module.exports = { DockPanel, TAB, snapEdge, freeBoundsAt, clearOf };
