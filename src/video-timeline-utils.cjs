(function exposeTimeline(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AurumTimeline = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));
const id = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

function normalizeTimelineProject(candidate = {}, duration = 0) {
  const maximum = Math.max(0.1, Number(duration) || 0.1);
  const clips = (Array.isArray(candidate.clips) && candidate.clips.length ? candidate.clips : [{ start: 0, end: maximum }])
    .slice(0, 200)
    .map((clip, index) => {
      const start = clamp(clip.start, 0, maximum - 0.04);
      const end = clamp(clip.end || maximum, start + 0.04, maximum);
      return { id: String(clip.id || id('clip')), order: index, start, end, transition: ['none', 'fade', 'black'].includes(clip.transition) ? clip.transition : 'none', transitionDuration: clamp(clip.transitionDuration || 0.25, 0.05, Math.min(1, (end - start) / 3)) };
    })
    .filter((clip) => clip.end - clip.start >= 0.04);
  const captions = (Array.isArray(candidate.captions) ? candidate.captions : []).slice(0, 500).map((caption) => ({
    id: String(caption.id || id('caption')), text: String(caption.text || '').trim().slice(0, 300),
    start: clamp(caption.start, 0, maximum), end: clamp(caption.end || Number(caption.start) + 2, Number(caption.start) + 0.1, maximum),
    x: clamp(caption.x ?? 0.5, 0.05, 0.95), y: clamp(caption.y ?? 0.84, 0.05, 0.95)
  })).filter((caption) => caption.text && caption.end > caption.start);
  const zooms = (Array.isArray(candidate.zooms) ? candidate.zooms : []).slice(0, 200).map((zoom) => ({
    id: String(zoom.id || id('zoom')), start: clamp(zoom.start, 0, maximum), end: clamp(zoom.end || Number(zoom.start) + 1.5, Number(zoom.start) + 0.1, maximum),
    scale: clamp(zoom.scale || 1.6, 1, 3), x: clamp(zoom.x ?? 0.5, 0, 1), y: clamp(zoom.y ?? 0.5, 0, 1)
  })).filter((zoom) => zoom.end > zoom.start);
  return { version: 1, duration: maximum, clips, captions, zooms, preset: ['quality', 'balanced', 'small', 'social'].includes(candidate.preset) ? candidate.preset : 'balanced', mute: Boolean(candidate.mute), volume: clamp(candidate.volume ?? 100, 0, 200) };
}

function splitClip(project, clipId, at) {
  const clips = [];
  let split = false;
  for (const clip of project.clips) {
    if (clip.id !== clipId || at <= clip.start + 0.04 || at >= clip.end - 0.04) { clips.push(clip); continue; }
    clips.push({ ...clip, id: id('clip'), end: at }, { ...clip, id: id('clip'), start: at, transition: 'none' });
    split = true;
  }
  return { ...project, clips: clips.map((clip, order) => ({ ...clip, order })), split };
}

function clipsWithoutSilence(duration, silences = [], padding = 0.08, minimumClip = 0.12) {
  const maximum = Math.max(0, Number(duration) || 0);
  const merged = silences.map((item) => ({ start: clamp(Number(item.start) - padding, 0, maximum), end: clamp(Number(item.end) + padding, 0, maximum) }))
    .filter((item) => item.end > item.start).sort((a, b) => a.start - b.start)
    .reduce((items, item) => { const last = items.at(-1); if (last && item.start <= last.end) last.end = Math.max(last.end, item.end); else items.push(item); return items; }, []);
  const clips = [];
  let cursor = 0;
  for (const silence of merged) {
    if (silence.start - cursor >= minimumClip) clips.push({ id: id('clip'), start: cursor, end: silence.start, transition: 'fade', transitionDuration: 0.12 });
    cursor = Math.max(cursor, silence.end);
  }
  if (maximum - cursor >= minimumClip) clips.push({ id: id('clip'), start: cursor, end: maximum, transition: 'fade', transitionDuration: 0.12 });
  return clips.map((clip, order) => ({ ...clip, order }));
}

function cursorZooms(samples = [], duration = 0) {
  const maximum = Math.max(0, Number(duration) || 0);
  const result = [];
  let last = null;
  for (const sample of samples.filter((item) => Number.isFinite(item.at)).sort((a, b) => a.at - b.at)) {
    const x = clamp(sample.x, 0, 1); const y = clamp(sample.y, 0, 1);
    if (last && Math.hypot(x - last.x, y - last.y) < 0.18 && sample.at - last.at < 2.5) continue;
    result.push({ id: id('zoom'), start: clamp(sample.at - 0.2, 0, maximum), end: clamp(sample.at + 1.3, 0.1, maximum), scale: 1.65, x, y });
    last = { x, y, at: sample.at };
  }
  return result.slice(0, 80);
}

return { clipsWithoutSilence, cursorZooms, normalizeTimelineProject, splitClip };
});
