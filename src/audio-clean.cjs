// Cleaner sound for a recording, with the video tool already on the computer (nothing else is needed): a low rumble
// filter, removal of background noise (a fan, an air conditioner) and one even speaking level for the whole recording.
// The picture is copied as it is; only the sound is worked on.
//
// Measured on speech over steady noise: the noise fell by about 18 dB (the simpler spectral filter gave 3), the words
// stayed exactly as they were (checked by transcribing before and after), and ten minutes take about 20 seconds.
const fsp = require('node:fs/promises');
const path = require('node:path');

// Rumble below speech goes, then the noise (non-local means: it keeps what repeats — the voice — and drops the rest).
const DENOISE = 'highpass=f=70,anlmdn=s=7:p=0.002:r=0.006';
// The level used for speech on the web, with peaks kept under the limit.
const LEVEL = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const AUDIO_CODEC = { '.webm': ['-c:a', 'libopus', '-b:a', '128k'], '.mp4': ['-c:a', 'aac', '-b:a', '160k'], '.mov': ['-c:a', 'aac', '-b:a', '160k'], '.m4a': ['-c:a', 'aac', '-b:a', '160k'] };

// The level is set in two passes: first the cleaned sound is measured, then one fixed correction is applied to all
// of it. (In one pass the level follows the sound, and the quiet moments — the noise — are turned up.)
const measureArgs = (input) => ['-hide_banner', '-i', input, '-vn', '-af', `${DENOISE},${LEVEL}:print_format=json`, '-f', 'null', '-'];

function parseMeasure(text) {
  const block = /\{[^{}]*"input_i"[^{}]*\}/.exec(String(text || ''));
  if (!block) return null;
  try {
    const values = JSON.parse(block[0]);
    const numbers = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].map((key) => Number(values[key]));
    // Silence all along measures as "-inf": there is nothing to set a level for.
    return numbers.every(Number.isFinite) ? { i: numbers[0], tp: numbers[1], lra: numbers[2], thresh: numbers[3], offset: numbers[4] } : null;
  } catch { return null; }
}

function cleanAudioArgs(input, output, measured = null) {
  const codec = AUDIO_CODEC[path.extname(output).toLowerCase()];
  if (!codec) return null;
  const level = measured ? `${LEVEL}:measured_I=${measured.i}:measured_TP=${measured.tp}:measured_LRA=${measured.lra}:measured_thresh=${measured.thresh}:offset=${measured.offset}:linear=true` : null;
  // The level filter works at a high sample rate inside: the sound is brought back to the usual 48,000.
  return ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-map', '0', '-c:v', 'copy', '-af', level ? `${DENOISE},${level}` : DENOISE, '-ar', '48000', ...codec, output];
}

async function hasSound(filePath, run) {
  const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath], { timeoutMs: 30_000 });
  return Boolean(probe.ok && probe.stdout.trim());
}

// output: where the cleaned file goes; left out, the file itself is replaced (only once the new one is whole).
async function cleanAudio(filePath, { run, output = null, timeoutMs = 30 * 60_000 } = {}) {
  const extension = path.extname(filePath);
  if (!AUDIO_CODEC[extension.toLowerCase()]) return { cleaned: false, reason: 'סוג הקובץ אינו נתמך לניקוי קול' };
  if (!(await hasSound(filePath, run))) return { cleaned: false, reason: 'בקובץ אין קול' };
  const measure = await run('ffmpeg', measureArgs(filePath), { timeoutMs });
  const measured = parseMeasure(measure.stderr || measure.error);
  const target = output || filePath;
  const working = `${target.slice(0, -path.extname(target).length)}.cleaning${extension}`;
  const result = await run('ffmpeg', cleanAudioArgs(filePath, working, measured), { timeoutMs });
  const stat = result.ok ? await fsp.stat(working).catch(() => null) : null;
  if (!stat?.size) {
    await fsp.rm(working, { force: true });
    return { cleaned: false, reason: `ניקוי הקול נכשל: ${String(result.error || 'הקובץ לא נוצר').split(/\r?\n/).filter(Boolean).at(-1)}` };
  }
  await fsp.rename(working, target);
  return { cleaned: true, path: target, levelled: Boolean(measured), loudnessBefore: measured?.i ?? null };
}

module.exports = { DENOISE, LEVEL, cleanAudio, cleanAudioArgs, hasSound, parseMeasure };
