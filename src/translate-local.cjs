// Translation of a text with the language engine that runs on this computer (Ollama's local interface). Nothing
// leaves the machine: only a loopback address is ever used, and no setting can point it elsewhere.
const { loopbackAddress } = require('./features-defs.js');

const LANGUAGE_NAMES = { 'עברית': 'Hebrew', 'אנגלית': 'English', 'ערבית': 'Arabic', 'רוסית': 'Russian', 'צרפתית': 'French', 'ספרדית': 'Spanish', 'גרמנית': 'German' };
const MAX_CHARACTERS = 6000;

class EngineError extends Error {}

function baseAddress(address) {
  const base = loopbackAddress(address);
  if (!base) throw new EngineError('כתובת המנוע חייבת להיות במחשב הזה');
  return base;
}

async function request(url, { method = 'GET', body = null, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method, signal: controller.signal, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new EngineError(`המנוע ענה בשגיאה (${response.status})`);
    return await response.json();
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError(error?.name === 'AbortError' ? 'המנוע לא ענה בזמן' : 'מנוע התרגום המקומי לא פועל');
  } finally { clearTimeout(timer); }
}

// Names of the models installed in the engine.
async function listModels(address, options = {}) {
  const data = await request(`${baseAddress(address)}/api/tags`, options);
  return (Array.isArray(data.models) ? data.models : []).map((model) => String(model.name || model.model || '')).filter(Boolean);
}

async function translateText(text, { address, model = '', target = 'עברית', fetchImpl = fetch, timeoutMs = 90_000 } = {}) {
  const clean = String(text || '').trim().slice(0, MAX_CHARACTERS);
  if (!clean) throw new EngineError('אין טקסט לתרגום');
  const base = baseAddress(address);
  let chosen = String(model || '').trim();
  if (!chosen) {
    const models = await listModels(address, { fetchImpl });
    if (!models.length) throw new EngineError('במנוע המקומי לא מותקן אף מודל שפה');
    chosen = models[0];
  }
  const language = LANGUAGE_NAMES[target] || 'Hebrew';
  const prompt = `Translate the following text into ${language}. Reply with the translation only, with no explanation and no quotation marks.\n\n${clean}`;
  const data = await request(`${base}/api/generate`, { method: 'POST', body: { model: chosen, prompt, stream: false, options: { temperature: 0 } }, fetchImpl, timeoutMs });
  const translated = String(data.response || '').trim();
  if (!translated) throw new EngineError('המנוע לא החזיר תרגום');
  return { text: translated, model: chosen };
}

module.exports = { EngineError, LANGUAGE_NAMES, listModels, translateText };
