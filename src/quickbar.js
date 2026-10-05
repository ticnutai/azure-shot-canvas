(() => {
  const api = window.quickbarApi;
  let preferences = { activation: 'click', pinned: false };
  let collapseTimer = null;
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
  const setExpanded = async (expanded) => {
    document.body.dataset.expanded = String(expanded);
    const result = await api.setExpanded(expanded);
    document.body.dataset.expanded = String(result.expanded);
  };
  api.getState().then((state) => {
    applyPreferences(state.preferences);
    document.body.dataset.expanded = String(state.expanded);
    applyRecordingState(state.recording);
  });
  document.querySelector('#edge-handle').addEventListener('click', () => setExpanded(true));
  document.querySelector('#edge-handle').addEventListener('mouseenter', () => { if (preferences.activation === 'hover') setExpanded(true); });
  document.querySelector('#collapse').addEventListener('click', () => setExpanded(false));
  document.querySelector('#pin').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    preferences = await api.setPreferences({ pinned: !preferences.pinned });
    button.setAttribute('aria-pressed', String(preferences.pinned));
  });
  document.querySelector('#quickbar').addEventListener('mouseenter', () => clearTimeout(collapseTimer));
  // The bar window can never take focus, so the main process never sees a blur to close a click-opened bar.
  // Click mode therefore closes after the pointer has been away for a while; hover mode closes almost at once.
  document.querySelector('#quickbar').addEventListener('mouseleave', () => {
    if (preferences.pinned) return;
    collapseTimer = setTimeout(() => setExpanded(false), preferences.activation === 'hover' ? 260 : 1500);
  });
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await api.runAction(button.dataset.action); } finally { setTimeout(() => { button.disabled = false; }, 350); }
  }));
  api.onRecordingState(applyRecordingState);
  api.onPreferences(applyPreferences);
})();
