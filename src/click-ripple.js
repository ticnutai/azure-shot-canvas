// A ring that widens around every mouse click in a recording (an extra). The helper reports a click as the line
// "click <x> <y> <l|r>" (physical pixels); the shape of the ring over its short life is worked out here, so both the
// reading of the line and the drawing can be checked without a screen. Used by the main process (CommonJS) and by the
// recording page (a plain script).
(() => {
  const LIFE_MS = 650;
  const COLORS = { gold: '244,188,63', red: '239,91,104', blue: '66,133,244', white: '255,255,255' };

  // "click 120 340 l" -> { x: 120, y: 340, button: 'left' }; anything else -> null.
  function parseClickEvent(line) {
    const match = /^click (-?\d{1,6}) (-?\d{1,6}) ([lr])$/.exec(String(line || '').trim());
    return match ? { x: Number(match[1]), y: Number(match[2]), button: match[3] === 'l' ? 'left' : 'right' } : null;
  }

  // The ring `age` milliseconds after the click, on a picture `canvasWidth` wide; null once it is gone.
  function rippleFrame(age, canvasWidth, color = 'gold') {
    if (!(age >= 0) || age >= LIFE_MS) return null;
    const t = age / LIFE_MS;
    const start = Math.max(10, canvasWidth * 0.008);
    const reach = Math.max(30, canvasWidth * 0.03);
    const rgb = COLORS[color] || COLORS.gold;
    return {
      radius: start + t * reach,
      lineWidth: Math.max(3, canvasWidth * 0.003) * (1 - t * 0.5),
      stroke: `rgba(${rgb},${((1 - t) * 0.9).toFixed(3)})`,
      fill: `rgba(${rgb},${((1 - t) * 0.22).toFixed(3)})`
    };
  }

  const api = { LIFE_MS, COLORS, parseClickEvent, rippleFrame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.aurumClickRipple = api;
})();
