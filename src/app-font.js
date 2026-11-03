// The font and bold of the program itself, chosen in the settings and followed at once by every open window. With nothing
// chosen the design's own fonts stay. Text typed on captures keeps its own font (see text-fonts.js).
(() => {
  const KEY = 'aurum-ui-font';
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; }
  };
  const style = document.createElement('style');
  document.documentElement.append(style);
  const ALL = 'body, body *:not(#text-input):not([data-font])';
  function apply() {
    const { font = '', bold = false } = read();
    const family = /^[\w ]+$/.test(font) ? `font-family: "${font}", "Segoe UI", Arial, sans-serif !important;` : '';
    style.textContent = family || bold ? `${ALL} { ${family} ${bold ? 'font-weight: 600 !important;' : ''} }` : '';
  }
  apply();
  window.addEventListener('storage', (event) => { if (event.key === KEY) apply(); });

  // The settings page, where the two controls live.
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.querySelector('#ui-font');
    const bold = document.querySelector('#ui-bold');
    if (!select || !bold) return;
    for (const { name, label } of window.AurumTextFonts.available()) select.append(new Option(label, name));
    const saved = read();
    select.value = saved.font || '';
    bold.checked = Boolean(saved.bold);
    const save = () => {
      try { localStorage.setItem(KEY, JSON.stringify({ font: select.value, bold: bold.checked })); } catch {}
      apply();
    };
    select.addEventListener('change', save);
    bold.addEventListener('change', save);
  });
})();
