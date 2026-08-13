(() => {
  if (!/^https?:$/.test(location.protocol) || typeof EventSource === 'undefined') return;
  const events = new EventSource('/__events');
  events.addEventListener('reload', () => location.reload());
  events.addEventListener('open', () => { document.documentElement.dataset.liveReload = 'connected'; });
  events.onerror = () => { document.documentElement.dataset.liveReload = 'reconnecting'; };
})();
