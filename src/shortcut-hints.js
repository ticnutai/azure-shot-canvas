// Every button that runs an action shows its keys in its hint ("צילום אזור · קיצור: PrtSc"), and a right-click on it
// opens the menu to change them. One script for every window (the studio, the bar, the captures window and its tools
// window); a button is known by the action it runs: data-hint-action, data-strip-action, data-menu-action,
// data-menu-item or data-action — only names of real shortcut actions count, anything else is left alone.
(() => {
  const api = window.shortcutHintsApi;
  if (!api) return;
  const SELECTOR = '[data-hint-action], [data-strip-action], [data-menu-action], [data-menu-item], [data-action]';
  const SUFFIX = ' · ';
  const OURS = / · (?:קיצור: |אין קיצור \()/;
  let labels = {};
  const actionOf = (element) => element.dataset.hintAction || element.dataset.stripAction || element.dataset.menuAction || element.dataset.menuItem || element.dataset.action;
  const known = (action) => Object.hasOwn(labels, action);

  function decorate() {
    for (const element of document.querySelectorAll(SELECTOR)) {
      const action = actionOf(element);
      if (!known(action)) continue;
      // The page may change a button's hint itself (start / stop recording): the keys part is taken off and put back.
      const base = (element.title || element.getAttribute('aria-label') || element.textContent.trim()).split(OURS)[0];
      const next = labels[action] ? `${base}${SUFFIX}קיצור: ${labels[action]} (לחיצה ימנית לשינוי)` : `${base}${SUFFIX}אין קיצור (לחיצה ימנית לקביעה)`;
      if (element.title !== next) element.title = next;
      element.dataset.shortcut = labels[action];
    }
  }
  // Menus are built again and again (the bar's drop-downs, the captures window's menus): their buttons get the hint too.
  let pending = 0;
  new MutationObserver(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(decorate); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });

  document.addEventListener('contextmenu', (event) => {
    const element = event.target.closest?.(SELECTOR);
    if (!element) return;
    const action = actionOf(element);
    if (!known(action)) return;
    event.preventDefault();
    event.stopPropagation();
    api.menu(action);
  }, true);

  const take = (next) => { labels = next || {}; decorate(); };
  api.labels().then(take).catch(() => {});
  api.onLabels(take);
})();
