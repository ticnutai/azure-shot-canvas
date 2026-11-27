// How the pointer looks on the frozen screen: the usual cross or arrow, or a glowing one in a chosen colour (easier to
// see on a busy picture, and on recordings of the screen). Drawn as small pictures for the cursor; nothing else changes.
(function (root) {
  const COLORS = ['#F5BD46', '#F13C50', '#22C7D6', '#27AE60', '#FF5FA2'];
  const STYLES = [
    { id: 'cross', label: 'צלב' },
    { id: 'arrow', label: 'חץ רגיל' },
    { id: 'glow-arrow', label: 'חץ זוהר' },
    { id: 'glow-cross', label: 'צלב זוהר' },
    { id: 'glow-ring', label: 'טבעת זוהרת' },
    { id: 'big-arrow', label: 'חץ גדול' }
  ];
  const ARROW = 'M4 2 L4 25 L10 19.5 L14 29 L18.5 27 L14.6 17.6 L22 17.6 Z';

  function svg(size, body) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
  }

  // The glow: the same shape drawn wide and faint under itself, twice.
  function glowStroke(d, color) {
    return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity=".28" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>`
      + `<path d="${d}" fill="none" stroke="${color}" stroke-opacity=".55" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  /** The picture of a cursor: { svg, x, y } (the hot spot), or null for the system's own cursor. */
  function picture(style, color) {
    const c = COLORS.includes(color) ? color : COLORS[0];
    switch (style) {
      case 'glow-arrow':
        return { svg: svg(36, `${glowStroke(ARROW, c)}<path d="${ARROW}" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>`), x: 4, y: 2 };
      case 'big-arrow':
        return { svg: svg(48, `<g transform="scale(1.55)"><path d="${ARROW}" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></g>`), x: 6, y: 3 };
      case 'glow-cross': {
        const d = 'M18 3 V14 M18 22 V33 M3 18 H14 M22 18 H33';
        return { svg: svg(36, `${glowStroke(d, c)}<path d="${d}" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="18" cy="18" r="1.6" fill="${c}"/>`), x: 18, y: 18 };
      }
      case 'glow-ring':
        return { svg: svg(36, `<circle cx="18" cy="18" r="11" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-opacity=".55" stroke-width="5"/><circle cx="18" cy="18" r="11" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="18" cy="18" r="2.4" fill="${c}" stroke="#111" stroke-width=".8"/>`), x: 18, y: 18 };
      default:
        return null;
    }
  }

  /** The value for the CSS cursor property. */
  function css(style, color) {
    if (style === 'arrow') return 'default';
    const p = picture(style, color);
    if (!p) return 'crosshair';
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(p.svg)}") ${p.x} ${p.y}, crosshair`;
  }

  /** A small preview for the choice buttons (a data address of the picture), or null for the system's own cursors. */
  function preview(style, color) {
    if (style === 'cross') return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg(36, '<path d="M18 6 V30 M6 18 H30" stroke="#dce8f5" stroke-width="1.6"/>'));
    if (style === 'arrow') return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg(36, `<path d="${ARROW}" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>`));
    const p = picture(style, color);
    return p ? 'data:image/svg+xml;utf8,' + encodeURIComponent(p.svg) : null;
  }

  // The cursor for the end of a line, along the line: it shows the line can be pulled longer or shorter there.
  function lineEnd(from, to) {
    const angle = ((Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI) + 180) % 180;
    if (angle < 22.5 || angle >= 157.5) return 'ew-resize';
    if (angle < 67.5) return 'nwse-resize';
    if (angle < 112.5) return 'ns-resize';
    return 'nesw-resize';
  }

  const api = { COLORS, STYLES, css, preview, picture, lineEnd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AurumRegionCursor = api;
})(typeof window !== 'undefined' ? window : globalThis);
