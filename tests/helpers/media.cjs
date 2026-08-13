const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');

function exec(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${file} failed: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });
}

async function probe(filePath) {
  const output = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels', '-of', 'json', filePath]);
  return JSON.parse(output);
}

async function audioLevels(filePath) {
  try {
    const output = await new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', 'NUL'], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && !stderr.includes('mean_volume')) reject(error);
        else resolve(stderr);
      });
    });
    const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(output);
    const max = /max_volume:\s*(-?[\d.]+) dB/.exec(output);
    return { meanDb: mean ? Number(mean[1]) : null, maxDb: max ? Number(max[1]) : null };
  } catch {
    return { meanDb: null, maxDb: null };
  }
}

async function pngDimensions(filePath) {
  const buffer = await fs.readFile(filePath);
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('Invalid PNG signature');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), size: buffer.length };
}

module.exports = { audioLevels, pngDimensions, probe };
