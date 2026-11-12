// What changed between two pictures of the same size: the places that differ are found (in small squares, so one
// stray pixel is not a "change"), joined into frames, and a picture is made with the two side by side — before on
// the left, after on the right — the changed places framed in red and everything else slightly dimmed.
// Pixels are 4 bytes each, as Windows gives them (blue, green, red, alpha); the work never depends on their order.

const CELL = 12; // the side of a square, in pixels
const THRESHOLD = 30; // how far a colour channel must move, on average over a square, to count

function changedCells(a, b, width, height, { cell = CELL, threshold = THRESHOLD } = {}) {
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let total = 0;
      let strong = 0;
      let count = 0;
      const right = Math.min(width, (column + 1) * cell);
      const bottom = Math.min(height, (row + 1) * cell);
      for (let y = row * cell; y < bottom; y += 1) {
        for (let x = column * cell; x < right; x += 1) {
          const at = (y * width + x) * 4;
          const distance = Math.abs(a[at] - b[at]) + Math.abs(a[at + 1] - b[at + 1]) + Math.abs(a[at + 2] - b[at + 2]);
          total += distance;
          if (distance > threshold * 3) strong += 1;
          count += 1;
        }
      }
      // A square counts when it moved on average, or when a clear part of it changed sharply (thin text on a plain ground).
      if (count && (total / count > threshold || strong / count > 0.04)) cells[row * columns + column] = 1;
    }
  }
  return { cells, columns, rows, cell };
}

// Touching squares (also by a corner) become one frame; frames that touch or overlap are joined.
function regionsOf({ cells, columns, rows, cell }, width, height, { pad = 6, limit = 60 } = {}) {
  const seen = new Uint8Array(cells.length);
  let frames = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (!cells[start] || seen[start]) continue;
    let left = columns; let top = rows; let right = 0; let bottom = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop();
      const column = index % columns;
      const row = (index - column) / columns;
      left = Math.min(left, column); right = Math.max(right, column); top = Math.min(top, row); bottom = Math.max(bottom, row);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = column + dx; const y = row + dy;
          if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
          const next = y * columns + x;
          if (cells[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
        }
      }
    }
    const x = Math.max(0, left * cell - pad);
    const y = Math.max(0, top * cell - pad);
    frames.push({ x, y, width: Math.min(width, (right + 1) * cell + pad) - x, height: Math.min(height, (bottom + 1) * cell + pad) - y });
  }
  const touch = (one, two) => one.x <= two.x + two.width && two.x <= one.x + one.width && one.y <= two.y + two.height && two.y <= one.y + one.height;
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < frames.length; i += 1) {
      for (let j = i + 1; j < frames.length; j += 1) {
        if (!touch(frames[i], frames[j])) continue;
        const x = Math.min(frames[i].x, frames[j].x); const y = Math.min(frames[i].y, frames[j].y);
        frames[i] = { x, y, width: Math.max(frames[i].x + frames[i].width, frames[j].x + frames[j].width) - x, height: Math.max(frames[i].y + frames[i].height, frames[j].y + frames[j].height) - y };
        frames.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  // Too many small frames say nothing: the biggest ones are kept.
  if (frames.length > limit) frames = frames.sort((one, two) => two.width * two.height - one.width * one.height).slice(0, limit);
  return frames.sort((one, two) => one.y - two.y || one.x - two.x);
}

// The two pictures side by side (a gap between them), dimmed outside the frames, each frame drawn in red on both.
function sideBySide(a, b, width, height, frames, { gap = 16, line = 3 } = {}) {
  const outWidth = width * 2 + gap;
  const out = Buffer.alloc(outWidth * height * 4, 255);
  const inside = new Uint8Array(width * height);
  for (const frame of frames) for (let y = frame.y; y < frame.y + frame.height; y += 1) inside.fill(1, y * width + frame.x, y * width + frame.x + frame.width);
  for (const [source, offset] of [[a, 0], [b, width + gap]]) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const from = (y * width + x) * 4;
        const to = (y * outWidth + x + offset) * 4;
        const keep = inside[y * width + x];
        for (let channel = 0; channel < 3; channel += 1) out[to + channel] = keep ? source[from + channel] : Math.round(source[from + channel] * 0.55 + 255 * 0.45);
        out[to + 3] = 255;
      }
    }
    for (const frame of frames) {
      for (let y = frame.y; y < frame.y + frame.height; y += 1) {
        for (let x = frame.x; x < frame.x + frame.width; x += 1) {
          const edge = x - frame.x < line || frame.x + frame.width - 1 - x < line || y - frame.y < line || frame.y + frame.height - 1 - y < line;
          if (!edge) continue;
          const to = (y * outWidth + x + offset) * 4;
          out[to] = 60; out[to + 1] = 45; out[to + 2] = 235; out[to + 3] = 255; // red, in blue-green-red order
        }
      }
    }
  }
  return { bitmap: out, width: outWidth, height };
}

function compareBitmaps(a, b, width, height) {
  const frames = regionsOf(changedCells(a, b, width, height), width, height);
  const changed = frames.reduce((total, frame) => total + frame.width * frame.height, 0);
  return { frames, changedShare: Math.min(1, changed / (width * height)), ...(frames.length ? sideBySide(a, b, width, height, frames) : {}) };
}

module.exports = { changedCells, compareBitmaps, regionsOf, sideBySide };
