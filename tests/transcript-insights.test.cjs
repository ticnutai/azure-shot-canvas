const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseModel, cleanInsights, ensureEngine, secondsOf, timedLines, transcriptInsights } = require('../src/transcript-insights.cjs');

const words = Array.from({ length: 60 }, (_value, index) => ({ word: `מילה${index}`, start: index * 2, end: index * 2 + 1 }));

test('a Hebrew model is chosen first; models that only translate or embed are never used', () => {
  const models = ['qwen3-embedding:0.6b', 'translategemma:4b', 'gemma3:4b', 'gemma3:12b', 'hf.co/dicta-il/DictaLM-3.0:Q4_K_M'];
  assert.equal(chooseModel(models), 'hf.co/dicta-il/DictaLM-3.0:Q4_K_M');
  assert.equal(chooseModel(models.slice(0, 4)), 'gemma3:12b');
  assert.equal(chooseModel(models, 'gemma3:4b'), 'gemma3:4b');
  assert.equal(chooseModel(['qwen3-embedding:0.6b', 'translategemma:4b']), null);
});

test('the transcript becomes lines that start with their time; a long one is thinned, not cut', () => {
  const lines = timedLines(words).split('\n');
  assert.match(lines[0], /^\[00:00\] מילה0 מילה1 מילה2/);
  assert.match(lines.at(-1), /^\[01:5\d\]/);
  const long = Array.from({ length: 6000 }, (_value, index) => ({ word: 'מילהארוכהמאוד', start: index * 2, end: index * 2 + 1 }));
  const thinned = timedLines(long);
  assert.ok(thinned.length <= 14_000);
  assert.match(thinned.split('\n').at(-1), /^\[19\d:\d\d\]/, 'the end of the recording is still there');
});

test('what the engine returns is kept only where it makes sense', () => {
  const raw = 'הנה התשובה: {"title":"מדריך: צילום/מסך","summary":" סיכום  קצר ","chapters":[{"at":"00:10","label":"התחלה"},{"at":"00:05","label":"אחורה"},{"at":"01:00","label":"עריכה"},{"at":"09:00","label":"אחרי הסוף"},{"at":"xx","label":"לא זמן"}]}';
  assert.deepEqual(cleanInsights(raw, 120), {
    title: 'מדריך צילום מסך', summary: 'סיכום קצר',
    chapters: [{ index: 1, at: 0, label: 'פתיחה' }, { index: 2, at: 10, label: 'התחלה' }, { index: 3, at: 60, label: 'עריכה' }]
  });
  assert.equal(cleanInsights('not an answer', 120), null);
  assert.equal(secondsOf('1:02:03'), 3723);
});

test('the engine installed but not running is started once, then asked', async () => {
  let up = false;
  let started = 0;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(url);
    if (!up) throw new Error('refused');
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'gemma3:12b' }] }));
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gemma3:12b');
    assert.equal(body.format, 'json');
    assert.match(body.prompt, /\[00:00\] מילה0/);
    return new Response(JSON.stringify({ response: '{"title":"שם","summary":"סיכום","chapters":[{"at":"00:00","label":"פתיחה"},{"at":"00:36","label":"המשך"}]}' }));
  };
  // The path of the engine program exists only on a computer that has it: the check is skipped where it does not.
  const fs = require('node:fs');
  const program = `${process.env.LOCALAPPDATA}\\Programs\\Ollama\\ollama.exe`;
  if (!fs.existsSync(program)) {
    await assert.rejects(ensureEngine('http://127.0.0.1:11434', { fetchImpl, start: () => {} }), /לא פועל ולא נמצא/);
    return;
  }
  const result = await transcriptInsights({ wordTimings: words, duration: 120 }, { address: 'http://127.0.0.1:11434', fetchImpl, start: () => { started += 1; up = true; } });
  assert.equal(started, 1);
  assert.equal(result.title, 'שם');
  assert.deepEqual(result.chapters.map((chapter) => chapter.at), [0, 36]);
});

test('only an address on this computer is ever used', async () => {
  await assert.rejects(transcriptInsights({ wordTimings: words, duration: 120 }, { address: 'http://example.com:11434', fetchImpl: async () => { throw new Error('must not be called'); } }), /במחשב הזה|לא פועל/);
});
