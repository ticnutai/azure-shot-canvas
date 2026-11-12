const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanAudio, cleanAudioArgs, parseMeasure } = require('../src/audio-clean.cjs');
const { runHidden } = require('../src/studio-tools.cjs');

test('the level measure is read from the tool output; silence gives nothing to level', () => {
  const text = 'frame= 1\n[Parsed_loudnorm_2 @ 0x1]\n{\n"input_i" : "-31.62",\n"input_tp" : "-12.10",\n"input_lra" : "2.30",\n"input_thresh" : "-41.80",\n"output_i" : "-16.1",\n"target_offset" : "0.12"\n}\n';
  assert.deepEqual(parseMeasure(text), { i: -31.62, tp: -12.1, lra: 2.3, thresh: -41.8, offset: 0.12 });
  assert.equal(parseMeasure(text.replace('-31.62', '-inf')), null);
  assert.equal(parseMeasure('no numbers here'), null);
});

test('the picture is copied, the sound gets the codec of its file type, other types are refused', () => {
  const args = cleanAudioArgs('in.webm', 'out.webm', { i: -30, tp: -10, lra: 3, thresh: -40, offset: 0.1 });
  assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'copy']);
  assert.ok(args.includes('libopus'));
  assert.match(args[args.indexOf('-af') + 1], /measured_I=-30.*linear=true/);
  assert.ok(cleanAudioArgs('in.mp4', 'out.mp4').includes('aac'));
  assert.equal(cleanAudioArgs('in.gif', 'out.gif'), null);
});

test('a real noisy recording: speech brought to the usual level, the noise between words lower than before', async (context) => {
  if (!(await runHidden('ffmpeg', ['-version'])).ok) return context.skip('the video tool is not on this computer');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-sound-'));
  const input = path.join(folder, 'noisy.mp4');
  // Six seconds: a quiet tone standing in for speech from the second second to the fifth, steady noise all along.
  const made = await runHidden('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=160x120:r=10:d=6', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.03:d=6',
    '-filter_complex', '[1:a]volume=0.2,adelay=2000|2000,apad=whole_dur=6[s];[s][2:a]amix=inputs=2:normalize=0[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'aac', '-t', '6', input], { timeoutMs: 60_000 });
  assert.ok(made.ok, made.error);
  const output = path.join(folder, 'clean.mp4');
  const meanAfter = async (file, from) => Number(/mean_volume: (-?[\d.]+)/.exec((await runHidden('ffmpeg', ['-hide_banner', '-ss', String(from), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])).stderr)?.[1]);
  const loudness = async (file) => Number([...(await runHidden('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128', '-f', 'null', '-'])).stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
  const before = { noise: await meanAfter(input, 5.3), loudness: await loudness(input) };
  const result = await cleanAudio(input, { run: runHidden, output });
  assert.equal(result.cleaned, true);
  assert.equal(result.levelled, true);
  const after = { noise: await meanAfter(output, 5.3), loudness: await loudness(output) };
  assert.ok(Math.abs(after.loudness + 16) < 2.5, `the level is near -16: ${after.loudness}`);
  // The sound was turned up by (after - before) loudness; the noise must have risen much less than that.
  const turnedUp = after.loudness - before.loudness;
  assert.ok(after.noise - before.noise < turnedUp - 8, `noise ${before.noise} → ${after.noise}, level up ${turnedUp}`);
  assert.ok(fs.existsSync(input), 'the original is kept');
  assert.equal(fs.readdirSync(folder).some((name) => name.includes('.cleaning')), false);
  fs.rmSync(folder, { recursive: true, force: true });
});

test('a file with no sound is left alone, with the reason', async (context) => {
  if (!(await runHidden('ffmpeg', ['-version'])).ok) return context.skip('the video tool is not on this computer');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-sound-'));
  const input = path.join(folder, 'silent.mp4');
  await runHidden('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=160x120:r=10:d=1', '-c:v', 'libx264', input], { timeoutMs: 60_000 });
  assert.deepEqual(await cleanAudio(input, { run: runHidden }), { cleaned: false, reason: 'בקובץ אין קול' });
  fs.rmSync(folder, { recursive: true, force: true });
});
