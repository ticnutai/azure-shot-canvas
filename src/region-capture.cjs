// Fast region capture, the way dedicated capture tools do it: the hotkey freezes every screen at once, the user
// drags (or clicks a window) right on the real screen, and the selection is cut from that frozen image — no
// studio window, no preview stream. Overlay windows are created once per screen and reused, so later
// captures open instantly.
const { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeImage, screen } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { clipRect, normalizeLastRegion, toImagePixels } = require('./region-utils.cjs');

class RegionCapture {
  constructor({ lastRegionPath, savedRegionsPath, windowList, hidden = false }) {
    this.lastRegionPath = lastRegionPath;
    this.savedRegionsPath = savedRegionsPath;
    this.windowList = windowList;
    this.hidden = hidden;
    this.pool = new Map();
    this.active = null;
    this.registerIpc();
  }

  registerIpc() {
    const owner = (event) => [...this.pool.values()].find((entry) => entry.window.webContents === event.sender);
    ipcMain.on('region:ready', (event, displayId) => { const entry = owner(event); if (entry && this.active) this.active.ready.get(String(displayId))?.(); });
    ipcMain.on('region:visible', (event) => { const entry = owner(event); if (entry && !entry.window.isDestroyed()) entry.window.setOpacity(1); });
    ipcMain.on('region:finish', (event, displayId, rect, options = {}) => { if (owner(event)) this.active?.resolve({ displayId: String(displayId), rect, options: options || {} }); });
    ipcMain.on('region:cancel', (event) => { if (owner(event)) this.active?.resolve(null); });
    ipcMain.handle('region:save-area', (event, displayId, rect) => { if (!owner(event)) throw new Error('בקשה ממקור לא מורשה'); return this.saveArea(String(displayId), rect); });
  }

  get isOpen() { return Boolean(this.active); }

  // Screens changed (added, removed, resolution or scaling): rebuild the overlays on the next capture.
  reset() {
    for (const entry of this.pool.values()) if (!entry.window.isDestroyed()) entry.window.destroy();
    this.pool.clear();
  }

  async overlayFor(display) {
    const key = String(display.id);
    const existing = this.pool.get(key);
    if (existing && !existing.window.isDestroyed()) return existing;
    const window = new BrowserWindow({
      ...display.bounds, show: false, frame: false, transparent: false, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, thickFrame: false,
      enableLargerThanScreen: true, backgroundColor: '#000000', title: 'בחירת אזור',
      webPreferences: { preload: path.join(__dirname, 'region-overlay-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
    });
    window.setMenuBarVisibility(false);
    window.setAlwaysOnTop(true, 'screen-saver');
    // The picker itself never shows up in any other capture or recording.
    window.setContentProtection(true);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    const entry = { window, loaded: window.loadFile(path.join(__dirname, 'region-overlay.html')) };
    this.pool.set(key, entry);
    window.on('closed', () => { if (this.pool.get(key) === entry) this.pool.delete(key); });
    return entry;
  }

  // Background warm-up: the first capture after start is as fast as every other one.
  async prepare() {
    this.windowList?.start().catch(() => {});
    await Promise.all(screen.getAllDisplays().map(async (display) => (await this.overlayFor(display)).loaded)).catch(() => {});
  }

  async readLastRegion(displays) {
    try { return normalizeLastRegion(JSON.parse(await fs.readFile(this.lastRegionPath, 'utf8')), displays); }
    catch { return null; }
  }

  async saveLastRegion(displayId, rect) {
    await fs.writeFile(this.lastRegionPath, JSON.stringify({ displayId, rect, savedAt: new Date().toISOString() }), 'utf8').catch(() => {});
  }

  // Named areas kept for reuse (up to 12, newest first), each tied to its screen; keys 1–9 pick them on the overlay.
  async readSavedAreas() {
    try {
      const value = JSON.parse(await fs.readFile(this.savedRegionsPath, 'utf8'));
      return Array.isArray(value) ? value.filter((item) => item?.name && item.rect) : [];
    } catch { return []; }
  }

  async saveArea(displayId, rect, name = null) {
    if (!['x', 'y', 'width', 'height'].every((field) => Number.isFinite(rect?.[field])) || rect.width < 8 || rect.height < 8) throw new Error('אזור לא תקין');
    const areas = await this.readSavedAreas();
    const entry = { name: name || `אזור ${areas.length + 1}`, displayId, rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, savedAt: new Date().toISOString() };
    const next = [entry, ...areas].slice(0, 12);
    await fs.writeFile(this.savedRegionsPath, JSON.stringify(next, null, 2), 'utf8');
    return { name: entry.name, count: next.length };
  }

  // Areas saved by the studio's older picker (relative to a screen, 0–1) move here once.
  async importAreas({ saved = [], last = null, displayId = null } = {}) {
    const displays = screen.getAllDisplays();
    const display = displays.find((item) => String(item.id) === String(displayId)) || screen.getPrimaryDisplay();
    const toPoints = (region) => region && ['x', 'y', 'width', 'height'].every((field) => Number.isFinite(region[field]))
      ? { x: region.x * display.bounds.width, y: region.y * display.bounds.height, width: region.width * display.bounds.width, height: region.height * display.bounds.height } : null;
    let imported = 0;
    for (const item of [...saved].reverse()) {
      const rect = toPoints(item.region);
      if (rect && rect.width >= 8 && rect.height >= 8) { await this.saveArea(String(display.id), rect, String(item.name || '').slice(0, 40) || null); imported += 1; }
    }
    const lastRect = toPoints(last);
    if (lastRect && !(await this.readLastRegion(displays))) await this.saveLastRegion(String(display.id), lastRect);
    return { imported };
  }

  // One still per screen, at full physical resolution: straight from Windows through the helper (about a tenth
  // of a second), or through Chromium's thumbnail route when the helper is not there (it can take seconds).
  async freezeDisplays(displays) {
    const fast = await this.freezeWithHelper(displays).catch(() => null);
    if (fast) return fast;
    return this.freezeWithThumbnails(displays);
  }

  async freezeWithHelper(displays) {
    if (!this.windowList?.shot) return null;
    const file = path.join(os.tmpdir(), `aurum-desktop-${process.pid}.raw`);
    // Waits for a helper that is still starting (right after launch): even then it beats the thumbnail route.
    const desktop = await this.windowList.shot(file, 4000);
    if (!desktop) return null;
    const bitmap = await fs.readFile(file);
    fs.rm(file, { force: true }).catch(() => {});
    if (bitmap.length !== desktop.width * desktop.height * 4) return null;
    const whole = nativeImage.createFromBitmap(bitmap, { width: desktop.width, height: desktop.height });
    const frozen = displays.map((display) => {
      let physical;
      try { physical = screen.dipToScreenRect(null, display.bounds); }
      catch { physical = { x: Math.round(display.bounds.x * display.scaleFactor), y: Math.round(display.bounds.y * display.scaleFactor), width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) }; }
      const rect = clipRect({ x: physical.x - desktop.x, y: physical.y - desktop.y, width: physical.width, height: physical.height }, { x: 0, y: 0, width: desktop.width, height: desktop.height });
      return rect && { display, image: whole.crop(rect) };
    });
    return frozen.every(Boolean) ? frozen : null;
  }

  async freezeWithThumbnails(displays) {
    const physical = (display) => ({ width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) });
    const box = displays.reduce((size, display) => {
      const { width, height } = physical(display);
      return { width: Math.max(size.width, width), height: Math.max(size.height, height) };
    }, { width: 1, height: 1 });
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: box, fetchWindowIcons: false });
    return displays.map((display, index) => {
      const source = sources.find((item) => String(item.display_id) === String(display.id)) || (sources.length === displays.length ? sources[index] : null);
      if (!source || source.thumbnail.isEmpty()) return null;
      const target = physical(display);
      const size = source.thumbnail.getSize();
      const image = size.width === target.width && size.height === target.height ? source.thumbnail : source.thumbnail.resize({ ...target, quality: 'best' });
      return { display, image };
    }).filter(Boolean);
  }

  // Other programs' windows, in screen points relative to each screen (front to back).
  async windowsByDisplay(displays) {
    const raw = await this.windowList?.list().catch(() => []) || [];
    const own = process.pid;
    const toPoints = ({ x, y, width, height }) => {
      const rect = { x, y, width, height };
      try { return screen.screenToDipRect(null, rect); }
      catch {
        const display = screen.getDisplayNearestPoint({ x: rect.x, y: rect.y });
        return { x: rect.x / display.scaleFactor, y: rect.y / display.scaleFactor, width: rect.width / display.scaleFactor, height: rect.height / display.scaleFactor };
      }
    };
    const converted = raw.filter((item) => item.pid !== own).map((item) => ({ ...toPoints(item), parts: (item.parts || []).map(toPoints) }));
    return new Map(displays.map((display) => {
      const local = (rect) => {
        const clipped = clipRect({ x: rect.x - display.bounds.x, y: rect.y - display.bounds.y, width: rect.width, height: rect.height }, { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height });
        return clipped && { x: Math.round(clipped.x), y: Math.round(clipped.y), width: Math.round(clipped.width), height: Math.round(clipped.height) };
      };
      return [String(display.id), converted
        .map((item) => { const rect = local(item); return rect && { ...rect, parts: item.parts.map(local).filter(Boolean) }; })
        .filter(Boolean)];
    }));
  }

  // Without marks the cut comes straight from the frozen image; with marks the overlay already rendered it
  // (same pixels plus the marks) and only its PNG signature and size are checked here.
  crop(frozen, rect, rendered = null) {
    const size = frozen.image.getSize();
    const pixels = toImagePixels(rect, size.width / frozen.display.bounds.width, size);
    if (!pixels) return null;
    const isPng = rendered instanceof Uint8Array && rendered.length > 8 && rendered[0] === 0x89 && rendered[1] === 0x50 && rendered[2] === 0x4e && rendered[3] === 0x47;
    const png = isPng ? Buffer.from(rendered) : frozen.image.crop(pixels).toPNG();
    return { png, width: pixels.width, height: pixels.height, displayId: String(frozen.display.id), rect, display: frozen.display };
  }

  // 'last' re-captures the previous area at once (no picker); without one it falls back to picking.
  // purpose: 'capture' (marks toolbar when markup is on), 'record' (only the area is returned), 'ocr'.
  async capture({ mode = 'pick', purpose = 'capture', markup = true, delay = 0, countdown = null } = {}) {
    if (this.active) return { busy: true };
    if (delay > 0 && countdown) await countdown(delay);
    const displays = screen.getAllDisplays();
    if (mode === 'last' && purpose === 'capture') {
      const last = await this.readLastRegion(displays);
      if (last) {
        const display = displays.find((item) => String(item.id) === String(last.displayId));
        const [frozen] = await this.freezeDisplays([display]);
        if (frozen) return this.crop(frozen, last.rect);
      }
    }
    return this.pick(displays, { purpose, markup });
  }

  async pick(displays, { purpose = 'capture', markup = true } = {}) {
    let resolveResult;
    const result = new Promise((resolve) => { resolveResult = resolve; });
    const ready = new Map();
    this.active = { resolve: (value) => resolveResult(value), ready };
    const entries = [];
    try {
      const cursor = screen.getCursorScreenPoint();
      const cursorDisplay = screen.getDisplayNearestPoint(cursor);
      const started = Date.now();
      const timed = (promise, name) => promise.then((value) => { this.timings[name] = Date.now() - started; return value; });
      this.timings = {};
      // The window list comes right after the picture (the helper answers in order, and is surely warm by then).
      const frozenList = await timed(this.freezeDisplays(displays), 'freeze');
      const [windows, last, areas] = await Promise.all([timed(this.windowsByDisplay(displays), 'windows'), this.readLastRegion(displays), this.readSavedAreas()]);
      if (!frozenList.length) throw new Error('לא ניתן לצלם את המסך כעת');
      for (const frozen of frozenList) {
        const { display } = frozen;
        const entry = await this.overlayFor(display);
        await entry.loaded;
        const key = String(display.id);
        const shown = new Promise((resolve) => ready.set(key, resolve));
        const size = frozen.image.getSize();
        const onThisScreen = display.id === cursorDisplay.id;
        entry.window.webContents.send('region:start', {
          displayId: key,
          width: display.bounds.width,
          height: display.bounds.height,
          image: { width: size.width, height: size.height, bitmap: frozen.image.toBitmap() },
          windows: windows.get(key) || [],
          last: last && String(last.displayId) === key ? last.rect : null,
          pointer: onThisScreen ? { x: cursor.x - display.bounds.x, y: cursor.y - display.bounds.y } : null,
          hint: onThisScreen,
          purpose,
          markup,
          saved: areas.filter((area) => String(area.displayId) === key || (displays.length === 1))
            .map((area) => ({ name: area.name, rect: clipRect(area.rect, { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height }) }))
            .filter((area) => area.rect && area.rect.width >= 8 && area.rect.height >= 8)
            .slice(0, 9)
        });
        entries.push({ entry, frozen, shown, focus: onThisScreen });
      }
      await Promise.race([Promise.all(entries.map((item) => item.shown)), new Promise((resolve) => setTimeout(resolve, 2500))]);
      this.timings.painted = Date.now() - started;
      for (const { entry, frozen, focus } of entries) {
        const { window } = entry;
        window.setBounds(frozen.display.bounds, false);
        if (this.hidden) continue;
        // Revealed at full opacity only once the new picture is painted: never a stale frame from last time.
        window.setOpacity(0);
        window.show();
        window.setAlwaysOnTop(true, 'screen-saver');
        window.moveTop();
        if (focus) window.focus();
        window.webContents.send('region:shown');
        setTimeout(() => { if (!window.isDestroyed() && window.getOpacity() < 1) window.setOpacity(1); }, 220);
      }
      // Windows may refuse the overlay keyboard focus (focus stealing rules), so Escape always works while it is
      // open: it goes to the overlay in use (the focused one), or to all of them.
      const escapeKey = !this.hidden && !globalShortcut.isRegistered('Escape') && globalShortcut.register('Escape', () => {
        const focused = entries.find(({ entry }) => !entry.window.isDestroyed() && entry.window.isFocused());
        for (const { entry } of focused ? [focused] : entries) if (!entry.window.isDestroyed()) entry.window.webContents.send('region:key', 'Escape');
      });
      const choice = await result.finally(() => { if (escapeKey) globalShortcut.unregister('Escape'); });
      if (!choice) return { cancelled: true };
      const frozen = frozenList.find((item) => String(item.display.id) === choice.displayId);
      if (!frozen) return { cancelled: true };
      const after = ['save', 'copy', 'edit', 'ocr', 'record'].includes(choice.options.after) ? choice.options.after : 'save';
      // A recording area: where on which screen, nothing is cut.
      if (purpose === 'record') return { record: true, displayId: choice.displayId, rect: choice.rect, bounds: { ...frozen.display.bounds } };
      const cropped = this.crop(frozen, choice.rect, choice.options.png);
      if (cropped && purpose === 'capture') await this.saveLastRegion(choice.displayId, cropped.rect);
      return cropped ? { ...cropped, after, marks: Number(choice.options.marks) || 0 } : { cancelled: true };
    } finally {
      for (const { entry } of entries) if (!entry.window.isDestroyed()) entry.window.hide();
      this.active = null;
    }
  }
}

module.exports = { RegionCapture };
