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
      onZoom: (zoom) => { $('#editor-zoom').textContent = `${Math.round(zoom * 100)}%`; },
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
    document.documentElement.dataset.editorOpen = 'true';
    document.querySelectorAll('.sidebar .nav-item').forEach((button) => button.classList.toggle('active', button.dataset.action === 'edit'));
    setMode(requestedMode);
    createEngine();
    sourcePath = payload.path;
    $('#editor-file-name').textContent = payload.name;
    await engine.load(payload.dataUrl, payload.project);
    selectTool('select');
    setDirty(false);
    updateStats();
  }

  async function save(modeToSave = 'overwrite') {
    if (!engine || !sourcePath) return;
    $('#editor-save-state').textContent = 'שומר…';
    const result = await api.saveEditorImage({ sourcePath, mode: modeToSave === 'copy' ? 'copy' : 'overwrite', dataUrl: engine.exportDataUrl(), project: engine.serializeProject(sourcePath) });
    sourcePath = result.path;
    $('#editor-file-name').textContent = result.name;
    setDirty(false);
    window.dispatchEvent(new CustomEvent('aurum:library-changed'));
  }

  function closeEditor(force = false) {
    if (dirty && !force && !confirm('יש שינויים שטרם נשמרו. לסגור את העורך?')) return;
    shell.classList.add('hidden');
    document.documentElement.dataset.editorOpen = 'false';
    const content = document.querySelector('.content-shell');
    const activePage = content?.dataset.activePage || 'capture';
    const activeNavigation = content?.dataset.activeNavigation || activePage;
    document.querySelectorAll('.sidebar .nav-item').forEach((button) => {
      const action = button.dataset.action || button.dataset.page;
      button.classList.toggle('active', button.dataset.page === activePage && action === activeNavigation);
    });
    engine?.dispose(); engine = null; sourcePath = null;
  }

  window.aurumEditor = { open: openEditor, close: closeEditor, isOpen: () => !shell.classList.contains('hidden'), stats: () => engine?.stats() };
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
  $('#editor-copy').addEventListener('click', async () => { await api.copyEditorImage(engine.exportDataUrl()); $('#editor-save-state').textContent = 'התמונה הועתקה ללוח'; });
  $('#editor-undo').addEventListener('click', () => engine.undo()); $('#editor-redo').addEventListener('click', () => engine.redo());
  $('#editor-fit').addEventListener('click', () => engine.fitToViewport()); $('#editor-zoom-in').addEventListener('click', () => engine.zoomBy(1.2)); $('#editor-zoom-out').addEventListener('click', () => engine.zoomBy(1 / 1.2));
  $('#editor-delete').addEventListener('click', () => engine.deleteSelected()); $('#editor-duplicate').addEventListener('click', () => engine.duplicateSelected());
  $('#editor-snap').addEventListener('change', (event) => engine.setSnap(event.target.checked));
  $('[data-editor-layer="front"]').addEventListener('click', () => engine.moveLayer('front')); $('[data-editor-layer="back"]').addEventListener('click', () => engine.moveLayer('back'));
  $('[data-editor-align="horizontal"]').addEventListener('click', () => engine.alignSelected('horizontal')); $('[data-editor-align="vertical"]').addEventListener('click', () => engine.alignSelected('vertical'));
  $('#editor-stroke').addEventListener('input', (event) => engine.setStyle({ stroke: event.target.value })); $('#editor-fill').addEventListener('input', (event) => engine.setStyle({ fill: event.target.value })); $('#editor-fill-none').addEventListener('click', () => engine.setStyle({ fill: 'transparent' }));
  $('#editor-width').addEventListener('input', (event) => { $('#editor-width-output').textContent = event.target.value; engine.setStyle({ strokeWidth: Number(event.target.value) }); });
  $('#editor-opacity').addEventListener('input', (event) => { $('#editor-opacity-output').textContent = `${event.target.value}%`; engine.setStyle({ opacity: Number(event.target.value) / 100 }); });
  $('#editor-font-size').addEventListener('input', (event) => { $('#editor-font-output').textContent = event.target.value; engine.setStyle({ fontSize: Number(event.target.value) }); });
  $('#editor-text').addEventListener('input', (event) => engine.setStyle({ text: event.target.value }));
  $('#editor-overlay-file').addEventListener('change', (event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => engine.addOverlay(reader.result); reader.readAsDataURL(file); event.target.value = ''; });
  window.addEventListener('resize', () => { if (engine) engine.setViewportSize($('#editor-workspace').clientWidth - 50, $('#editor-workspace').clientHeight - 50); });
  document.addEventListener('keydown', (event) => {
    if (!engine || shell.classList.contains('hidden')) return;
    const targetIsInput = /input|textarea/i.test(event.target.tagName);
    if (event.ctrlKey && event.code === 'KeyZ') { event.preventDefault(); return event.shiftKey ? engine.redo() : engine.undo(); }
    if (event.ctrlKey && event.code === 'KeyY') { event.preventDefault(); return engine.redo(); }
    if (event.ctrlKey && event.code === 'KeyS') { event.preventDefault(); return save(); }
    if (targetIsInput) return;
    if (event.key === 'Delete' || event.key === 'Backspace') engine.deleteSelected();
    if (event.key === 'Escape') selectTool('select');
    const shortcuts = { KeyV: 'select', KeyA: 'arrow', KeyL: 'line', KeyR: 'rect', KeyO: 'ellipse', KeyP: 'polygon', KeyD: 'pen', KeyT: 'text' };
    if (shortcuts[event.code]) selectTool(shortcuts[event.code]);
  });
})();
