const DEFAULT_QUICKBAR_PREFERENCES = Object.freeze({
  enabled: false,
  edge: 'right',
  activation: 'click',
  display: 'cursor',
  pinned: false
});

function normalizeQuickbarPreferences(candidate = {}, current = DEFAULT_QUICKBAR_PREFERENCES) {
  const next = { ...DEFAULT_QUICKBAR_PREFERENCES, ...current };
  if ('enabled' in candidate) next.enabled = Boolean(candidate.enabled);
  if (['left', 'right', 'top'].includes(candidate.edge)) next.edge = candidate.edge;
  if (['click', 'hover'].includes(candidate.activation)) next.activation = candidate.activation;
  if (['cursor', 'primary'].includes(candidate.display)) next.display = candidate.display;
  if ('pinned' in candidate) next.pinned = Boolean(candidate.pinned);
  if (!next.enabled) next.pinned = false;
  return next;
}

function quickbarBounds(workArea, preferences, expanded = false) {
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
  const height = Math.min(194, workArea.height);
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

module.exports = { DEFAULT_QUICKBAR_PREFERENCES, normalizeQuickbarPreferences, quickbarBounds, shouldHideMainWindowOnClose };
