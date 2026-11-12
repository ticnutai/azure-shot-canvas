// Transcription with what is already on this computer — nothing is downloaded, ever. It looks for a Python that has
// faster-whisper installed and for a Whisper model already in one of the usual model folders (Hebrew models of
// ivrit.ai first), and runs the two together in a hidden process, on the graphics card when it can.
// If nothing usable is found it says so; the studio then keeps using the transcription server, when one runs.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Best first: Hebrew models (fast, then full), then the general multilingual ones.
const MODEL_PREFERENCE = [
  'ivrit-ai--whisper-large-v3-turbo-ct2', 'ivrit-ai--faster-whisper-v2-d4', 'ivrit-ai--whisper-large-v3-ct2',
  'mobiuslabsgmbh--faster-whisper-large-v3-turbo', 'Systran--faster-whisper-large-v3', 'Systran--faster-whisper-medium', 'Systran--faster-whisper-small'
];

function modelFolders(env = process.env, home = os.homedir()) {
  return [...new Set([
    env.SCREEN_STUDIO_WHISPER_MODELS,
    path.join(home, '.cache', 'whisper-models'),
    env.HF_HUB_CACHE, env.HF_HOME && path.join(env.HF_HOME, 'hub'),
    path.join(home, '.cache', 'huggingface', 'hub')
  ].filter(Boolean))];
}

// A finished model: a snapshot folder with its weights and its settings (a cut download has no weights).
function completeSnapshot(modelFolder) {
  const snapshots = path.join(modelFolder, 'snapshots');
  let names = [];
  try { names = fs.readdirSync(snapshots); } catch { return null; }
  for (const name of names) {
    const folder = path.join(snapshots, name);
    try {
      const weights = fs.statSync(fs.realpathSync(path.join(folder, 'model.bin')));
      if (weights.size > 50 * 1024 * 1024 && fs.existsSync(path.join(folder, 'config.json'))) return folder;
    } catch {}
  }
  return null;
}

function findModel(folders = modelFolders()) {
  for (const wanted of MODEL_PREFERENCE) {
    for (const root of folders) {
      const found = completeSnapshot(path.join(root, `models--${wanted}`));
      if (found) return { name: wanted.split('--')[1], path: found };
    }
  }
  return null;
}

function pythonCandidates(env = process.env) {
  const base = path.join(env.LOCALAPPDATA || '', 'Programs', 'Python');
  let installed = [];
  try { installed = fs.readdirSync(base).filter((name) => /^Python3\d+$/i.test(name)).sort().reverse().map((name) => path.join(base, name, 'python.exe')); } catch {}
  return [...new Set([env.SCREEN_STUDIO_PYTHON, ...installed, 'C:\\Program Files\\Python313\\python.exe', 'C:\\Program Files\\Python312\\python.exe'].filter((file) => file && fs.existsSync(file)))];
}

// The worker, written next to the program's data (Python cannot read it from inside the packed program).
const WORKER = String.raw`
import json, os, sys, importlib.util
# The graphics card's libraries installed with Python (nvidia-cublas, nvidia-cudnn) are not on the search path by
# themselves: their folders are added, so the card is used instead of the slower processor.
for package in ("nvidia.cublas", "nvidia.cudnn", "nvidia.cuda_runtime"):
    try:
        spec = importlib.util.find_spec(package)
    except Exception:
        spec = None
    for location in (spec.submodule_search_locations if spec else None) or []:
        folder = os.path.join(location, "bin")
        if os.path.isdir(folder):
            os.add_dll_directory(folder)
            os.environ["PATH"] = folder + os.pathsep + os.environ.get("PATH", "")
from faster_whisper import WhisperModel
model_path, media, language = sys.argv[1], sys.argv[2], sys.argv[3]
model = None
for device, compute in (("cuda", "float16"), ("cpu", "int8")):
    try:
        model = WhisperModel(model_path, device=device, compute_type=compute)
        segments, info = model.transcribe(media, language=language or None, word_timestamps=True, vad_filter=True, beam_size=5)
        words, texts = [], []
        for segment in segments:
            texts.append(segment.text.strip())
            for word in segment.words or []:
                words.append({"word": word.word.strip(), "start": round(word.start, 3), "end": round(word.end, 3)})
            print(json.dumps({"progress": round(segment.end / max(info.duration, 0.01), 3)}), file=sys.stderr, flush=True)
        print(json.dumps({"text": " ".join(texts), "duration": info.duration, "language": info.language, "device": device, "wordTimings": words}, ensure_ascii=False))
        sys.exit(0)
    except SystemExit:
        raise
    except Exception as error:
        last = error
        model = None
print(json.dumps({"error": str(last)}), file=sys.stderr)
sys.exit(2)
`;

class LocalTranscriber {
  // run(command, args, options) → { ok, stdout, error }: the program's hidden runner.
  constructor({ run, workDirectory }) {
    Object.assign(this, { run, workDirectory });
    this.found = null;
  }

  // Looked for once (a few quick checks); `again` looks anew (after the user installed something).
  async find(again = false) {
    if (this.found && !again) return this.found;
    const model = findModel();
    let python = null;
    for (const candidate of pythonCandidates()) {
      // Only whether the library is there — loading it takes many seconds, and this runs when the tools page opens.
      if ((await this.run(candidate, ['-c', 'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec("faster_whisper") else 1)'], { timeoutMs: 15_000 })).ok) { python = candidate; break; }
    }
    this.found = { available: Boolean(model && python), python, model };
    return this.found;
  }

  async transcribe(filePath, { language = 'he', timeoutMs = 3 * 3_600_000 } = {}) {
    const { available, python, model } = await this.find();
    if (!available) throw new Error('לא נמצא במחשב מנוע תמלול מקומי');
    await fsp.mkdir(this.workDirectory, { recursive: true });
    const worker = path.join(this.workDirectory, 'transcribe-worker.py');
    await fsp.writeFile(worker, WORKER, 'utf8');
    const result = await this.run(python, [worker, model.path, filePath, language], { timeoutMs, env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1' } });
    if (!result.ok) throw new Error(`התמלול המקומי נכשל: ${String(result.error || '').split(/\r?\n/).filter(Boolean).at(-1) || 'סיבה לא ידועה'}`);
    const parsed = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    return { ...parsed, model: model.name };
  }
}

module.exports = { LocalTranscriber, MODEL_PREFERENCE, completeSnapshot, findModel, modelFolders, pythonCandidates };
