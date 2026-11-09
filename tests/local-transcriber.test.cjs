const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findModel, LocalTranscriber } = require('../src/local-transcriber.cjs');
const { transcribeMedia } = require('../src/studio-tools.cjs');

function model(root, name, { complete = true } = {}) {
  const folder = path.join(root, `models--${name}`, 'snapshots', 'abc');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'config.json'), '{}');
  // A finished model has its weights; a cut download does not.
  if (complete) { const handle = fs.openSync(path.join(folder, 'model.bin'), 'w'); fs.ftruncateSync(handle, 60 * 1024 * 1024); fs.closeSync(handle); }
  return folder;
}

test('the Hebrew model already on the computer is chosen first; a cut download is passed over', () => {
  const one = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-models-a-'));
  const two = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-models-b-'));
  try {
    model(one, 'Systran--faster-whisper-small');
    model(one, 'ivrit-ai--whisper-large-v3-turbo-ct2', { complete: false });
    const hebrew = model(two, 'ivrit-ai--faster-whisper-v2-d4');
    assert.deepEqual(findModel([one, two]), { name: 'faster-whisper-v2-d4', path: hebrew });
    assert.equal(findModel([fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-models-empty-'))]), null);
  } finally {
    fs.rmSync(one, { recursive: true, force: true });
    fs.rmSync(two, { recursive: true, force: true });
  }
});

test('no server and no engine on the computer: a clear message, nothing downloaded', async () => {
  const local = new LocalTranscriber({ run: async () => ({ ok: false }), workDirectory: os.tmpdir() });
  local.found = { available: false };
  await assert.rejects(transcribeMedia(path.join(os.tmpdir(), 'none.wav'), { transcriptionUrl: 'http://127.0.0.1:9', localTranscriber: local }), /לא נמצא מנוע תמלול/);
});

test('no server: the engine on the computer transcribes, and captions are written', async () => {
  const media = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-transcribe-')), 'clip.wav');
  fs.writeFileSync(media, 'x');
  const local = { find: async () => ({ available: true }), transcribe: async () => ({ text: 'שלום עולם', duration: 2, model: 'whisper-large-v3-turbo-ct2', wordTimings: [{ word: 'שלום', start: 0, end: 0.5 }, { word: 'עולם', start: 0.5, end: 1 }] }) };
  const result = await transcribeMedia(media, { transcriptionUrl: 'http://127.0.0.1:9', localTranscriber: local });
  assert.equal(result.text, 'שלום עולם');
  assert.equal(result.engine, 'local:whisper-large-v3-turbo-ct2');
  assert.match(fs.readFileSync(`${media}.srt`, 'utf8'), /00:00:00,000 --> 00:00:01,000\nשלום עולם/);
  fs.rmSync(path.dirname(media), { recursive: true, force: true });
});
