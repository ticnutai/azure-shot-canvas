// Reading text from pictures. When the separate Tesseract program is installed it is used (it is a little faster);
// otherwise the same engine built into the program (tesseract.js, Apache-2.0) does the work, so reading text,
// smart redact, translation and the text index work on every computer with nothing else installed.
// The language files (Hebrew and English) come with the program, in src/tessdata.
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');

let worker = null; // the engine, ready to read
let starting = null;
let idleTimer = null;
const IDLE_MS = 90_000; // the built-in engine is let go after a while unused (it holds tens of megabytes)
const READ_LIMIT_MS = 120_000;

// The engine listens for its background worker's failures the browser way (worker.onerror), which a Node worker never
// calls: a failure would be an uncaught error that brings the whole program down. Its worker is started here instead,
// with failures passed on and the engine let go, so a failed reading is only a failed reading.
const spawnPath = require.resolve('tesseract.js/src/worker/node/spawnWorker.js');
require.cache[spawnPath] = {
  id: spawnPath,
  filename: spawnPath,
  loaded: true,
  exports: ({ workerPath }) => {
    const background = new Worker(workerPath);
    background.on('error', (error) => {
      worker = null;
      background.terminate().catch(() => {});
      if (typeof background.onerror === 'function') background.onerror(error);
    });
    return background;
  }
};

async function builtInWorker(tessdataDirectory) {
  clearTimeout(idleTimer);
  if (worker) return worker;
  if (!starting) {
    starting = (async () => {
      const { createWorker, OEM } = require('tesseract.js');
      // In the installed program the engine's files sit beside the packed program (see asarUnpack in package.json):
      // its background worker is started from there, where it can find the files it needs.
      const workerPath = require.resolve('tesseract.js/src/worker-script/node/index.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      worker = await createWorker(['heb', 'eng'], OEM.LSTM_ONLY, {
        workerPath,
        langPath: tessdataDirectory,
        cachePath: tessdataDirectory,
        cacheMethod: 'none',
        gzip: false
      });
      return worker;
    })().finally(() => { starting = null; });
  }
  return starting;
}

async function stopBuiltIn() {
  clearTimeout(idleTimer);
  const finished = worker;
  worker = null;
  await finished?.terminate().catch(() => {});
}

function releaseLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stopBuiltIn, IDLE_MS);
  idleTimer.unref?.();
}

const withLimit = (promise) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { stopBuiltIn(); reject(new Error('זיהוי הטקסט לקח יותר מדי זמן')); }, READ_LIMIT_MS);
  promise.then(resolve, reject).finally(() => clearTimeout(timer));
});

// mode 'text': the text of the picture as lines. mode 'words': Tesseract's word table (TSV), for smart redact.
async function recognizeBuiltIn(filePath, { tessdataDirectory, mode = 'text' } = {}) {
  try {
    return await withLimit((async () => {
      const engine = await builtInWorker(tessdataDirectory);
      // Screenshots: a block of text for reading, scattered pieces of text when looking for words to hide.
      await engine.setParameters({ tessedit_pageseg_mode: mode === 'words' ? '11' : '6', preserve_interword_spaces: '1' });
      const { data } = await engine.recognize(filePath, {}, { text: true, tsv: mode === 'words' });
      return mode === 'words' ? data.tsv || '' : (data.text || '').trim();
    })());
  } catch (error) {
    throw new Error(`זיהוי הטקסט נכשל: ${error?.message || error}`);
  } finally {
    releaseLater();
  }
}

const hasProgram = (command) => {
  try { return fs.statSync(command).isFile(); } catch { return false; }
};

module.exports = { hasProgram, recognizeBuiltIn, stopBuiltIn };
