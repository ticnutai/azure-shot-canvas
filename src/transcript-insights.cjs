// From a recording's transcript: a suggested name, a short summary and chapters with their times. The work is done
// by the language engine already on this computer (Ollama, the one the translation extra uses) with a model already
// installed in it — Hebrew models first. Nothing is downloaded and nothing leaves the computer. When the engine is
// installed but not running, it is started (hidden) and left running.
const fs = require('node:fs');
const path = require('node:path');
const { EngineError, baseAddress, listModels, request } = require('./translate-local.cjs');

// Best first for Hebrew text; models that only translate or only make search vectors are never used.
const PREFERRED = [/dicta/i, /gemma3:(12|27)b/i, /qwen3/i, /gemma3/i, /llama3|mistral|phi/i];
const NOT_FOR_WRITING = /embed|translategemma|whisper|rerank/i;

function chooseModel(models, wanted = '') {
  const usable = models.filter((name) => !NOT_FOR_WRITING.test(name));
  if (wanted && models.includes(wanted)) return wanted;
  for (const pattern of PREFERRED) {
    const found = usable.find((name) => pattern.test(name));
    if (found) return found;
  }
  return usable[0] || null;
}

const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const secondsOf = (text) => {
  const parts = String(text ?? '').trim().split(':').map(Number);
  if (!parts.length || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

// The transcript as lines that each start with their time, about every twenty seconds. A long transcript is thinned
// evenly (every second or third line) so the whole recording is still covered.
function timedLines(words = [], { everySeconds = null, maxCharacters = 14_000 } = {}) {
  // Short recordings get a time every few seconds, so a chapter can start where its subject really starts.
  const length = Number(words.at(-1)?.end) || 0;
  everySeconds = everySeconds || (length < 120 ? 6 : length < 900 ? 12 : 25);
  const lines = [];
  let current = null;
  for (const word of words) {
    const text = String(word.word || '').trim();
    if (!text) continue;
    if (!current || word.start - current.at >= everySeconds) { current = { at: Number(word.start) || 0, words: [] }; lines.push(current); }
    current.words.push(text);
  }
  let rendered = lines.map((line) => `[${clock(line.at)}] ${line.words.join(' ')}`);
  for (let step = 2; rendered.join('\n').length > maxCharacters && step < 40; step += 1) rendered = lines.filter((_line, index) => index % step === 0).map((line) => `[${clock(line.at)}] ${line.words.join(' ')}`);
  return rendered.join('\n');
}

function buildPrompt(lines, duration) {
  const chapters = duration < 90 ? 'בין 1 ל־2' : duration < 600 ? 'בין 2 ל־5' : 'בין 4 ל־10';
  return `לפניך תמלול של הקלטת מסך. כל שורה מתחילה בזמן שלה בסוגריים מרובעים, בדקות ושניות.
משך ההקלטה: ${clock(duration)}.

כתוב בעברית:
1. title — שם קצר וברור להקלטה, עד 8 מילים, בלי סימני פיסוק מיוחדים.
2. summary — סיכום של 2 עד 4 משפטים: על מה ההקלטה ומה מוסבר בה.
3. chapters — ${chapters} פרקים לפי הנושאים, לפי הסדר. לכל פרק: at — הזמן שבו הוא מתחיל, בדיוק כפי שמופיע באחת השורות (דקות:שניות); label — שם קצר, עד 6 מילים. הפרק הראשון מתחיל ב־00:00.

ענה אך ורק בפורמט הזה, בלי שום טקסט נוסף:
{"title":"...","summary":"...","chapters":[{"at":"00:00","label":"..."}]}

התמלול:
${lines}`;
}

// What came back, kept only when it makes sense: times inside the recording, in order, no doubles.
function cleanInsights(raw, duration) {
  let data = raw;
  if (typeof raw === 'string') {
    const block = /\{[\s\S]*\}/.exec(raw);
    try { data = JSON.parse(block ? block[0] : raw); } catch { data = null; }
  }
  if (!data || typeof data !== 'object') return null;
  const title = String(data.title || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const summary = String(data.summary || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  const chapters = [];
  for (const chapter of Array.isArray(data.chapters) ? data.chapters : []) {
    const at = typeof chapter?.at === 'number' ? chapter.at : secondsOf(chapter?.at);
    const label = String(chapter?.label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (at === null || !label || at > Math.max(0, duration - 1)) continue;
    if (chapters.length && at <= chapters.at(-1).at) continue;
    chapters.push({ at, label });
  }
  if (chapters.length && chapters[0].at > 5) chapters.unshift({ at: 0, label: 'פתיחה' }); else if (chapters.length) chapters[0].at = 0;
  if (!title && !summary) return null;
  return { title, summary, chapters: chapters.slice(0, 12).map((chapter, index) => ({ index: index + 1, ...chapter })) };
}

// The engine answering, starting it when it is installed but not running. `start(programPath)` runs it hidden.
async function ensureEngine(address, { fetchImpl = fetch, start = null, env = process.env, waitMs = 60_000 } = {}) {
  const tryList = () => listModels(address, { fetchImpl, timeoutMs: 2500 });
  try { return await tryList(); } catch {}
  const program = [path.join(env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'), 'C:\\Program Files\\Ollama\\ollama.exe'].find((file) => fs.existsSync(file));
  if (!program || !start) throw new EngineError('מנוע השפה המקומי לא פועל ולא נמצא במחשב');
  start(program);
  for (const deadline = Date.now() + waitMs; Date.now() < deadline;) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    try { return await tryList(); } catch {}
  }
  throw new EngineError('מנוע השפה המקומי הופעל אבל לא ענה בזמן');
}

// transcript: { wordTimings: [{ word, start, end }], duration }.
async function transcriptInsights(transcript, { address, model = '', fetchImpl = fetch, start = null, timeoutMs = 10 * 60_000 } = {}) {
  const words = Array.isArray(transcript?.wordTimings) ? transcript.wordTimings : [];
  if (words.length < 5) throw new EngineError('התמלול קצר מדי לסיכום');
  const duration = Number(transcript.duration) || Number(words.at(-1).end) || 0;
  const models = await ensureEngine(address, { fetchImpl, start });
  const chosen = chooseModel(models, String(model || '').trim());
  if (!chosen) throw new EngineError('במנוע השפה המקומי אין מודל שמתאים לכתיבה');
  const data = await request(`${baseAddress(address)}/api/generate`, {
    method: 'POST', fetchImpl, timeoutMs,
    body: { model: chosen, prompt: buildPrompt(timedLines(words), duration), stream: false, format: 'json', options: { temperature: 0.2, num_ctx: 8192 } }
  });
  const insights = cleanInsights(data.response, duration);
  if (!insights) throw new EngineError('מנוע השפה לא החזיר סיכום שאפשר להשתמש בו');
  return { ...insights, model: chosen, duration };
}

module.exports = { buildPrompt, chooseModel, cleanInsights, ensureEngine, secondsOf, timedLines, transcriptInsights };
