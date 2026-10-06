// Appearance controller: window layout, layout colours (light/dark pair), design kit and UI zoom.
// Loaded before renderer.js so applyThemeChoice() can accept the layout colour themes at startup.
(() => {
  const root = document.documentElement;
  const store = {
    get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch {} }
  };

  // mini: proportions of the preview thumbnail (side bar width, top bar height, card radius)
  const LAYOUTS = [
    { id: 'lemaan', name: 'למען', description: 'נייבי וזהב, סרגל צד מעוגל — המראה המקורי', light: 'porcelain', dark: 'midnight', mini: [16, 14, 6] },
    { id: 'acrobat', name: 'מקצועי', description: 'אפורים ניטרליים, כחול אחד, סרגל צר עם אייקונים', light: 'pro-light', dark: 'pro-dark', mini: [12, 11, 3] },
    { id: 'finereader', name: 'סריקה ומסמכים', description: 'צפוף, סרגל עליון כחול ופינות ישרות', light: 'scan-light', dark: 'scan-dark', mini: [14, 10, 1] },
    { id: 'classic', name: 'קלאסי', description: 'סרגל צד כהה וכרטיסים לבנים', light: 'classic-light', dark: 'classic-dark', mini: [18, 12, 4] },
    { id: 'apple', name: 'אלגנטי', description: 'סרגל צד שקוף־למחצה, מרווח ושקט', light: 'elegant-light', dark: 'elegant-dark', mini: [18, 12, 5] },
    { id: 'office', name: 'משרדי', description: 'סרגל עליון צף ומעוגל, דף במרכז', light: 'office-light', dark: 'office-dark', mini: [15, 12, 4] },
    { id: 'modern', name: 'מודרני', description: 'קווים דקים, צפוף וחד, בלי תוויות בסרגל', light: 'modern-light', dark: 'modern-dark', mini: [11, 10, 3] },
    { id: 'ribbon', name: 'רצועת כלים', description: 'כמו מעבד התמלילים: לשוניות למעלה ושורת כותרת כחולה', light: 'ribbon-light', dark: 'ribbon-dark', mini: [0, 10, 2] },
    { id: 'fluent', name: 'חלונות 11', description: 'סרגל ניווט רחב עם שמות, כמו מסך ההגדרות של חלונות', light: 'fluent-light', dark: 'fluent-dark', mini: [28, 10, 4] },
    { id: 'studio', name: 'אולפן עריכה', description: 'אפור פחם וצפוף, כמו תוכנות עריכת וידאו', light: 'studio-light', dark: 'studio-dark', mini: [9, 8, 1] }
  ];
  const MODES = [
    { id: 'match', name: 'לפי המצב הנוכחי' },
    { id: 'light', name: 'בהיר' },
    { id: 'dark', name: 'כהה' },
    { id: 'keep', name: 'להשאיר את הערכה שלי' }
  ];
  const KITS = [
    { id: 'auto', name: 'לפי הפריסה', hint: 'הצורה המקורית' },
    { id: 'compact', name: 'קומפקטי', hint: 'רגוע ומאוזן' },
    { id: 'tiles', name: 'אריחים', hint: 'מרווח ומרומם' },
    { id: 'list', name: 'רשימה', hint: 'שטוח ומסודר' },
    { id: 'icons', name: 'אייקונים', hint: 'צבעוני לפי מסך' },
    { id: 'minimal', name: 'מינימלי', hint: 'טקסט ורווח לבן' },
    { id: 'sharp', name: 'חד ומדויק', hint: 'פינות ישרות וקווים דקים' },
    { id: 'glass', name: 'זכוכית', hint: 'שקוף ורך עם הילה' },
    { id: 'contrast', name: 'ניגודיות גבוהה', hint: 'קווים וטקסט ברורים' }
  ];
  const layoutThemes = new Set(LAYOUTS.flatMap((layout) => [layout.light, layout.dark]));
  const findLayout = (id) => LAYOUTS.find((layout) => layout.id === id) || LAYOUTS[0];
  const currentMode = () => (MODES.some((mode) => mode.id === store.get('aurum-layout-mode')) ? store.get('aurum-layout-mode') : 'match');
  const isDark = () => getComputedStyle(root).colorScheme.includes('dark');

  function themeFor(layout, mode, wasDark) {
    if (mode === 'keep') return null;
    if (mode === 'light') return layout.light;
    if (mode === 'dark') return layout.dark;
    return wasDark ? layout.dark : layout.light;
  }

  function applyLayout(id, { persist = true, recolor = true } = {}) {
    const layout = findLayout(id);
    const wasDark = isDark();
    root.dataset.layout = layout.id;
    const theme = recolor ? themeFor(layout, currentMode(), wasDark) : null;
    if (theme && typeof applyThemeChoice === 'function') applyThemeChoice(theme, true);
    if (persist) store.set('aurum-layout', layout.id);
    render();
  }

  function applyMode(id) {
    store.set('aurum-layout-mode', id);
    applyLayout(root.dataset.layout);
  }

  function applyKit(id) {
    const kit = KITS.find((item) => item.id === id) || KITS[0];
    root.dataset.kit = kit.id;
    store.set('aurum-kit', kit.id);
    render();
  }

  function applyZoom(percent, persist = true) {
    const value = Math.max(75, Math.min(150, Math.round(Number(percent) || 100)));
    // Setting the zoom factor while the page loads froze frame production in hidden windows; only touch it when it differs.
    if (value !== 100 || root.dataset.uiZoom) window.screenStudio?.setUiZoom?.(value / 100);
    const input = document.querySelector('#ui-zoom');
    if (input) input.value = String(value);
    const output = document.querySelector('#ui-zoom-output');
    if (output) output.textContent = `${value}%`;
    root.dataset.uiZoom = String(value);
    if (persist) store.set('aurum-ui-zoom', String(value));
  }

  function radio(button, checked) {
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(checked));
    button.tabIndex = checked ? 0 : -1;
    return button;
  }

  function render() {
    const gallery = document.querySelector('#layout-gallery');
    if (!gallery) return;
    const mode = currentMode();
    const previewDark = mode === 'dark' || ((mode === 'match' || mode === 'keep') && isDark());
    gallery.replaceChildren(...LAYOUTS.map((layout) => {
      const button = radio(document.createElement('button'), root.dataset.layout === layout.id);
      button.type = 'button';
      button.className = 'layout-card';
      button.dataset.layoutChoice = layout.id;
      const mini = document.createElement('span');
      mini.className = 'layout-mini';
      mini.dataset.theme = previewDark ? layout.dark : layout.light;
      mini.dataset.layoutPreview = layout.id;
      mini.style.cssText = `--m-side-w:${layout.mini[0]}%;--m-top-h:${layout.mini[1]}px;--m-r:${layout.mini[2]}px`;
      mini.append(document.createElement('i'), document.createElement('em'), document.createElement('u'));
      const name = document.createElement('b');
      name.textContent = layout.name;
      const description = document.createElement('small');
      description.textContent = layout.description;
      button.append(mini, name, description);
      button.addEventListener('click', () => applyLayout(layout.id));
      return button;
    }));
    const modes = document.querySelector('#layout-mode-switch');
    modes?.replaceChildren(...MODES.map((item) => {
      const button = radio(document.createElement('button'), item.id === mode);
      button.type = 'button';
      button.dataset.layoutMode = item.id;
      button.textContent = item.name;
      button.addEventListener('click', () => applyMode(item.id));
      return button;
    }));
    const kits = document.querySelector('#kit-switch');
    kits?.replaceChildren(...KITS.map((kit) => {
      const button = radio(document.createElement('button'), root.dataset.kit === kit.id);
      button.type = 'button';
      button.dataset.kitChoice = kit.id;
      button.append(kit.name);
      const hint = document.createElement('small');
      hint.textContent = kit.hint;
      button.append(hint);
      button.addEventListener('click', () => applyKit(kit.id));
      return button;
    }));
  }

  // Arrow keys move between options inside each radio group, like native Windows radio buttons.
  document.addEventListener('keydown', (event) => {
    const group = event.target.closest?.('#layout-gallery, #layout-mode-switch, #kit-switch');
    if (!group || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const buttons = [...group.querySelectorAll('[role="radio"]')];
    const index = buttons.indexOf(event.target);
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? 1 : -1;
    const next = buttons[(index + step + buttons.length) % buttons.length];
    event.preventDefault();
    next.click();
    group.querySelector(`[aria-checked="true"]`)?.focus();
  });

  function initializeAppearance() {
    root.dataset.layout = findLayout(root.dataset.layout).id;
    if (!KITS.some((kit) => kit.id === root.dataset.kit)) root.dataset.kit = 'auto';
    const zoomSection = document.querySelector('#ui-zoom-section');
    if (!window.screenStudio?.setUiZoom) zoomSection?.classList.add('hidden');
    else {
      applyZoom(store.get('aurum-ui-zoom') || 100, false);
      document.querySelector('#ui-zoom')?.addEventListener('input', (event) => applyZoom(event.target.value));
      document.querySelector('#ui-zoom-reset')?.addEventListener('click', () => applyZoom(100));
    }
    render();
  }

  window.aurumAppearance = {
    layouts: LAYOUTS, kits: KITS, modes: MODES,
    isLayoutTheme: (theme) => layoutThemes.has(theme),
    applyLayout, applyKit, applyMode, applyZoom, render
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeAppearance, { once: true });
  else initializeAppearance();
})();
