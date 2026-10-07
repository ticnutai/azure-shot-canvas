// Automatic scrolling capture: joins frames of the same area taken between wheel turns into one tall picture.
// Matching is done row by row on real pixels (every row at the seam plus a band from the middle of the overlap),
// so it holds for any content and any scroll distance.
const MAX_HEIGHT = 30_000;
const MATCH_THRESHOLD = 6; // mean difference (0–255) under which two strips count as the same picture

// Mean difference between `rows` rows of a (starting at rowA) and b (starting at rowB), sampled across the width.
function bandDifference(a, b, rowA, rowB, rows, width) {
  const rowBytes = width * 4;
  const columnStep = Math.max(4, Math.floor(width / 48)) * 4;
  let total = 0;
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    const offsetA = (rowA + row) * rowBytes;
    const offsetB = (rowB + row) * rowBytes;
    for (let x = 0; x < rowBytes; x += columnStep) {
      total += Math.abs(a[offsetA + x] - b[offsetB + x]) + Math.abs(a[offsetA + x + 1] - b[offsetB + x + 1]) + Math.abs(a[offsetA + x + 2] - b[offsetB + x + 2]);
      count += 3;
    }
  }
  return count ? total / count : Infinity;
}

// Two frames showing the same picture (the page did not move).
function framesAlike(a, b, width, height) {
  return bandDifference(a, b, 0, 0, height, width) < 1;
}

// How many rows at the bottom of `previous` reappear at the top of `current`; null when none match.
// Every candidate is checked on rows spread over the whole overlap (not one band): text pages have blank gaps
// between lines, and a single band can fall into a gap where every position looks the same.
function findOverlap(previous, current, width, height) {
  const minimum = Math.max(8, Math.round(height * 0.08));
  const maximum = height - 2;
  let best = { overlap: null, score: Infinity };
  for (let overlap = minimum; overlap <= maximum; overlap += 1) {
    // Quick reject on the seam.
    if (bandDifference(previous, current, height - overlap, 0, Math.min(4, overlap), width) > MATCH_THRESHOLD * 3) continue;
    const samples = Math.min(overlap, 48);
    let total = 0;
    for (let index = 0; index < samples; index += 1) {
      const row = Math.floor(index * (overlap - 1) / Math.max(1, samples - 1));
      total += bandDifference(previous, current, height - overlap + row, row, 1, width);
      if (total / samples > best.score) break;
    }
    const score = total / samples;
    // On a tie the larger overlap wins (a shorter scroll step is the likelier one).
    if (score < best.score || (score === best.score && overlap > best.overlap)) best = { overlap, score };
  }
  return best.score <= MATCH_THRESHOLD ? best.overlap : null;
}
// Mean difference of one row of two frames (sampled), 0 = identical.
function rowDifference(a, b, rowA, rowB, width) {
  const rowBytes = width * 4;
  let total = 0;
  let count = 0;
  for (let x = 0; x < rowBytes; x += 12) { total += Math.abs(a[rowA * rowBytes + x] - b[rowB * rowBytes + x]); count += 1; }
  return count ? total / count : 0;
}

// Fixed bands — a toolbar or header at the top, a status bar at the bottom — stay put while the page scrolls.
// Found by comparing the first two frames row by row; they appear once in the joined picture.
function fixedBands(frames, width, height) {
  if (frames.length < 2) return { top: 0, bottom: 0 };
  const [a, b] = frames;
  let top = 0;
  while (top < height && rowDifference(a, b, top, top, width) < 1) top += 1;
  let bottom = 0;
  while (bottom < height - top && rowDifference(a, b, height - 1 - bottom, height - 1 - bottom, width) < 1) bottom += 1;
  // A frame that did not move at all is not "all header"; and the moving part must stay large enough to match.
  if (top + bottom >= height * 0.7) return { top: 0, bottom: 0 };
  return { top, bottom };
}

// frames: raw 4-byte pixel buffers (BGRA or RGBA, all the same size). Returns
// { buffer, width, height, parts, reachedEnd } — reachedEnd: the last frame repeated (the page stopped moving).
function stitchFrames(frames, width, height) {
  if (!frames.length) return null;
  const { top, bottom } = fixedBands(frames, width, height);
  if (top || bottom) {
    const rowBytes = width * 4;
    const innerHeight = height - top - bottom;
    const inner = frames.map((frame) => frame.subarray(top * rowBytes, (top + innerHeight) * rowBytes));
    const joined = stitchMoving(inner, width, innerHeight);
    const total = Math.min(MAX_HEIGHT, top + joined.height + bottom);
    const buffer = Buffer.alloc(total * rowBytes);
    Buffer.from(frames[0].buffer, frames[0].byteOffset, top * rowBytes).copy(buffer, 0);
    joined.buffer.copy(buffer, top * rowBytes, 0, Math.min(joined.buffer.length, (total - top) * rowBytes));
    const last = frames[frames.length - 1];
    if (total - bottom > top) Buffer.from(last.buffer, last.byteOffset + (height - bottom) * rowBytes, bottom * rowBytes).copy(buffer, (total - bottom) * rowBytes);
    return { ...joined, buffer, height: total, fixedTop: top, fixedBottom: bottom };
  }
  return stitchMoving(frames, width, height);
}

function stitchMoving(frames, width, height) {
  const pieces = [{ frame: frames[0], from: 0 }];
  let reachedEnd = false;
  for (const frame of frames.slice(1)) {
    const previous = pieces[pieces.length - 1].frame;
    if (framesAlike(previous, frame, width, height)) { reachedEnd = true; break; }
    const overlap = findOverlap(previous, frame, width, height);
    if (overlap === null) break; // no overlap found: stop rather than glue unrelated pictures together
    pieces.push({ frame, from: overlap });
  }
  const total = Math.min(MAX_HEIGHT, pieces.reduce((sum, piece) => sum + (height - piece.from), 0));
  const rowBytes = width * 4;
  const buffer = Buffer.alloc(total * rowBytes);
  let y = 0;
  for (const piece of pieces) {
    const rows = Math.min(height - piece.from, total - y);
    if (rows <= 0) break;
    Buffer.from(piece.frame.buffer, piece.frame.byteOffset, piece.frame.byteLength).copy(buffer, y * rowBytes, piece.from * rowBytes, (piece.from + rows) * rowBytes);
    y += rows;
  }
  return { buffer, width, height: total, parts: pieces.length, reachedEnd };
}

// Cuts one rectangle (physical pixels) out of a whole-desktop raw bitmap.
function cropRows(bitmap, bitmapWidth, rect) {
  const rowBytes = rect.width * 4;
  const out = Buffer.alloc(rect.height * rowBytes);
  for (let row = 0; row < rect.height; row += 1) {
    const start = ((rect.y + row) * bitmapWidth + rect.x) * 4;
    bitmap.copy(out, row * rowBytes, start, start + rowBytes);
  }
  return out;
}

module.exports = { MAX_HEIGHT, cropRows, findOverlap, fixedBands, framesAlike, stitchFrames };
