function percentile(values, percentage) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { count: 0, min: null, p50: null, p95: null, max: null, mean: null };
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: Math.min(...finite),
    p50: percentile(finite, 50),
    p95: percentile(finite, 95),
    max: Math.max(...finite),
    mean: sum / finite.length
  };
}

function metric(name, value, unit, threshold, direction = 'max', evidence = '') {
  const pass = direction === 'min' ? value >= threshold : value <= threshold;
  return { name, value, unit, threshold, direction, pass, evidence };
}

module.exports = { metric, percentile, summarize };
