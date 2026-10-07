// Captures window: the newest captures as large thumbnails with their names, chosen with a click (Control adds,
// Shift extends), opened with a double click, dragged out to any program; capture and record from the bottom bar.
(() => {
  const api = window.workspaceApi;
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

  function syncSelection() {
    grid.querySelectorAll('.item').forEach((tile) => tile.setAttribute('aria-selected', String(chosen.has(tile.dataset.path))));
    const one = selectedItems();
    $('#edit').disabled = one.length !== 1 || one[0].kind !== 'image';
    root.dataset.selected = String(chosen.size);
  }

  function render() {
    const list = visible();
    $('#count').textContent = items.length ? (filter ? `${list.length} מתוך ${items.length}` : `${items.length} צילומים`) : '';
    root.dataset.count = String(list.length);
    if (!list.length) {
      grid.replaceChildren(Object.assign(document.createElement('div'), { className: 'empty', textContent: items.length ? 'אין צילומים שמתאימים לחיפוש' : 'עדיין אין צילומים — לחצו על "צילום אזור" או על מקש צילום המסך' }));
      return syncSelection();
    }
    grid.replaceChildren(...list.map((item) => {
      const tile = document.createElement('div');
      tile.className = 'item';
      tile.setAttribute('role', 'option');
      tile.dataset.path = item.path;
      tile.dataset.kind = item.kind;
      tile.title = item.name;
      const frame = document.createElement('div');
      frame.className = 'thumb';
      const image = document.createElement('img');
      image.src = item.thumbnail || '';
      image.alt = '';
      image.draggable = true;
      frame.append(image);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;
      tile.append(frame, name);
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
    }));
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
  document.querySelectorAll('.round-action[data-action]').forEach((button) => button.addEventListener('click', () => api.runAction(button.dataset.action)));
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
