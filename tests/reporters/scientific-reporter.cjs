const fs = require('node:fs');
const path = require('node:path');

class ScientificReporter {
  constructor() {
    this.startedAt = new Date();
    this.tests = [];
  }

  onTestEnd(test, result) {
    const metrics = [];
    for (const attachment of result.attachments || []) {
      if (attachment.name !== 'metrics' || !attachment.body) continue;
      try { metrics.push(...JSON.parse(attachment.body.toString('utf8'))); } catch {}
    }
    this.tests.push({
      title: test.titlePath().slice(1).join(' › '),
      status: result.status,
      durationMs: result.duration,
      error: result.error?.message || null,
      metrics
    });
  }

  onEnd(result) {
    const outputDir = path.resolve('artifacts/qa');
    fs.mkdirSync(outputDir, { recursive: true });
    const finishedAt = new Date();
    const allMetrics = this.tests.flatMap((test) => test.metrics);
    const thresholdFailures = allMetrics.filter((item) => item.pass === false);
    const report = {
      schemaVersion: 1,
      suite: 'Hebrew Screen Studio scientific QA',
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt - this.startedAt,
      status: result.status === 'passed' && thresholdFailures.length === 0 ? 'passed' : 'failed',
      summary: {
        tests: this.tests.length,
        passed: this.tests.filter((test) => test.status === 'passed').length,
        failed: this.tests.filter((test) => test.status !== 'passed').length,
        metrics: allMetrics.length,
        thresholdFailures: thresholdFailures.length
      },
      environment: { platform: process.platform, arch: process.arch, node: process.version },
      tests: this.tests
    };
    const json = JSON.stringify(report, null, 2);
    fs.writeFileSync(path.join(outputDir, 'latest-report.json'), json);
    fs.writeFileSync(path.join(outputDir, `report-${finishedAt.toISOString().replace(/[:.]/g, '-')}.json`), json);
    fs.writeFileSync(path.join(outputDir, 'latest-report.html'), htmlReport(report));
    process.stdout.write(`\nQA ${report.status.toUpperCase()}: ${report.summary.passed}/${report.summary.tests} tests, ${report.summary.thresholdFailures} threshold failures\n`);
  }
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function htmlReport(report) {
  const rows = report.tests.map((test) => {
    const metricRows = test.metrics.map((m) => `<tr class="${m.pass ? 'pass' : 'fail'}"><td>${escape(m.name)}</td><td>${round(m.value)} ${escape(m.unit)}</td><td>${m.direction === 'min' ? '≥' : '≤'} ${round(m.threshold)} ${escape(m.unit)}</td><td>${m.pass ? 'PASS' : 'FAIL'}</td><td>${escape(m.evidence)}</td></tr>`).join('');
    return `<section><h2>${test.status === 'passed' ? '✅' : '❌'} ${escape(test.title)}</h2><p>Duration: ${test.durationMs} ms</p>${test.error ? `<pre>${escape(test.error)}</pre>` : ''}<table><thead><tr><th>Metric</th><th>Measured</th><th>Threshold</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${metricRows || '<tr><td colspan="5">Functional assertion only</td></tr>'}</tbody></table></section>`;
  }).join('');
  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>דוח QA — אולפן צילום מסך</title><style>body{font-family:Segoe UI,Arial;background:#07111f;color:#eaf2ff;margin:0;padding:32px}header,section{max-width:1200px;margin:0 auto 20px;background:#0d1b2d;border:1px solid #20344c;border-radius:14px;padding:20px}h1,h2{margin-top:0}small,p{color:#9eb0c5}table{width:100%;border-collapse:collapse;direction:ltr;text-align:left}th,td{padding:9px;border-bottom:1px solid #263c54}.pass td:nth-child(4){color:#54dfb9}.fail td:nth-child(4){color:#ff6d80}pre{white-space:pre-wrap;color:#ff9baa}.badge{display:inline-block;padding:6px 11px;border-radius:999px;background:${report.status === 'passed' ? '#16483d' : '#5a2430'};color:${report.status === 'passed' ? '#71edca' : '#ff9bab'}}</style><body><header><h1>דוח QA מדעי — אולפן צילום מסך</h1><span class="badge">${report.status.toUpperCase()}</span><p>${report.finishedAt} · ${report.summary.passed}/${report.summary.tests} tests · ${report.summary.metrics} metrics</p></header>${rows}</body></html>`;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 'N/A';
}

module.exports = ScientificReporter;
