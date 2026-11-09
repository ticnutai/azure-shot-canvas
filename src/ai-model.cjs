// The model for erasing with artificial intelligence (MI-GAN by Picsart AI Research, MIT license): downloaded once, on the
// user's request, into the program's data folder, and checked against its known fingerprint before it is used. Nothing
// is sent anywhere: the picture never leaves the computer; only the model file is fetched.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MODEL = Object.freeze({
  file: 'migan_pipeline_v2.onnx',
  url: 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
  sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
  size: 28079181
});

class AiModel {
  // fetchImpl: a fetch that follows redirects (Electron's net.fetch in the program, the global one in checks).
  constructor({ directory, fetchImpl, model = MODEL }) {
    Object.assign(this, { directory, fetchImpl, model });
    this.downloading = null;
  }

  get filePath() { return path.join(this.directory, 'models', this.model.file); }

  async status() {
    const stat = await fsp.stat(this.filePath).catch(() => null);
    return { ready: Boolean(stat && stat.size === this.model.size), downloading: Boolean(this.downloading), size: this.model.size };
  }

  // One download at a time; a second request joins the first. onProgress(received, total).
  download(onProgress = () => {}) {
    if (!this.downloading) this.downloading = this.fetchModel(onProgress).finally(() => { this.downloading = null; });
    return this.downloading;
  }

  async fetchModel(onProgress) {
    if ((await this.status()).ready) return { ready: true };
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const partial = `${this.filePath}.partial`;
    const response = await this.fetchImpl(this.model.url);
    if (!response.ok || !response.body) throw new Error(`ההורדה נכשלה (קוד ${response.status})`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(partial);
    let received = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve));
        onProgress(received, this.model.size);
      }
      await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    } catch (error) {
      out.destroy();
      await fsp.rm(partial, { force: true });
      throw error;
    }
    if (hash.digest('hex') !== this.model.sha256) {
      await fsp.rm(partial, { force: true });
      throw new Error('הקובץ שהורד אינו הקובץ הנכון, ולכן נמחק');
    }
    await fsp.rename(partial, this.filePath);
    return { ready: true };
  }

  async read() {
    if (!(await this.status()).ready) throw new Error('המודל עוד לא הורד');
    return fsp.readFile(this.filePath);
  }
}

module.exports = { AiModel, MODEL };
