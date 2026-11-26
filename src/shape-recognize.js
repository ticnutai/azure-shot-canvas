// The smart pen: a hand-drawn stroke becomes a straight line, a circle / ellipse or a rectangle when it is close enough
// to one; anything else stays as drawn. Plain geometry on points ({x, y} in screen points), so it can be checked alone.
(function (root) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  const boxOf = (points) => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, right: Math.max(...xs), bottom: Math.max(...ys), width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  };
  const pathLength = (points) => points.reduce((sum, p, i) => (i ? sum + dist(points[i - 1], p) : 0), 0);

  // A line that is almost level or upright snaps to exactly level / upright.
  function snapLine(from, to) {
    const angle = Math.abs(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI);
    if (angle < 6 || angle > 174) return { from, to: { x: to.x, y: from.y } };
    if (Math.abs(angle - 90) < 6) return { from, to: { x: from.x, y: to.y } };
    return { from, to };
  }

  /** The shape the stroke stands for, or null to keep it as drawn. */
  function recognize(points) {
    if (!Array.isArray(points) || points.length < 4) return null;
    const first = points[0];
    const last = points[points.length - 1];
    const box = boxOf(points);
    const size = Math.max(box.width, box.height);
    if (size < 14) return null;
    const length = pathLength(points);

    // A straight line: every point near the segment between the two ends, and not a closed loop.
    const span = dist(first, last);
    if (span > 20 && span > length * 0.8) {
      const far = Math.max(...points.map((p) => distToSegment(p, first, last)));
      if (far <= Math.max(6, span * 0.07)) return { type: 'line', ...snapLine(first, last) };
    }

    // Closed shapes: the two ends meet (or nearly), and the stroke went around.
    const closed = span <= Math.max(24, size * 0.25) && length > size * 2.2;
    if (!closed || box.width < 12 || box.height < 12) return null;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const rx = box.width / 2;
    const ry = box.height / 2;
    // How far the points are from an ellipse filling the box, and from the box's own sides (both relative to its size).
    let ellipseError = 0;
    let rectError = 0;
    const small = Math.min(box.width, box.height);
    for (const p of points) {
      ellipseError += Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1);
      rectError += Math.min(Math.abs(p.x - box.left), Math.abs(p.x - box.right), Math.abs(p.y - box.top), Math.abs(p.y - box.bottom)) / small;
    }
    ellipseError /= points.length;
    rectError /= points.length;
    // A rectangle also has points near its four corners.
    const reach = small * 0.22;
    const corners = [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]]
      .filter(([x, y]) => points.some((p) => Math.hypot(p.x - x, p.y - y) <= reach)).length;
    if (corners >= 3 && rectError < 0.06 && rectError < ellipseError * 0.8) {
      return { type: 'rect', from: { x: box.left, y: box.top }, to: { x: box.right, y: box.bottom } };
    }
    if (ellipseError < 0.2) {
      // Nearly round becomes a true circle.
      if (Math.abs(box.width - box.height) <= Math.max(box.width, box.height) * 0.15) {
        const r = (rx + ry) / 2;
        return { type: 'ellipse', from: { x: cx - r, y: cy - r }, to: { x: cx + r, y: cy + r } };
      }
      return { type: 'ellipse', from: { x: box.left, y: box.top }, to: { x: box.right, y: box.bottom } };
    }
    return null;
  }

  const api = { recognize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AurumShapeRecognize = api;
})(typeof window !== 'undefined' ? window : globalThis);
