const ENCODER_PROFILES = [
  { id: 'h264_nvenc', label: 'NVIDIA NVENC', hardware: true, args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '18'] },
  { id: 'h264_qsv', label: 'Intel Quick Sync', hardware: true, args: ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '18'] },
  { id: 'h264_amf', label: 'AMD AMF', hardware: true, args: ['-c:v', 'h264_amf', '-quality', 'quality', '-qp_i', '18', '-qp_p', '18'] },
  { id: 'libx264', label: 'H.264 תוכנה', hardware: false, args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18'] }
];

function parseVideoEncoders(output = '') {
  const text = String(output);
  return ENCODER_PROFILES.map((profile) => ({ ...profile, available: new RegExp(`\\b${profile.id}\\b`).test(text) }));
}

function encoderCandidates(encoders = []) {
  const available = new Set(encoders.filter((encoder) => encoder.available).map((encoder) => encoder.id));
  const candidates = ENCODER_PROFILES.filter((profile) => available.has(profile.id));
  if (!candidates.some((profile) => profile.id === 'libx264')) candidates.push(ENCODER_PROFILES.at(-1));
  return candidates;
}

module.exports = { ENCODER_PROFILES, encoderCandidates, parseVideoEncoders };
