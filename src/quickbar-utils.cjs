const DEFAULT_QUICKBAR_PREFERENCES = Object.freeze({
  // On by default: a slim bar hidden in the top edge, like dedicated capture tools.
  enabled: true,
  // 'strip' = slim bar with two large buttons and drop-down menus; 'panel' = the full panel of eight actions.
  style: 'strip',
  edge: 'top',
  // Position along the edge, 0 (start) – 1 (end); the user drags the bar to set it.
  offset: 0.5,
  // Opens when the pointer touches it and hides as soon as the pointer leaves.
  activation: 'hover',
  display: 'cursor',
  pinned: false,
  // Post-capture card: shown above every app right after a capture, hides after captureTimeout seconds (0 = stays).
  capturePreview: true,
  captureTimeout: 6,
  // Region capture: off = the picture is saved the moment the selection is released (Control on release still
  // opens the marks toolbar); on = the marks toolbar every time. Then: wait before freezing, copy every capture.
  regionMarkup: false,
  captureDelay: 0,
  // Every capture is put on the clipboard as a picture (paste anywhere right away).
  autoCopy: true,
  // Laptops whose Print Screen key sends Windows+Shift+S (the snipping tool): that key opens the studio instead.
  laptopCaptureKey: true,
  // The bar's history button: 'workspace' = the captures window (large thumbnails, round buttons); 'panel' = the small grid.
  historyStyle: 'workspace'
});

const CAPTURE_TIMEOUTS = [0, 4, 6, 10];
const CAPTURE_DELAYS = [0, 3, 5, 10];
const MAX_RECENT_CAPTURES = 6;

function normalizeQuickbarPreferences(candidate = {}, current = DEFAULT_QUICKBAR_PREFERENCES) {
  const next = { ...DEFAULT_QUICKBAR_PREFERENCES, ...current };
  if ('enabled' in candidate) next.enabled = Boolean(candidate.enabled);
  if (['strip', 'panel'].includes(candidate.style)) next.style = candidate.style;
  if (['left', 'right', 'top'].includes(candidate.edge)) next.edge = candidate.edge;
  if (Number.isFinite(Number(candidate.offset)) && candidate.offset !== null && candidate.offset !== '') next.offset = Math.round(Math.min(1, Math.max(0, Number(candidate.offset))) * 1000) / 1000;
  if (['click', 'hover'].includes(candidate.activation)) next.activation = candidate.activation;
  if (['cursor', 'primary'].includes(candidate.display)) next.display = candidate.display;
  if ('pinned' in candidate) next.pinned = Boolean(candidate.pinned);
  if ('capturePreview' in candidate) next.capturePreview = Boolean(candidate.capturePreview);
  if (CAPTURE_TIMEOUTS.includes(Number(candidate.captureTimeout))) next.captureTimeout = Number(candidate.captureTimeout);
  if ('regionMarkup' in candidate) next.regionMarkup = Boolean(candidate.regionMarkup);
  if ('autoCopy' in candidate) next.autoCopy = Boolean(candidate.autoCopy);
  if ('laptopCaptureKey' in candidate) next.laptopCaptureKey = Boolean(candidate.laptopCaptureKey);
  if (['workspace', 'panel'].includes(candidate.historyStyle)) next.historyStyle = candidate.historyStyle;
  if (CAPTURE_DELAYS.includes(Number(candidate.captureDelay))) next.captureDelay = Number(candidate.captureDelay);
  if (!next.enabled) next.pinned = false;
  return next;
}

// view 'capture' = the post-capture card (large thumbnail + actions + recent strip); 'actions' = the regular bar,
// which grows by one row when there are recent captures to show.
// 'history' = the scrolling grid of recent captures; menu = a strip drop-down is open.
// Preferences without a style (saved before the strip existed) keep the classic panel layout.
// An open menu adds menuLength along the edge's depth (top) or menuDepth inward (sides); sides grow to menuLength tall.
const STRIP = Object.freeze({ thickness: 64, length: 300, menuDepth: 276, menuLength: 344 });
const HISTORY_SIZE = Object.freeze({ width: 392, height: 470 });
// The hidden bar: a thin line along the edge (thick enough to find with the pointer by pushing it to the edge).
const TAB = Object.freeze({ thickness: 6, length: 120 });

// Centre of a window of `size` placed at `offset` (0–1) along a span, kept fully inside it.
function alongEdge(start, span, size, offset = 0.5) {
  const centre = start + span * (Number.isFinite(offset) ? offset : 0.5);
  return Math.round(Math.min(Math.max(start, centre - size / 2), start + Math.max(0, span - size)));
}

function quickbarBounds(workArea, preferences, expanded = false, { view = 'actions', hasRecent = false, menu = false } = {}) {
  const edge = preferences.edge;
  const offset = preferences.offset;
  const strip = preferences.style === 'strip';
  if (!expanded) {
    // Hidden: a thin line flush with the very edge of the screen.
    if (edge === 'top') return { x: alongEdge(workArea.x, workArea.width, TAB.length, offset), y: workArea.y, width: TAB.length, height: TAB.thickness };
    return {
      x: edge === 'left' ? workArea.x : workArea.x + workArea.width - TAB.thickness,
      y: alongEdge(workArea.y, workArea.height, TAB.length, offset),
      width: TAB.thickness,
      height: TAB.length
    };
  }
  let width;
  let height;
  let margin = Math.min(6, Math.max(0, workArea.width - 356));
  if (view === 'history') ({ width, height } = HISTORY_SIZE);
  else if (view === 'capture' || !strip) { width = 356; height = view === 'capture' ? 382 : hasRecent ? 268 : 194; }
  else {
    // The strip sits flush against its edge; an open menu grows it inward.
    margin = 0;
    if (edge === 'top') { width = STRIP.length; height = STRIP.thickness + (menu ? STRIP.menuLength : 0); }
    else { width = STRIP.thickness + (menu ? STRIP.menuDepth : 0); height = menu ? Math.max(STRIP.length, STRIP.menuLength) : STRIP.length; }
  }
  width = Math.min(width, workArea.width);
  height = Math.min(height, workArea.height);
  margin = edge === 'top' ? Math.min(margin, Math.max(0, workArea.height - height)) : Math.min(margin, Math.max(0, workArea.width - width));
  return {
    x: edge === 'left' ? workArea.x + margin
      : edge === 'right' ? workArea.x + workArea.width - width - margin
        : alongEdge(workArea.x, workArea.width, width, offset),
    y: edge === 'top' ? workArea.y + margin : alongEdge(workArea.y, workArea.height, height, offset),
    width,
    height
  };
}

// Which edge a dragged bar belongs to: the top band of the screen keeps it on top; lower down, the nearer side.
function edgeForPointer(workArea, point) {
  if (point.y - workArea.y < Math.min(160, workArea.height * 0.2)) return 'top';
  return point.x - workArea.x < workArea.width / 2 ? 'left' : 'right';
}

// Where a dragged bar lands: the pointer's position along the bar's edge, as 0–1.
function offsetForPointer(workArea, edge, point) {
  const ratio = edge === 'top' ? (point.x - workArea.x) / workArea.width : (point.y - workArea.y) / workArea.height;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 1000;
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

module.exports = { CAPTURE_CARD_KEYS, CAPTURE_DELAYS, CAPTURE_TIMEOUTS, DEFAULT_QUICKBAR_PREFERENCES, MAX_RECENT_CAPTURES, addRecentCapture, edgeForPointer, normalizeQuickbarPreferences, offsetForPointer, quickbarBounds, shouldHideMainWindowOnClose };
