// Automatic cleaning (an extra): which captures are old enough to go to the recycle bin. Only the choosing is here, so it
// can be checked on its own; the moving to the bin is the library's own (trashCaptures). A favourite is never chosen.
const DAY = 24 * 60 * 60 * 1000;
const IMAGE = /\.(png|jpe?g|webp|pdf)$/i;
const VIDEO = /\.(webm|mp4|mkv|mov|gif)$/i;
const MAX_IN_ONE_RUN = 200;

function matchesKind(filePath, kind) {
  if (kind === 'images') return IMAGE.test(filePath);
  if (kind === 'videos') return VIDEO.test(filePath);
  return IMAGE.test(filePath) || VIDEO.test(filePath);
}

// entries: [{ path, at (last change, in milliseconds), size, favorite }]. Oldest first, a limited number in one run.
function expiredCaptures(entries, { days, kind = 'all', now = Date.now(), limit = MAX_IN_ONE_RUN }) {
  const keepFor = Number(days);
  if (!Number.isFinite(keepFor) || keepFor < 1) return [];
  const before = now - keepFor * DAY;
  return entries
    .filter((entry) => !entry.favorite && Number.isFinite(entry.at) && entry.at < before && matchesKind(entry.path, kind))
    .sort((a, b) => a.at - b.at)
    .slice(0, limit);
}

module.exports = { MAX_IN_ONE_RUN, expiredCaptures, matchesKind };
