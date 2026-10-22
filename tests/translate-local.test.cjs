const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EngineError, listModels, translateText } = require('../src/translate-local.cjs');

// A tiny stand-in for the local engine.
function engine(handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ url: request.url, method: request.method, body: body ? JSON.parse(body) : null });
      handler(request, response, requests.at(-1));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, address: `http://127.0.0.1:${server.address().port}` })));
}
const json = (response, data, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)); };

test('the installed models are listed', async () => {
  const { server, address } = await engine((_request, response) => json(response, { models: [{ name: 'llama3:8b' }, { name: 'gemma2' }] }));
  try { assert.deepEqual(await listModels(address), ['llama3:8b', 'gemma2']); } finally { server.close(); }
});

test('a text is translated with the first installed model when none is named', async () => {
  const { server, requests, address } = await engine((request, response) => (request.url === '/api/tags' ? json(response, { models: [{ name: 'llama3:8b' }] }) : json(response, { response: '  שלום עולם \n' })));
  try {
    const result = await translateText('Hello world', { address, target: 'עברית' });
    assert.deepEqual(result, { text: 'שלום עולם', model: 'llama3:8b' });
    const generate = requests.find((item) => item.url === '/api/generate');
    assert.equal(generate.body.model, 'llama3:8b');
    assert.equal(generate.body.stream, false);
    assert.ok(generate.body.prompt.includes('into Hebrew'));
    assert.ok(generate.body.prompt.endsWith('Hello world'));
  } finally { server.close(); }
});

test('a model named by the user is used without asking the engine for the list', async () => {
  const { server, requests, address } = await engine((_request, response) => json(response, { response: 'Bonjour' }));
  try {
    const result = await translateText('Hello', { address, model: 'my-model', target: 'צרפתית' });
    assert.equal(result.model, 'my-model');
    assert.ok(!requests.some((item) => item.url === '/api/tags'));
    assert.ok(requests[0].body.prompt.includes('into French'));
  } finally { server.close(); }
});

test('an engine that is not running gives a clear message, not a crash', async () => {
  await assert.rejects(translateText('Hello', { address: 'http://127.0.0.1:1', timeoutMs: 2000 }), (error) => error instanceof EngineError && /לא פועל/.test(error.message));
});

test('no model installed, an empty answer and an error answer each have their own message', async () => {
  const empty = await engine((_request, response) => json(response, { models: [] }));
  try { await assert.rejects(translateText('Hello', { address: empty.address }), /לא מותקן אף מודל/); } finally { empty.server.close(); }
  const silent = await engine((_request, response) => json(response, { response: '   ' }));
  try { await assert.rejects(translateText('Hello', { address: silent.address, model: 'm' }), /לא החזיר תרגום/); } finally { silent.server.close(); }
  const broken = await engine((_request, response) => json(response, { error: 'x' }, 500));
  try { await assert.rejects(translateText('Hello', { address: broken.address, model: 'm' }), /שגיאה \(500\)/); } finally { broken.server.close(); }
});

test('only an address on this computer is used', async () => {
  await assert.rejects(translateText('Hello', { address: 'http://192.168.1.20:11434', model: 'm' }), /במחשב הזה/);
  await assert.rejects(listModels('https://example.com'), /במחשב הזה/);
  await assert.rejects(translateText('   ', { address: 'http://127.0.0.1:11434' }), /אין טקסט/);
});

test('a very long text is cut before it is sent', async () => {
  const { server, requests, address } = await engine((_request, response) => json(response, { response: 'ok' }));
  try {
    await translateText('x'.repeat(20_000), { address, model: 'm' });
    assert.ok(requests[0].body.prompt.length < 6400);
  } finally { server.close(); }
});
