// FFmpeg (the video tool behind GIF export, MP4, auto zoom, silence removal, captions burned in, thumbnails…).
// When it is installed on the computer it is used as it is. Otherwise it is downloaded once, on the user's request,
// from a fixed release (Gyan's Windows builds, the ones linked from ffmpeg.org), checked against its known
// fingerprint, unpacked into the program's data folder, and put first on the search path of this program only.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AiModel } = require('./ai-model.cjs');

const VIDEO_TOOLS = Object.freeze({
  version: '9.0.2',
  file: 'ffmpeg-9.0.2-essentials_build.zip',
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
  sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
  size: 114768076,
  inside: 'ffmpeg-9.0.2-essentials_build/bin'
});

class VideoTools {
  // run(command, args) → { ok }: the program's hidden runner. tar: Windows' own unpacker (it reads zip files).
  constructor({ directory, fetchImpl, run, tools = VIDEO_TOOLS, tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') }) {
    Object.assign(this, { directory, run, tools, tar });
    this.download = this.download.bind(this);
    this.archive = new AiModel({ directory, fetchImpl, model: tools });
    this.binDirectory = path.join(directory, 'video-tools', tools.version);
    this.fromComputer = null; // known after activate()
    this.active = false;
  }

  async ready() {
    const found = await Promise.all(['ffmpeg.exe', 'ffprobe.exe'].map((name) => fsp.stat(path.join(this.binDirectory, name)).then((stat) => stat.size > 0, () => false)));
    return found.every(Boolean);
  }

  async status() {
    return { installedOnComputer: Boolean(this.fromComputer), downloaded: await this.ready(), active: this.active || Boolean(this.fromComputer), downloading: Boolean(this.archive.downloading || this.unpacking), size: this.tools.size, version: this.tools.version };
  }

  // Called once at start and after a download: uses the computer's own copy when there is one.
  async activate() {
    if (this.fromComputer === null) this.fromComputer = (await this.run('ffmpeg', ['-version'])).ok;
    if (this.fromComputer || this.active || !(await this.ready())) return this.status();
    process.env.PATH = `${this.binDirectory}${path.delimiter}${process.env.PATH || ''}`;
    this.active = true;
    return this.status();
  }

  download(onProgress = () => {}) {
    if (!this.unpacking) {
      this.unpacking = (async () => {
        if (!(await this.ready())) {
          await this.archive.download(onProgress);
          await fsp.mkdir(this.binDirectory, { recursive: true });
          const unpacked = await this.run(this.tar, ['-xf', this.archive.filePath, '-C', this.binDirectory, '--strip-components', '2', `${this.tools.inside}/ffmpeg.exe`, `${this.tools.inside}/ffprobe.exe`]);
          if (!unpacked.ok || !(await this.ready())) throw new Error('פתיחת הקובץ שהורד נכשלה');
          await fsp.rm(this.archive.filePath, { force: true }); // the unpacked tools are kept; the archive is not needed
        }
        return this.activate();
      })().finally(() => { this.unpacking = null; });
    }
    return this.unpacking;
  }
}

module.exports = { VIDEO_TOOLS, VideoTools };
