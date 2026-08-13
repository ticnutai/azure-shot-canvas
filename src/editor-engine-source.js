import {
  ActiveSelection, Canvas, Circle, Ellipse, FabricImage, Group, IText, Line,
  PencilBrush, Polygon, Polyline, Rect, Shadow, Textbox, Triangle, util
} from 'fabric';

const CUSTOM_PROPERTIES = ['dataRole', 'toolType', 'secureRedaction'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function loadDomImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('לא ניתן לטעון את התמונה לעורך'));
    image.src = dataUrl;
  });
}

function arrowGroup(x1, y1, x2, y2, options, doubleHead = false) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const length = Math.max(10, Math.hypot(dx, dy));
  const localX1 = -length / 2;
  const localX2 = length / 2;
  const line = new Line([localX1, 0, localX2, 0], { stroke: options.stroke, strokeWidth: options.strokeWidth, originX: 'center', originY: 'center' });
  const headSize = Math.max(10, options.strokeWidth * 4);
  const end = new Triangle({ left: localX2, top: 0, width: headSize, height: headSize, fill: options.stroke, angle: 90, originX: 'center', originY: 'center' });
  const objects = [line, end];
  if (doubleHead) objects.push(new Triangle({ left: localX1, top: 0, width: headSize, height: headSize, fill: options.stroke, angle: -90, originX: 'center', originY: 'center' }));
  const group = new Group(objects, { left: (x1 + x2) / 2, top: (y1 + y2) / 2, angle, originX: 'center', originY: 'center' });
  group.toolType = doubleHead ? 'double-arrow' : 'arrow';
  return group;
}

class AurumImageEditorEngine {
  constructor(canvasElement, hooks = {}) {
    this.canvas = new Canvas(canvasElement, { preserveObjectStacking: true, selection: true, fireRightClick: true, stopContextMenu: true });
    this.hooks = hooks;
    this.tool = 'select';
    this.style = { stroke: '#ef3340', fill: 'transparent', strokeWidth: 6, opacity: 1, fontSize: 42 };
    this.zoom = 1;
    this.gridSize = 10;
    this.snap = false;
    this.counter = 1;
    this.history = [];
    this.historyIndex = -1;
    this.backgrounds = new Map();
    this.backgroundSequence = 0;
    this.currentBackgroundKey = null;
    this.initialBackgroundKey = null;
    this.backgroundObject = null;
    this.backgroundImageElement = null;
    this.drawing = null;
    this.polygonPoints = [];
    this.polygonPreview = null;
    this.restoring = false;
    this.clipboardObject = null;
    this.bindEvents();
  }

  bindEvents() {
    this.canvas.on('selection:created', () => this.emitSelection());
    this.canvas.on('selection:updated', () => this.emitSelection());
    this.canvas.on('selection:cleared', () => this.emitSelection());
    this.canvas.on('object:modified', (event) => {
      if (this.snap && event.target) {
        event.target.set({ left: Math.round(event.target.left / this.gridSize) * this.gridSize, top: Math.round(event.target.top / this.gridSize) * this.gridSize });
        event.target.setCoords();
      }
      this.pushHistory();
    });
    this.canvas.on('mouse:down', (event) => this.pointerDown(event));
    this.canvas.on('mouse:move', (event) => this.pointerMove(event));
    this.canvas.on('mouse:up', (event) => this.pointerUp(event));
    this.canvas.upperCanvasEl.addEventListener('dblclick', () => { if (this.tool === 'polygon') this.finishPolygon(); });
  }

  emitSelection() {
    const object = this.canvas.getActiveObject();
    this.hooks.onSelection?.(object ? {
      type: object.toolType || object.type,
      stroke: object.stroke || this.style.stroke,
      fill: object.fill || this.style.fill,
      opacity: object.opacity ?? 1,
      strokeWidth: object.strokeWidth || this.style.strokeWidth,
      fontSize: object.fontSize || this.style.fontSize,
      text: object.text || ''
    } : null);
  }

  async load(dataUrl, project = null) {
    this.history = [];
    this.historyIndex = -1;
    this.backgrounds.clear();
    this.backgroundSequence = 0;
    const backgroundData = project?.backgroundDataUrl || dataUrl;
    const key = this.rememberBackground(backgroundData);
    this.initialBackgroundKey = key;
    await this.setBackground(key);
    if (project?.objects?.length) {
      const objects = await util.enlivenObjects(project.objects);
      this.canvas.add(...objects);
    }
    this.canvas.renderAll();
    this.fitToViewport();
    this.pushHistory(true);
  }

  rememberBackground(dataUrl) {
    const key = `background-${++this.backgroundSequence}`;
    this.backgrounds.set(key, dataUrl);
    return key;
  }

  async setBackground(key) {
    const dataUrl = this.backgrounds.get(key);
    if (!dataUrl) throw new Error('רקע העריכה אינו זמין');
    const domImage = await loadDomImage(dataUrl);
    const fabricImage = await FabricImage.fromURL(dataUrl);
    fabricImage.set({ left: 0, top: 0, originX: 'left', originY: 'top', selectable: false, evented: false, dataRole: 'background' });
    if (this.backgroundObject) this.canvas.remove(this.backgroundObject);
    this.backgroundObject = fabricImage;
    this.backgroundImageElement = domImage;
    this.currentBackgroundKey = key;
    this.canvas.setDimensions({ width: domImage.naturalWidth, height: domImage.naturalHeight });
    this.canvas.add(fabricImage);
    this.canvas.moveObjectTo(fabricImage, 0);
  }

  setViewportSize(width, height) {
    this.viewportSize = { width, height };
    this.fitToViewport();
  }

  fitToViewport() {
    if (!this.viewportSize || !this.canvas.width || !this.canvas.height) return;
    const zoom = Math.min((this.viewportSize.width - 50) / this.canvas.width, (this.viewportSize.height - 50) / this.canvas.height, 1);
    this.setZoom(clamp(zoom, 0.05, 3));
  }

  setZoom(value) {
    this.zoom = clamp(Number(value) || 1, 0.05, 4);
    this.canvas.setDimensions({ width: Math.round(this.canvas.width * this.zoom), height: Math.round(this.canvas.height * this.zoom) }, { cssOnly: true });
    this.hooks.onZoom?.(this.zoom);
  }

  zoomBy(factor) { this.setZoom(this.zoom * factor); }

  setStyle(patch) {
    Object.assign(this.style, patch);
    const active = this.canvas.getActiveObject();
    if (!active) return;
    const apply = (object) => {
      if (patch.stroke !== undefined && object.stroke !== undefined) object.set('stroke', patch.stroke);
      if (patch.fill !== undefined && object.fill !== undefined && object.toolType !== 'arrow') object.set('fill', patch.fill);
      if (patch.strokeWidth !== undefined && object.strokeWidth !== undefined) object.set('strokeWidth', Number(patch.strokeWidth));
      if (patch.opacity !== undefined) object.set('opacity', Number(patch.opacity));
      if (patch.fontSize !== undefined && object.fontSize !== undefined) object.set('fontSize', Number(patch.fontSize));
      if (patch.text !== undefined && object.text !== undefined) object.set('text', patch.text);
      object.setCoords();
    };
    if (active.type === 'activeSelection') active.getObjects().forEach(apply); else if (active.type === 'group' && active.toolType?.includes('arrow')) active.getObjects().forEach(apply); else apply(active);
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  setTool(tool) {
    if (this.tool === 'polygon' && tool !== 'polygon') this.finishPolygon();
    this.tool = tool;
    this.canvas.isDrawingMode = ['pen', 'highlighter'].includes(tool);
    this.canvas.selection = tool === 'select';
    this.canvas.skipTargetFind = tool !== 'select';
    if (this.canvas.isDrawingMode) {
      const brush = new PencilBrush(this.canvas);
      brush.color = tool === 'highlighter' ? `${this.style.stroke}66` : this.style.stroke;
      brush.width = tool === 'highlighter' ? this.style.strokeWidth * 4 : this.style.strokeWidth;
      this.canvas.freeDrawingBrush = brush;
    }
    this.canvas.defaultCursor = tool === 'select' ? 'default' : tool === 'pan' ? 'grab' : 'crosshair';
    this.hooks.onTool?.(tool);
  }

  scenePoint(event) {
    return this.canvas.getScenePoint ? this.canvas.getScenePoint(event.e) : this.canvas.getPointer(event.e);
  }

  baseOptions(extra = {}) {
    return { stroke: this.style.stroke, fill: this.style.fill, strokeWidth: this.style.strokeWidth, opacity: this.style.opacity, objectCaching: false, ...extra };
  }

  pointerDown(event) {
    if (this.canvas.isDrawingMode || this.tool === 'select') return;
    const point = this.scenePoint(event);
    if (this.tool === 'text' || this.tool === 'callout') return this.addText(point, this.tool === 'callout');
    if (this.tool === 'counter') return this.addCounter(point);
    if (this.tool === 'polygon') return this.addPolygonPoint(point);
    if (this.tool === 'image') return this.hooks.onRequestImage?.();
    if (this.tool === 'pan') return;
    const options = this.baseOptions({ left: point.x, top: point.y, originX: 'left', originY: 'top' });
    let object;
    if (['rect', 'redact', 'blur', 'pixelate', 'crop', 'magnify'].includes(this.tool)) object = new Rect({ ...options, width: 1, height: 1, fill: this.tool === 'redact' ? '#000000' : this.tool === 'rect' ? this.style.fill : '#ffffff22', strokeDashArray: ['blur', 'pixelate', 'crop', 'magnify'].includes(this.tool) ? [12, 8] : null });
    else if (this.tool === 'ellipse') object = new Ellipse({ ...options, rx: 1, ry: 1 });
    else if (['line', 'arrow', 'double-arrow'].includes(this.tool)) object = new Line([point.x, point.y, point.x, point.y], this.baseOptions({ fill: undefined }));
    if (!object) return;
    object.toolType = this.tool;
    this.drawing = { start: point, object };
    this.canvas.add(object);
  }

  pointerMove(event) {
    if (!this.drawing) return;
    const point = this.scenePoint(event);
    const { start, object } = this.drawing;
    if (object.type === 'line') object.set({ x2: point.x, y2: point.y });
    else {
      const left = Math.min(start.x, point.x);
      const top = Math.min(start.y, point.y);
      const width = Math.max(1, Math.abs(point.x - start.x));
      const height = Math.max(1, Math.abs(point.y - start.y));
      if (object.type === 'ellipse') object.set({ left, top, rx: width / 2, ry: height / 2 });
      else object.set({ left, top, width, height });
    }
    object.setCoords();
    this.canvas.requestRenderAll();
  }

  async pointerUp(event) {
    if (this.canvas.isDrawingMode) {
      setTimeout(() => this.pushHistory(), 0);
      return;
    }
    if (!this.drawing) return;
    const { start, object } = this.drawing;
    const end = this.scenePoint(event);
    this.drawing = null;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 4) { this.canvas.remove(object); return; }
    if (['arrow', 'double-arrow'].includes(object.toolType)) {
      this.canvas.remove(object);
      this.canvas.add(arrowGroup(start.x, start.y, end.x, end.y, this.style, object.toolType === 'double-arrow'));
    } else if (['blur', 'pixelate'].includes(object.toolType)) {
      this.canvas.remove(object);
      await this.addObscuredRegion(object, object.toolType);
    } else if (object.toolType === 'crop') {
      this.canvas.remove(object);
      await this.cropTo(object);
    } else if (object.toolType === 'magnify') {
      this.canvas.remove(object);
      await this.addMagnifier(object);
    } else if (object.toolType === 'redact') {
      object.set({ fill: '#000000', stroke: '#000000', secureRedaction: true, strokeDashArray: null });
    }
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  addText(point, callout = false) {
    const text = new Textbox(callout ? 'הערה' : 'טקסט', this.baseOptions({ left: point.x, top: point.y, width: 360, fill: callout ? '#ffffff' : this.style.stroke, strokeWidth: 0, fontSize: this.style.fontSize, fontFamily: 'Segoe UI', direction: 'rtl', textAlign: 'right', backgroundColor: callout ? this.style.stroke : '', padding: callout ? 12 : 2 }));
    text.toolType = callout ? 'callout' : 'text';
    this.canvas.add(text);
    this.canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    this.pushHistory();
  }

  addCounter(point) {
    const radius = Math.max(18, this.style.fontSize * .55);
    const circle = new Circle({ radius, fill: this.style.stroke, originX: 'center', originY: 'center' });
    const label = new IText(String(this.counter++), { fontFamily: 'Segoe UI', fontSize: radius * 1.15, fontWeight: 700, fill: '#ffffff', originX: 'center', originY: 'center', selectable: false, evented: false });
    const group = new Group([circle, label], { left: point.x, top: point.y, originX: 'center', originY: 'center' });
    group.toolType = 'counter';
    this.canvas.add(group);
    this.pushHistory();
  }

  addPolygonPoint(point) {
    this.polygonPoints.push({ x: point.x, y: point.y });
    if (this.polygonPreview) this.canvas.remove(this.polygonPreview);
    this.polygonPreview = new Polyline(this.polygonPoints, this.baseOptions({ fill: 'transparent', selectable: false, evented: false, strokeDashArray: [8, 5] }));
    this.canvas.add(this.polygonPreview);
    this.canvas.requestRenderAll();
  }

  finishPolygon() {
    if (this.polygonPreview) this.canvas.remove(this.polygonPreview);
    if (this.polygonPoints.length >= 3) {
      const polygon = new Polygon(this.polygonPoints, this.baseOptions());
      polygon.toolType = 'polygon';
      this.canvas.add(polygon);
      this.pushHistory();
    }
    this.polygonPreview = null;
    this.polygonPoints = [];
    this.canvas.requestRenderAll();
  }

  cropCanvasRegion(rect, mode = 'normal') {
    const left = clamp(Math.round(rect.left), 0, this.backgroundImageElement.naturalWidth - 1);
    const top = clamp(Math.round(rect.top), 0, this.backgroundImageElement.naturalHeight - 1);
    const width = clamp(Math.round(rect.width * (rect.scaleX || 1)), 1, this.backgroundImageElement.naturalWidth - left);
    const height = clamp(Math.round(rect.height * (rect.scaleY || 1)), 1, this.backgroundImageElement.naturalHeight - top);
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d');
    if (mode === 'pixelate') {
      const tiny = document.createElement('canvas');
      tiny.width = Math.max(1, Math.round(width / 14));
      tiny.height = Math.max(1, Math.round(height / 14));
      tiny.getContext('2d').drawImage(this.backgroundImageElement, left, top, width, height, 0, 0, tiny.width, tiny.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(tiny, 0, 0, width, height);
    } else {
      if (mode === 'blur') context.filter = 'blur(14px)';
      context.drawImage(this.backgroundImageElement, left, top, width, height, 0, 0, width, height);
      context.filter = 'none';
    }
    return { dataUrl: output.toDataURL('image/png'), left, top, width, height };
  }

  async addObscuredRegion(rect, mode) {
    const region = this.cropCanvasRegion(rect, mode);
    const image = await FabricImage.fromURL(region.dataUrl);
    image.set({ left: region.left, top: region.top, originX: 'left', originY: 'top', toolType: mode, objectCaching: false });
    this.canvas.add(image);
  }

  async addMagnifier(rect) {
    const region = this.cropCanvasRegion(rect);
    const image = await FabricImage.fromURL(region.dataUrl);
    image.set({ left: region.left, top: region.top, originX: 'left', originY: 'top', scaleX: 1.35, scaleY: 1.35, shadow: new Shadow({ color: '#0008', blur: 18, offsetX: 3, offsetY: 5 }), toolType: 'magnify' });
    const border = new Rect({ left: 0, top: 0, width: region.width, height: region.height, fill: 'transparent', stroke: this.style.stroke, strokeWidth: this.style.strokeWidth, selectable: false, evented: false });
    const group = new Group([image, border], { left: region.left, top: region.top, originX: 'left', originY: 'top' });
    group.toolType = 'magnify';
    this.canvas.add(group);
  }

  async cropTo(rect) {
    const region = this.cropCanvasRegion(rect);
    const oldBackground = this.backgroundObject;
    const annotations = this.canvas.getObjects().filter((object) => object !== oldBackground);
    const key = this.rememberBackground(region.dataUrl);
    await this.setBackground(key);
    annotations.forEach((object) => {
      object.set({ left: object.left - region.left, top: object.top - region.top });
      if (object.left + object.getScaledWidth() < 0 || object.top + object.getScaledHeight() < 0 || object.left > region.width || object.top > region.height) this.canvas.remove(object);
      else { this.canvas.add(object); object.setCoords(); }
    });
    this.canvas.moveObjectTo(this.backgroundObject, 0);
    this.fitToViewport();
  }

  async addOverlay(dataUrl) {
    const image = await FabricImage.fromURL(dataUrl);
    const maxWidth = this.canvas.width * .35;
    if (image.width > maxWidth) image.scale(maxWidth / image.width);
    image.set({ left: this.canvas.width / 2, top: this.canvas.height / 2, originX: 'center', originY: 'center', toolType: 'image' });
    this.canvas.add(image);
    this.canvas.setActiveObject(image);
    this.pushHistory();
  }

  annotationsJson() {
    return this.canvas.getObjects().filter((object) => object !== this.backgroundObject).map((object) => object.toObject(CUSTOM_PROPERTIES));
  }

  snapshot() { return JSON.stringify({ backgroundKey: this.currentBackgroundKey, objects: this.annotationsJson(), counter: this.counter }); }

  pushHistory(force = false) {
    if (this.restoring) return;
    const snapshot = this.snapshot();
    if (!force && this.history[this.historyIndex] === snapshot) return;
    this.history.splice(this.historyIndex + 1);
    this.history.push(snapshot);
    if (this.history.length > 60) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.hooks.onHistory?.({ canUndo: this.historyIndex > 0, canRedo: false, length: this.history.length });
  }

  async restoreHistory(index) {
    if (index < 0 || index >= this.history.length || index === this.historyIndex) return;
    this.restoring = true;
    try {
      const snapshot = JSON.parse(this.history[index]);
      this.canvas.discardActiveObject();
      this.canvas.getObjects().filter((object) => object !== this.backgroundObject).forEach((object) => this.canvas.remove(object));
      if (snapshot.backgroundKey !== this.currentBackgroundKey) await this.setBackground(snapshot.backgroundKey);
      const objects = await util.enlivenObjects(snapshot.objects || []);
      this.canvas.add(...objects);
      this.canvas.moveObjectTo(this.backgroundObject, 0);
      this.counter = snapshot.counter || 1;
      this.historyIndex = index;
      this.canvas.requestRenderAll();
      this.hooks.onHistory?.({ canUndo: index > 0, canRedo: index < this.history.length - 1, length: this.history.length });
    } finally { this.restoring = false; }
  }

  undo() { return this.restoreHistory(this.historyIndex - 1); }
  redo() { return this.restoreHistory(this.historyIndex + 1); }

  deleteSelected() {
    const active = this.canvas.getActiveObjects();
    if (!active.length) return;
    active.forEach((object) => this.canvas.remove(object));
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  async duplicateSelected() {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    const clone = await active.clone(CUSTOM_PROPERTIES);
    clone.set({ left: active.left + 24, top: active.top + 24 });
    this.canvas.add(clone);
    this.canvas.setActiveObject(clone);
    this.pushHistory();
  }

  moveLayer(direction) {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    const current = this.canvas.getObjects().indexOf(active);
    const target = direction === 'front' ? this.canvas.getObjects().length - 1 : direction === 'back' ? 1 : direction === 'forward' ? current + 1 : current - 1;
    this.canvas.moveObjectTo(active, clamp(target, 1, this.canvas.getObjects().length - 1));
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  alignSelected(axis) {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    if (axis === 'horizontal') active.set('left', (this.canvas.width - active.getScaledWidth()) / 2);
    if (axis === 'vertical') active.set('top', (this.canvas.height - active.getScaledHeight()) / 2);
    active.setCoords();
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  setSnap(enabled) { this.snap = Boolean(enabled); }

  exportDataUrl() {
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    return this.canvas.toDataURL({ format: 'png', multiplier: 1, enableRetinaScaling: false });
  }

  serializeProject(sourcePath) {
    return {
      schemaVersion: 1,
      sourcePath,
      width: this.canvas.width,
      height: this.canvas.height,
      objects: this.annotationsJson(),
      backgroundDataUrl: this.backgrounds.get(this.currentBackgroundKey),
      savedAt: new Date().toISOString()
    };
  }

  stats() {
    const objects = this.canvas.getObjects().filter((object) => object !== this.backgroundObject);
    return { width: this.canvas.width, height: this.canvas.height, objects: objects.length, secureRedactions: objects.filter((object) => object.secureRedaction).length, history: this.history.length, zoom: this.zoom };
  }

  dispose() { this.canvas.dispose(); }
}

window.AurumImageEditorEngine = AurumImageEditorEngine;
