// Full-screen region picker over a frozen image of one screen. Everything here is in screen points relative to
// this screen. After a selection the user can mark it up right here (arrow, box, pen, text, blur, numbers) and
// then save, copy, open the full editor or copy the text in it. Without marks the picture is cut by the main
// process from the untouched frozen image; with marks this page renders it at full resolution.
(() => {
  const api = window.regionApi;
  const geometry = window.AurumRegion;
  const markup = window.AurumMarkup;
  const $ = (selector) => document.querySelector(selector);
  const frozen = $('#frozen');
  const marks = $('#marks');
  const loupe = $('#loupe');
  const loupeCanvas = $('#loupe-canvas');
  const loupeInfo = $('#loupe-info');
  const sizeLabel = $('#size-label');
  const hint = $('#hint');
  const toolbar = $('#toolbar');
  const textInput = $('#text-input');
  const root = document.documentElement;
  const VEIL = 'rgba(4, 10, 20, 0.48)';
  const GOLD = '#f5bd46';
  const LOUPE_ZOOM = 8;
  const HANDLE = 7;
  const HINTS = {
    capture: ['גררו לבחירת אזור', 'לחיצה על חלון או על חלק ממנו מצלמת אותו (שיפט: החלון כולו)', 'אנטר האזור הקודם', 'רווח המסך כולו', 'אסקייפ ביטול'],
    record: ['גררו לבחירת אזור להקלטה', 'לחיצה על חלון מקליטה אותו', 'רווח המסך כולו', 'אסקייפ ביטול'],
    ocr: ['גררו סביב הטקסט להעתקה', 'לחיצה על חלון או על חלק ממנו', 'אסקייפ ביטול']
  };
  const TOOL_KEYS = { KeyV: 'move', KeyA: 'arrow', KeyR: 'rect', KeyP: 'pen', KeyT: 'text', KeyB: 'blur', KeyN: 'number' };

  let session = null; // { displayId, width, height, scale, windows, last, purpose, markup }
  let pointer = null;
  let dragStart = null;
  let dragEnd = null;
  let finished = false;
  let frame = 0;
  // Edit mode (after a selection, when quick marks are on).
  let selected = null;
  let tool = 'move';
  let color = markup.COLORS[0];
  let shapes = [];
  let drawing = null;
  let adjusting = null; // { kind: 'move' | handle name, start, rect }
  let shiftHeld = false;

  const screenBounds = () => ({ x: 0, y: 0, width: session.width, height: session.height });
  const hoveredTarget = () => {
    if (!pointer || dragStart || selected) return null;
    const rect = geometry.targetAt(session.windows, pointer, { wholeWindow: shiftHeld });
    return rect ? geometry.clipRect(rect, screenBounds()) : null;
  };
  const dragSelection = () => (dragStart && dragEnd && geometry.isDrag(dragStart, dragEnd) ? geometry.rectFromPoints(dragStart, dragEnd) : null);
  const inside = (point, rect) => point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
  const clampToSelection = (point) => ({ x: Math.min(Math.max(selected.x, point.x), selected.x + selected.width), y: Math.min(Math.max(selected.y, point.y), selected.y + selected.height) });

  function drawFrozen(image) {
    frozen.width = image.width;
    frozen.height = image.height;
    // The main process sends raw BGRA pixels (lossless and far faster than encoding a PNG); canvas wants RGBA.
    const pixels = new Uint8ClampedArray(image.bitmap.buffer, image.bitmap.byteOffset, image.bitmap.byteLength);
    for (let index = 0; index < pixels.length; index += 4) {
      const blue = pixels[index];
      pixels[index] = pixels[index + 2];
      pixels[index + 2] = blue;
      pixels[index + 3] = 255;
    }
    frozen.getContext('2d').putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  }

  const handlesOf = (rect) => {
    const midX = rect.x + rect.width / 2;
    const midY = rect.y + rect.height / 2;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    return { nw: [rect.x, rect.y], n: [midX, rect.y], ne: [right, rect.y], e: [right, midY], se: [right, bottom], s: [midX, bottom], sw: [rect.x, bottom], w: [rect.x, midY] };
  };
  const handleAt = (point) => {
    if (!selected || tool !== 'move') return null;
    return Object.entries(handlesOf(selected)).find(([, [x, y]]) => Math.abs(point.x - x) <= HANDLE + 2 && Math.abs(point.y - y) <= HANDLE + 2)?.[0] || null;
  };

  function drawMarks() {
    frame = 0;
    if (!session) return;
    const ratio = window.devicePixelRatio || 1;
    if (marks.width !== Math.round(session.width * ratio)) {
      marks.width = Math.round(session.width * ratio);
      marks.height = Math.round(session.height * ratio);
    }
    const context = marks.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, session.width, session.height);
    const focus = selected || dragSelection() || hoveredTarget();
    // Dim everything except the area that would be captured right now.
    context.beginPath();
    context.rect(0, 0, session.width, session.height);
    if (focus) context.rect(focus.x, focus.y, focus.width, focus.height);
    context.fillStyle = VEIL;
    context.fill('evenodd');
    if (selected) {
      context.save();
      context.beginPath();
      context.rect(selected.x, selected.y, selected.width, selected.height);
      context.clip();
      const scale = session.scale;
      for (const shape of drawing ? [...shapes, drawing] : shapes) markup.drawShape(context, shape, { frozen, scale });
      context.restore();
    }
    if (focus) {
      context.strokeStyle = GOLD;
      context.lineWidth = selected || dragSelection() ? 1.5 : 3;
      context.strokeRect(focus.x + 0.5, focus.y + 0.5, focus.width - 1, focus.height - 1);
    }
    if (selected && tool === 'move') {
      context.fillStyle = '#ffffff';
      context.strokeStyle = GOLD;
      context.lineWidth = 1.5;
      for (const [x, y] of Object.values(handlesOf(selected))) {
        context.fillRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
        context.strokeRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
      }
    }
    if (pointer && !selected) {
      context.strokeStyle = 'rgba(255, 211, 106, 0.85)';
      context.lineWidth = 1;
      context.setLineDash([6, 4]);
      context.beginPath();
      context.moveTo(0, Math.round(pointer.y) + 0.5);
      context.lineTo(session.width, Math.round(pointer.y) + 0.5);
      context.moveTo(Math.round(pointer.x) + 0.5, 0);
      context.lineTo(Math.round(pointer.x) + 0.5, session.height);
      context.stroke();
      context.setLineDash([]);
    }
    drawLabel(focus);
    drawLoupe();
    placeToolbar();
  }

  function drawLabel(focus) {
    if (!focus) { sizeLabel.style.display = 'none'; return; }
    sizeLabel.textContent = `${Math.round(focus.width * session.scale)} × ${Math.round(focus.height * session.scale)}`;
    sizeLabel.style.display = 'block';
    const width = sizeLabel.offsetWidth;
    const height = sizeLabel.offsetHeight;
    const left = Math.min(Math.max(4, focus.x), session.width - width - 4);
    const top = focus.y - height - 6 >= 4 ? focus.y - height - 6 : Math.min(focus.y + 6, session.height - height - 4);
    sizeLabel.style.transform = `translate(${left}px, ${top}px)`;
  }

  function drawLoupe() {
    if (!pointer || (selected && !adjusting)) { loupe.style.display = 'none'; return; }
    loupe.style.display = 'block';
    const context = loupeCanvas.getContext('2d');
    const span = loupeCanvas.width / LOUPE_ZOOM;
    const centerX = Math.floor(pointer.x * session.scale);
    const centerY = Math.floor(pointer.y * session.scale);
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#000';
    context.fillRect(0, 0, loupeCanvas.width, loupeCanvas.height);
    context.drawImage(frozen, centerX - span / 2, centerY - span / 2, span, span, 0, 0, loupeCanvas.width, loupeCanvas.height);
    const middle = loupeCanvas.width / 2 - LOUPE_ZOOM / 2;
    context.strokeStyle = GOLD;
    context.lineWidth = 1;
    context.strokeRect(middle + 0.5, middle + 0.5, LOUPE_ZOOM - 1, LOUPE_ZOOM - 1);
    const focus = selected || dragSelection();
    loupeInfo.textContent = focus
      ? `${Math.round(focus.width * session.scale)} × ${Math.round(focus.height * session.scale)}`
      : `${centerX}, ${centerY}`;
    const boxWidth = loupe.offsetWidth;
    const boxHeight = loupe.offsetHeight;
    const left = pointer.x + 22 + boxWidth > session.width ? pointer.x - 22 - boxWidth : pointer.x + 22;
    const top = pointer.y + 22 + boxHeight > session.height ? pointer.y - 22 - boxHeight : pointer.y + 22;
    loupe.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, top)}px)`;
  }

  // The toolbar sits under the selection, above it when there is no room, or inside its bottom edge.
  function placeToolbar() {
    if (!selected) { toolbar.hidden = true; return; }
    toolbar.hidden = false;
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const right = selected.x + selected.width;
    const left = Math.min(Math.max(6, right - width), session.width - width - 6);
    let top = selected.y + selected.height + 8;
    if (top + height > session.height - 6) top = selected.y - height - 8;
    if (top < 6) top = selected.y + selected.height - height - 8;
    toolbar.style.transform = `translate(${left}px, ${Math.max(6, top)}px)`;
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(drawMarks); };

  // ---- Ending the session -------------------------------------------------------------------------------
  async function finish(rect, after = 'save') {
    if (finished || !session || !geometry.isUsable(rect)) return;
    commitText();
    finished = true;
    root.dataset.regionAfter = after;
    let png = null;
    if (shapes.length) {
      const pixels = geometry.toImagePixels(rect, session.scale, { width: frozen.width, height: frozen.height });
      png = await markup.renderSelection({ frozen, scale: session.scale, rect, pixels, shapes });
    }
    api.finish(session.displayId, rect, { after, png, marks: shapes.length });
  }

  function cancel() {
    if (finished) return;
    finished = true;
    api.cancel();
  }

  // A chosen area: capture at once, or (quick marks on) keep it on screen with the toolbar.
  // markupNow: Control held on release opens the marks toolbar even when saving on release is the setting.
  function choose(rect, { markupNow = false } = {}) {
    if (!geometry.isUsable(rect)) return;
    if (session.purpose === 'record') return finish(rect, 'record');
    if (session.purpose === 'ocr') return finish(rect, 'ocr');
    if (!session.markup && !markupNow) return finish(rect, 'save');
    selected = rect;
    tool = 'move';
    syncToolbar();
    document.body.dataset.editing = 'true';
    root.dataset.regionEditing = 'true';
    schedule();
  }

  // ---- Toolbar ------------------------------------------------------------------------------------------
  function syncToolbar() {
    toolbar.querySelectorAll('[data-tool]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)));
    toolbar.querySelectorAll('[data-color]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.color === color)));
    toolbar.querySelector('[data-command="undo"]').disabled = !shapes.length;
    document.body.dataset.tool = tool;
  }
  function setTool(name) {
    commitText();
    tool = name;
    syncToolbar();
    schedule();
  }
  function undo() {
    commitText();
    shapes.pop();
    syncToolbar();
    schedule();
  }
  toolbar.addEventListener('pointerdown', (event) => event.stopPropagation());
  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !selected) return;
    if (button.dataset.tool) setTool(button.dataset.tool);
    else if (button.dataset.color) { color = button.dataset.color; syncToolbar(); }
    else if (button.dataset.command === 'undo') undo();
    else if (button.dataset.command === 'cancel') cancel();
    else if (button.dataset.command === 'save-area') saveArea();
    else if (button.dataset.after) finish(selected, button.dataset.after);
  });
  for (const [index, value] of markup.COLORS.entries()) {
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    swatch.dataset.color = value;
    swatch.style.setProperty('--swatch', value);
    swatch.title = ['אדום', 'צהוב', 'כחול', 'ירוק', 'שחור'][index];
    toolbar.querySelector('.colors').append(swatch);
  }

  // ---- Saved areas -------------------------------------------------------------------------------------
  const note = $('#note');
  let noteTimer = 0;
  function showNote(text) {
    note.textContent = text;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.hidden = true; }, 1800);
  }
  async function saveArea() {
    if (!selected) return;
    try {
      const saved = await api.saveArea(session.displayId, selected);
      session.saved = [{ name: saved.name, rect: { ...selected } }, ...session.saved].slice(0, 9);
      root.dataset.savedAreas = String(session.saved.length);
      showNote(`${saved.name} נשמר · בפעם הבאה: מקש 1`);
    } catch (error) { showNote(error.message); }
  }

  // ---- Text marks ---------------------------------------------------------------------------------------
  let textAt = null;
  function startText(point) {
    commitText();
    textAt = point;
    textInput.value = '';
    textInput.style.color = color;
    textInput.hidden = false;
    // The text's right edge is where the user clicked (Hebrew runs right to left).
    textInput.style.transform = `translate(${Math.max(0, point.x - 260)}px, ${point.y - 4}px)`;
    requestAnimationFrame(() => textInput.focus());
  }
  function commitText() {
    if (!textAt) return;
    const shape = { type: 'text', color, from: textAt, text: textInput.value };
    textAt = null;
    textInput.hidden = true;
    if (markup.isMeaningful(shape)) shapes.push(shape);
    syncToolbar();
    schedule();
  }
  textInput.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); textAt = null; textInput.hidden = true; schedule(); }
    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commitText(); }
  });
  textInput.addEventListener('pointerdown', (event) => event.stopPropagation());

  // ---- Pointer --------------------------------------------------------------------------------------------
  const pointFrom = (event) => ({
    x: Math.min(Math.max(0, event.clientX), session.width),
    y: Math.min(Math.max(0, event.clientY), session.height)
  });
  const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

  window.addEventListener('pointermove', (event) => {
    if (!session || finished) return;
    pointer = pointFrom(event);
    shiftHeld = event.shiftKey;
    if (dragStart) dragEnd = pointer;
    if (drawing) {
      const point = clampToSelection(pointer);
      if (drawing.type === 'pen') drawing.points.push(point);
      else drawing.to = point;
    }
    if (adjusting) {
      const dx = pointer.x - adjusting.start.x;
      const dy = pointer.y - adjusting.start.y;
      const base = adjusting.rect;
      let { x, y, width, height } = base;
      if (adjusting.kind === 'move') {
        x = Math.min(Math.max(0, base.x + dx), session.width - base.width);
        y = Math.min(Math.max(0, base.y + dy), session.height - base.height);
        if (shapes.length) { x = base.x; y = base.y; } // marks are tied to the pixels under them
      } else {
        let left = base.x; let top = base.y; let right = base.x + base.width; let bottom = base.y + base.height;
        if (adjusting.kind.includes('w')) left = Math.min(right - geometry.MIN_SIZE, Math.max(0, base.x + dx));
        if (adjusting.kind.includes('e')) right = Math.max(left + geometry.MIN_SIZE, Math.min(session.width, right + dx));
        if (adjusting.kind.includes('n')) top = Math.min(bottom - geometry.MIN_SIZE, Math.max(0, base.y + dy));
        if (adjusting.kind.includes('s')) bottom = Math.max(top + geometry.MIN_SIZE, Math.min(session.height, bottom + dy));
        x = left; y = top; width = right - left; height = bottom - top;
      }
      selected = { x, y, width, height };
    }
    if (selected && !adjusting && !drawing) {
      const handle = handleAt(pointer);
      document.body.style.cursor = handle ? CURSORS[handle] : tool === 'move' && inside(pointer, selected) ? (shapes.length ? 'default' : 'move') : tool === 'text' ? 'text' : 'crosshair';
    }
    const hintBox = hint.getBoundingClientRect();
    document.body.dataset.nearHint = String(pointer.y < hintBox.bottom + 30 && pointer.x > hintBox.left - 30 && pointer.x < hintBox.right + 30);
    schedule();
  });

  window.addEventListener('pointerdown', (event) => {
    if (!session || finished) return;
    if (event.button === 2) return selected ? undefined : cancel();
    if (event.button !== 0) return;
    pointer = pointFrom(event);
    document.body.setPointerCapture?.(event.pointerId);
    if (selected) {
      commitText();
      const handle = handleAt(pointer);
      if (handle) { adjusting = { kind: handle, start: pointer, rect: { ...selected } }; return; }
      if (tool === 'move') {
        if (inside(pointer, selected)) { adjusting = { kind: 'move', start: pointer, rect: { ...selected } }; return; }
        // Outside the selection with the move tool: start over with a new area (marks are dropped).
        selected = null;
        shapes = [];
        document.body.dataset.editing = 'false';
        syncToolbar();
      } else {
        if (!inside(pointer, selected)) return;
        const point = clampToSelection(pointer);
        if (tool === 'text') return startText(point);
        if (tool === 'number') {
          shapes.push({ type: 'number', color, from: point, number: shapes.filter((shape) => shape.type === 'number').length + 1 });
          syncToolbar();
          return schedule();
        }
        drawing = tool === 'pen' ? { type: 'pen', color, points: [point] } : { type: tool, color, from: point, to: point };
        return schedule();
      }
    }
    dragStart = pointer;
    dragEnd = pointer;
    document.body.dataset.dragging = 'true';
    schedule();
  });

  window.addEventListener('pointerup', (event) => {
    if (!session || finished || event.button !== 0) return;
    if (drawing) {
      if (markup.isMeaningful(drawing)) shapes.push(drawing);
      drawing = null;
      syncToolbar();
      return schedule();
    }
    if (adjusting) { adjusting = null; return schedule(); }
    if (!dragStart) return;
    dragEnd = pointFrom(event);
    const dragged = dragSelection();
    const start = dragStart;
    dragStart = null;
    document.body.dataset.dragging = 'false';
    if (dragged) return choose(dragged, { markupNow: event.ctrlKey });
    // A click: the window part under the pointer, or the whole screen when there is none.
    pointer = start;
    shiftHeld = event.shiftKey;
    choose(hoveredTarget() || screenBounds(), { markupNow: event.ctrlKey });
  });

  window.addEventListener('dblclick', (event) => {
    if (selected && tool === 'move' && inside(pointFrom(event), selected)) finish(selected, 'save');
  });
  window.addEventListener('contextmenu', (event) => { event.preventDefault(); if (!selected) cancel(); });

  window.addEventListener('keydown', (event) => {
    if (!session || finished) return;
    shiftHeld = event.shiftKey;
    if (event.key === 'Escape') { event.preventDefault(); return cancel(); }
    if (selected) {
      if (event.key === 'Enter') { event.preventDefault(); return finish(selected, 'save'); }
      if (event.ctrlKey && event.code === 'KeyC') { event.preventDefault(); return finish(selected, 'copy'); }
      if (event.ctrlKey && event.code === 'KeyZ') { event.preventDefault(); return undo(); }
      if (event.ctrlKey && event.code === 'KeyE') { event.preventDefault(); return finish(selected, 'edit'); }
      if (!event.ctrlKey && TOOL_KEYS[event.code]) { event.preventDefault(); return setTool(TOOL_KEYS[event.code]); }
      return;
    }
    if (event.key === 'Enter' && session.last && session.purpose === 'capture') { event.preventDefault(); return choose(session.last); }
    // 1–9: a saved area (newest is 1).
    const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
    if (digit && session.saved[Number(digit) - 1]) { event.preventDefault(); return choose(session.saved[Number(digit) - 1].rect); }
    if (event.key === ' ' || event.code === 'Space') { event.preventDefault(); return choose(screenBounds()); }
    // Arrows fine-tune the corner being dragged, one screen point at a time (Shift: ten).
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (delta && pointer) {
      event.preventDefault();
      pointer = { x: Math.min(Math.max(0, pointer.x + delta[0]), session.width), y: Math.min(Math.max(0, pointer.y + delta[1]), session.height) };
      if (dragStart) dragEnd = pointer;
    }
    schedule();
  });
  window.addEventListener('keyup', (event) => { shiftHeld = event.shiftKey; schedule(); });

  // ---- Session start ------------------------------------------------------------------------------------
  function renderHint(purpose, savedCount = 0) {
    const [first, ...rest] = HINTS[purpose] || HINTS.capture;
    if (purpose === 'capture') rest.unshift(session.markup ? 'שחרור — סרגל סימון לפני השמירה' : 'שחרור — נשמר מיד · עם קונטרול: סימון לפני השמירה');
    if (savedCount && purpose !== 'ocr') rest.splice(rest.length - 1, 0, savedCount === 1 ? 'מקש 1 האזור השמור' : `מקשים 1–${savedCount} אזורים שמורים`);
    const bold = document.createElement('b');
    bold.textContent = first;
    hint.replaceChildren(bold, ...rest.map((text) => Object.assign(document.createElement('span'), { textContent: text })));
  }

  api.onStart((data) => {
    session = {
      displayId: data.displayId, width: data.width, height: data.height, scale: data.image.width / data.width,
      windows: data.windows || [], last: data.last || null, purpose: data.purpose || 'capture', markup: data.markup !== false,
      saved: Array.isArray(data.saved) ? data.saved : []
    };
    finished = false;
    dragStart = null;
    dragEnd = null;
    selected = null;
    shapes = [];
    drawing = null;
    adjusting = null;
    textAt = null;
    textInput.hidden = true;
    tool = 'move';
    pointer = data.pointer || null;
    document.body.dataset.dragging = 'false';
    document.body.dataset.editing = 'false';
    document.body.dataset.hint = String(data.hint !== false);
    document.body.style.cursor = '';
    root.dataset.regionEditing = 'false';
    delete root.dataset.regionAfter;
    renderHint(session.purpose, session.saved.length);
    root.dataset.savedAreas = String(session.saved.length);
    note.hidden = true;
    syncToolbar();
    drawFrozen(data.image);
    drawMarks();
    root.dataset.regionWindows = String(session.windows.length);
    root.dataset.regionParts = String(session.windows.reduce((sum, item) => sum + (item.parts?.length || 0), 0));
    root.dataset.regionReady = String(Date.now());
    api.ready(data.displayId);
  });
  // Escape held by the main process while the overlay is open (it works even without keyboard focus).
  api.onKey?.((key) => {
    if (key !== 'Escape' || !session || finished) return;
    if (textAt) { textAt = null; textInput.hidden = true; return schedule(); }
    cancel();
  });
  // Report the first painted frame after the window appears, so it is revealed without a stale picture.
  api.onShown(() => requestAnimationFrame(() => requestAnimationFrame(() => api.visible(session?.displayId))));
})();
