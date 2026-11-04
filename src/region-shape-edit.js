// Changing a mark after it was drawn: finding the mark under the pointer, its handles, moving and resizing it. Marks are
// plain objects in screen points (see region-markup.js); nothing here draws, so all of it can be checked on its own.
(function (root) {
  const REACH = 9; // how near the pointer must be to a handle or a line, in screen points
  const MIN_SIZE = 6;
  const NUMBER_RADIUS = 15;

  function boundsOf(shape) {
    if (shape.type === 'pen') {
      const xs = shape.points.map((point) => point.x);
      const ys = shape.points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    if (shape.type === 'number') return { x: shape.from.x - NUMBER_RADIUS, y: shape.from.y - NUMBER_RADIUS, width: NUMBER_RADIUS * 2, height: NUMBER_RADIUS * 2 };
    // Hebrew text runs leftward from the point where it was placed.
    if (shape.type === 'text') return { x: shape.from.x - (shape.width || 0), y: shape.from.y, width: shape.width || 0, height: shape.height || 0 };
    return { x: Math.min(shape.from.x, shape.to.x), y: Math.min(shape.from.y, shape.to.y), width: Math.abs(shape.to.x - shape.from.x), height: Math.abs(shape.to.y - shape.from.y) };
  }

  function handlesOf(shape) {
    if (shape.type === 'arrow') return [{ name: 'from', x: shape.from.x, y: shape.from.y }, { name: 'to', x: shape.to.x, y: shape.to.y }];
    if (shape.type === 'text' || shape.type === 'number') return [];
    const { x, y, width, height } = boundsOf(shape);
    const midX = x + width / 2;
    const midY = y + height / 2;
    const right = x + width;
    const bottom = y + height;
    return [
      { name: 'nw', x, y }, { name: 'n', x: midX, y }, { name: 'ne', x: right, y }, { name: 'e', x: right, y: midY },
      { name: 'se', x: right, y: bottom }, { name: 's', x: midX, y: bottom }, { name: 'sw', x, y: bottom }, { name: 'w', x, y: midY }
    ];
  }
  const handleAt = (shape, point) => handlesOf(shape).find(({ x, y }) => Math.abs(point.x - x) <= REACH && Math.abs(point.y - y) <= REACH)?.name || null;

  function distanceToLine(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const along = dx || dy ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(point.x - (a.x + along * dx), point.y - (a.y + along * dy));
  }
  function isOn(shape, point) {
    if (shape.type === 'arrow') return distanceToLine(point, shape.from, shape.to) <= REACH;
    if (shape.type === 'pen') return shape.points.some((spot, index) => distanceToLine(point, shape.points[Math.max(0, index - 1)], spot) <= REACH);
    const { x, y, width, height } = boundsOf(shape);
    return point.x >= x - REACH && point.y >= y - REACH && point.x <= x + width + REACH && point.y <= y + height + REACH;
  }
  // The mark under the pointer: when several are there the smallest wins, so a mark inside a big box can be reached;
  // of equal ones the newest, which is drawn on top.
  function shapeAt(shapes, point) {
    let best = null;
    let bestArea = Infinity;
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
      const shape = shapes[index];
      if (!isOn(shape, point)) continue;
      const { width, height } = boundsOf(shape);
      const area = width * height;
      if (area < bestArea) { best = shape; bestArea = area; }
    }
    return best;
  }

  const clone = (value) => JSON.parse(JSON.stringify(value));

  // The fields of a mark moved by (dx, dy), held so that it stays inside the area.
  function moveShape(base, dx, dy, area) {
    const box = boundsOf(base);
    const moveX = Math.min(Math.max(area.x - box.x, dx), Math.max(area.x - box.x, area.x + area.width - box.x - box.width));
    const moveY = Math.min(Math.max(area.y - box.y, dy), Math.max(area.y - box.y, area.y + area.height - box.y - box.height));
    const shift = ({ x, y }) => ({ x: x + moveX, y: y + moveY });
    if (base.type === 'pen') return { points: base.points.map(shift) };
    return base.to ? { from: shift(base.from), to: shift(base.to) } : { from: shift(base.from) };
  }

  // The fields of a mark with one handle dragged to a point. A side changes one direction (narrower or wider), a corner
  // both. The mark does not turn over: a side stops a little before the opposite one.
  function resizeShape(base, handle, point) {
    if (base.type === 'arrow') return { [handle]: { x: point.x, y: point.y } };
    const box = boundsOf(base);
    let left = box.x;
    let top = box.y;
    let right = box.x + box.width;
    let bottom = box.y + box.height;
    if (handle.includes('w')) left = Math.min(right - MIN_SIZE, point.x);
    if (handle.includes('e')) right = Math.max(left + MIN_SIZE, point.x);
    if (handle.includes('n')) top = Math.min(bottom - MIN_SIZE, point.y);
    if (handle.includes('s')) bottom = Math.max(top + MIN_SIZE, point.y);
    if (base.type === 'pen') {
      const scaleX = box.width ? (right - left) / box.width : 1;
      const scaleY = box.height ? (bottom - top) / box.height : 1;
      return { points: base.points.map(({ x, y }) => ({ x: left + (x - box.x) * scaleX, y: top + (y - box.y) * scaleY })) };
    }
    return { from: { x: left, y: top }, to: { x: right, y: bottom } };
  }

  const api = { boundsOf, clone, handleAt, handlesOf, moveShape, resizeShape, shapeAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AurumShapeEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);
