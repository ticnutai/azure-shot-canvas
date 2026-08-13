function metricKey(testTitle, metricName) {
  return `${testTitle}::${metricName}`;
}

function compareReports(current, previous) {
  if (!current) return [];
  const previousMetrics = new Map();
  for (const test of previous?.tests || []) {
    for (const metric of test.metrics || []) previousMetrics.set(metricKey(test.title, metric.name), metric);
  }
  return (current.tests || []).flatMap((test) => (test.metrics || []).map((metric) => {
    const before = previousMetrics.get(metricKey(test.title, metric.name));
    const delta = before && Number.isFinite(before.value) && Number.isFinite(metric.value) ? metric.value - before.value : null;
    const regression = delta === null ? false : metric.direction === 'min' ? delta < 0 : delta > 0;
    return { ...metric, testTitle: test.title, previousValue: before?.value ?? null, delta, regression };
  }));
}

module.exports = { compareReports, metricKey };
