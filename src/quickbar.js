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
    document.querySelector('#pin')?.setAttribute('aria-pressed', String(preferences.pinned));
  };
  const applyRecordingState = (active) => {
    const button = document.querySelector('[data-action="record"]');
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.querySelector('span').textContent = active ? 'עצור הקלטה' : 'התחל הקלטה';
    const stateLabel = document.querySelector('#recording-state');
    if (stateLabel) stateLabel.textContent = active ? 'מקליט כעת' : 'מוכן';
  };
  const setView = (view) => {
    root.dataset.view = view;
    document.querySelector('#quickbar-title').textContent = view === 'capture' ? 'נשמר' : 'אורום מהיר';
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
  api.onCaptures(({ captures: list, fresh, timeout }) => {
    captures = list;
    if (fresh) {
      root.dataset.cardShownAt = String(Date.now());
      selected = 0;
      setView('capture');
      document.body.dataset.expanded = 'true';
      scheduleCollapse(timeout * 1000);
    } else if (!captures.length) {
      setView('actions');
    }
    selected = Math.min(selected, Math.max(0, captures.length - 1));
    renderCard();
    renderStrip();
    syncCardKeys();
  });

  document.querySelector('#edge-handle').addEventListener('click', () => setExpanded(true));
  document.querySelector('#edge-handle').addEventListener('mouseenter', () => { if (preferences.activation === 'hover') setExpanded(true); });
  document.querySelector('#collapse').addEventListener('click', () => setExpanded(false));
  document.querySelector('#show-actions').addEventListener('click', async () => { setView('actions'); await api.setView('actions'); renderStrip(); syncCardKeys(); });
  document.querySelector('#pin').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    preferences = await api.setPreferences({ pinned: !preferences.pinned });
    button.setAttribute('aria-pressed', String(preferences.pinned));
  });
  // The bar window can never take focus, so the main process never sees a blur to close a click-opened bar.
  // Click mode therefore closes after the pointer has been away for a while; hover mode closes almost at once;
  // the capture card gives two seconds after the pointer leaves.
  document.querySelector('#quickbar').addEventListener('mouseenter', () => { clearTimeout(collapseTimer); hovering = true; syncCardKeys(); });
  document.querySelector('#quickbar').addEventListener('mouseleave', () => {
    hovering = false;
    syncCardKeys();
    if (preferences.pinned) return;
    scheduleCollapse(root.dataset.view === 'capture' ? 2000 : preferences.activation === 'hover' ? 260 : 1500);
  });
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await api.runAction(button.dataset.action); } finally { setTimeout(() => { button.disabled = false; }, 350); }
  }));

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
