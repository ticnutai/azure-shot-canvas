// Settings → appearance → icons: the program's icon (shape + colour, applied at once to the tray and the windows)
// and the top bar's folded tab (shape + colour). Each choice lives here only.
(() => {
  const icons = window.AurumAppIcons;
  const api = window.screenStudio || {};
  const shapesBox = document.querySelector('#icon-shapes');
  if (!icons || !shapesBox) return;
  const colorsBox = document.querySelector('#icon-colors');
  const tabStylesBox = document.querySelector('#tab-styles');
  const tabColorsBox = document.querySelector('#tab-colors');
  let iconChoice = { ...icons.DEFAULT };
  let tabChoice = { tabStyle: 'tab', tabColor: 'look', barLook: 'office' };

  // An SVG drawing becomes a PNG picture (Windows shows only real pictures in the tray).
  async function toPng(svgText, size) {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').drawImage(image, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  }

  async function applyIcon(choice) {
    iconChoice = icons.normalize(choice);
    render();
    if (!api.setAppIcon) return;
    const images = {};
    for (const size of icons.SIZES) images[size] = await toPng(icons.svg(iconChoice, size), size);
    await api.setAppIcon({ ...iconChoice, images }).catch(() => {});
    document.documentElement.dataset.appIcon = `${iconChoice.shape}:${iconChoice.color}`;
  }

  // A small picture of each tab shape on a strip of screen edge.
  const TAB_STYLES = [['tab', 'לשונית'], ['line', 'קו דק'], ['pill', 'כמוסה'], ['dot', 'נקודה'], ['glass', 'זכוכית']];
  function tabColors() {
    const own = icons.COLORS.find((color) => color.id === tabChoice.tabColor);
    if (own) return [own.light, own.dark];
    return tabChoice.barLook === 'graphite' ? ['#f5bd46', '#bd7f17'] : ['#1f6fe5', '#1f6fe5'];
  }
  function tabPreview(style) {
    const [light, dark] = tabColors();
    const fill = 'url(#tp)';
    const shapes = {
      tab: `<path d="M8 0H92V5H64V12L58 18H42L36 12V5H8Z" fill="${fill}"/><circle cx="50" cy="11" r="4" fill="none" stroke="#fff" stroke-width="1.6"/>`,
      line: `<rect x="8" y="0" width="84" height="4" fill="${fill}"/>`,
      pill: `<rect x="20" y="3" width="60" height="12" rx="6" fill="${fill}"/><circle cx="50" cy="9" r="3" fill="#fff"/>`,
      dot: `<circle cx="50" cy="8" r="8" fill="${fill}"/><circle cx="50" cy="8" r="3.6" fill="none" stroke="#fff" stroke-width="1.4"/>`,
      glass: `<rect x="24" y="2" width="52" height="12" rx="6" fill="#fff" stroke="#0003"/><circle cx="50" cy="8" r="3.4" fill="${dark}"/>`
    };
    return `<svg viewBox="0 0 100 22" width="100" height="22" aria-hidden="true"><defs><linearGradient id="tp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect width="100" height="22" fill="#eef1f5"/>${shapes[style]}</svg>`;
  }

  const option = (box, { value, label, art, pressed, onPick, swatch }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(pressed));
    button.dataset.value = value;
    button.title = label;
    if (swatch) { button.className = 'icon-swatch'; button.style.background = swatch; button.setAttribute('aria-label', label); }
    else { button.className = 'icon-choice'; button.innerHTML = `${art}<span></span>`; button.querySelector('span').textContent = label; }
    button.addEventListener('click', onPick);
    box.append(button);
  };

  function render() {
    shapesBox.replaceChildren();
    icons.SHAPES.forEach((shape) => option(shapesBox, { value: shape.id, label: shape.name, art: icons.svg({ shape: shape.id, color: iconChoice.color }, 40), pressed: shape.id === iconChoice.shape, onPick: () => applyIcon({ ...iconChoice, shape: shape.id }) }));
    colorsBox.replaceChildren();
    icons.COLORS.forEach((color) => option(colorsBox, { value: color.id, label: color.name, swatch: `linear-gradient(135deg, ${color.light}, ${color.dark})`, pressed: color.id === iconChoice.color, onPick: () => applyIcon({ ...iconChoice, color: color.id }) }));
    tabStylesBox.replaceChildren();
    TAB_STYLES.forEach(([style, label]) => option(tabStylesBox, { value: style, label, art: tabPreview(style), pressed: style === tabChoice.tabStyle, onPick: () => applyTab({ tabStyle: style }) }));
    tabColorsBox.replaceChildren();
    option(tabColorsBox, { value: 'look', label: 'לפי מראה הסרגל', swatch: tabChoice.barLook === 'graphite' ? 'linear-gradient(135deg,#f5bd46,#bd7f17)' : '#1f6fe5', pressed: tabChoice.tabColor === 'look', onPick: () => applyTab({ tabColor: 'look' }) });
    icons.COLORS.forEach((color) => option(tabColorsBox, { value: color.id, label: color.name, swatch: `linear-gradient(135deg, ${color.light}, ${color.dark})`, pressed: color.id === tabChoice.tabColor, onPick: () => applyTab({ tabColor: color.id }) }));
  }

  async function applyTab(patch) {
    tabChoice = { ...tabChoice, ...patch };
    render();
    const saved = await api.setQuickbarPreferences?.(patch).catch(() => null);
    if (saved) tabChoice = { tabStyle: saved.tabStyle, tabColor: saved.tabColor, barLook: saved.barLook };
    document.documentElement.dataset.tabStyle = tabChoice.tabStyle;
  }

  (async () => {
    const savedIcon = await api.getAppIcon?.().catch(() => null);
    if (savedIcon?.shape) iconChoice = icons.normalize(savedIcon);
    const bar = await api.getQuickbarPreferences?.().catch(() => null);
    if (bar) tabChoice = { tabStyle: bar.tabStyle || 'tab', tabColor: bar.tabColor || 'look', barLook: bar.barLook || 'office' };
    render();
  })();
  // The bar look can change elsewhere in settings: the "by the bar look" swatch follows it.
  document.querySelector('#bar-look')?.addEventListener('change', (event) => { tabChoice.barLook = event.target.value; render(); });
  window.aurumIconPicker = { applyIcon, applyTab, choice: () => ({ ...iconChoice, ...tabChoice }) };
})();
