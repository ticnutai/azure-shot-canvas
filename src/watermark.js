// A watermark (an extra): a text or a logo in a corner of saved pictures and of recordings. The same drawing serves both.
// Used by the studio page (a plain script) and by the checks (CommonJS).
(() => {
  const SIZES = Object.freeze({ small: 0.025, medium: 0.04, large: 0.06 });
  const MIN_WIDTH = 160;
  const MIN_HEIGHT = 80;

  // Where a box goes on a picture.
  function placement(position, width, height, boxWidth, boxHeight) {
    const margin = Math.max(8, Math.round(Math.min(width, height) * 0.02));
    const left = margin;
    const right = width - boxWidth - margin;
    const top = margin;
    const bottom = height - boxHeight - margin;
    if (position === 'center') return { x: (width - boxWidth) / 2, y: (height - boxHeight) / 2 };
    return {
      x: position.endsWith('left') ? left : right,
      y: position.startsWith('top') ? top : bottom
    };
  }

  const fontSizeFor = (width, height, size) => Math.max(12, Math.round(Math.min(width, height) * (SIZES[size] || SIZES.medium)));

  // settings: { source: 'text' | 'logo', text, position, opacity (percent), size }. logo: a loaded picture, or null.
  // A very small picture gets none: the mark would cover what it shows. Returns whether something was drawn.
  function drawWatermark(context, width, height, settings, logo = null) {
    if (!settings || width < MIN_WIDTH || height < MIN_HEIGHT) return false;
    const position = settings.position || 'bottom-right';
    const fontSize = fontSizeFor(width, height, settings.size);
    const opacity = Math.min(1, Math.max(0.05, Number(settings.opacity ?? 60) / 100));
    if (settings.source === 'logo') {
      const naturalWidth = logo?.naturalWidth || logo?.width;
      const naturalHeight = logo?.naturalHeight || logo?.height;
      if (!naturalWidth || !naturalHeight) return false;
      const boxHeight = Math.min(fontSize * 2.5, height * 0.4);
      const boxWidth = Math.min(boxHeight * (naturalWidth / naturalHeight), width * 0.5);
      const fitted = Math.min(boxHeight, boxWidth * (naturalHeight / naturalWidth));
      const { x, y } = placement(position, width, height, boxWidth, fitted);
      context.save();
      context.globalAlpha = opacity;
      context.drawImage(logo, x, y, boxWidth, fitted);
      context.restore();
      return true;
    }
    const text = String(settings.text || '').trim();
    if (!text) return false;
    context.save();
    context.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
    context.direction = 'rtl';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    const boxWidth = Math.min(context.measureText(text).width, width - 16);
    const { x, y } = placement(position, width, height, boxWidth, fontSize * 1.25);
    context.globalAlpha = opacity;
    // Readable on a light and on a dark picture alike.
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2, fontSize * 0.14);
    context.strokeStyle = '#000000b0';
    context.strokeText(text, x, y, boxWidth);
    context.fillStyle = '#ffffff';
    context.fillText(text, x, y, boxWidth);
    context.restore();
    return true;
  }

  const api = { MIN_HEIGHT, MIN_WIDTH, SIZES, drawWatermark, fontSizeFor, placement };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.aurumWatermark = api;
})();
