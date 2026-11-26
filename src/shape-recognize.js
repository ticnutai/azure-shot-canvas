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

  // Points near the straight segment a-b (every one within the allowance).
  const straight = (pts, a, b, allow) => pts.every((p) => distToSegment(p, a, b) <= allow);

  /**
   * A line with an arrowhead drawn at its end in the same stroke: a straight shaft to the tip, then a short
   * stroke back from the tip (one barb, or both barbs). Returns the shaft, or null.
   */
  function arrowOf(points) {
    const first = points[0];
    // The tip: the point farthest from the start.
    let tipIndex = 0;
    points.forEach((p, i) => { if (dist(first, p) > dist(first, points[tipIndex])) tipIndex = i; });
    const tip = points[tipIndex];
    const shaft = dist(first, tip);
    if (shaft < 40 || tipIndex < 2 || tipIndex > points.length - 3) return null;
    if (!straight(points.slice(0, tipIndex + 1), first, tip, Math.max(7, shaft * 0.08))) return null;
    const tail = points.slice(tipIndex);
    const tailLength = pathLength(tail);
    const reach = Math.max(...tail.map((p) => dist(p, tip)));
    if (tailLength < Math.max(12, shaft * 0.1) || reach > shaft * 0.5) return null;
    // The head points back toward the start, and spreads to the side of the shaft.
    const ux = (tip.x - first.x) / shaft;
    const uy = (tip.y - first.y) / shaft;
    const along = tail.map((p) => (p.x - tip.x) * ux + (p.y - tip.y) * uy);
    const back = along.reduce((s, v) => s + v, 0) / along.length;
    const farthestBack = Math.min(...along);
    const side = Math.max(...tail.map((p) => Math.abs((p.x - tip.x) * -uy + (p.y - tip.y) * ux)));
    if (back >= 0 || farthestBack > -reach * 0.45 || side < Math.max(6, shaft * 0.04)) return null;
    return { type: 'arrow', ...snapLine(first, tip) };
  }

  /**
   * A check mark ✓: two straight arms meeting at the lowest point, the first arm shorter than the second.
   * Returns a clean three-point stroke, or null.
   */
  function checkOf(points) {
    const first = points[0];
    const last = points[points.length - 1];
    let cornerIndex = 0;
    points.forEach((p, i) => { if (p.y > points[cornerIndex].y) cornerIndex = i; });
    if (cornerIndex < 1 || cornerIndex > points.length - 2) return null;
    const corner = points[cornerIndex];
    const a = dist(first, corner);
    const b = dist(corner, last);
    const long = Math.max(a, b);
    const short = Math.min(a, b);
    if (long < 30 || short < long * 0.15 || short > long * 0.85) return null;
    // Both ends above the corner, and one on each side of it.
    if (first.y > corner.y - short * 0.4 || last.y > corner.y - short * 0.4) return null;
    if ((first.x - corner.x) * (last.x - corner.x) >= 0) return null;
    if (!straight(points.slice(0, cornerIndex + 1), first, corner, Math.max(6, a * 0.18))) return null;
    if (!straight(points.slice(cornerIndex), corner, last, Math.max(6, b * 0.12))) return null;
    return { type: 'check', points: [{ ...first }, { ...corner }, { ...last }] };
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

    // An arrow first (its shaft alone would also pass as a line), then a check mark.
    const arrow = arrowOf(points);
    if (arrow) return arrow;
    const check = checkOf(points);
    if (check) return check;

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
