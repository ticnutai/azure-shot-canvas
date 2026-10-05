const DEFAULT_QUICKBAR_PREFERENCES = Object.freeze({
  enabled: false,
  edge: 'right',
  activation: 'click',
  display: 'cursor',
  pinned: false,
  // Post-capture card: shown above every app right after a capture, hides after captureTimeout seconds (0 = stays).
  capturePreview: true,
  captureTimeout: 6
});

const CAPTURE_TIMEOUTS = [0, 4, 6, 10];
const MAX_RECENT_CAPTURES = 6;

function normalizeQuickbarPreferences(candidate = {}, current = DEFAULT_QUICKBAR_PREFERENCES) {
  const next = { ...DEFAULT_QUICKBAR_PREFERENCES, ...current };
  if ('enabled' in candidate) next.enabled = Boolean(candidate.enabled);
  if (['left', 'right', 'top'].includes(candidate.edge)) next.edge = candidate.edge;
  if (['click', 'hover'].includes(candidate.activation)) next.activation = candidate.activation;
  if (['cursor', 'primary'].includes(candidate.display)) next.display = candidate.display;
  if ('pinned' in candidate) next.pinned = Boolean(candidate.pinned);
  if ('capturePreview' in candidate) next.capturePreview = Boolean(candidate.capturePreview);
  if (CAPTURE_TIMEOUTS.includes(Number(candidate.captureTimeout))) next.captureTimeout = Number(candidate.captureTimeout);
  if (!next.enabled) next.pinned = false;
  return next;
}

// view 'capture' = the post-capture card (large thumbnail + actions + recent strip); 'actions' = the regular bar,
// which grows by one row when there are recent captures to show.
function quickbarBounds(workArea, preferences, expanded = false, { view = 'actions', hasRecent = false } = {}) {
  const edge = preferences.edge;
  if (!expanded) {
    if (edge === 'top') return { x: Math.round(workArea.x + (workArea.width - 86) / 2), y: workArea.y, width: 86, height: 11 };
    return {
      x: edge === 'left' ? workArea.x : workArea.x + workArea.width - 11,
      y: Math.round(workArea.y + (workArea.height - 160) / 2),
      width: 11,
      height: 160
    };
  }
  const width = Math.min(356, workArea.width);
  const height = Math.min(view === 'capture' ? 382 : hasRecent ? 268 : 194, workArea.height);
  return {
    x: edge === 'left' ? workArea.x + Math.min(6, Math.max(0, workArea.width - width))
      : edge === 'right' ? workArea.x + workArea.width - width - Math.min(6, Math.max(0, workArea.width - width))
        : Math.round(workArea.x + (workArea.width - width) / 2),
    y: edge === 'top' ? workArea.y + Math.min(6, Math.max(0, workArea.height - height))
      : Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
}

function shouldHideMainWindowOnClose(preferences, environment = {}) {
  return Boolean(preferences.enabled && environment.qa !== true && environment.headless !== true && environment.quitting !== true);
}

// Keys for the capture card, live only while the pointer is over it (the card window never takes focus).
const CAPTURE_CARD_KEYS = Object.freeze([
  { accelerator: 'Enter', action: 'edit', label: 'Enter' },
  { accelerator: 'E', action: 'edit', label: 'E' },
  { accelerator: 'CommandOrControl+C', action: 'copy', label: 'Ctrl+C' },
  { accelerator: 'P', action: 'pin', label: 'P' },
  { accelerator: 'O', action: 'open-folder', label: 'O' },
  { accelerator: 'Delete', action: 'trash', label: 'Delete' },
  { accelerator: 'Escape', action: 'close', label: 'Esc' }
]);

// Newest first, one entry per file, capped — a capture re-saved under the same path moves to the front.
function addRecentCapture(list, item, max = MAX_RECENT_CAPTURES) {
  return [item, ...list.filter((entry) => entry.path.toLowerCase() !== item.path.toLowerCase())].slice(0, max);
}

module.exports = { CAPTURE_CARD_KEYS, CAPTURE_TIMEOUTS, DEFAULT_QUICKBAR_PREFERENCES, MAX_RECENT_CAPTURES, addRecentCapture, normalizeQuickbarPreferences, quickbarBounds, shouldHideMainWindowOnClose };
