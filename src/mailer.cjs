// Sending captures by e-mail: opens a new message in the chosen mail program with the files attached (never sends).
// The default program is "שיחה" (Sicha Mail). It publishes its entry point in the Windows registry:
//   HKCU\Software\SichaMail  ComposeExe, ComposeArgs   →   ComposeExe [ComposeArgs] [--subject "…"] "file1" "file2" …
// The other choice is any program the person picks; it gets the files as arguments.
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const MAIL_CLIENTS = Object.freeze(['sicha', 'custom']);
const SICHA_KEY = 'HKCU\\Software\\SichaMail';

// Command-line text into arguments, Windows style: spaces separate, double quotes group, \" is a quote.
function splitArgs(text = '') {
  const args = [];
  let current = '';
  let quoted = false;
  let started = false;
  const source = String(text);
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\' && source[index + 1] === '"') { current += '"'; index += 1; started = true; continue; }
    if (char === '"') { quoted = !quoted; started = true; continue; }
    if (/\s/.test(char) && !quoted) {
      if (started) args.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) args.push(current);
  return args;
}

function mailSubject(files = []) {
  if (!files.length) return '';
  if (files.length === 1) return `צילום מסך: ${path.basename(files[0])}`;
  return `${files.length} צילומים מאולפן צילום המסך`;
}

function normalizeMailSettings(value = {}) {
  const client = MAIL_CLIENTS.includes(value.client) ? value.client : 'sicha';
  const customPath = typeof value.customPath === 'string' && /\.exe$/i.test(value.customPath) ? value.customPath : '';
  return { client: client === 'custom' && !customPath ? 'sicha' : client, customPath };
}

// The program and arguments that open a new message with these files, or null when the chosen program is not ready.
function composeCommand(settings, sicha, files) {
  const chosen = normalizeMailSettings(settings);
  if (!files.length) return null;
  if (chosen.client === 'custom') return { client: 'custom', file: chosen.customPath, args: [...files] };
  if (!sicha?.ComposeExe) return null;
  return { client: 'sicha', file: sicha.ComposeExe, args: [...splitArgs(sicha.ComposeArgs), '--subject', mailSubject(files), ...files] };
}

// Reads Sicha's entry point from the registry; empty when it is not registered (yet).
function readSichaCompose({ env = process.env } = {}) {
  // Test runs point at a stand-in program instead of the real registry.
  if (env.SCREEN_STUDIO_QA === '1' && env.SCREEN_STUDIO_SICHA_COMPOSE_EXE !== undefined) {
    return Promise.resolve(env.SCREEN_STUDIO_SICHA_COMPOSE_EXE ? { ComposeExe: env.SCREEN_STUDIO_SICHA_COMPOSE_EXE, ComposeArgs: env.SCREEN_STUDIO_SICHA_COMPOSE_ARGS || '' } : {});
  }
  if (process.platform !== 'win32') return Promise.resolve({});
  // Through PowerShell with UTF-8 output: `reg query` prints in the old console code page and garbles Hebrew paths.
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $k = Get-ItemProperty -Path 'Registry::${SICHA_KEY}' -ErrorAction SilentlyContinue; if ($k) { @{ ComposeExe = [string]$k.ComposeExe; ComposeArgs = [string]$k.ComposeArgs } | ConvertTo-Json -Compress }`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 8000 }, (error, stdout) => {
      try { resolve(error || !stdout.trim() ? {} : JSON.parse(stdout.trim())); } catch { resolve({}); }
    });
  });
}

function launch(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

module.exports = { MAIL_CLIENTS, SICHA_KEY, composeCommand, launch, mailSubject, normalizeMailSettings, readSichaCompose, splitArgs };
