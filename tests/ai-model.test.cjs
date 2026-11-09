const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AiModel, MODEL } = require('../src/ai-model.cjs');

const bytes = Buffer.from('a small stand-in for the model file, long enough to arrive in a few pieces'.repeat(50));
const fingerprint = crypto.createHash('sha256').update(bytes).digest('hex');
const pieces = (data) => new ReadableStream({ start(controller) { for (let at = 0; at < data.length; at += 500) controller.enqueue(new Uint8Array(data.subarray(at, at + 500))); controller.close(); } });

function setup(content = bytes, sha256 = fingerprint) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-model-'));
  let calls = 0;
  const model = new AiModel({ directory, model: { file: 'model.onnx', url: 'https://example.invalid/model.onnx', sha256, size: content.length }, fetchImpl: async () => { calls += 1; return new Response(pieces(content)); } });
  return { model, directory, calls: () => calls };
}

test('the real model is pinned to one file and one fingerprint', () => {
  assert.match(MODEL.url, /^https:\/\/huggingface\.co\//);
  assert.match(MODEL.sha256, /^[0-9a-f]{64}$/);
  assert.equal(MODEL.size, 28079181);
});

test('downloaded once, with progress, checked, then read back; a second request joins the first', async () => {
  const { model, directory, calls } = setup();
  assert.equal((await model.status()).ready, false);
  await assert.rejects(model.read(), /עוד לא הורד/);
  const progress = [];
  const [first, second] = await Promise.all([model.download((received, total) => progress.push([received, total])), model.download()]);
  assert.deepEqual(first, { ready: true });
  assert.deepEqual(second, { ready: true });
  assert.equal(calls(), 1);
  assert.equal(progress.at(-1)[0], bytes.length);
  assert.equal((await model.status()).ready, true);
  assert.deepEqual(await model.read(), bytes);
  await model.download();
  assert.equal(calls(), 1, 'nothing is fetched again once it is here');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('a file that is not the right one is thrown away and never used', async () => {
  const { model, directory } = setup(bytes, '0'.repeat(64));
  await assert.rejects(model.download(), /אינו הקובץ הנכון/);
  assert.equal((await model.status()).ready, false);
  assert.equal(fs.existsSync(`${model.filePath}.partial`), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
