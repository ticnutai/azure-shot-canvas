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
      setOnTop: async (value) => value, openStudio: async () => {}, getState: async () => ({ onTop: false }), onChanged: () => {},
      setFolder: async (paths, folder) => { list = list.map((item) => (paths.includes(item.path) ? { ...item, folder } : item)); },
      copy: async (paths) => ({ files: paths.length }),
      rename: async (path, name) => {
        const item = list.find((entry) => entry.path === path);
        const full = `${name}${item?.name.slice(item.name.lastIndexOf('.')) || ''}`;
        list = list.map((entry) => (entry.path === path ? { ...entry, name: full } : entry));
        return { path, name: full };
      },
      createGuide: async () => ({ path: 'מדריך צעדים.pdf' }), trim: async () => ({ path: 'קטע.mp4' })
    };
  }
  const api = window.workspaceApi || previewApi();
  const $ = (selector) => document.querySelector(selector);
  const grid = $('#grid');
  const menu = $('#menu');
  const root = document.documentElement;
  // Split in two windows, this page is either the list of captures or only its buttons (the tools window).
  const part = new URLSearchParams(location.search).get('part') === 'tools' ? 'tools' : 'list';
  root.dataset.part = part;
  if (part === 'tools') { document.title = 'כלי הצילום'; $('.title').textContent = 'כלי הצילום'; }
  // The tools window holds no list of its own: the captures chosen in the list window, with their kind.
  let shared = [];
  let items = [];
  let filter = '';
  const chosen = new Set();
  let anchor = null;

  // Folder filter: '*' everything, '' captures without a folder, otherwise one folder.
  let folderFilter = '*';
  // The search finds the name, and — with the text search extra on — the words written inside the picture (item.text).
  const matches = (item) => { const word = filter.toLowerCase(); return item.name.toLowerCase().includes(word) || (item.text || '').toLowerCase().includes(word); };
  const visible = () => items.filter((item) => (folderFilter === '*' || (item.folder || '') === folderFilter) && (!filter || matches(item)));
  const folderNames = () => [...new Set(items.map((item) => item.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  function renderFolderFilter() {
    const select = $('#folder-filter');
    const names = folderNames();
    if (folderFilter !== '*' && folderFilter !== '' && !names.includes(folderFilter)) folderFilter = '*';
    select.replaceChildren(
      new Option('כל התיקיות', '*'),
      ...names.map((name) => new Option(`${name} (${items.filter((item) => item.folder === name).length})`, name)),
      ...(names.length ? [new Option('בלי תיקייה', '')] : [])
    );
    select.value = folderFilter;
  }
  const selectedItems = () => (part === 'tools' ? shared : items.filter((item) => chosen.has(item.path)));

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
      const needs = button.dataset.needs;
      button.disabled = needs === 'one-image' ? !(one.length === 1 && one[0].kind === 'image')
        : needs === 'one-video' ? !(one.length === 1 && one[0].kind === 'video')
          : needs === 'images' ? !one.some((item) => item.kind === 'image')
            : one.length === 0;
    });
    root.dataset.selected = String(one.length);
    if (part === 'list' && root.dataset.split === 'on') api.shareSelection?.(one.map(({ path, kind }) => ({ path, kind })));
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
      // Pictures far down the list load only when they come near the screen, decoded away from the window's work.
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = item.thumbnail || '';
      image.alt = '';
      image.draggable = true;
      frame.append(image);
      const text = document.createElement('div');
      text.className = 'text';
      text.append(cell(item.name, 'name'), cell(`${KIND_LABELS[item.kind] || ''} · ${formatDate(item.modified)} · ${formatSize(item.size)}`, 'meta'));
      tile.append(frame, text, cell(KIND_LABELS[item.kind] || item.extension || ''), cell(formatDate(item.modified)), cell(formatSize(item.size)));
      if (item.folder) tile.append(cell(item.folder, 'folder-tag'));
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
    rangeStart = null;
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
    if (part === 'tools') return;
    items = await api.list().catch(() => []);
    for (const path of [...chosen]) if (!items.some((item) => item.path === path)) chosen.delete(path);
    renderFolderFilter();
    render();
  }

  // ---- Dialogs: folder, steps guide, video trim -----------------------------------------------------------
  const backdrop = $('#dialog-backdrop');
  const dialog = $('#dialog');
  function openDialog(build) {
    closeMenu();
    dialog.replaceChildren();
    build(dialog);
    backdrop.hidden = false;
    root.dataset.dialog = dialog.dataset.kind || 'open';
    dialog.querySelector('input[type="text"], button.primary')?.focus();
  }
  function closeDialog() {
    dialog.querySelector('video')?.pause();
    backdrop.hidden = true;
    delete root.dataset.dialog;
  }
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) closeDialog(); });
  const make = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
  const errorLine = () => make('p', { className: 'error', hidden: true });

  function folderDialog(targets) {
    openDialog((box) => {
      box.dataset.kind = 'folder';
      const input = make('input', { type: 'text', placeholder: 'שם תיקייה חדשה, למשל שם לקוח או פרויקט', maxLength: 40 });
      const apply = async (name) => { await api.setFolder(targets.map((item) => item.path), name); closeDialog(); await load(); };
      const existing = folderNames();
      box.append(
        make('h2', { textContent: targets.length === 1 ? 'העברה לתיקייה' : `העברה לתיקייה (${targets.length} צילומים)` }),
        make('p', { textContent: 'התיקייה היא תווית לסידור בלוח — הקבצים עצמם לא זזים ממקומם.' }),
        ...(existing.length ? [make('div', { className: 'choices' }, ...existing.map((name) => make('button', { textContent: name, onclick: () => apply(name) })))] : []),
        input,
        make('div', { className: 'buttons' },
          make('button', { textContent: 'הסרה מתיקייה', onclick: () => apply('') }),
          make('button', { textContent: 'ביטול', onclick: closeDialog }),
          make('button', { className: 'primary', textContent: 'העברה', onclick: () => input.value.trim() && apply(input.value.trim()) }))
      );
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && input.value.trim()) apply(input.value.trim()); });
    });
  }

  function guideDialog(targets) {
    const images = targets.filter((item) => item.kind === 'image');
    openDialog((box) => {
      box.dataset.kind = 'guide';
      const input = make('input', { type: 'text', value: 'מדריך צעדים', maxLength: 80 });
      const error = errorLine();
      const create = async (format, button) => {
        button.disabled = true;
        error.hidden = true;
        try {
          const result = await api.createGuide({ paths: images.map((item) => item.path), title: input.value, format });
          root.dataset.lastGuide = result.path;
          closeDialog();
        } catch (failure) { error.textContent = failure.message; error.hidden = false; }
        finally { button.disabled = false; }
      };
      const pdf = make('button', { className: 'primary', textContent: 'יצירת PDF' });
      const word = make('button', { textContent: 'יצירת מסמך וורד' });
      pdf.onclick = () => create('pdf', pdf);
      word.onclick = () => create('docx', word);
      box.append(
        make('h2', { textContent: `מדריך צעדים מ־${images.length} צילומים` }),
        make('p', { textContent: 'כל צילום הופך לשלב ממוספר, לפי סדר הצילום, עם הסימונים שעליו. המסמך נשמר בתיקיית הצילומים ונפתח בתיקייה.' }),
        input, error,
        make('div', { className: 'buttons' }, make('button', { textContent: 'ביטול', onclick: closeDialog }), word, pdf)
      );
    });
  }

  function trimDialog(item) {
    openDialog((box) => {
      box.dataset.kind = 'trim';
      const video = make('video', { src: item.url || '', controls: true, preload: 'metadata' });
      const start = make('input', { type: 'range', min: 0, max: 0, step: 0.1, value: 0, ariaLabel: 'התחלה' });
      const end = make('input', { type: 'range', min: 0, max: 0, step: 0.1, value: 0, ariaLabel: 'סוף' });
      const startOut = make('output');
      const endOut = make('output');
      const error = errorLine();
      const time = (seconds) => `${Math.floor(seconds / 60)}:${String((seconds % 60).toFixed(1)).padStart(4, '0')}`;
      const sync = () => {
        if (Number(start.value) > Number(end.value) - 0.2) start.value = Math.max(0, Number(end.value) - 0.2);
        startOut.textContent = time(Number(start.value));
        endOut.textContent = time(Number(end.value));
      };
      video.addEventListener('loadedmetadata', () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        start.max = end.max = String(duration);
        end.value = String(duration);
        sync();
      });
      start.addEventListener('input', () => { sync(); video.currentTime = Number(start.value); });
      end.addEventListener('input', () => { if (Number(end.value) < Number(start.value) + 0.2) end.value = Number(start.value) + 0.2; sync(); video.currentTime = Number(end.value); });
      const save = make('button', { className: 'primary', textContent: 'שמירת הקטע כקובץ חדש' });
      save.onclick = async () => {
        save.disabled = true;
        error.hidden = true;
        try { await api.trim(item.path, Number(start.value), Number(end.value)); closeDialog(); await load(); }
        catch (failure) { error.textContent = failure.message; error.hidden = false; }
        finally { save.disabled = false; }
      };
      box.append(
        make('h2', { textContent: 'חיתוך וידאו' }),
        make('p', { textContent: 'גררו את נקודות ההתחלה והסוף. הקובץ המקורי נשאר כמו שהוא.' }),
        video,
        make('div', { className: 'trim-range' }, make('span', { textContent: 'התחלה' }), start, startOut),
        make('div', { className: 'trim-range' }, make('span', { textContent: 'סוף' }), end, endOut),
        make('div', { className: 'row' },
          make('button', { textContent: 'התחלה מהמקום הנוכחי', onclick: () => { start.value = String(video.currentTime); sync(); } }),
          make('button', { textContent: 'סוף במקום הנוכחי', onclick: () => { end.value = String(video.currentTime); sync(); } })),
        error,
        make('div', { className: 'buttons' }, make('button', { textContent: 'ביטול', onclick: closeDialog }), save)
      );
    });
  }

  // A short message where the capture count usually is, then the count comes back.
  let noteTimer = 0;
  function flashNote(text) {
    const count = $('#count');
    clearTimeout(noteTimer);
    count.textContent = text;
    count.classList.add('note');
    root.dataset.note = text;
    noteTimer = setTimeout(() => { count.classList.remove('note'); delete root.dataset.note; render(); }, 3500);
  }

  async function run(action, targets = selectedItems()) {
    closeMenu();
    // The tools window: the action runs in the list window, where the captures and the dialogs are.
    if (part === 'tools') { if (targets.length) await api.runInList?.(action); return; }
    if (!targets.length) return;
    if (action === 'folder') return folderDialog(targets);
    if (action === 'guide') return guideDialog(targets);
    if (action === 'trim') return targets[0].kind === 'video' ? trimDialog(targets[0]) : undefined;
    if (action === 'edit') {
      const [first] = targets;
      if (first.kind === 'image') await api.action(first.path, 'edit');
      return;
    }
    if (action === 'copy') {
      // All the chosen captures in one copy (one at a time left only the last on the clipboard).
      try {
        await api.copy(targets.map((item) => item.path));
        flashNote(targets.length === 1 ? 'הצילום הועתק — אפשר להדביק' : `הועתקו ${targets.length} צילומים — הדבקה בתיקייה, בצ׳אט או במסמך מדביקה את כולם`);
      } catch (failure) { flashNote(`ההעתקה נכשלה: ${failure.message}`); }
      return;
    }
    for (const item of targets) await api.action(item.path, action).catch(() => {});
    if (action === 'trash') { chosen.clear(); await load(); }
  }

  // ---- Menus ----------------------------------------------------------------------------------------------
  const ACTION_MENUS = {
    capture: [['region', '▱', 'אזור או חלון'], ['repeatRegion', '↺', 'האזור הקודם'], ['ocrRegion', 'א', 'העתקת טקסט מאזור'], ['scrollCapture', '⇣', 'עמוד גלילה אוטומטי'], ['screenshot', '▣', 'מסך מלא']],
    record: [['recordRegion', '▱', 'הקלטת אזור או חלון'], ['record', '●', 'התחלה או עצירה של הקלטה'], ['pause', 'Ⅱ', 'השהיה או המשך']]
  };
  const ITEM_MENU = [['edit', '✎', 'עריכה'], ['copy', '⧉', 'העתקה ללוח'], ['pin', '⌖', 'הצמדה מעל החלונות'], ['open-folder', '⌑', 'הצגה בתיקייה'], null, ['folder', '▣', 'העברה לתיקייה…'], ['guide', '☰', 'מדריך צעדים…'], ['trim', '✂', 'חיתוך וידאו…'], null, ['trash', '⌫', 'העברה לסל המיחזור']];
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
    const oneImage = one.length === 1 && one[0].kind === 'image';
    const allowed = { edit: oneImage, pin: oneImage, guide: one.some((item) => item.kind === 'image'), trim: one.length === 1 && one[0].kind === 'video' };
    const entries = ITEM_MENU.filter((entry) => !entry || allowed[entry[0]] !== false);
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
    }), document.createElement('hr'), Object.assign(document.createElement('div'), { className: 'menu-title', textContent: 'סרגל הפעולות (קונטרול + F1)' }), ...BAR_LOOKS.map(([key, label]) => {
      const button = document.createElement('button');
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(root.dataset.bar === key));
      button.dataset.barChoice = key;
      button.append(Object.assign(document.createElement('span'), { className: 'bar-mark' }), Object.assign(document.createElement('span'), { textContent: label }));
      button.addEventListener('click', () => { closeMenu(); applyBar(key); });
      return button;
    }), document.createElement('hr'), Object.assign(document.createElement('button'), { textContent: 'מקשי קיצור (?)', onclick: () => { closeMenu(); keysDialog(); } }));
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
  // The pin: a free window — always above the others; hidden in an edge — stays open (does not fold away).
  let dockState = { enabled: false, expanded: false, edge: 'right', pinned: false };
  let freeOnTop = false;
  function syncPin() {
    const pin = $('#on-top');
    const docked = dockState.enabled;
    pin.setAttribute('aria-pressed', String(docked ? dockState.pinned : freeOnTop));
    pin.title = docked ? (dockState.pinned ? 'נעוץ — נשאר פתוח (לחיצה משחררת)' : 'נעיצה — להשאיר פתוח') : 'תמיד מעל החלונות';
    pin.setAttribute('aria-label', pin.title);
  }
  $('#on-top').addEventListener('click', async (event) => {
    const pressed = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    if (dockState.enabled) applyDock(await api.setDock?.({ pinned: pressed }) || { ...dockState, pinned: pressed });
    else { freeOnTop = Boolean(await api.setOnTop(pressed)); syncPin(); }
  });
  function applyDock(state) {
    dockState = { ...dockState, ...state };
    root.dataset.docked = dockState.enabled ? (dockState.expanded ? 'open' : 'folded') : 'off';
    root.dataset.dockEdge = dockState.edge;
    $('#dock').setAttribute('aria-pressed', String(dockState.enabled));
    $('#dock').title = dockState.enabled ? 'החזרה לחלון רגיל' : 'הסתרה בקצה המסך — נפתח כשמתקרבים עם העכבר';
    syncPin();
  }
  api.onDock?.(applyDock);
  $('#dock').addEventListener('click', async () => applyDock(await api.setDock?.({ enabled: !dockState.enabled }) || { enabled: !dockState.enabled, expanded: !dockState.enabled }));

  // Handles on every side and corner: pressing one lets the main process follow the pointer until the button is let go.
  document.querySelectorAll('[data-grip]').forEach((grip) => {
    let held = false;
    const letGo = () => { if (!held) return; held = false; delete root.dataset.resizing; api.resizeFrom?.(null); };
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      held = true;
      root.dataset.resizing = grip.dataset.grip;
      grip.setPointerCapture(event.pointerId);
      api.resizeFrom?.(grip.dataset.grip);
    });
    grip.addEventListener('pointermove', (event) => { if (held && !(event.buttons & 1)) letGo(); });
    grip.addEventListener('pointerup', letGo);
    grip.addEventListener('lostpointercapture', letGo);
  });

  // The folded tab: pointing opens (after a breath, so a drag can start), a click opens, pressing and moving drags.
  const tab = $('#dock-tab');
  let tabTimer = 0;
  let pressedAt = null;
  let dragging = false;
  tab.addEventListener('mouseenter', () => { tabTimer = setTimeout(() => { if (!pressedAt) api.setDock?.({ expanded: true }); }, 140); });
  tab.addEventListener('mouseleave', () => clearTimeout(tabTimer));
  tab.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    clearTimeout(tabTimer);
    pressedAt = { x: event.screenX, y: event.screenY };
    tab.setPointerCapture(event.pointerId);
  });
  tab.addEventListener('pointermove', (event) => {
    if (!pressedAt || dragging) return;
    if (Math.hypot(event.screenX - pressedAt.x, event.screenY - pressedAt.y) < 5) return;
    dragging = true;
    root.dataset.dragging = 'true';
    api.dragDock?.(true);
  });
  const release = () => {
    if (!pressedAt) return;
    const wasDragging = dragging;
    pressedAt = null;
    dragging = false;
    delete root.dataset.dragging;
    if (wasDragging) api.dragDock?.(false);
    else api.setDock?.({ expanded: true });
  };
  tab.addEventListener('pointerup', release);
  tab.addEventListener('pointercancel', release);

  // While a dialog, a menu or a drop-down list is open, or a capture is being dragged out, the window must not fold.
  let draggingOut = false;
  let lastBusy = null;
  function reportBusy() {
    const busy = !backdrop.hidden || !menu.hidden || document.activeElement?.tagName === 'SELECT' || draggingOut;
    if (busy === lastBusy) return;
    lastBusy = busy;
    root.dataset.busy = String(busy);
    api.setBusy?.(busy);
  }
  new MutationObserver(reportBusy).observe(backdrop, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(reportBusy).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('focusin', reportBusy);
  document.addEventListener('focusout', () => setTimeout(reportBusy));
  grid.addEventListener('dragstart', () => { draggingOut = true; reportBusy(); setTimeout(() => { draggingOut = false; reportBusy(); }, 4000); }, true);
  $('#search').addEventListener('input', (event) => { filter = event.target.value.trim(); render(); });
  $('#folder-filter').addEventListener('change', (event) => { folderFilter = event.target.value; chosen.clear(); render(); });
  grid.addEventListener('click', (event) => { if (event.target === grid) { chosen.clear(); syncSelection(); } });
  // ---- Top action bar: full, compact (one row), icons only, or hidden ---------------------------------------
  const BAR_LOOKS = [['full', 'מלא'], ['compact', 'מצומצם — שורה אחת'], ['icons', 'סמלים בלבד'], ['hidden', 'מוסתר']];
  let lastShownBar = 'compact';
  function applyBar(look) {
    if (!BAR_LOOKS.some(([key]) => key === look)) return;
    if (look !== 'hidden') lastShownBar = look;
    root.dataset.bar = look;
    store('aurum-ws-bar', look);
  }
  applyBar(stored('aurum-ws-bar', 'full'));

  // ---- Keys: one table drives the handler, the button hints and the help window (so no key is listed twice) --
  const NUMBER_ACTIONS = ['region', 'repeatRegion', 'screenshot', 'scrollCapture', 'ocrRegion', 'recordRegion'];
  const KEYS = [
    ['חיצים', 'מעבר בין הצילומים (עם שיפט — בחירת טווח)'],
    ['בית / סוף', 'הצילום הראשון / האחרון'],
    ['אנטר', 'עריכה'],
    ['רווח', 'תצוגה גדולה של הצילום'],
    ['F2', 'שינוי שם'],
    ['Delete', 'העברה לסל המיחזור'],
    ['קונטרול + C', 'העתקה'],
    ['קונטרול + A', 'בחירת הכל'],
    ['קונטרול + F', 'חיפוש'],
    ['1 עד 6', 'צילום אזור · האזור הקודם · מסך מלא · עמוד גלילה · טקסט מאזור · הקלטת אזור'],
    ['קונטרול + 1 עד 4', 'תצוגה: גדולה · רשת · רשימה · טבלה'],
    ['קונטרול + פלוס / מינוס', 'הגדלה / הקטנה של התמונות (גם קונטרול + גלגלת)'],
    ['קונטרול + F1', 'הסתרה / הצגה של סרגל הפעולות'],
    ['? או F1', 'החלון הזה'],
    ['אסקייפ', 'סגירה']
  ];
  // The number shows on each button of the bar and in its hint.
  NUMBER_ACTIONS.forEach((action, index) => {
    document.querySelectorAll(`.ribbon [data-action="${action}"]`).forEach((button) => {
      button.dataset.key = String(index + 1);
      button.title = `${button.querySelector('span:last-child')?.textContent || ''} (${index + 1})`;
    });
  });

  // The neighbour in the direction of an arrow, as the pictures sit on screen (right-to-left rows).
  function neighbour(key) {
    const tiles = [...grid.querySelectorAll('.item')];
    if (!tiles.length) return null;
    const current = tiles.find((tile) => tile.dataset.path === anchor) || null;
    if (!current) return tiles[0];
    if (key === 'Home') return tiles[0];
    if (key === 'End') return tiles.at(-1);
    const index = tiles.indexOf(current);
    if (key === 'ArrowLeft') return tiles[Math.min(tiles.length - 1, index + 1)];
    if (key === 'ArrowRight') return tiles[Math.max(0, index - 1)];
    const box = current.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    const rows = tiles.filter((tile) => {
      const other = tile.getBoundingClientRect();
      return key === 'ArrowDown' ? other.top > box.bottom - 4 : other.bottom < box.top + 4;
    });
    if (!rows.length) return current;
    const rowTop = key === 'ArrowDown' ? Math.min(...rows.map((tile) => tile.getBoundingClientRect().top)) : Math.max(...rows.map((tile) => tile.getBoundingClientRect().top));
    const row = rows.filter((tile) => Math.abs(tile.getBoundingClientRect().top - rowTop) < 4);
    return row.reduce((best, tile) => {
      const distance = Math.abs(tile.getBoundingClientRect().left + tile.getBoundingClientRect().width / 2 - middle);
      return distance < best.distance ? { tile, distance } : best;
    }, { tile: row[0], distance: Infinity }).tile;
  }
  // Arrows choose the neighbour; with Shift the choice stretches from where the range began.
  let rangeStart = null;
  function moveTo(key, extend) {
    const target = neighbour(key);
    if (!target) return;
    const list = visible();
    const to = list.findIndex((entry) => entry.path === target.dataset.path);
    if (to === -1) return;
    chosen.clear();
    if (extend) {
      rangeStart = rangeStart || anchor || list[to].path;
      const from = Math.max(0, list.findIndex((entry) => entry.path === rangeStart));
      list.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((entry) => chosen.add(entry.path));
    } else {
      rangeStart = null;
      chosen.add(list[to].path);
    }
    anchor = list[to].path;
    syncSelection();
    target.scrollIntoView({ block: 'nearest' });
  }

  function previewDialog(item) {
    openDialog((box) => {
      box.dataset.kind = 'preview';
      const media = item.kind === 'video'
        ? make('video', { src: item.url || '', controls: true, autoplay: true })
        : make('img', { src: item.url || item.thumbnail || '', alt: item.name });
      box.append(make('h2', { textContent: item.name }), media, make('p', { className: 'hint', textContent: 'רווח או אסקייפ — סגירה · חיצים — הצילום הבא' }));
    });
  }
  function renameDialog(item) {
    openDialog((box) => {
      box.dataset.kind = 'rename';
      const extension = item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.')) : '';
      const input = make('input', { type: 'text', value: item.name.slice(0, item.name.length - extension.length), maxLength: 160 });
      const error = errorLine();
      const save = async () => {
        error.hidden = true;
        try {
          // Only the name: the main process keeps the file's own extension.
          const result = await api.rename(item.path, input.value.trim());
          chosen.clear(); chosen.add(result.path); anchor = result.path;
          closeDialog();
          await load();
        } catch (failure) { error.textContent = failure.message; error.hidden = false; }
      };
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && input.value.trim()) save(); });
      box.append(make('h2', { textContent: 'שינוי שם' }), input, error,
        make('div', { className: 'buttons' }, make('button', { textContent: 'ביטול', onclick: closeDialog }), make('button', { className: 'primary', textContent: 'שמירה', onclick: () => input.value.trim() && save() })));
      setTimeout(() => { input.focus(); input.select(); });
    });
  }
  function keysDialog() {
    openDialog((box) => {
      box.dataset.kind = 'keys';
      const table = make('table', { className: 'keys' });
      KEYS.forEach(([key, what]) => table.append(make('tr', {}, make('td', {}, make('kbd', { textContent: key })), make('td', { textContent: what }))));
      box.append(make('h2', { textContent: 'מקשי קיצור בלוח הצילומים' }), table, make('div', { className: 'buttons' }, make('button', { className: 'primary', textContent: 'סגירה', onclick: closeDialog })));
    });
  }

  document.addEventListener('keydown', (event) => {
    // An open dialog takes the keys: Escape closes it (not the window), typing in it never acts on captures.
    if (!backdrop.hidden) {
      const kind = root.dataset.dialog;
      if (event.key === 'Escape' || (kind === 'preview' && event.key === ' ')) { event.preventDefault(); return closeDialog(); }
      if (kind === 'preview' && /^Arrow(Left|Right)$/.test(event.key)) {
        event.preventDefault();
        closeDialog();
        moveTo(event.key, false);
        const item = selectedItems()[0];
        if (item) previewDialog(item);
      }
      return;
    }
    if (event.target.id === 'search') { if (event.key === 'Escape') { event.target.value = ''; filter = ''; render(); grid.focus(); } return; }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    const one = selectedItems();
    if (event.key === 'Escape') {
      if (!menu.hidden) return closeMenu();
      // Hidden in an edge: Escape folds it back into its tab instead of closing it.
      if (dockState.enabled && dockState.expanded) return api.setDock?.({ expanded: false });
      return part === 'tools' ? undefined : api.close();
    }
    // The tools window has no captures to move between, rename or look at: only its buttons and their keys.
    const toolKey = /^(Enter|Delete|F1|\?)$/.test(event.key) || (event.ctrlKey && /^(KeyC|F1)$/.test(event.code || event.key)) || /^(Digit|Numpad)[1-6]$/.test(event.code);
    if (part === 'tools' && !toolKey) return;
    if (event.key === 'F1' && event.ctrlKey) { event.preventDefault(); return applyBar(root.dataset.bar === 'hidden' ? lastShownBar : 'hidden'); }
    if (event.key === 'F1' || event.key === '?') { event.preventDefault(); return keysDialog(); }
    if (event.key === 'Enter') return run('edit');
    if (event.key === 'Delete') return run('trash');
    if (event.key === 'F2') { event.preventDefault(); if (one.length === 1) renameDialog(one[0]); return; }
    if (event.key === ' ') { event.preventDefault(); if (one.length) previewDialog(one[0]); return; }
    if (/^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(event.key) && !event.ctrlKey) { event.preventDefault(); return moveTo(event.key, event.shiftKey); }
    if (event.ctrlKey && event.code === 'KeyC') return run('copy');
    if (event.ctrlKey && event.code === 'KeyA') { event.preventDefault(); visible().forEach((item) => chosen.add(item.path)); return syncSelection(); }
    if (event.ctrlKey && event.code === 'KeyF') { event.preventDefault(); $('#search').focus(); $('#search').select(); return; }
    if (event.ctrlKey && /^Digit[1-4]$/.test(event.code)) { event.preventDefault(); applyLook({ view: VIEWS[Number(event.code.slice(5)) - 1] }); return render(); }
    if (event.ctrlKey && (event.code === 'Equal' || event.code === 'NumpadAdd')) { event.preventDefault(); return applyLook({ size: Number($('#thumb-size').value) + 20 }); }
    if (event.ctrlKey && (event.code === 'Minus' || event.code === 'NumpadSubtract')) { event.preventDefault(); return applyLook({ size: Number($('#thumb-size').value) - 20 }); }
    if (!event.ctrlKey && !event.altKey && !event.metaKey && /^(Digit|Numpad)[1-6]$/.test(event.code)) {
      event.preventDefault();
      return api.runAction(NUMBER_ACTIONS[Number(event.code.slice(-1)) - 1]);
    }
  });
  window.aurumWorkspace = { keys: () => KEYS.map(([key]) => key), bar: () => root.dataset.bar, setBar: applyBar };

  // ---- Split in two windows ---------------------------------------------------------------------------------
  function applySplit(split) {
    root.dataset.split = split ? 'on' : 'off';
    const button = $('#split');
    button.setAttribute('aria-pressed', String(Boolean(split)));
    button.title = split ? 'איחוד לחלון אחד: הכפתורים חוזרים ללוח' : 'פיצול לשני חלונות: הצילומים בחלון אחד והכפתורים בחלון נפרד';
    button.setAttribute('aria-label', button.title);
    if (split) syncSelection();
  }
  $('#split').addEventListener('click', async () => applySplit(await api.setSplit?.(root.dataset.split !== 'on') ?? root.dataset.split !== 'on'));
  api.onSplit?.(applySplit);
  api.onSelection?.((chosenList) => { shared = chosenList; syncSelection(); });
  api.onRunItem?.((action) => run(action));
  // The tools window is as tall as its buttons: they wrap to the width the user gives it, the height follows.
  if (part === 'tools') {
    const fit = () => {
      const bar = [...document.querySelectorAll('.ribbon, .actions')].find((node) => getComputedStyle(node).display !== 'none');
      if (bar) api.fitHeight?.(Math.ceil($('.titlebar').getBoundingClientRect().height + bar.getBoundingClientRect().height));
    };
    const watch = new ResizeObserver(fit);
    document.querySelectorAll('.ribbon, .actions').forEach((node) => watch.observe(node));
  }
  // The design and the bar look chosen in one window show in the other at once.
  window.addEventListener('storage', (event) => {
    if (event.key === 'aurum-ws-theme' && event.newValue) applyLook({ theme: event.newValue });
    if (event.key === 'aurum-ws-bar' && event.newValue) applyBar(event.newValue);
  });

  api.onChanged(() => load());
  api.getState().then((state) => { freeOnTop = Boolean(state.onTop); applySplit(part === 'tools' || Boolean(state.split)); if (state.dock) applyDock(state.dock); else syncPin(); });
  load().then(() => { root.dataset.ready = 'true'; });
})();
