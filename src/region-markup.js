// Quick marks drawn right on the frozen screen (arrow, box, pen, text, blur, numbered step). Shapes are kept in
// screen points of this screen; the same drawing code paints the live preview and the saved image, so what you
// see is exactly what is saved.
(() => {
  const COLORS = Object.freeze(['#f13c50', '#ffc929', '#2f80ed', '#27ae60', '#111111']);
  const LINE = 4;
  const BLUR_BLOCK = 10; // pixels per blur block in the saved image

  const boundsOf = (shape) => {
    if (shape.type === 'pen') {
      const xs = shape.points.map((point) => point.x);
      const ys = shape.points.map((point) => point.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    return { x: Math.min(shape.from.x, shape.to.x), y: Math.min(shape.from.y, shape.to.y), width: Math.abs(shape.to.x - shape.from.x), height: Math.abs(shape.to.y - shape.from.y) };
  };

  // Blur = coarse pixel blocks taken from the untouched frozen image (cannot be undone by sharpening).
  function drawBlur(context, shape, frozen, scale) {
    const rect = boundsOf(shape);
    if (rect.width < 2 || rect.height < 2) return;
    const source = { x: Math.round(rect.x * scale), y: Math.round(rect.y * scale), width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)) };
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(source.width / BLUR_BLOCK));
    small.height = Math.max(1, Math.round(source.height / BLUR_BLOCK));
    const smallContext = small.getContext('2d');
    smallContext.imageSmoothingEnabled = true;
    smallContext.drawImage(frozen, source.x, source.y, source.width, source.height, 0, 0, small.width, small.height);
    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(small, 0, 0, small.width, small.height, rect.x, rect.y, rect.width, rect.height);
    context.restore();
  }

  function drawArrow(context, from, to, color) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const head = Math.min(18, Math.max(10, length * 0.35));
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = LINE;
    context.lineCap = 'round';
    context.shadowColor = '#0006';
    context.shadowBlur = 3;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x - Math.cos(angle) * head * 0.6, to.y - Math.sin(angle) * head * 0.6);
    context.stroke();
    context.beginPath();
    context.moveTo(to.x, to.y);
    context.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
    context.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawShape(context, shape, { frozen, scale }) {
    if (shape.type === 'blur') return drawBlur(context, shape, frozen, scale);
    context.save();
    if (shape.type === 'arrow') drawArrow(context, shape.from, shape.to, shape.color);
    else if (shape.type === 'rect') {
      const rect = boundsOf(shape);
      context.strokeStyle = shape.color;
      context.lineWidth = LINE;
      context.lineJoin = 'round';
      context.shadowColor = '#0005';
      context.shadowBlur = 3;
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    } else if (shape.type === 'pen') {
      context.strokeStyle = shape.color;
      context.lineWidth = LINE;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      shape.points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
      context.stroke();
    } else if (shape.type === 'text') {
      context.font = '700 20px "Segoe UI", Arial, sans-serif';
      context.direction = 'rtl';
      context.textAlign = 'start';
      context.textBaseline = 'top';
      context.lineJoin = 'round';
      context.lineWidth = 4;
      context.strokeStyle = shape.color === '#111111' ? '#ffffff' : '#000000aa';
      context.fillStyle = shape.color;
      shape.text.split('\n').forEach((line, index) => {
        context.strokeText(line, shape.from.x, shape.from.y + index * 26);
        context.fillText(line, shape.from.x, shape.from.y + index * 26);
      });
    } else if (shape.type === 'number') {
      context.fillStyle = shape.color;
      context.shadowColor = '#0006';
      context.shadowBlur = 4;
      context.beginPath();
      context.arc(shape.from.x, shape.from.y, 15, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = shape.color === '#ffc929' ? '#111111' : '#ffffff';
      context.font = '700 16px "Segoe UI", Arial, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(shape.number), shape.from.x, shape.from.y + 1);
    }
    context.restore();
  }

  // A drawn shape too small to mean anything (a stray click) is dropped.
  function isMeaningful(shape) {
    if (shape.type === 'text') return Boolean(shape.text.trim());
    if (shape.type === 'number') return true;
    if (shape.type === 'pen') return shape.points.length > 1;
    const rect = boundsOf(shape);
    return shape.type === 'arrow' ? Math.hypot(rect.width, rect.height) >= 8 : rect.width >= 4 && rect.height >= 4;
  }

  // The finished picture: the selected pixels of the frozen screen plus every mark, as PNG bytes.
  async function renderSelection({ frozen, scale, rect, pixels, shapes }) {
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext('2d');
    context.drawImage(frozen, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, pixels.width, pixels.height);
    context.setTransform(scale, 0, 0, scale, -pixels.x, -pixels.y);
    context.save();
    context.beginPath();
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.clip();
    for (const shape of shapes) drawShape(context, shape, { frozen, scale });
    context.restore();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  window.AurumMarkup = { COLORS, boundsOf, drawShape, isMeaningful, renderSelection };
})();
