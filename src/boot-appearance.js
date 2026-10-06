// Runs before any stylesheet paints (CSP forbids inline scripts, so it lives in its own file).
// Applies the saved layout, design kit and colour theme so the first frame already has the right look.
(() => {
  const root = document.documentElement;
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const layouts = ['lemaan', 'acrobat', 'finereader', 'classic', 'apple', 'office', 'modern', 'ribbon', 'fluent', 'studio'];
  const kits = ['auto', 'compact', 'tiles', 'list', 'icons', 'minimal', 'sharp', 'glass', 'contrast'];
  const layout = read('aurum-layout');
  const kit = read('aurum-kit');
  root.dataset.layout = layouts.includes(layout) ? layout : 'lemaan';
  root.dataset.kit = kits.includes(kit) ? kit : 'auto';
  const theme = read('aurum-theme');
  if (theme && /^[a-z-]+$/.test(theme)) root.dataset.theme = theme;
})();
