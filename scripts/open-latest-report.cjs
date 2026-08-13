const { execFile } = require('node:child_process');
const path = require('node:path');
const report = path.resolve('artifacts/qa/latest-report.html');
execFile('explorer.exe', [report], { windowsHide: true });
