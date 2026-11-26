// Quick marks drawn right on the frozen screen (arrow, double arrow, line, box, ellipse, highlighter, pen, text, blur,
// numbered step). Shapes are kept in
// screen points of this screen; the same drawing code paints the live preview and the saved image, so what you
// see is exactly what is saved.
(() => {
  const COLORS = Object.freeze(['#f13c50', '#ffc929', '#2f80ed', '#27ae60', '#111111']);
  const LINE = 4;
  // Marks that are one straight line between two points (their handles are the two ends).
  const LINE_TYPES = new Set(['arrow', 'darrow', 'line']);
  // Marks whose line thickness can be chosen.
  const STROKED = new Set(['arrow', 'darrow', 'line', 'rect', 'ellipse', 'pen', 'smartpen']);
  const BLUR_BLOCK = 10; // pixels per blur block in the saved image

  const boundsOf = (shape) => {
    if (shape.type === 'pen') {
      const xs = shape.points.map((point) => point.x);
      const ys = shape.points.map((point) => point.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    return { x: Math.min(shape.from.x, shape.to.x), y: Math.min(shape.from.y, shape.to.y), width: Math.abs(shape.to.x - shape.from.x), height: Math.abs(shape.to.y - shape.from.y) };
  };

  // Smart erase on the frozen screen: what is in the box goes, filled from the background around it (smart-erase.js).
  // Worked out once for each place and kept; while the box is still being dragged only its outline shows.
  const erased = new Map();
  function erasePiece(frozen, rect, scale) {
    const pad = 16;
    const fullWidth = frozen.width;
    const fullHeight = frozen.height;
    const left = Math.max(0, Math.floor(rect.x * scale) - pad);
    const top = Math.max(0, Math.floor(rect.y * scale) - pad);
    const width = Math.min(fullWidth, Math.ceil((rect.x + rect.width) * scale) + pad) - left;
    const height = Math.min(fullHeight, Math.ceil((rect.y + rect.height) * scale) + pad) - top;
    if (width < 3 || height < 3) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(frozen, left, top, width, height, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const eraser = window.AurumSmartErase;
    const box = { x: rect.x * scale - left, y: rect.y * scale - top, width: rect.width * scale, height: rect.height * scale };
    const mask = eraser.growMask(eraser.rectMask(width, height, box), width, height, 2);
    const result = eraser.erase(image, mask);
    if (!result) return null;
    for (let index = 0; index < mask.length; index += 1) if (!mask[index]) image.data[index * 4 + 3] = 0;
    context.putImageData(image, 0, 0);
    const piece = { canvas, x: left, y: top, method: result.method };
    // A busy background (a photo, a texture): when the model is here, it does better than the plain ways.
    if (result.method === 'smooth' && window.AurumAiErase) improveWithAi(piece, frozen, rect, scale);
    return piece;
  }

  // The model needs more of the picture around the place than the plain ways do. The plain result shows at once;
  // the better one replaces it when ready, and saving waits for it (see settled).
  const pending = new Set();
  function improveWithAi(piece, frozen, rect, scale) {
    const job = (async () => {
      const state = await window.AurumAiErase.status().catch(() => null);
      if (!state?.ready) return;
      const holeWidth = rect.width * scale;
      const holeHeight = rect.height * scale;
      const margin = Math.round(Math.min(400, Math.max(48, Math.max(holeWidth, holeHeight))));
      const left = Math.max(0, Math.floor(rect.x * scale) - margin);
      const top = Math.max(0, Math.floor(rect.y * scale) - margin);
      const width = Math.min(frozen.width, Math.ceil((rect.x + rect.width) * scale) + margin) - left;
      const height = Math.min(frozen.height, Math.ceil((rect.y + rect.height) * scale) + margin) - top;
      const work = document.createElement('canvas');
      work.width = width;
      work.height = height;
      const workContext = work.getContext('2d', { willReadFrequently: true });
      workContext.drawImage(frozen, left, top, width, height, 0, 0, width, height);
      const image = workContext.getImageData(0, 0, width, height);
      const eraser = window.AurumSmartErase;
      const box = { x: rect.x * scale - left, y: rect.y * scale - top, width: holeWidth, height: holeHeight };
      const mask = eraser.growMask(eraser.rectMask(width, height, box), width, height, 3);
      await window.AurumAiErase.inpaint(image, mask);
      // Back into the piece: only the erased place, at the piece's own position.
      const pieceContext = piece.canvas.getContext('2d', { willReadFrequently: true });
      const target = pieceContext.getImageData(0, 0, piece.canvas.width, piece.canvas.height);
      const dx = left - piece.x;
      const dy = top - piece.y;
      for (let y = 0; y < piece.canvas.height; y += 1) {
        for (let x = 0; x < piece.canvas.width; x += 1) {
          const at = (y * piece.canvas.width + x) * 4;
          if (!target.data[at + 3]) continue;
          const sx = x - dx;
          const sy = y - dy;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height || !mask[sy * width + sx]) continue;
          const from = (sy * width + sx) * 4;
          target.data[at] = image.data[from];
          target.data[at + 1] = image.data[from + 1];
          target.data[at + 2] = image.data[from + 2];
        }
      }
      pieceContext.putImageData(target, 0, 0);
      piece.method = 'ai';
      document.documentElement.dataset.lastErase = 'ai';
      window.dispatchEvent(new Event('aurum-erase-improved'));
    })().catch(() => {}).finally(() => pending.delete(job));
    pending.add(job);
  }
  // Waits for erasing still being worked on (at most a while; the plain result is kept if it takes longer).
  const settled = () => (pending.size ? Promise.race([Promise.all([...pending]), new Promise((resolve) => setTimeout(resolve, 20_000))]) : Promise.resolve());
  function drawErase(context, shape, frozen, scale, live) {
    const rect = boundsOf(shape);
    if (rect.width < 2 || rect.height < 2) return;
    if (live || !window.AurumSmartErase) {
      context.save();
      context.fillStyle = 'rgba(255,45,122,0.14)';
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.strokeStyle = '#ff2d7a';
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.restore();
      return;
    }
    const key = [rect.x, rect.y, rect.width, rect.height, scale].map((value) => Math.round(value * 10)).join(',');
    let piece = erased.get(key);
    if (piece === undefined) {
      piece = erasePiece(frozen, rect, scale);
      erased.set(key, piece);
      if (erased.size > 24) erased.delete(erased.keys().next().value);
    }
    if (piece) context.drawImage(piece.canvas, piece.x / scale, piece.y / scale, piece.canvas.width / scale, piece.canvas.height / scale);
    if (piece && !pending.size) document.documentElement.dataset.lastErase = piece.method;
  }
  // Erasing changes the picture, not the marks drawn on it: erased places are drawn first.
  const inOrder = (shapes) => [...shapes.filter((shape) => shape.type === 'erase'), ...shapes.filter((shape) => shape.type !== 'erase')];

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

  // The line thickness of a mark; marks drawn before thickness could be chosen are of the usual one.
  const widthOf = (shape) => (Number(shape.width) > 0 ? Number(shape.width) : LINE);

  // A straight line with a head at its end (heads: 1), at both ends (2) or none (0).
  function drawArrow(context, from, to, color, width = LINE, heads = 1) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const head = Math.min(18, Math.max(10, length * (heads === 2 ? 0.25 : 0.35))) * Math.max(1, width / LINE) ** 0.6;
    const back = heads ? head * 0.6 : 0;
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.shadowColor = '#0006';
    context.shadowBlur = 3;
    context.beginPath();
    context.moveTo(from.x + (heads === 2 ? Math.cos(angle) * back : 0), from.y + (heads === 2 ? Math.sin(angle) * back : 0));
    context.lineTo(to.x - Math.cos(angle) * back, to.y - Math.sin(angle) * back);
    context.stroke();
    const tip = (point, toward) => {
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(point.x - head * Math.cos(toward - Math.PI / 7), point.y - head * Math.sin(toward - Math.PI / 7));
      context.lineTo(point.x - head * Math.cos(toward + Math.PI / 7), point.y - head * Math.sin(toward + Math.PI / 7));
      context.closePath();
      context.fill();
    };
    if (heads >= 1) tip(to, angle);
    if (heads === 2) tip(from, angle + Math.PI);
    context.restore();
  }

  // A text mark's own font; marks without one are bold in the usual font.
  function textFont(shape) {
    return `${shape.bold === false ? 400 : 700} 20px "${shape.font || 'Segoe UI'}", "Segoe UI", Arial, sans-serif`;
  }

  function drawShape(context, shape, { frozen, scale, live = false }) {
    if (shape.type === 'blur') return drawBlur(context, shape, frozen, scale);
    if (shape.type === 'erase') return drawErase(context, shape, frozen, scale, live);
    context.save();
    if (shape.type === 'arrow') drawArrow(context, shape.from, shape.to, shape.color, widthOf(shape), 1);
    else if (shape.type === 'darrow') drawArrow(context, shape.from, shape.to, shape.color, widthOf(shape), 2);
    else if (shape.type === 'line') drawArrow(context, shape.from, shape.to, shape.color, widthOf(shape), 0);
    else if (shape.type === 'ellipse') {
      const rect = boundsOf(shape);
      context.strokeStyle = shape.color;
      context.lineWidth = widthOf(shape);
      context.shadowColor = '#0005';
      context.shadowBlur = 3;
      context.beginPath();
      context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      context.stroke();
    } else if (shape.type === 'highlight') {
      // A see-through band of colour: what is under it stays readable.
      const rect = boundsOf(shape);
      context.globalAlpha = 0.38;
      context.fillStyle = shape.color;
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    } else if (shape.type === 'rect') {
      const rect = boundsOf(shape);
      context.strokeStyle = shape.color;
      context.lineWidth = widthOf(shape);
      context.lineJoin = 'round';
      context.shadowColor = '#0005';
      context.shadowBlur = 3;
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    } else if (shape.type === 'pen') {
      context.strokeStyle = shape.color;
      context.lineWidth = widthOf(shape);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      shape.points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
      context.stroke();
    } else if (shape.type === 'text') {
      context.font = textFont(shape);
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

  // The size of a text mark, so a click can find it later.
  const measuring = document.createElement('canvas').getContext('2d');
  function textSize(shape) {
    measuring.font = textFont(shape);
    const lines = shape.text.split('\n');
    return { width: Math.ceil(Math.max(...lines.map((line) => measuring.measureText(line).width))), height: lines.length * 26 };
  }

  // A drawn shape too small to mean anything (a stray click) is dropped.
  function isMeaningful(shape) {
    if (shape.type === 'text') return Boolean(shape.text.trim());
    if (shape.type === 'number') return true;
    if (shape.type === 'pen') return shape.points.length > 1;
    const rect = boundsOf(shape);
    return LINE_TYPES.has(shape.type) ? Math.hypot(rect.width, rect.height) >= 8 : rect.width >= 4 && rect.height >= 4;
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
    for (const shape of inOrder(shapes)) drawShape(context, shape, { frozen, scale });
    context.restore();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  window.AurumMarkup = { COLORS, LINE_TYPES, STROKED, boundsOf, drawShape, inOrder, isMeaningful, renderSelection, settled, textSize };
})();
