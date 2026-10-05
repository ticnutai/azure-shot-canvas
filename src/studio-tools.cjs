const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_TRANSCRIPTION_URL = 'http://127.0.0.1:3000';

function existingExecutable(name) {
  if (process.platform !== 'win32') return name;
  if (name === 'tesseract') return process.env.SCREEN_STUDIO_TESSERACT_PATH || 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
  return name;
}

function runHidden(command, args, options = {}) {
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 30_000);
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, { windowsHide: true, env: options.env || process.env });
    let stdout = '';
    let stderr = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, stdout, error: `Timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => finish({ ok: false, stdout, error: error.message }));
    child.on('close', (code) => finish(code === 0
      ? { ok: true, stdout, stderr }
      : { ok: false, stdout, error: stderr || `${command} exited with ${code}` }));
  });
}

async function fetchJson(url, options = {}, timeoutMs = 2_500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  } finally { clearTimeout(timer); }
}

async function discoverLocalEngines(options = {}) {
  const ffmpeg = await runHidden('ffmpeg', ['-version'], { timeoutMs: 4_000 });
  const ffprobe = await runHidden('ffprobe', ['-version'], { timeoutMs: 4_000 });
  const tesseractCommand = existingExecutable('tesseract');
  const tesseract = await runHidden(tesseractCommand, ['--version'], { timeoutMs: 4_000 });
  const languages = tesseract.ok ? await runHidden(tesseractCommand, ['--list-langs'], { timeoutMs: 4_000 }) : { ok: false, stdout: '' };
  const transcriptionUrl = options.transcriptionUrl || DEFAULT_TRANSCRIPTION_URL;
  let whisper = null;
  try { whisper = await fetchJson(`${transcriptionUrl}/health`, {}, 2_500); } catch {}
  return {
    ffmpeg: { available: ffmpeg.ok, version: ffmpeg.stdout.split(/\r?\n/)[0] || null },
    ffprobe: { available: ffprobe.ok, version: ffprobe.stdout.split(/\r?\n/)[0] || null },
    ocr: { available: tesseract.ok, languages: languages.stdout.split(/\r?\n/).filter((line) => /^[a-z]{3}$/i.test(line.trim())).map((line) => line.trim()) },
    transcription: { available: Boolean(whisper), url: transcriptionUrl, model: whisper?.current_model || whisper?.model || null },
    duplicatePolicy: 'reuse-existing-only'
  };
}

function rationalNumber(value) {
  if (typeof value === 'number') return value;
  const [numerator, denominator] = String(value || '0').split('/').map(Number);
  return denominator ? numerator / denominator : numerator || 0;
}

function qualitySummary(probe) {
  const streams = probe.streams || [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format?.duration || video?.duration || audio?.duration || 0);
  const fps = rationalNumber(video?.avg_frame_rate || video?.r_frame_rate);
  const frameCount = Number(video?.nb_read_frames || video?.nb_frames || 0);
  const expectedFrames = duration > 0 && fps > 0 ? Math.round(duration * fps) : 0;
  const droppedEstimate = frameCount && expectedFrames ? Math.max(0, expectedFrames - frameCount) : null;
  const starts = [video, audio].filter(Boolean).map((stream) => Number(stream.start_time || 0));
  const avSyncOffsetMs = starts.length === 2 ? Math.round(Math.abs(starts[0] - starts[1]) * 1000) : null;
  const scoreDeductions = (droppedEstimate ? Math.min(25, droppedEstimate) : 0) + (avSyncOffsetMs ? Math.min(25, Math.floor(avSyncOffsetMs / 20)) : 0);
  return {
    durationSeconds: Number(duration.toFixed(3)), width: video?.width || null, height: video?.height || null,
    fps: Number(fps.toFixed(3)), videoCodec: video?.codec_name || null, audioCodec: audio?.codec_name || null,
    audioChannels: audio?.channels || 0, bitRate: Number(probe.format?.bit_rate || 0), frameCount: frameCount || null,
    expectedFrames: expectedFrames || null, droppedFramesEstimate: droppedEstimate, avSyncOffsetMs,
    score: Math.max(0, 100 - scoreDeductions), valid: Boolean(video && duration > 0)
  };
}

// Header-only probe is near-instant; frame counting decodes the whole file, so its timeout scales with duration.
async function analyzeMedia(filePath, { countFrames = true, persist = true } = {}) {
  const probeArgs = ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath];
  const quick = await runHidden('ffprobe', probeArgs, { timeoutMs: 30_000 });
  if (!quick.ok) throw new Error(`בדיקת המדיה נכשלה: ${quick.error}`);
  let probe = JSON.parse(quick.stdout);
  const headerDuration = Number(probe.format?.duration) || 0;
  if (countFrames || !headerDuration) {
    const timeoutMs = Math.min(15 * 60_000, Math.max(30_000, headerDuration * 250 + 15_000));
    const counted = await runHidden('ffprobe', ['-count_frames', ...probeArgs], { timeoutMs });
    if (counted.ok) probe = JSON.parse(counted.stdout);
    else if (!headerDuration) throw new Error(`בדיקת המדיה נכשלה: ${counted.error}`);
  }
  const quality = { ...qualitySummary(probe), analyzedAt: new Date().toISOString() };
  if (persist) await fs.writeFile(`${filePath}.quality.json`, JSON.stringify(quality, null, 2), 'utf8');
  return quality;
}

function srtTimestamp(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const ms = total % 1000;
  const whole = Math.floor(total / 1000);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function wordsToSrt(words = [], maxWords = 9) {
  const blocks = [];
  for (let index = 0; index < words.length; index += maxWords) {
    const group = words.slice(index, index + maxWords);
    if (!group.length) continue;
    blocks.push(`${blocks.length + 1}\n${srtTimestamp(group[0].start)} --> ${srtTimestamp(group.at(-1).end)}\n${group.map((item) => item.word).join(' ').trim()}`);
  }
  return `${blocks.join('\n\n')}\n`;
}

async function transcribeMedia(filePath, options = {}) {
  const baseUrl = options.transcriptionUrl || DEFAULT_TRANSCRIPTION_URL;
  const health = await fetchJson(`${baseUrl}/health`, {}, 3_000).catch(() => null);
  if (!health) throw new Error('מנוע התמלול המקומי הקיים אינו פעיל');
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes]), path.basename(filePath));
  form.append('language', options.language || 'he');
  form.append('normalize', '0');
  const result = await fetchJson(`${baseUrl}/transcribe`, { method: 'POST', body: form }, options.timeoutMs || 3_600_000);
  const transcript = { ...result, sourcePath: filePath, createdAt: new Date().toISOString(), engineUrl: baseUrl };
  const transcriptPath = `${filePath}.transcript.json`;
  const srtPath = `${filePath}.srt`;
  await fs.writeFile(transcriptPath, JSON.stringify(transcript, null, 2), 'utf8');
  await fs.writeFile(srtPath, wordsToSrt(result.wordTimings || []), 'utf8');
  return { text: result.text || '', transcriptPath, srtPath, wordCount: (result.wordTimings || []).length, duration: result.duration || 0 };
}

async function runOcr(filePath, options = {}) {
  const language = options.language || 'heb+eng';
  const args = [filePath, 'stdout', '-l', language, '--psm', '6'];
  if (options.tessdataDirectory) args.push('--tessdata-dir', options.tessdataDirectory);
  const tesseractCommand = existingExecutable('tesseract');
  let result = await runHidden(tesseractCommand, args, { timeoutMs: 120_000 });
  if (!result.ok && language.includes('heb')) result = await runHidden(tesseractCommand, [filePath, 'stdout', '-l', 'eng', '--psm', '6'], { timeoutMs: 120_000 });
  if (!result.ok) throw new Error(`OCR נכשל: ${result.error}`);
  return { text: result.stdout.trim(), language: result.stdout.trim() ? (language.includes('heb') && !/Failed loading language 'heb'/.test(result.error || '') ? language : 'eng') : language };
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.srt': 'text/plain; charset=utf-8' })[extension] || 'application/octet-stream';
}

class PrivateShareServer {
  constructor() { this.server = null; this.port = null; this.shares = new Map(); }
  async start() {
    if (this.server) return this.port;
    this.server = http.createServer(async (request, response) => {
      const token = String(request.url || '').match(/^\/share\/([a-f0-9]+)$/)?.[1];
      const share = token && this.shares.get(token);
      if (!share || share.expiresAt < Date.now()) { response.writeHead(404); response.end('Expired or unavailable'); return; }
      try {
        const stat = await fs.stat(share.filePath);
        response.writeHead(200, { 'Content-Type': contentType(share.filePath), 'Content-Length': stat.size, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(share.filePath))}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        require('node:fs').createReadStream(share.filePath).pipe(response);
      } catch { response.writeHead(404); response.end('Unavailable'); }
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = this.server.address().port;
    return this.port;
  }
  async share(filePath, ttlMinutes = 30) {
    const port = await this.start();
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + Math.max(1, Math.min(1440, Number(ttlMinutes) || 30)) * 60_000;
    this.shares.set(token, { filePath, expiresAt });
    return { url: `http://127.0.0.1:${port}/share/${token}`, expiresAt, private: true, localOnly: true };
  }
  stop() { if (this.server) this.server.close(); this.server = null; this.port = null; this.shares.clear(); }
}

module.exports = { DEFAULT_TRANSCRIPTION_URL, PrivateShareServer, analyzeMedia, discoverLocalEngines, existingExecutable, qualitySummary, rationalNumber, runHidden, runOcr, srtTimestamp, transcribeMedia, wordsToSrt };
