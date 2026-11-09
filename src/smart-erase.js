// Smart erase: removes something from a picture and fills the place with what was around it. Three ways, chosen by
// looking at the pixels around the place:
//   solid  — the background is one colour (most screen captures): filled with exactly that colour;
//   lines  — the background has lines, frames or a colour gradient: every row and column is continued from both sides;
//   smooth — a photo or a busy background: filled from the edge inward, each pixel from its known neighbours, nearer and
//            earlier ones counting more (the fast-marching method of A. Telea, 2004, as in OpenCV's "inpaint").
// Plain pixel work with no page access, so the same code serves the editor, the frozen screen and the checks.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AurumSmartErase = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const KNOWN = 0;
  const BAND = 1;
  const INSIDE = 2;
  const RING = 3; // how far around the place the background is read, in pixels
  const SOLID_SHARE = 0.86; // this share of the ring in one colour → a plain background
  const SMOOTH_LIMIT = 900 * 900; // bigger places are filled by rows and columns, which is fast at any size

  // A mask (1 = erase) for a rectangle, grown by `grow` pixels so the soft edge of what is erased goes too.
  function rectMask(width, height, rect, grow = 0) {
    const mask = new Uint8Array(width * height);
    const left = Math.max(0, Math.floor(rect.x - grow));
    const top = Math.max(0, Math.floor(rect.y - grow));
    const right = Math.min(width, Math.ceil(rect.x + rect.width + grow));
    const bottom = Math.min(height, Math.ceil(rect.y + rect.height + grow));
    for (let y = top; y < bottom; y += 1) mask.fill(1, y * width + left, y * width + right);
    return mask;
  }

  // Grows a mask by `steps` pixels (a soft edge left behind by a brush or by smoothing would show otherwise).
  function growMask(mask, width, height, steps) {
    let current = mask;
    for (let step = 0; step < steps; step += 1) {
      const next = current.slice();
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (current[index]) continue;
          if ((x > 0 && current[index - 1]) || (x < width - 1 && current[index + 1]) || (y > 0 && current[index - width]) || (y < height - 1 && current[index + width])) next[index] = 1;
        }
      }
      current = next;
    }
    return current;
  }

  function boundsOfMask(mask, width, height) {
    let left = width; let top = height; let right = -1; let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!mask[y * width + x]) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }

  // The pixels just around the place (not in it): what the background looks like there.
  function ringPixels(image, mask, box) {
    const { width, height, data } = image;
    const pixels = [];
    const left = Math.max(0, box.x - RING);
    const top = Math.max(0, box.y - RING);
    const right = Math.min(width - 1, box.x + box.width - 1 + RING);
    const bottom = Math.min(height - 1, box.y + box.height - 1 + RING);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const index = y * width + x;
        if (mask[index]) continue;
        // Only pixels near the place: within RING of a masked pixel along the row or the column.
        let near = false;
        for (let d = 1; d <= RING && !near; d += 1) {
          near = (x - d >= 0 && mask[index - d]) || (x + d < width && mask[index + d]) || (y - d >= 0 && mask[index - d * width]) || (y + d < height && mask[index + d * width]);
        }
        if (near) pixels.push([data[index * 4], data[index * 4 + 1], data[index * 4 + 2], data[index * 4 + 3]]);
      }
    }
    return pixels;
  }

  // The most common colour of the ring (colours a few shades apart count as one) and its share of the ring.
  function dominantColor(pixels) {
    if (!pixels.length) return { color: [255, 255, 255, 255], share: 0, kinds: 0, covered: 0 };
    const bins = new Map();
    for (const pixel of pixels) {
      const key = ((pixel[0] >> 3) << 10) | ((pixel[1] >> 3) << 5) | (pixel[2] >> 3);
      const bin = bins.get(key) || { count: 0, sum: [0, 0, 0, 0] };
      bin.count += 1;
      for (let channel = 0; channel < 4; channel += 1) bin.sum[channel] += pixel[channel];
      bins.set(key, bin);
    }
    let best = null;
    for (const bin of bins.values()) if (!best || bin.count > best.count) best = bin;
    // Neighbouring bins (a shade apart) belong to the same colour.
    const color = best.sum.map((value) => Math.round(value / best.count));
    let count = 0;
    for (const pixel of pixels) if (Math.abs(pixel[0] - color[0]) <= 10 && Math.abs(pixel[1] - color[1]) <= 10 && Math.abs(pixel[2] - color[2]) <= 10) count += 1;
    // A screen (frames, lines, a few flat colours): a few colours cover nearly all of it. A photo: many small ones.
    const main = [...bins.values()].filter((bin) => bin.count >= pixels.length * 0.02);
    const covered = main.reduce((sum, bin) => sum + bin.count, 0) / pixels.length;
    return { color, share: count / pixels.length, kinds: main.length, covered };
  }

  const toHex = (color) => `#${color.slice(0, 3).map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

  // Whether something (a frame line, a band) enters the place on one side and leaves on the opposite side: then it
  // must go on through the place, even on a background that is nearly all one colour.
  function crossing(image, box, color) {
    const { width, height, data } = image;
    const pixel = (x, y) => data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3);
    const differs = (p) => Math.abs(p[0] - color[0]) > 24 || Math.abs(p[1] - color[1]) > 24 || Math.abs(p[2] - color[2]) > 24;
    const alike = (a, b) => Math.abs(a[0] - b[0]) <= 24 && Math.abs(a[1] - b[1]) <= 24 && Math.abs(a[2] - b[2]) <= 24;
    const left = box.x - 1; const right = box.x + box.width; const top = box.y - 1; const bottom = box.y + box.height;
    if (left >= 0 && right < width) {
      for (let y = box.y; y < box.y + box.height; y += 1) { const a = pixel(left, y); const b = pixel(right, y); if (differs(a) && differs(b) && alike(a, b)) return true; }
    }
    if (top >= 0 && bottom < height) {
      for (let x = box.x; x < box.x + box.width; x += 1) { const a = pixel(x, top); const b = pixel(x, bottom); if (differs(a) && differs(b) && alike(a, b)) return true; }
    }
    return false;
  }

  // Which way suits the place: a plain colour, rows and columns, or the smooth fill.
  function analyze(image, mask) {
    const box = boundsOfMask(mask, image.width, image.height);
    if (!box) return null;
    const ring = ringPixels(image, mask, box);
    const dominant = dominantColor(ring);
    let method = 'smooth';
    if (dominant.share >= SOLID_SHARE) method = crossing(image, box, dominant.color) ? 'lines' : 'solid';
    else if ((dominant.kinds <= 8 && dominant.covered >= 0.8) || box.width * box.height > SMOOTH_LIMIT) method = 'lines';
    return { box, method, color: dominant.color, hex: toHex(dominant.color), share: dominant.share };
  }

  function fillSolid(image, mask, color) {
    const { data } = image;
    for (let index = 0; index < mask.length; index += 1) {
      if (!mask[index]) continue;
      data.set(color, index * 4);
    }
  }

  // Each erased pixel: from the nearest known pixels on its left and right, and above and below. Where the two sides of
  // a row agree (a frame line, a band of colour) the row goes on; where they differ but the column agrees, the column
  // does; otherwise both are blended, each side by nearness. So lines and gradients that cross the place go on through it.
  const SAME = 24;
  function fillLines(image, mask, box, background = null) {
    const { width, height, data } = image;
    const source = new Uint8ClampedArray(data);
    const free = (x, y) => !mask[y * width + x];
    // The nearest known pixel from (x, y) going (dx, dy): its distance, or 0 when the picture's edge comes first.
    const reach = (x, y, dx, dy) => {
      for (let distance = 1; ; distance += 1) {
        const nx = x + dx * distance;
        const ny = y + dy * distance;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return 0;
        if (free(nx, ny)) return distance;
      }
    };
    const colour = (x, y) => source.subarray((y * width + x) * 4, (y * width + x) * 4 + 4);
    const alike = (a, b) => Math.abs(a[0] - b[0]) <= SAME && Math.abs(a[1] - b[1]) <= SAME && Math.abs(a[2] - b[2]) <= SAME;
    // Along one line: the two sides blended by nearness; one side alone when the other is the picture's edge.
    const along = (a, da, b, db) => {
      if (a && b) return { value: [0, 1, 2, 3].map((c) => (a[c] * db + b[c] * da) / (da + db)), same: alike(a, b), span: da + db };
      const one = a || b;
      return one ? { value: [...one], same: false, span: (da || db) * 2 } : null;
    };
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        const index = y * width + x;
        if (!mask[index]) continue;
        const left = reach(x, y, -1, 0); const right = reach(x, y, 1, 0); const up = reach(x, y, 0, -1); const down = reach(x, y, 0, 1);
        const row = along(left && colour(x - left, y), left, right && colour(x + right, y), right);
        const column = along(up && colour(x, y - up), up, down && colour(x, y + down), down);
        let value;
        if (row && column) {
          // Both sides agree both ways (a thin line crossing a plain panel): the way that is not the background is the line.
          const away = (v) => (background ? Math.abs(v[0] - background[0]) + Math.abs(v[1] - background[1]) + Math.abs(v[2] - background[2]) : 0);
          if (row.same && !column.same) value = row.value;
          else if (column.same && !row.same) value = column.value;
          else if (row.same && column.same && Math.abs(away(row.value) - away(column.value)) > 3 * SAME) value = away(row.value) > away(column.value) ? row.value : column.value;
          else {
            const rowWeight = 1 / row.span; const columnWeight = 1 / column.span;
            value = row.value.map((v, c) => (v * rowWeight + column.value[c] * columnWeight) / (rowWeight + columnWeight));
          }
        } else value = (row || column)?.value;
        if (value) for (let c = 0; c < 4; c += 1) data[index * 4 + c] = Math.round(value[c]);
      }
    }
  }

  // A small heap of pixels by arrival time, for the fast-marching fill.
  class Heap {
    constructor() { this.items = []; }
    get size() { return this.items.length; }
    push(time, index) {
      const items = this.items;
      items.push([time, index]);
      let at = items.length - 1;
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (items[parent][0] <= items[at][0]) break;
        [items[parent], items[at]] = [items[at], items[parent]];
        at = parent;
      }
    }
    pop() {
      const items = this.items;
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let at = 0;
        for (;;) {
          const left = at * 2 + 1;
          const right = left + 1;
          let smallest = at;
          if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
          if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
          if (smallest === at) break;
          [items[smallest], items[at]] = [items[at], items[smallest]];
          at = smallest;
        }
      }
      return top;
    }
  }

  // Fast marching (Telea): the place is filled from its edge inward, each pixel from the known pixels within `radius`,
  // weighted by nearness, by direction (along the way the edge moves) and by how early they were filled.
  function fillSmooth(image, mask, radius = 5) {
    const { width, height, data } = image;
    const flags = new Uint8Array(width * height);
    const times = new Float64Array(width * height);
    const heap = new Heap();
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index]) { flags[index] = INSIDE; times[index] = 1e6; }
    }
    // The edge: known pixels next to the place.
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index]) continue;
      const x = index % width;
      const y = (index - x) / width;
      if ((x > 0 && mask[index - 1]) || (x < width - 1 && mask[index + 1]) || (y > 0 && mask[index - width]) || (y < height - 1 && mask[index + width])) {
        flags[index] = BAND;
        heap.push(0, index);
      }
    }
    const timeAt = (x, y) => (x < 0 || y < 0 || x >= width || y >= height || flags[y * width + x] === INSIDE ? 1e6 : times[y * width + x]);
    const solve = (x1, y1, x2, y2) => {
      const t1 = timeAt(x1, y1);
      const t2 = timeAt(x2, y2);
      if (t1 >= 1e6 && t2 >= 1e6) return 1e6;
      if (t1 >= 1e6) return t2 + 1;
      if (t2 >= 1e6) return t1 + 1;
      const r = 2 - (t1 - t2) * (t1 - t2);
      return r > 0 ? (t1 + t2 + Math.sqrt(r)) / 2 : Math.min(t1, t2) + 1;
    };
    while (heap.size) {
      const [, index] = heap.pop();
      if (flags[index] === KNOWN) continue;
      flags[index] = KNOWN;
      const x = index % width;
      const y = (index - x) / width;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const near = ny * width + nx;
        if (flags[near] !== INSIDE) continue;
        times[near] = Math.min(solve(nx - 1, ny, nx, ny - 1), solve(nx + 1, ny, nx, ny - 1), solve(nx - 1, ny, nx, ny + 1), solve(nx + 1, ny, nx, ny + 1));
        // The direction the edge moves here (the slope of the arrival time).
        const gradX = (timeAt(nx + 1, ny) < 1e6 && timeAt(nx - 1, ny) < 1e6) ? (timeAt(nx + 1, ny) - timeAt(nx - 1, ny)) / 2 : 0;
        const gradY = (timeAt(nx, ny + 1) < 1e6 && timeAt(nx, ny - 1) < 1e6) ? (timeAt(nx, ny + 1) - timeAt(nx, ny - 1)) / 2 : 0;
        const sum = [0, 0, 0, 0];
        let weights = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const qx = nx + dx;
            const qy = ny + dy;
            if ((!dx && !dy) || qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
            const q = qy * width + qx;
            if (flags[q] === INSIDE) continue;
            const length2 = dx * dx + dy * dy;
            if (length2 > radius * radius) continue;
            const length = Math.sqrt(length2);
            const direction = Math.abs((-dx * gradX - dy * gradY) / length) || 1e-6;
            const level = 1 / (1 + Math.abs(times[q] - times[near]));
            const weight = direction * (1 / length2) * level;
            for (let channel = 0; channel < 4; channel += 1) sum[channel] += data[q * 4 + channel] * weight;
            weights += weight;
          }
        }
        if (weights) for (let channel = 0; channel < 4; channel += 1) data[near * 4 + channel] = Math.round(sum[channel] / weights);
        flags[near] = BAND;
        heap.push(times[near], near);
      }
    }
  }

  // Erases the masked pixels of `image` (changed in place). method: 'auto' (the default), 'solid', 'lines' or 'smooth';
  // color: [r, g, b, a] to use instead of the detected colour (solid only). Returns what was done, or null.
  function erase(image, mask, { method = 'auto', color = null } = {}) {
    const found = analyze(image, mask);
    if (!found) return null;
    const chosen = method === 'auto' ? found.method : method;
    if (chosen === 'solid') fillSolid(image, mask, color || found.color);
    else if (chosen === 'lines') fillLines(image, mask, found.box, found.color);
    else fillSmooth(image, mask);
    return { method: chosen, detected: found.method, hex: color ? toHex(color) : found.hex, box: found.box };
  }

  const METHOD_NAMES = Object.freeze({ solid: 'צבע הרקע', lines: 'המשך הקווים והצבעים מסביב', smooth: 'השלמה רכה מהסביבה' });

  return { METHOD_NAMES, analyze, boundsOfMask, dominantColor, erase, growMask, rectMask, toHex };
});
