const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function launchStudio(testName, options = {}) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), `screen-studio-${testName}-`));
  const qaReportDir = path.join(outputDir, 'qa-report');
  await fs.mkdir(qaReportDir, { recursive: true });
  const previous = qaFixture('2026-08-11T10:00:00.000Z', 1500, 1920);
  const current = qaFixture('2026-08-12T10:00:00.000Z', 1200, 2880);
  await fs.writeFile(path.join(qaReportDir, 'report-2026-08-11T10-00-00-000Z.json'), JSON.stringify(previous));
  await fs.writeFile(path.join(qaReportDir, 'report-2026-08-12T10-00-00-000Z.json'), JSON.stringify(current));
  await fs.writeFile(path.join(qaReportDir, 'latest-report.json'), JSON.stringify(current));
  await fs.writeFile(path.join(qaReportDir, 'latest-report.html'), '<h1>QA fixture</h1>');
  await fs.writeFile(path.join(qaReportDir, 'latest-console.log'), 'Saved QA console fixture\n4 tests passed');
  const chromiumSwitches = options.fakeMedia === false ? [] : ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  const app = await electron.launch({
    args: [...chromiumSwitches, `--user-data-dir=${path.join(outputDir, 'electron-profile')}`, '.'],
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      SCREEN_STUDIO_OUTPUT_DIR: outputDir,
      SCREEN_STUDIO_QA_REPORT_DIR: qaReportDir,
      SCREEN_STUDIO_QA: '1'
    },
    timeout: 30_000
  });
  const page = await app.firstWindow();
  const runtimeErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push({ type: 'console', text: message.text() });
  });
  page.on('pageerror', (error) => runtimeErrors.push({ type: 'pageerror', text: error.message }));
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true', null, { timeout: 20_000 });
  await page.waitForFunction(() => document.documentElement.dataset.sourcesLoading === 'false' && document.querySelectorAll('.source-card').length > 0, null, { timeout: 20_000 });
  return { app, page, outputDir, runtimeErrors };
}

function qaFixture(finishedAt, latency, width) {
  return {
    status: 'passed', finishedAt, durationMs: 4000,
    summary: { tests: 1, passed: 1, failed: 0, metrics: 2, thresholdFailures: 0 },
    tests: [{ title: 'QA dashboard fixture', status: 'passed', metrics: [
      { name: 'Response latency', value: latency, unit: 'ms', threshold: 2500, direction: 'max', pass: true, evidence: 'fixture' },
      { name: 'Video width', value: width, unit: 'px', threshold: 1920, direction: 'min', pass: true, evidence: 'fixture' }
    ] }]
  };
}

async function closeStudio(app) {
  if (app) await app.close().catch(() => {});
}

module.exports = { closeStudio, launchStudio };
