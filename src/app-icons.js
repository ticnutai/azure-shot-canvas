// The program's icon, to choose: a shape and a colour. Drawn as SVG and turned into pictures by the settings page
// (Windows cannot show SVG in the tray), then handed to the main process for the tray and the windows.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AurumAppIcons = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const COLORS = [
    { id: 'gold', name: 'זהב', light: '#f7c95a', dark: '#c7860f' },
    { id: 'blue', name: 'כחול', light: '#64b0ff', dark: '#1f5fd6' },
    { id: 'violet', name: 'סגול', light: '#bba2ff', dark: '#6a3fd8' },
    { id: 'green', name: 'ירוק', light: '#62d6a0', dark: '#138c57' },
    { id: 'red', name: 'אדום', light: '#ff8f7f', dark: '#d1332f' },
    { id: 'teal', name: 'טורקיז', light: '#5fe0d6', dark: '#0e8a96' },
    { id: 'pink', name: 'ורוד', light: '#ff9fcb', dark: '#cf3f80' },
    { id: 'graphite', name: 'גרפיט', light: '#6f7784', dark: '#20242b' }
  ];

  // Lines stay at least ~1.3 screen pixels wide, so the thin designs remain sharp in the 16-pixel tray picture.
  const stroke = (base, size) => Math.max(base, (256 / size) * 1.3).toFixed(1);
  const plate = (color, id) => `<defs><linearGradient id="p${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color.light}"/><stop offset="1" stop-color="${color.dark}"/></linearGradient><linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect x="8" y="8" width="240" height="240" rx="58" fill="url(#p${id})"/><rect x="8" y="8" width="240" height="240" rx="58" fill="url(#s${id})"/><rect x="9.5" y="9.5" width="237" height="237" rx="56.5" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="3"/>`;

  const SHAPES = [
    { id: 'lens', name: 'עדשה', draw: (c, s) => `${plate(c, 'l' + c.id + s)}<circle cx="128" cy="128" r="64" fill="none" stroke="#fff" stroke-width="${stroke(24, s)}"/><circle cx="128" cy="128" r="25" fill="#fff"/><circle cx="186" cy="70" r="15" fill="#e8403a" stroke="#fff" stroke-width="6"/>` },
    { id: 'ring', name: 'טבעת דקה', draw: (c, s) => `${plate(c, 'r' + c.id + s)}<circle cx="128" cy="128" r="72" fill="none" stroke="#fff" stroke-width="${stroke(11, s)}"/><circle cx="128" cy="128" r="14" fill="#fff"/>` },
    { id: 'frame', name: 'מסגרת צילום', draw: (c, s) => `${plate(c, 'f' + c.id + s)}<path d="M64 100V72a8 8 0 0 1 8-8h28M156 64h28a8 8 0 0 1 8 8v28M192 156v28a8 8 0 0 1-8 8h-28M100 192H72a8 8 0 0 1-8-8v-28" fill="none" stroke="#fff" stroke-width="${stroke(12, s)}" stroke-linecap="round"/><circle cx="128" cy="128" r="16" fill="#fff"/>` },
    { id: 'camera', name: 'מצלמה בקו', draw: (c, s) => `${plate(c, 'c' + c.id + s)}<path d="M58 98a14 14 0 0 1 14-14h26l12-18h36l12 18h26a14 14 0 0 1 14 14v76a14 14 0 0 1-14 14H72a14 14 0 0 1-14-14z" fill="none" stroke="#fff" stroke-width="${stroke(11, s)}" stroke-linejoin="round"/><circle cx="128" cy="134" r="30" fill="none" stroke="#fff" stroke-width="${stroke(11, s)}"/>` },
    { id: 'aperture', name: 'צמצם', draw: (c, s) => `${plate(c, 'a' + c.id + s)}<circle cx="128" cy="128" r="70" fill="none" stroke="#fff" stroke-width="${stroke(10, s)}"/><g stroke="#fff" stroke-width="${stroke(9, s)}" stroke-linecap="round">${[0, 60, 120, 180, 240, 300].map((angle) => `<path d="M128 58 L164 120" transform="rotate(${angle} 128 128)"/>`).join('')}</g>` },
    { id: 'outline', name: 'קו בלבד', draw: (c, s) => `<rect x="18" y="18" width="220" height="220" rx="56" fill="#fff" fill-opacity=".92" stroke="${c.dark}" stroke-width="${stroke(12, s)}"/><circle cx="128" cy="128" r="62" fill="none" stroke="${c.dark}" stroke-width="${stroke(12, s)}"/><circle cx="128" cy="128" r="18" fill="${c.dark}"/>` },
    { id: 'record', name: 'נקודת הקלטה', draw: (c, s) => `${plate(c, 'd' + c.id + s)}<circle cx="128" cy="128" r="70" fill="#fff" fill-opacity=".95"/><circle cx="128" cy="128" r="34" fill="${c.dark}"/><circle cx="128" cy="128" r="70" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="${stroke(4, s)}"/>` }
  ];

  const DEFAULT = Object.freeze({ shape: 'lens', color: 'gold' });
  const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

  function normalize(choice) {
    const shape = SHAPES.some((item) => item.id === choice?.shape) ? choice.shape : DEFAULT.shape;
    const color = COLORS.some((item) => item.id === choice?.color) ? choice.color : DEFAULT.color;
    return { shape, color };
  }

  function svg(choice, size = 256) {
    const { shape, color } = normalize(choice);
    const drawing = SHAPES.find((item) => item.id === shape).draw(COLORS.find((item) => item.id === color), size);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}">${drawing}</svg>`;
  }

  return { COLORS, SHAPES, DEFAULT, SIZES, normalize, svg };
});
