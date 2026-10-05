(() => {
  const api = window.screenStudio;
  const shell = document.querySelector('#image-editor-shell');
  if (!shell || !window.AurumImageEditorEngine) return;
  const $ = (selector) => shell.querySelector(selector);
  const $$ = (selector) => [...shell.querySelectorAll(selector)];
  let engine = null;
  let sourcePath = null;
  let mode = 'quick';
  let dirty = false;

  const setDirty = (value = true) => {
    dirty = value;
    shell.dataset.editorDirty = String(value);
    $('#editor-save-state').textContent = value ? 'יש שינויים שטרם נשמרו' : 'הפרויקט נשמר מקומית';
    updateStats();
  };

  const updateStats = () => {
    if (!engine) return;
    const stats = engine.stats();
    $('#editor-stats').innerHTML = `אובייקטים: <b>${stats.objects}</b><br>רזולוציה: <b>${stats.width}×${stats.height}</b><br>היסטוריה: <b>${stats.history}</b><br>השחרות בטוחות: <b>${stats.secureRedactions}</b>`;
  };

  const selectTool = (tool) => {
    engine?.setTool(tool);
    $$('[data-editor-tool]').forEach((button) => button.classList.toggle('active', button.dataset.editorTool === tool));
  };

  const setMode = (next) => {
    mode = next === 'professional' ? 'professional' : 'quick';
    shell.dataset.editorMode = mode;
    $$('[data-editor-mode]').forEach((button) => button.classList.toggle('active', button.dataset.editorMode === mode));
  };

  const createEngine = () => {
    engine?.dispose();
    const canvas = document.createElement('canvas');
    canvas.id = 'editor-canvas';
    $('#editor-canvas-wrap').replaceChildren(canvas);
    engine = new window.AurumImageEditorEngine(canvas, {
      onHistory: ({ canUndo, canRedo }) => { $('#editor-undo').disabled = !canUndo; $('#editor-redo').disabled = !canRedo; setDirty(true); },
      onZoom: (zoom) => {
        const percent = Math.round(zoom * 100);
        $('#editor-zoom').textContent = `${percent}%`;
        $('#editor-zoom-range').value = String(Math.max(5, Math.min(400, percent)));
        shell.dataset.editorZoom = String(percent);
      },
      onSelection: (selection) => {
        if (!selection) return;
        if (selection.stroke && /^#[0-9a-f]{6}$/i.test(selection.stroke)) $('#editor-stroke').value = selection.stroke;
        $('#editor-width').value = selection.strokeWidth || 6;
        $('#editor-opacity').value = Math.round((selection.opacity ?? 1) * 100);
        if (selection.fontSize) $('#editor-font-size').value = selection.fontSize;
        if (selection.text !== undefined) $('#editor-text').value = selection.text;
      },
      onRequestImage: () => $('#editor-overlay-file').click()
    });
    const workspace = $('#editor-workspace');
    engine.setViewportSize(workspace.clientWidth - 50, workspace.clientHeight - 50);
  };

  async function openEditor(filePath, requestedMode = 'quick') {
    const payload = await api.loadEditorImage(filePath);
    shell.classList.remove('hidden');
    shell.dataset.editorReady = 'false';
    document.documentElement.dataset.editorOpen = 'true';
    document.documentElement.dataset.activePage = 'edit';
    document.querySelectorAll('.sidebar .nav-item').forEach((button) => button.classList.toggle('active', button.dataset.action === 'edit'));
    setMode(requestedMode);
    createEngine();
    sourcePath = payload.path;
    $('#editor-file-name').textContent = payload.name;
    await engine.load(payload.dataUrl, payload.project);
    selectTool('select');
    setDirty(false);
    updateStats();
    shell.dataset.editorReady = 'true';
  }

  async function save(modeToSave = 'overwrite') {
    if (!engine || !sourcePath) return;
    $('#editor-save-state').textContent = 'שומר…';
    let result;
    try {
      result = await api.saveEditorImage({ sourcePath, mode: modeToSave === 'copy' ? 'copy' : 'overwrite', dataUrl: engine.exportDataUrl(), project: engine.serializeProject(sourcePath) });
    } catch (error) {
      $('#editor-save-state').textContent = `השמירה נכשלה: ${error?.message || 'שגיאה לא ידועה'}`;
      return;
    }
    sourcePath = result.path;
    $('#editor-file-name').textContent = result.name;
    setDirty(false);
    window.dispatchEvent(new CustomEvent('aurum:library-changed'));
  }

  function closeEditor(force = false) {
    if (dirty && !force && !confirm('יש שינויים שטרם נשמרו. לסגור את העורך?')) return;
    shell.classList.add('hidden');
    shell.dataset.editorReady = 'false';
    document.documentElement.dataset.editorOpen = 'false';
    const content = document.querySelector('.content-shell');
    const activePage = content?.dataset.activePage || 'capture';
    document.documentElement.dataset.activePage = activePage;
    const activeNavigation = content?.dataset.activeNavigation || activePage;
    document.querySelectorAll('.sidebar .nav-item').forEach((button) => {
      const action = button.dataset.action || button.dataset.page;
      button.classList.toggle('active', button.dataset.page === activePage && action === activeNavigation);
    });
    engine?.dispose(); engine = null; sourcePath = null;
  }

  window.aurumEditor = { open: openEditor, close: closeEditor, isOpen: () => !shell.classList.contains('hidden'), stats: () => engine?.stats(), objects: () => engine?.annotationsJson() || [], exportDataUrl: () => engine?.exportDataUrl() };
  $$('[data-editor-tool]').forEach((button) => button.addEventListener('click', () => selectTool(button.dataset.editorTool)));
  $$('[data-editor-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.editorMode)));
  $('#editor-close').addEventListener('click', () => closeEditor());
  document.querySelector('.sidebar')?.addEventListener('click', (event) => {
    const navigation = event.target.closest('.nav-item[data-page]');
    if (!navigation || shell.classList.contains('hidden') || navigation.dataset.action === 'edit') return;
    if (dirty && !confirm('יש שינויים שטרם נשמרו. לעבור למסך אחר?')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    closeEditor(true);
  }, true);
  $('#editor-save').addEventListener('click', () => save());
  $('#editor-save-copy').addEventListener('click', () => save('copy'));
  $('#editor-copy').addEventListener('click', () => copyToClipboard());
  // Share-ready export: the flattened edit on a gradient with padding, rounded corners and a soft shadow.
  const BEAUTIFY_BACKGROUNDS = { ocean: ['#2b5876', '#4e4376'], sunset: ['#ee9ca7', '#ffdde1'], slate: ['#e2e8f0', '#94a3b8'] };
  const loadImage = (src) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('טעינת התמונה נכשלה')); image.src = src; });
  async function beautifiedPng(dataUrl, style) {
    const image = await loadImage(dataUrl);
    const padding = Math.round(Math.max(image.width, image.height) * 0.06);
    const radius = Math.round(Math.min(image.width, image.height) * 0.025) + 6;
    const canvas = document.createElement('canvas');
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    const context = canvas.getContext('2d');
    const [from, to] = BEAUTIFY_BACKGROUNDS[style] || BEAUTIFY_BACKGROUNDS.ocean;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.35)';
    context.shadowBlur = padding * 0.6;
    context.shadowOffsetY = padding * 0.15;
    context.beginPath();
    context.roundRect(padding, padding, image.width, image.height, radius);
    context.fillStyle = '#ffffff';
    context.fill();
    context.restore();
    context.save();
    context.beginPath();
    context.roundRect(padding, padding, image.width, image.height, radius);
    context.clip();
    context.drawImage(image, padding, padding);
    context.restore();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return { bytes: await blob.arrayBuffer(), width: canvas.width, height: canvas.height };
  }
  $('#editor-beautify')?.addEventListener('click', async () => {
    if (!engine) return;
    const button = $('#editor-beautify');
    button.disabled = true;
    try {
      const result = await beautifiedPng(engine.exportDataUrl(), $('#editor-beautify-style').value);
      const saved = await api.saveScreenshot(result.bytes);
      shell.dataset.beautifiedPath = saved.path;
      $('#editor-save-state').textContent = `נשמרה תמונה מעוצבת חדשה (${result.width}×${result.height})`;
      window.dispatchEvent(new CustomEvent('aurum:library-changed'));
    } catch (error) {
      $('#editor-save-state').textContent = `הייצוא המעוצב נכשל: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });  const smartRedact = $('#editor-smart-redact');
  if (!api.detectSensitiveRegions) smartRedact?.classList.add('hidden');
  smartRedact?.addEventListener('click', async () => {
    if (!engine) return;
    smartRedact.disabled = true;
    shell.dataset.smartRedact = 'running';
    $('#editor-save-state').textContent = 'מאתר מידע רגיש בתמונה…';
    try {
      const { dataUrl, scale } = engine.backgroundForOcr();
      const result = await api.detectSensitiveRegions(dataUrl);
      const added = engine.addRedactions(result.regions, scale);
      $('#editor-save-state').textContent = added ? `הושחרו ${added} פריטים: ${result.summary}` : 'לא נמצא מידע רגיש בתמונה';
      shell.dataset.smartRedact = String(added);
    } catch (error) {
      $('#editor-save-state').textContent = `האיתור נכשל: ${error.message}`;
      shell.dataset.smartRedact = 'error';
    } finally {
      smartRedact.disabled = false;
    }
  });
  $('#editor-undo').addEventListener('click', () => engine.undo()); $('#editor-redo').addEventListener('click', () => engine.redo());
  const setManualZoom = (zoom) => { $('#editor-workspace').dataset.manualZoom = 'true'; engine.setZoom(zoom); };
  const fitEditor = () => { $('#editor-workspace').dataset.manualZoom = 'false'; engine.fitToViewport(); };
  $('#editor-fit').addEventListener('click', fitEditor);
  $('#editor-zoom-in').addEventListener('click', () => setManualZoom(engine.stats().zoom * 1.2));
  $('#editor-zoom-out').addEventListener('click', () => setManualZoom(engine.stats().zoom / 1.2));
  $('#editor-zoom-range').addEventListener('input', (event) => setManualZoom(Number(event.target.value) / 100));
  $('#editor-workspace').addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setManualZoom(engine.stats().zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });
  $('#editor-delete').addEventListener('click', () => engine.deleteSelected()); $('#editor-duplicate').addEventListener('click', () => engine.duplicateSelected());
  $('#editor-snap').addEventListener('change', (event) => engine.setSnap(event.target.checked));
  $('[data-editor-layer="front"]').addEventListener('click', () => engine.moveLayer('front')); $('[data-editor-layer="back"]').addEventListener('click', () => engine.moveLayer('back'));
  $('[data-editor-align="horizontal"]').addEventListener('click', () => engine.alignSelected('horizontal')); $('[data-editor-align="vertical"]').addEventListener('click', () => engine.alignSelected('vertical'));
  $('#editor-stroke').addEventListener('input', (event) => engine.setStyle({ stroke: event.target.value })); $('#editor-fill').addEventListener('input', (event) => engine.setStyle({ fill: event.target.value })); $('#editor-fill-none').addEventListener('click', () => engine.setStyle({ fill: 'transparent' }));
  $('#editor-width').addEventListener('input', (event) => { $('#editor-width-output').textContent = event.target.value; engine.setStyle({ strokeWidth: Number(event.target.value) }); });
  $('#editor-opacity').addEventListener('input', (event) => { $('#editor-opacity-output').textContent = `${event.target.value}%`; engine.setStyle({ opacity: Number(event.target.value) / 100 }); });
  $('#editor-font-size').addEventListener('input', (event) => { $('#editor-font-output').textContent = event.target.value; engine.setStyle({ fontSize: Number(event.target.value) }); });
  $('#editor-text').addEventListener('input', (event) => engine.setStyle({ text: event.target.value }));
  const addImageFile = (file) => { const reader = new FileReader(); reader.onload = () => engine?.addOverlay(reader.result); reader.readAsDataURL(file); };
  $('#editor-overlay-file').addEventListener('change', (event) => { const file = event.target.files[0]; if (!file) return; addImageFile(file); event.target.value = ''; });
  const copyToClipboard = async () => { await api.copyEditorImage(engine.exportDataUrl()); $('#editor-save-state').textContent = 'התמונה הועתקה ללוח'; };
  // Ctrl+V: an image on the system clipboard becomes a layer; otherwise paste the last copied shapes.
  document.addEventListener('paste', (event) => {
    if (!engine || shell.classList.contains('hidden') || /input|textarea/i.test(event.target.tagName) || engine.isEditingText()) return;
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
    event.preventDefault();
    if (file) addImageFile(file); else engine.pasteCopied();
  });
  window.addEventListener('resize', () => { if (engine) engine.setViewportSize($('#editor-workspace').clientWidth - 50, $('#editor-workspace').clientHeight - 50); });
  document.addEventListener('keydown', (event) => {
    if (!engine || shell.classList.contains('hidden')) return;
    const targetIsInput = /input|textarea/i.test(event.target.tagName);
    if (targetIsInput && event.ctrlKey && (event.code === 'KeyZ' || event.code === 'KeyY')) return;
    if (event.ctrlKey && event.code === 'KeyZ') { event.preventDefault(); return event.shiftKey ? engine.redo() : engine.undo(); }
    if (event.ctrlKey && event.code === 'KeyY') { event.preventDefault(); return engine.redo(); }
    if (event.ctrlKey && event.code === 'KeyS') { event.preventDefault(); return save(); }
    if (event.ctrlKey && (event.code === 'Equal' || event.code === 'NumpadAdd')) { event.preventDefault(); return setManualZoom(engine.stats().zoom * 1.2); }
    if (event.ctrlKey && (event.code === 'Minus' || event.code === 'NumpadSubtract')) { event.preventDefault(); return setManualZoom(engine.stats().zoom / 1.2); }
    if (event.ctrlKey && (event.code === 'Digit0' || event.code === 'Numpad0')) { event.preventDefault(); return fitEditor(); }
    if (targetIsInput || engine.isEditingText()) return;
    if (event.ctrlKey && event.code === 'KeyA') { event.preventDefault(); return engine.selectAll(); }
    if (event.ctrlKey && event.code === 'KeyD') { event.preventDefault(); return engine.duplicateSelected(); }
    if (event.ctrlKey && event.code === 'KeyC') { event.preventDefault(); return engine.hasSelection() ? engine.copySelected() : copyToClipboard(); }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key] && engine.hasSelection()) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      return engine.nudgeSelected(arrows[event.key][0] * step, arrows[event.key][1] * step);
    }
    if (event.key === 'Delete' || event.key === 'Backspace') engine.deleteSelected();
    if (event.key === 'Escape') selectTool('select');
    const shortcuts = { KeyV: 'select', KeyA: 'arrow', KeyL: 'line', KeyR: 'rect', KeyO: 'ellipse', KeyP: 'polygon', KeyD: 'pen', KeyH: 'highlighter', KeyT: 'text', KeyN: 'counter', KeyB: 'blur', KeyC: 'crop', KeyS: 'spotlight' };
    if (shortcuts[event.code]) selectTool(shortcuts[event.code]);
  });
})();
