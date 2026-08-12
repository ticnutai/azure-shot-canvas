const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let consoleOutput = '';

function writeOutput(stream, chunk) {
  const text = chunk.toString();
  consoleOutput += text;
  stream.write(text);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : command;
    const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, commandArgs, { shell: false, windowsHide: true });
    child.stdout.on('data', (chunk) => writeOutput(process.stdout, chunk));
    child.stderr.on('data', (chunk) => writeOutput(process.stderr, chunk));
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(Object.assign(new Error(`${command} exited with ${code}`), { exitCode: code || 1 })));
  });
}

async function main() {
  let exitCode = 0;
  try {
    await run('npm', ['test']);
    await run('npx', ['playwright', 'test']);
    const reportPath = path.resolve('artifacts/qa/latest-report.json');
    if (!fs.existsSync(reportPath)) throw new Error('QA report was not created');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.status !== 'passed') throw new Error(`QA report failed with ${report.summary.thresholdFailures} threshold failures.`);
    const message = `Scientific QA passed. HTML: ${path.resolve('artifacts/qa/latest-report.html')}\n`;
    consoleOutput += message;
    process.stdout.write(message);
  } catch (error) {
    exitCode = error.exitCode || 1;
    const message = `${error.message}\n`;
    consoleOutput += message;
    process.stderr.write(message);
  } finally {
    const qaDirectory = path.resolve('artifacts/qa');
    fs.mkdirSync(qaDirectory, { recursive: true });
    fs.writeFileSync(path.join(qaDirectory, 'latest-console.log'), consoleOutput, 'utf8');
  }
  process.exitCode = exitCode;
}

main();
