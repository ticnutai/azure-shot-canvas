// Captures window: the newest captures as large thumbnails with their names, chosen with a click (Control adds,
// Shift extends), opened with a double click, dragged out to any program; capture and record from the bottom bar.
(() => {
  // Opened in a plain browser (the local preview address): sample captures, so the designs can be seen as they are.
  function previewApi() {
    const palette = [['#1f6fe5', '#e9f0ff'], ['#e0472b', '#fff0ec'], ['#2a9d5b', '#eaf7ef'], ['#7a4ddb', '#f2ecff'], ['#c99124', '#fff7e3'], ['#16191f', '#f2f3f5']];
    const picture = (index) => {
      const [ink, paper] = palette[index % palette.length];
      const rows = Array.from({ length: 5 }, (_, row) => `<rect x="40" y="${70 + row * 26}" width="${150 + ((index * 37 + row * 53) % 140)}" height="10" rx="2" fill="${ink}" opacity="${0.18 + (row % 3) * 0.1}"/>`).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="${paper}"/><rect width="480" height="38" fill="${ink}"/><circle cx="22" cy="19" r="7" fill="#fff" opacity=".9"/><rect x="40" y="13" width="120" height="12" rx="2" fill="#fff" opacity=".85"/>${rows}<rect x="300" y="64" width="150" height="150" rx="6" fill="${ink}" opacity=".85"/><rect x="40" y="230" width="410" height="44" rx="4" fill="#fff" stroke="${ink}" stroke-opacity=".3"/></svg>`;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    };
    let list = Array.from({ length: 12 }, (_, index) => {
      const minute = String(59 - index * 3).padStart(2, '0');
      return { name: `2026-10-07_19h${minute}_${String(10 + index)}.${index === 4 ? 'mp4' : 'png'}`, path: `preview-${index}`, kind: index === 4 ? 'video' : 'image', extension: index === 4 ? 'mp4' : 'png', modified: Date.now() - index * 3_600_000, size: 40_000 + index * 9_000, thumbnail: picture(index) };
    });
    return {
      preview: true,
      list: async () => list,
      action: async (path, action) => { if (action === 'trash') list = list.filter((item) => item.path !== path); },
      runAction: async () => {}, startDrag: () => {}, close: async () => {}, toggleMaximize: async () => {},
      setOnTop: async (value) => value, openStudio: async () => {}, getState: async () => ({ onTop: false }), onChanged: () => {}
    };
  }
  const api = window.workspaceApi || previewApi();
  const $ = (selector) => document.querySelector(selector);
  const grid = $('#grid');
  const menu = $('#menu');
  const root = document.documentElement;
  let items = [];
  let filter = '';
  const chosen = new Set();
  let anchor = null;

  const visible = () => items.filter((item) => !filter || item.name.toLowerCase().includes(filter.toLowerCase()));
  const selectedItems = () => items.filter((item) => chosen.has(item.path));

  // Design, view and picture size are this window's own conveniences, kept on this computer.
  const stored = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const THEMES = [['graphite', 'גרפיט כהה', '#3a3a3a'], ['office', 'משרדי בהיר', '#1f6fe5'], ['cards', 'כרטיסים צבעוניים', '#e0472b'], ['tiles', 'אריחים רכים', '#7a4ddb'], ['lines', 'קווים נקיים', '#ffffff'], ['lines-dark', 'קווים נקיים כהה', '#16181c']];
  const VIEWS = ['large', 'grid', 'list', 'table'];
  function applyLook({ theme, view, size } = {}) {
    if (theme && THEMES.some(([key]) => key === theme)) { root.dataset.theme = theme; store('aurum-ws-theme', theme); }
    if (view && VIEWS.includes(view)) {
      root.dataset.view = view;
      store('aurum-ws-view', view);
      document.querySelectorAll('[data-view-choice]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.viewChoice === view)));
    }
    if (size) {
      const value = Math.min(420, Math.max(120, Math.round(Number(size) / 10) * 10));
      root.style.setProperty('--thumb', `${value}px`);
      $('#thumb-size').value = String(value);
      store('aurum-ws-thumb', String(value));
    }
  }
  applyLook({ theme: stored('aurum-ws-theme', 'graphite'), view: stored('aurum-ws-view', 'large'), size: stored('aurum-ws-thumb', '220') });

  function syncSelection() {
    grid.querySelectorAll('.item').forEach((tile) => tile.setAttribute('aria-selected', String(chosen.has(tile.dataset.path))));
    const one = selectedItems();
    $('#edit').disabled = one.length !== 1 || one[0].kind !== 'image';
    document.querySelectorAll('[data-item-action]').forEach((button) => {
      button.disabled = button.dataset.needs === 'one-image' ? !(one.length === 1 && one[0].kind === 'image') : one.length === 0;
    });
    root.dataset.selected = String(chosen.size);
  }

  const KIND_LABELS = { image: 'תמונה', video: 'וידאו' };
  const formatSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const formatDate = (time) => new Date(time).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const cell = (text, className = 'cell') => Object.assign(document.createElement('span'), { className, textContent: text });

  function render() {
    const list = visible();
    $('#count').textContent = items.length ? (filter ? `${list.length} מתוך ${items.length}` : `${items.length} צילומים`) : '';
    root.dataset.count = String(list.length);
    if (!list.length) {
      grid.replaceChildren(Object.assign(document.createElement('div'), { className: 'empty', textContent: items.length ? 'אין צילומים שמתאימים לחיפוש' : 'עדיין אין צילומים — לחצו על "צילום אזור" או על מקש צילום המסך' }));
      return syncSelection();
    }
    const head = document.createElement('div');
    head.className = 'table-head';
    head.append(cell('', ''), cell('שם', ''), cell('סוג', ''), cell('נוצר', ''), cell('גודל', ''));
    const tiles = list.map((item) => {
      const tile = document.createElement('div');
      tile.className = 'item';
      tile.setAttribute('role', 'option');
      tile.dataset.path = item.path;
      tile.dataset.kind = item.kind;
      tile.dataset.ext = item.extension || '';
      tile.title = item.name;
      const frame = document.createElement('div');
      frame.className = 'thumb';
      const image = document.createElement('img');
      image.src = item.thumbnail || '';
      image.alt = '';
      image.draggable = true;
      frame.append(image);
      const text = document.createElement('div');
      text.className = 'text';
      text.append(cell(item.name, 'name'), cell(`${KIND_LABELS[item.kind] || ''} · ${formatDate(item.modified)} · ${formatSize(item.size)}`, 'meta'));
      tile.append(frame, text, cell(KIND_LABELS[item.kind] || item.extension || ''), cell(formatDate(item.modified)), cell(formatSize(item.size)));
      tile.addEventListener('click', (event) => choose(item, event));
      tile.addEventListener('dblclick', () => run(item.kind === 'image' ? 'edit' : 'open-folder', [item]));
      tile.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (!chosen.has(item.path)) { chosen.clear(); chosen.add(item.path); anchor = item.path; syncSelection(); }
        openItemMenu(event.clientX, event.clientY);
      });
      // Dragging a picture hands the real file to the program it is dropped on.
      image.addEventListener('dragstart', (event) => { event.preventDefault(); api.startDrag(item.path); });
      return tile;
    });
    grid.replaceChildren(...(root.dataset.view === 'table' ? [head, ...tiles] : tiles));
    syncSelection();
  }
  function choose(item, event) {
    const list = visible();
    if (event.shiftKey && anchor) {
      const from = list.findIndex((entry) => entry.path === anchor);
      const to = list.findIndex((entry) => entry.path === item.path);
      if (!event.ctrlKey) chosen.clear();
      list.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((entry) => chosen.add(entry.path));
    } else if (event.ctrlKey) {
      if (chosen.has(item.path)) chosen.delete(item.path); else chosen.add(item.path);
      anchor = item.path;
    } else {
      chosen.clear();
      chosen.add(item.path);
      anchor = item.path;
    }
    syncSelection();
  }

  async function load() {
    items = await api.list().catch(() => []);
    for (const path of [...chosen]) if (!items.some((item) => item.path === path)) chosen.delete(path);
    render();
  }

  async function run(action, targets = selectedItems()) {
    closeMenu();
    if (!targets.length) return;
    if (action === 'edit') {
      const [first] = targets;
      if (first.kind === 'image') await api.action(first.path, 'edit');
      return;
    }
    for (const item of targets) await api.action(item.path, action).catch(() => {});
    if (action === 'trash') { chosen.clear(); await load(); }
  }

  // ---- Menus ----------------------------------------------------------------------------------------------
  const ACTION_MENUS = {
    capture: [['region', '▱', 'אזור או חלון'], ['repeatRegion', '↺', 'האזור הקודם'], ['ocrRegion', 'א', 'העתקת טקסט מאזור'], ['scrollCapture', '⇣', 'עמוד גלילה'], ['screenshot', '▣', 'מסך מלא']],
    record: [['recordRegion', '▱', 'הקלטת אזור או חלון'], ['record', '●', 'התחלה או עצירה של הקלטה'], ['pause', 'Ⅱ', 'השהיה או המשך']]
  };
  const ITEM_MENU = [['edit', '✎', 'עריכה'], ['copy', '⧉', 'העתקה ללוח'], ['pin', '⌖', 'הצמדה מעל החלונות'], ['open-folder', '⌑', 'הצגה בתיקייה'], null, ['trash', '⌫', 'העברה לסל המיחזור']];
  function showMenu(entries, x, y, onPick) {
    menu.replaceChildren(...entries.map((entry) => {
      if (!entry) return document.createElement('hr');
      const [key, icon, label] = entry;
      const button = document.createElement('button');
      button.setAttribute('role', 'menuitem');
      button.dataset.menuItem = key;
      button.innerHTML = '<i></i><span></span>';
      button.querySelector('i').textContent = icon;
      button.querySelector('span').textContent = label;
      button.addEventListener('click', () => { closeMenu(); onPick(key); });
      return button;
    }));
    menu.hidden = false;
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - box.width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - box.height - 6))}px`;
  }
  function closeMenu() { menu.hidden = true; }
  function openItemMenu(x, y) {
    const one = selectedItems();
    const entries = ITEM_MENU.filter((entry) => !entry || ((entry[0] !== 'edit' && entry[0] !== 'pin') || (one.length === 1 && one[0].kind === 'image')));
    showMenu(entries, x, y, (key) => run(key));
  }
  document.querySelectorAll('.more').forEach((button) => button.addEventListener('click', () => {
    const box = button.getBoundingClientRect();
    showMenu(ACTION_MENUS[button.dataset.menu], box.left, box.top - 8 - ACTION_MENUS[button.dataset.menu].length * 36 - 12, (action) => api.runAction(action));
  }));
  document.addEventListener('pointerdown', (event) => { if (!menu.hidden && !menu.contains(event.target)) closeMenu(); });

  // ---- Buttons and keys -----------------------------------------------------------------------------------
  document.querySelectorAll('.round-action[data-action], .ribbon [data-action]').forEach((button) => button.addEventListener('click', () => api.runAction(button.dataset.action)));
  document.querySelectorAll('.ribbon [data-item-action]').forEach((button) => button.addEventListener('click', () => run(button.dataset.itemAction)));
  document.querySelectorAll('[data-view-choice]').forEach((button) => button.addEventListener('click', () => { applyLook({ view: button.dataset.viewChoice }); render(); }));
  $('#thumb-size').addEventListener('input', (event) => applyLook({ size: event.target.value }));
  // Control + wheel over the pictures: bigger / smaller.
  grid.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    applyLook({ size: Number($('#thumb-size').value) + (event.deltaY < 0 ? 20 : -20) });
  }, { passive: false });
  $('#theme-button').addEventListener('click', (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    menu.replaceChildren(Object.assign(document.createElement('div'), { className: 'menu-title', textContent: 'עיצוב' }), ...THEMES.map(([key, label, color]) => {
      const button = document.createElement('button');
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(root.dataset.theme === key));
      button.dataset.themeChoice = key;
      const swatch = Object.assign(document.createElement('span'), { className: 'swatch' });
      swatch.style.background = color;
      button.append(swatch, Object.assign(document.createElement('span'), { textContent: label }));
      button.addEventListener('click', () => { closeMenu(); applyLook({ theme: key }); });
      return button;
    }));
    menu.hidden = false;
    const width = menu.getBoundingClientRect().width;
    menu.style.left = `${Math.max(6, Math.min(box.left, window.innerWidth - width - 6))}px`;
    menu.style.top = `${box.bottom + 6}px`;
  });
  $('#edit').addEventListener('click', () => run('edit'));
  $('#close').addEventListener('click', () => api.close());
  $('#close-bottom').addEventListener('click', () => api.close());
  $('#maximize').addEventListener('click', () => api.toggleMaximize());
  $('#open-studio').addEventListener('click', () => api.openStudio());
  $('#on-top').addEventListener('click', async (event) => {
    const pressed = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    event.currentTarget.setAttribute('aria-pressed', String(await api.setOnTop(pressed)));
  });
  $('#search').addEventListener('input', (event) => { filter = event.target.value.trim(); render(); });
  grid.addEventListener('click', (event) => { if (event.target === grid) { chosen.clear(); syncSelection(); } });
  document.addEventListener('keydown', (event) => {
    if (event.target.id === 'search') { if (event.key === 'Escape') { event.target.value = ''; filter = ''; render(); grid.focus(); } return; }
    if (event.key === 'Escape') { if (!menu.hidden) return closeMenu(); return api.close(); }
    if (event.key === 'Enter') return run('edit');
    if (event.key === 'Delete') return run('trash');
    if (event.ctrlKey && event.code === 'KeyC') return run('copy');
    if (event.ctrlKey && event.code === 'KeyA') { event.preventDefault(); visible().forEach((item) => chosen.add(item.path)); return syncSelection(); }
  });

  api.onChanged(() => load());
  api.getState().then((state) => { $('#on-top').setAttribute('aria-pressed', String(Boolean(state.onTop))); });
  load().then(() => { root.dataset.ready = 'true'; });
})();
