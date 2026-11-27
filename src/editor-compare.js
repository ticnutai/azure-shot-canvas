// Comparing two pictures in the editor: the one being edited (with its marks) and another, side by side or one under
// the other. Zooming and moving act on both together, so the same spot is seen in both. Chosen from the editor's top
// bar ("השוואה"); the second picture comes from the recent captures or from a file.
(() => {
  const api = window.screenStudio;
  const $ = (selector, root = document) => root.querySelector(selector);
  const LAYOUT_KEY = 'aurum-compare-layout';
  const readLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'column' ? 'column' : 'row'; } catch { return 'row'; } };
  const saveLayout = (value) => { try { localStorage.setItem(LAYOUT_KEY, value); } catch {} };

  let view = null; // the open comparison
  const state = { layout: readLayout(), zoom: 1, x: 0, y: 0, images: [] };

  function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
  }

  // ---- the menu on the top bar ----------------------------------------------------------------------------
  function setupButton() {
    const button = $('#editor-compare');
    const menu = $('#editor-compare-menu');
    if (!button || !menu) return;
    button.addEventListener('click', (event) => { event.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', (event) => { if (!menu.contains(event.target)) menu.hidden = true; });
    menu.querySelectorAll('[data-compare-layout]').forEach((option) => option.addEventListener('click', () => {
      menu.hidden = true;
      state.layout = option.dataset.compareLayout === 'column' ? 'column' : 'row';
      saveLayout(state.layout);
      choose();
    }));
  }

  // ---- choosing the second picture ------------------------------------------------------------------------
  async function choose() {
    const current = window.aurumEditor?.currentPath?.();
    const items = ((await api.listLibrary().catch(() => [])) || []).filter((item) => item.kind === 'image' && item.path !== current).slice(0, 60);
    const dialog = el('div', { className: 'compare-chooser', role: 'dialog', ariaLabel: 'בחירת תמונה להשוואה' });
    const close = () => dialog.remove();
    const head = el('div', { className: 'compare-chooser-head' }, [
      el('b', { textContent: 'עם איזו תמונה להשוות?' }),
      el('button', { className: 'editor-icon', textContent: '✕', title: 'ביטול', onclick: close })
    ]);
    const grid = el('div', { className: 'compare-chooser-grid' });
    for (const item of items) {
      const card = el('button', { className: 'compare-choice', title: item.name }, [
        el('img', { src: item.thumbnail || '', alt: '' }),
        el('span', { textContent: item.name })
      ]);
      card.addEventListener('click', async () => {
        close();
        const payload = await api.loadEditorImage(item.path);
        open({ src: payload.dataUrl, name: payload.name });
      });
      grid.append(card);
    }
    if (!items.length) grid.append(el('p', { className: 'compare-empty', textContent: 'אין עוד צילומים בספרייה – אפשר לבחור קובץ מהמחשב.' }));
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      const reader = new FileReader();
      reader.onload = () => { close(); open({ src: reader.result, name: chosen.name }); };
      reader.readAsDataURL(chosen);
    });
    const foot = el('div', { className: 'compare-chooser-foot' }, [
      el('button', { className: 'ghost', textContent: 'קובץ מהמחשב…', onclick: () => file.click() }), file
    ]);
    dialog.append(head, grid, foot);
    dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    document.body.append(dialog);
    dialog.tabIndex = -1; dialog.focus();
  }

  // ---- the comparison view --------------------------------------------------------------------------------
  function open(other) {
    const mine = { src: window.aurumEditor?.exportDataUrl?.(), name: window.aurumEditor?.currentName?.() || 'התמונה בעורך' };
    if (!mine.src) return;
    state.images = [mine, other];
    state.zoom = 1; state.x = 0; state.y = 0;
    view?.remove();
    view = el('section', { className: 'compare-view', ariaLabel: 'השוואה בין שתי תמונות' });
    view.dataset.layout = state.layout;
    const bar = el('div', { className: 'compare-bar' });
    const layoutButton = (value, label, title) => {
      const b = el('button', { className: 'compare-layout-button', textContent: label, title });
      b.dataset.layout = value;
      b.addEventListener('click', () => { state.layout = value; saveLayout(value); view.dataset.layout = value; syncBar(); render(); });
      return b;
    };
    bar.append(
      el('b', { textContent: 'השוואה' }),
      layoutButton('row', '◫ זה לצד זה', 'שתי התמונות זו לצד זו'),
      layoutButton('column', '⬒ זה מתחת לזה', 'שתי התמונות זו מתחת לזו'),
      el('button', { className: 'ghost', textContent: '⇄ החלפת צדדים', onclick: () => { state.images.reverse(); fill(); } }),
      el('button', { className: 'ghost', textContent: 'תמונה אחרת…', onclick: () => choose() }),
      el('span', { className: 'compare-spacer' }),
      el('button', { className: 'editor-icon', textContent: '−', title: 'הקטנה', onclick: () => zoomAt(1 / 1.25) }),
      el('button', { className: 'editor-icon', textContent: '⛶', title: 'התאמה (נגיעה כפולה)', onclick: () => reset() }),
      el('button', { className: 'editor-icon', textContent: '＋', title: 'הגדלה', onclick: () => zoomAt(1.25) }),
      el('output', { className: 'compare-zoom' }),
      el('button', { className: 'gold-button', textContent: '✕ סגירת ההשוואה', onclick: () => close() })
    );
    const panes = el('div', { className: 'compare-panes' });
    for (let index = 0; index < 2; index += 1) {
      const pane = el('div', { className: 'compare-pane' }, [el('img', { alt: '', draggable: false }), el('span', { className: 'compare-label' })]);
      panes.append(pane);
    }
    view.append(bar, panes);
    document.body.append(view);
    place();
    syncBar();
    fill();
    wire(panes);
    document.documentElement.dataset.compareOpen = 'true';
  }

  function close() {
    view?.remove();
    view = null;
    delete document.documentElement.dataset.compareOpen;
  }

  // The view covers the editor below its top bar.
  function place() {
    if (!view) return;
    const shell = $('#image-editor-shell')?.getBoundingClientRect();
    const top = $('.editor-topbar')?.getBoundingClientRect();
    if (!shell) return;
    Object.assign(view.style, { left: `${shell.left}px`, width: `${shell.width}px`, top: `${top ? top.bottom : shell.top}px`, height: `${shell.bottom - (top ? top.bottom : shell.top)}px` });
  }

  function syncBar() {
    view?.querySelectorAll('.compare-layout-button').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout));
  }

  function fill() {
    const panes = view.querySelectorAll('.compare-pane');
    state.images.forEach((image, index) => {
      const img = $('img', panes[index]);
      $('.compare-label', panes[index]).textContent = image.name;
      img.onload = render;
      img.src = image.src;
    });
    render();
  }

  // Both pictures fit their pane (filling it on the limiting side), then the shared zoom and move are applied.
  function render() {
    if (!view) return;
    view.querySelectorAll('.compare-pane').forEach((pane) => {
      const img = $('img', pane);
      if (!img.naturalWidth) return;
      const fit = Math.min(pane.clientWidth / img.naturalWidth, pane.clientHeight / img.naturalHeight);
      const scale = fit * state.zoom;
      img.style.width = `${img.naturalWidth}px`;
      img.style.height = `${img.naturalHeight}px`;
      img.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${scale})`;
    });
    const output = $('.compare-zoom', view);
    if (output) output.textContent = `${Math.round(state.zoom * 100)}%`;
    view.dataset.zoom = String(state.zoom);
  }

  function reset() { state.zoom = 1; state.x = 0; state.y = 0; render(); }

  // Zooming around a point (pointer position relative to the pane centre); keeps that spot under the pointer.
  function zoomAt(factor, px = 0, py = 0) {
    const next = Math.min(12, Math.max(1, state.zoom * factor));
    const k = next / state.zoom;
    state.x = px - (px - state.x) * k;
    state.y = py - (py - state.y) * k;
    state.zoom = next;
    if (next === 1) { state.x = 0; state.y = 0; }
    render();
  }

  function wire(panes) {
    let drag = null;
    panes.addEventListener('wheel', (event) => {
      const pane = event.target.closest('.compare-pane');
      if (!pane) return;
      event.preventDefault();
      const box = pane.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2);
    }, { passive: false });
    panes.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('.compare-pane')) return;
      drag = { x: event.clientX, y: event.clientY, sx: state.x, sy: state.y };
      panes.setPointerCapture(event.pointerId);
      panes.classList.add('dragging');
    });
    panes.addEventListener('pointermove', (event) => {
      if (!drag) return;
      state.x = drag.sx + event.clientX - drag.x;
      state.y = drag.sy + event.clientY - drag.y;
      render();
    });
    const end = () => { drag = null; panes.classList.remove('dragging'); };
    panes.addEventListener('pointerup', end);
    panes.addEventListener('pointercancel', end);
    panes.addEventListener('dblclick', reset);
  }

  window.addEventListener('resize', () => { place(); render(); });
  document.addEventListener('keydown', (event) => { if (view && event.key === 'Escape') close(); });
  // Closing the editor closes the comparison too.
  new MutationObserver(() => { if (view && $('#image-editor-shell')?.classList.contains('hidden')) close(); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

  setupButton();
  window.aurumCompare = { open, close, choose, state: () => ({ ...state, open: Boolean(view) }), setLayout: (value) => { state.layout = value; saveLayout(value); if (view) { view.dataset.layout = value; syncBar(); render(); } } };
})();
