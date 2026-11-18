// The folded captures window's tab: pointing opens the window (after a breath, so a drag can start), a click opens
// it, pressing and moving drags the tab to any place on any of the four screen edges.
(() => {
  const api = window.dockTabApi;
  const tab = document.getElementById('tab');
  const body = document.body;
  api.onState((state) => {
    body.dataset.edge = state.edge || 'right';
    body.dataset.tabStyle = state.tabStyle || 'tab';
    body.style.setProperty('--light', state.light || '#64b0ff');
    body.style.setProperty('--dark', state.dark || '#1f6fe5');
    tab.setAttribute('aria-label', state.label || 'פתיחת לוח הצילומים');
  });
  // Where in the window the tab is drawn (its exact size; the window may be a little bigger).
  api.onBox?.((box) => {
    if (!box) return;
    Object.assign(tab.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, right: 'auto', bottom: 'auto' });
  });
  let timer = 0;
  let pressedAt = null;
  let dragging = false;
  tab.addEventListener('mouseenter', () => { clearTimeout(timer); timer = setTimeout(() => { if (!pressedAt) api.setDock({ expanded: true }); }, 140); });
  tab.addEventListener('mouseleave', () => clearTimeout(timer));
  tab.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    clearTimeout(timer);
    pressedAt = { x: event.screenX, y: event.screenY };
    tab.setPointerCapture(event.pointerId);
  });
  tab.addEventListener('pointermove', (event) => {
    if (!pressedAt || dragging) return;
    if (Math.hypot(event.screenX - pressedAt.x, event.screenY - pressedAt.y) < 5) return;
    dragging = true;
    body.dataset.dragging = 'true';
    api.dragDock(true);
  });
  const release = () => {
    if (!pressedAt) return;
    const wasDragging = dragging;
    pressedAt = null;
    dragging = false;
    delete body.dataset.dragging;
    if (wasDragging) api.dragDock(false);
    else api.setDock({ expanded: true });
  };
  tab.addEventListener('pointerup', release);
  tab.addEventListener('pointercancel', release);
  tab.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') api.setDock({ expanded: true }); });
})();
