(function exposeScrollCapture(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AurumScrollCapture = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function rowSignature(imageData, width, height, rowStep = 3, columnSamples = 32) {
    const data = imageData.data || imageData;
    const signature = [];
    for (let y = 0; y < height; y += rowStep) {
      let total = 0;
      for (let sample = 0; sample < columnSamples; sample += 1) {
        const x = Math.min(width - 1, Math.round((sample + 0.5) * width / columnSamples));
        const index = (y * width + x) * 4;
        total += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      }
      signature.push(total / columnSamples);
    }
    return { values: signature, rowStep, sourceHeight: height };
  }

  function meanDifference(a, aStart, b, bStart, length) {
    let total = 0;
    let count = 0;
    for (let index = 0; index < length; index += 2) {
      total += Math.abs(a[aStart + index] - b[bStart + index]);
      count += 1;
    }
    return count ? total / count : Infinity;
  }

  function analyzeTransition(previous, current, options = {}) {
    if (!previous?.values?.length || previous.values.length !== current?.values?.length) return { kind: 'unmatched', overlapPixels: 0, score: Infinity };
    const rows = previous.values.length;
    const duplicateScore = meanDifference(previous.values, 0, current.values, 0, rows);
    const duplicateThreshold = Number(options.duplicateThreshold ?? 2.5);
    if (duplicateScore <= duplicateThreshold) return { kind: 'duplicate', overlapPixels: current.sourceHeight, score: duplicateScore };
    const minimum = Math.max(4, Math.round(rows * Number(options.minimumOverlapRatio ?? 0.15)));
    const maximum = Math.min(rows - 2, Math.round(rows * Number(options.maximumOverlapRatio ?? 0.95)));
    let best = { rows: 0, score: Infinity };
    for (let overlap = minimum; overlap <= maximum; overlap += 1) {
      const score = meanDifference(previous.values, rows - overlap, current.values, 0, overlap);
      if (score < best.score) best = { rows: overlap, score };
    }
    const threshold = Number(options.matchThreshold ?? 14);
    if (best.score > threshold) return { kind: 'unmatched', overlapPixels: 0, score: best.score };
    return { kind: 'append', overlapPixels: Math.min(current.sourceHeight - 1, best.rows * current.rowStep), score: best.score };
  }

  function nextCanvasHeight(currentHeight, frameHeight, overlapPixels, maximumHeight = 30_000) {
    return Math.min(maximumHeight, currentHeight + Math.max(0, frameHeight - overlapPixels));
  }

  return { analyzeTransition, nextCanvasHeight, rowSignature };
});
