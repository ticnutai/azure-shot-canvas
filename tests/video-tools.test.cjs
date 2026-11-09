const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VideoTools, VIDEO_TOOLS } = require('../src/video-tools.cjs');

const archive = Buffer.from('a stand-in for the video tool archive'.repeat(40));
const tools = { ...VIDEO_TOOLS, file: 'tools.zip', url: 'https://example.invalid/tools.zip', sha256: crypto.createHash('sha256').update(archive).digest('hex'), size: archive.length };

function setup({ onComputer = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-video-tools-'));
  const calls = [];
  const run = async (command, args) => {
    calls.push([path.basename(command), ...args]);
    if (command === 'ffmpeg') return { ok: onComputer };
    // The unpacker: writes the two tools where it was told to.
    const target = args[args.indexOf('-C') + 1];
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) fs.writeFileSync(path.join(target, name), 'tool');
    return { ok: true };
  };
  const videoTools = new VideoTools({ directory, run, tools, fetchImpl: async () => new Response(archive) });
  return { videoTools, directory, calls };
}

test('the video tool is pinned to one release and one fingerprint', () => {
  assert.match(VIDEO_TOOLS.url, /^https:\/\/github\.com\/GyanD\/codexffmpeg\/releases\/download\/9\.0\.2\//);
  assert.match(VIDEO_TOOLS.sha256, /^[0-9a-f]{64}$/);
});

test('the computer has its own: it is used, nothing is downloaded and the search path is left alone', async () => {
  const { videoTools, directory } = setup({ onComputer: true });
  const before = process.env.PATH;
  const state = await videoTools.activate();
  assert.equal(state.installedOnComputer, true);
  assert.equal(state.active, true);
  assert.equal(process.env.PATH, before);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('missing: downloaded once, unpacked, the archive removed, and put first on the search path', async () => {
  const { videoTools, directory, calls } = setup();
  const before = process.env.PATH;
  try {
    assert.equal((await videoTools.activate()).active, false);
    const [first, second] = await Promise.all([videoTools.download(), videoTools.download()]);
    assert.equal(first.active, true);
    assert.deepEqual(first, second);
    assert.equal(calls.filter((call) => call[0] === 'tar.exe').length, 1);
    assert.ok(process.env.PATH.startsWith(videoTools.binDirectory));
    assert.equal(fs.existsSync(videoTools.archive.filePath), false);
    assert.equal((await videoTools.status()).downloaded, true);
  } finally {
    process.env.PATH = before;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
