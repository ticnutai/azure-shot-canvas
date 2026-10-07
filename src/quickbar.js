(() => {
  const api = window.quickbarApi;
  const root = document.documentElement;
  let preferences = { activation: 'click', pinned: false };
  let collapseTimer = null;
  let captures = [];
  let selected = 0;
  let hovering = false;
  // While the pointer is over the card, its keys are live; tell the main process which capture they act on.
  const syncCardKeys = () => api.cardHover(hovering && root.dataset.view === 'capture' ? captures[selected]?.path || null : null)
    .then((keys) => { root.dataset.cardKeys = String(keys.length); })
    .catch(() => { root.dataset.cardKeys = '0'; });
  const applyPreferences = (value) => {
    preferences = value;
    document.body.dataset.edge = preferences.edge;
    document.body.dataset.activation = preferences.activation;
    document.body.dataset.style = preferences.style || 'panel';
    document.querySelectorAll('.pin-toggle').forEach((button) => button.setAttribute('aria-pressed', String(preferences.pinned)));
  };
  const applyRecordingState = (active) => {
    const button = document.querySelector('[data-action="record"]');
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.querySelector('span').textContent = active ? 'עצור הקלטה' : 'התחל הקלטה';
    const stripButton = document.querySelector('[data-strip-action="record"]');
    stripButton?.classList.toggle('active', active);
    stripButton?.setAttribute('aria-pressed', String(active));
    if (stripButton) {
      stripButton.querySelector('span').textContent = active ? 'עצירה' : 'הקלטה';
      stripButton.title = active ? 'עצירת ההקלטה ושמירה' : 'התחלת הקלטה';
    }
    const stateLabel = document.querySelector('#recording-state');
    if (stateLabel) stateLabel.textContent = active ? 'מקליט כעת' : 'מוכן';
  };
  const setView = (view) => {
    root.dataset.view = view;
    document.querySelector('#quickbar-title').textContent = view === 'capture' ? 'נשמר' : 'אורום מהיר';
    if (view !== 'actions') closeMenu({ notify: false });
  };
  const setExpanded = async (expanded) => {
    clearTimeout(collapseTimer);
    document.body.dataset.expanded = String(expanded);
    const result = await api.setExpanded(expanded);
    document.body.dataset.expanded = String(result.expanded);
    if (!result.expanded) setView('actions');
  };
  // Hide after `seconds`; 0 keeps it open. Pointing at the bar always cancels the countdown.
  const scheduleCollapse = (milliseconds) => {
    clearTimeout(collapseTimer);
    if (preferences.pinned || !milliseconds) return;
    collapseTimer = setTimeout(() => setExpanded(false), milliseconds);
  };

  const formatDuration = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  const formatSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const renderCard = () => {
    const item = captures[selected];
    document.body.dataset.hasRecent = String(captures.length > 0);
    if (!item) return;
    const thumb = document.querySelector('#capture-thumb');
    thumb.src = item.thumbnail || '';
    thumb.alt = item.name;
    document.querySelector('#capture-name').textContent = item.name;
    document.querySelector('#capture-meta').textContent = `${item.kind === 'video' ? 'הקלטה' : 'צילום'} · ${formatSize(item.size)}`;
    const badge = document.querySelector('#capture-badge');
    badge.hidden = !(item.kind === 'video' && item.durationSeconds);
    badge.textContent = item.durationSeconds ? `▶ ${formatDuration(item.durationSeconds)}` : '';
    document.querySelector('[data-capture-action="pin"]').disabled = item.kind !== 'image';
    root.dataset.captureKind = item.kind;
  };
  const renderStrip = () => {
    const strip = document.querySelector('#recent-strip');
    strip.replaceChildren(...captures.map((item, index) => {
      const button = document.createElement('button');
      button.className = 'recent-item';
      button.title = item.name;
      button.setAttribute('aria-pressed', String(index === selected && root.dataset.view === 'capture'));
      const image = document.createElement('img');
      image.src = item.thumbnail || '';
      image.alt = '';
      button.append(image);
      if (item.kind === 'video') button.dataset.kind = 'video';
      button.addEventListener('click', async () => {
        selected = index;
        setView('capture');
        await api.setView('capture');
        renderCard();
        renderStrip();
        syncCardKeys();
      });
      return button;
    }));
  };

  api.getState().then((state) => {
    applyPreferences(state.preferences);
    captures = state.captures || [];
    setView(state.view || 'actions');
    document.body.dataset.expanded = String(state.expanded);
    applyRecordingState(state.recording);
    renderCard();
    renderStrip();
  });
  api.onCaptures(({ captures: list, fresh, timeout, select }) => {
    captures = list;
    if (select) {
      // Opened from the history grid: show its card and leave it open while the pointer is on it.
      selected = 0;
      setView('capture');
      document.body.dataset.expanded = 'true';
    } else if (fresh) {
      root.dataset.cardShownAt = String(Date.now());
      selected = 0;
      setView('capture');
      document.body.dataset.expanded = 'true';
      scheduleCollapse(timeout * 1000);
    } else if (!captures.length && root.dataset.view === 'capture') {
      setView('actions');
    }
    selected = Math.min(selected, Math.max(0, captures.length - 1));
    renderCard();
    renderStrip();
    syncCardKeys();
  });

  // The hidden line: touching it opens the bar (hover mode, after a breath so a drag can start); a click opens it
  // too; pressing and moving drags it anywhere — along the edge, to another edge or to another screen.
  const handle = document.querySelector('#edge-handle');
  let hoverTimer = 0;
  let pressedAt = null;
  handle.addEventListener('mouseenter', () => {
    if (preferences.activation === 'hover') hoverTimer = setTimeout(() => { if (!pressedAt) setExpanded(true); }, 140);
  });
  handle.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    clearTimeout(hoverTimer);
    pressedAt = { x: event.screenX, y: event.screenY };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!pressedAt || dragging || Math.hypot(event.screenX - pressedAt.x, event.screenY - pressedAt.y) < 5) return;
    dragging = true;
    root.dataset.dragging = 'true';
    api.drag(true);
  });
  handle.addEventListener('pointerup', async () => {
    const wasDragging = dragging;
    pressedAt = null;
    if (wasDragging) await endDrag();
    else setExpanded(true);
  });
  document.querySelector('#collapse').addEventListener('click', () => setExpanded(false));
  document.querySelector('#show-actions').addEventListener('click', async () => { setView('actions'); await api.setView('actions'); renderStrip(); syncCardKeys(); });
  document.querySelectorAll('.pin-toggle').forEach((pinButton) => pinButton.addEventListener('click', async () => {
    preferences = await api.setPreferences({ pinned: !preferences.pinned });
    document.querySelectorAll('.pin-toggle').forEach((button) => button.setAttribute('aria-pressed', String(preferences.pinned)));
  }));
  // The bar window can never take focus, so the main process never sees a blur to close a click-opened bar.
  // Click mode therefore closes after the pointer has been away for a while; hover mode closes almost at once;
  // the capture card gives two seconds after the pointer leaves.
  // An open menu, the history grid and a drag in progress all keep the bar open a little longer.
  for (const area of document.querySelectorAll('#quickbar, #strip, #history')) {
    area.addEventListener('mouseenter', () => { clearTimeout(collapseTimer); hovering = true; syncCardKeys(); });
    area.addEventListener('mouseleave', () => {
      hovering = false;
      syncCardKeys();
      if (preferences.pinned || dragging) return;
      const view = root.dataset.view;
      scheduleCollapse(view === 'capture' || view === 'history' ? 2000 : document.body.dataset.menuOpen === 'true' ? 900 : preferences.activation === 'hover' ? 260 : 1500);
    });
  }
  // Region captures close the bar first, so it never sits on top of the frozen screen.
  const runBarAction = async (action) => {
    if (action === 'region' || action === 'repeatRegion') await setExpanded(false);
    else closeMenu();
    return api.runAction(action);
  };
  document.querySelectorAll('[data-action], [data-strip-action]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await runBarAction(button.dataset.action || button.dataset.stripAction); } finally { setTimeout(() => { button.disabled = false; }, 350); }
  }));

  // Strip drop-down menus: every capture and recording action, one click away.
  const MENUS = {
    capture: [
      ['region', '▱', 'אזור או חלון', 'גרירה או לחיצה על חלון'],
      ['repeatRegion', '↺', 'האזור הקודם', 'בלי לבחור שוב'],
      ['ocrRegion', 'א', 'העתקת טקסט מאזור', 'גם בעברית'],
      ['scrollCapture', '⇣', 'עמוד גלילה', 'עמוד ארוך בצילום אחד'],
      ['screenshot', '▣', 'מסך מלא', 'המקור שנבחר באולפן'],
      ['screenshotEdit', '✎', 'צילום ופתיחה בעורך', ''],
      ['openOutput', '⌑', 'פתיחת תיקיית השמירה', '']
    ],
    record: [
      ['record', '●', 'התחלה או עצירה של הקלטה', 'המסך שנבחר באולפן'],
      ['recordRegion', '▱', 'הקלטת אזור או חלון', 'בוחרים על המסך'],
      ['pause', 'Ⅱ', 'השהיה או המשך', ''],
      ['microphone', '🎙', 'מיקרופון', 'הפעלה או השתקה'],
      ['camera', '◉', 'מצלמה', 'הצגה או הסתרה'],
      ['openLibrary', '▥', 'הספרייה', '']
    ]
  };
  function closeMenu({ notify = true } = {}) {
    if (document.body.dataset.menuOpen !== 'true') return;
    document.body.dataset.menuOpen = 'false';
    document.querySelectorAll('.strip-more').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    if (notify) api.setMenu(false);
  }
  // Quick toggles for region capture, changed without leaving the menu.
  const DELAYS = [0, 3, 5, 10];
  function captureToggles() {
    const row = document.createElement('div');
    row.className = 'menu-toggles';
    const chip = (key, label, pressed, next) => {
      const button = document.createElement('button');
      button.className = 'menu-toggle';
      button.dataset.toggle = key;
      button.textContent = label;
      button.setAttribute('aria-pressed', String(pressed));
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        applyPreferences(await api.setPreferences(next()));
        row.replaceWith(captureToggles());
      });
      return button;
    };
    const delay = preferences.captureDelay || 0;
    row.append(
      chip('markup', 'סימון לפני שמירה', Boolean(preferences.regionMarkup), () => ({ regionMarkup: !preferences.regionMarkup })),
      chip('delay', delay ? `השהיה ${delay} שנ׳` : 'בלי השהיה', delay > 0, () => ({ captureDelay: DELAYS[(DELAYS.indexOf(delay) + 1) % DELAYS.length] })),
      chip('copy', 'העתקה אוטומטית', Boolean(preferences.autoCopy), () => ({ autoCopy: !preferences.autoCopy }))
    );
    return row;
  }
  async function openMenu(name) {
    const menu = document.querySelector('#strip-menu');
    menu.replaceChildren(...MENUS[name].map(([action, icon, label, note]) => {
      const item = document.createElement('button');
      item.setAttribute('role', 'menuitem');
      item.dataset.menuAction = action;
      item.innerHTML = '<i></i><span></span><small></small>';
      item.querySelector('i').textContent = icon;
      item.querySelector('span').textContent = label;
      item.querySelector('small').textContent = note;
      item.addEventListener('click', () => runBarAction(action));
      return item;
    }));
    if (name === 'capture') menu.append(captureToggles());
    document.querySelectorAll('.strip-more').forEach((button) => button.setAttribute('aria-expanded', String(button.dataset.menu === name)));
    await api.setMenu(true);
    document.body.dataset.menuOpen = 'true';
    document.body.dataset.menuName = name;
  }
  document.querySelectorAll('.strip-more').forEach((button) => button.addEventListener('click', () => (
    document.body.dataset.menuOpen === 'true' && document.body.dataset.menuName === button.dataset.menu ? closeMenu() : openMenu(button.dataset.menu)
  )));
  document.querySelector('#strip-hide').addEventListener('click', () => setExpanded(false));

  // History grid: the newest captures from the library, with the card's actions one click away.
  const formatWhen = (time) => {
    const date = new Date(time);
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  };
  let historyItems = [];
  const historyFilter = { text: '', kind: 'all', time: 'all' };
  const chosen = new Set();
  const emptyNote = (text) => Object.assign(document.createElement('div'), { className: 'history-empty', textContent: text });
  // Search by name, kind (image / video) and time (today / last 7 days), all together.
  const matchesFilter = (item) => {
    if (historyFilter.kind !== 'all' && item.kind !== historyFilter.kind) return false;
    if (historyFilter.time === 'today' && new Date(item.modified).toDateString() !== new Date().toDateString()) return false;
    if (historyFilter.time === 'week' && Date.now() - item.modified > 7 * 24 * 3600 * 1000) return false;
    return !historyFilter.text || item.name.toLowerCase().includes(historyFilter.text.toLowerCase());
  };
  function renderSelection() {
    const bar = document.querySelector('#history-selection');
    bar.hidden = chosen.size === 0;
    document.querySelector('#history-selected-count').textContent = `${chosen.size} נבחרו`;
    document.querySelectorAll('.history-item').forEach((tile) => tile.setAttribute('aria-selected', String(chosen.has(tile.dataset.path))));
  }
  function renderHistory() {
    const grid = document.querySelector('#history-grid');
    const visible = historyItems.filter(matchesFilter);
    document.querySelector('#history-count').textContent = historyItems.length ? `${visible.length} מתוך ${historyItems.length}` : '';
    root.dataset.historyCount = String(visible.length);
    if (!historyItems.length) return grid.replaceChildren(emptyNote('עדיין אין צילומים'));
    if (!visible.length) return grid.replaceChildren(emptyNote('אין צילומים שמתאימים לחיפוש'));
    grid.replaceChildren(...visible.map((item) => {
      const tile = document.createElement('button');
      tile.className = 'history-item';
      tile.setAttribute('role', 'listitem');
      tile.title = item.name;
      tile.dataset.path = item.path;
      if (item.kind === 'video') tile.dataset.kind = 'video';
      const image = document.createElement('img');
      image.src = item.thumbnail || '';
      image.alt = '';
      image.draggable = true;
      const when = document.createElement('time');
      when.textContent = formatWhen(item.modified);
      tile.append(image, when);
      tile.addEventListener('click', (event) => {
        // Ctrl+click builds a selection; a plain click (with nothing selected) opens the card.
        if (event.ctrlKey || chosen.size) {
          if (chosen.has(item.path)) chosen.delete(item.path); else chosen.add(item.path);
          return renderSelection();
        }
        api.openCapture(item.path);
      });
      tile.addEventListener('dblclick', () => { if (!chosen.size) api.captureAction(item.path, 'edit').then(() => setExpanded(false)); });
      image.addEventListener('dragstart', (event) => { event.preventDefault(); api.startDrag(item.path); });
      return tile;
    }));
    renderSelection();
  }
  async function showHistory() {
    // Default: the captures window (large thumbnails, round buttons); the small grid stays as a choice.
    if (preferences.historyStyle !== 'panel' && api.openWorkspace) {
      await setExpanded(false);
      return api.openWorkspace();
    }
    setView('history');
    await api.setView('history');
    chosen.clear();
    document.querySelector('#history-grid').replaceChildren(emptyNote('טוען…'));
    historyItems = await api.history().catch(() => []);
    renderHistory();
  }
  document.querySelector('#history-search').addEventListener('input', (event) => { historyFilter.text = event.target.value.trim(); renderHistory(); });
  document.querySelectorAll('[data-kind-filter], [data-time-filter]').forEach((chip) => chip.addEventListener('click', () => {
    const group = chip.dataset.kindFilter ? 'kind' : 'time';
    historyFilter[group] = chip.dataset.kindFilter || chip.dataset.timeFilter;
    chip.parentElement.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button === chip)));
    renderHistory();
  }));
  document.querySelector('#history-select-clear').addEventListener('click', () => { chosen.clear(); renderSelection(); });
  document.querySelector('#history-trash').addEventListener('click', async () => {
    for (const filePath of [...chosen]) await api.captureAction(filePath, 'trash').catch(() => {});
    chosen.clear();
    historyItems = await api.history().catch(() => []);
    renderHistory();
  });
  document.querySelector('#strip-history').addEventListener('click', showHistory);
  document.querySelector('#show-history').addEventListener('click', showHistory);
  document.querySelector('#history-back').addEventListener('click', async () => { setView('actions'); await api.setView('actions'); });
  document.querySelector('#history-library').addEventListener('click', () => { setExpanded(false); api.runAction('openLibrary'); });

  // Dragging the grip slides the strip along its edge; the main process follows the pointer and saves the spot.
  let dragging = false;
  const grip = document.querySelector('#strip-grip');
  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    grip.setPointerCapture(event.pointerId);
    closeMenu();
    api.drag(true);
  });
  const endDrag = async () => {
    if (!dragging) return;
    dragging = false;
    root.dataset.dragging = 'false';
    applyPreferences(await api.drag(false));
    // Dropped with the pointer already elsewhere: hide like any time the pointer leaves.
    if (!hovering && !preferences.pinned && document.body.dataset.expanded === 'true') scheduleCollapse(700);
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('lostpointercapture', endDrag);

  const runCaptureAction = async (action) => {
    const item = captures[selected];
    if (!item) return;
    const button = document.querySelector(`[data-capture-action="${action}"]`);
    if (button) button.disabled = true;
    try {
      await api.captureAction(item.path, action);
      root.dataset.lastCaptureAction = action;
      if (action === 'copy') document.querySelector('#capture-meta').textContent = 'הועתק ללוח ✓';
      if (action === 'edit') setExpanded(false);
    } catch (error) {
      document.querySelector('#capture-meta').textContent = error.message;
    } finally {
      if (button) setTimeout(() => { button.disabled = action === 'pin' && captures[selected]?.kind !== 'image'; }, 300);
    }
  };
  document.querySelectorAll('[data-capture-action]').forEach((button) => button.addEventListener('click', () => runCaptureAction(button.dataset.captureAction)));
  document.querySelector('#capture-figure').addEventListener('dblclick', () => runCaptureAction('edit'));
  // Dragging the thumbnail hands the real file to the target program (Explorer, chat, mail, documents).
  document.querySelector('#capture-thumb').addEventListener('dragstart', (event) => {
    event.preventDefault();
    const item = captures[selected];
    if (item) api.startDrag(item.path);
  });

  api.onCardKey((action) => (action === 'close' ? setExpanded(false) : runCaptureAction(action)));
  api.onRecordingState(applyRecordingState);
  api.onPreferences(applyPreferences);
})();
