const api = window.screenStudio;

const state = {
  sources: [],
  selectedSource: null,
  quality: 'balanced',
  recorder: null,
  displayStream: null,
  previewStream: null,
  previewRequestId: 0,
  previewFrameCount: 0,
  microphoneStream: null,
  cameraStream: null,
  outputStream: null,
  audioContext: null,
  qaSystemAudioContext: null,
  qaSystemAudioOscillator: null,
  drawTimer: null,
  chunks: [],
  recordingSession: null,
  recordingAppendQueue: Promise.resolve(),
  recordingWriteError: null,
  recordingBytes: 0,
  recordingChunks: 0,
  audioRecorders: [],
  audioAppendQueue: Promise.resolve(),
  healthTimer: null,
  cameraLastFrameAt: 0,
  cameraMonitorToken: 0,
  cameraStallNotified: false,
  cameraFrameMonitoring: false,
  scrollCapture: null,
  cursorInfo: null,
  cursorTimer: null,
  cursorSamples: [],
  startedAt: 0,
  timer: null,
  busy: false,
  sourceFilter: 'screen',
  targetHeight: 2160,
  libraryItems: [],
  captureKind: 'record',
  captureScope: 'full',
  libraryView: 'grid',
  librarySize: 'medium',
  recentFilter: 'all',
  recentSort: 'date-desc',
  recentView: 'cards',
  captureLayout: 'clean',
  previewFit: 'contain',
  previewZoom: 100,
  safeArea: false,
  cameraPosition: 'bottom-right',
  cameraSize: 20,
  captureDelay: 0,
  shortcuts: {},
  afterScreenshotAction: 'save',
  chapterMarkers: [],
  region: { x: 0, y: 0, width: 1, height: 1 }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const displayVideo = $('#display-video');
const cameraVideo = $('#camera-video');
const recordingCanvas = $('#recording-canvas');
const recordingContext = recordingCanvas.getContext('2d', { alpha: false });
let latestQaStatus = null;
let qaConsoleText = '';
let themeEditorOpen = false;
let listeningShortcutAction = null;
let editingVideoItem = null;
let editingVideoProject = null;
let editingVideoCursorSamples = [];
let selectedTimelineItem = null;
let workflowDefinitions = [];
let workflowExecutionLog = [];
let shortcutRegistrationState = {};
const shortcutDoublePressState = new Map();

const defaultShortcuts = {
  record: { kind: 'chord', code: 'Digit2', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 },
  recordStart: null, recordStop: { kind: 'single', code: 'F10', modifiers: [], scope: 'global', intervalMs: 300 },
  pause: { kind: 'chord', code: 'KeyP', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 },
  screenshot: { kind: 'chord', code: 'Digit1', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 },
  region: { kind: 'chord', code: 'Digit3', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 }, screenshotEdit: null,
  microphone: { kind: 'chord', code: 'KeyM', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 }, systemAudio: null,
  camera: { kind: 'chord', code: 'KeyC', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 },
  openOutput: { kind: 'chord', code: 'KeyO', modifiers: ['Ctrl', 'Shift'], scope: 'global', intervalMs: 300 },
  openLibrary: null, openLatest: null, editLatest: null,
  toggleWindow: { kind: 'double', code: 'F9', modifiers: [], scope: 'global', intervalMs: 500 }
};
const shortcutActions = {
  record: ['recording', 'התחלה / עצירת הקלטה', 'מחליף מצב לפי מצב ההקלטה הנוכחי'], recordStart: ['recording', 'התחלת הקלטה', 'מתחיל רק אם אין הקלטה פעילה'], recordStop: ['recording', 'עצירת הקלטה', 'עוצר ושומר רק הקלטה פעילה'], pause: ['recording', 'השהיה / המשך', 'מחליף בין השהיה להמשך'],
  screenshot: ['capture', 'צילום מסך מלא', 'מצלם מיד את המקור שנבחר'], region: ['capture', 'צילום אזור', 'פותח בחירת שטח לפני הצילום'], screenshotEdit: ['capture', 'צילום ופתיחה בעורך', 'מצלם ופותח עריכה מקצועית'],
  microphone: ['audio', 'השתקת מיקרופון', 'הפעלה או השתקה של המיקרופון'], systemAudio: ['audio', 'קול המחשב', 'הפעלה או השתקה של שמע המחשב'], camera: ['camera', 'הפעלת מצלמה', 'הצגה או הסתרה של המצלמה'],
  openOutput: ['library', 'פתיחת תיקיית השמירה', 'פותח ישירות את תיקיית הקבצים'], openLibrary: ['library', 'פתיחת הספרייה', 'עובר לעמוד כל הצילומים והווידאו'], openLatest: ['library', 'פתיחת הקובץ האחרון', 'פותח את הקובץ האחרון שנשמר'], editLatest: ['library', 'עריכת הצילום האחרון', 'פותח את התמונה האחרונה בעורך'], toggleWindow: ['window', 'הצגה / הסתרת האפליקציה', 'מסתיר או מחזיר את חלון האולפן']
};

function shortcutLabel(binding) {
  if (!binding) return 'לא מוגדר';
  if (typeof binding === 'string') return binding.replace(/Key([A-Z])/g, '$1').replace(/Digit([0-9])/g, '$1').replaceAll('+', ' + ');
  const key = String(binding.code || '').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
  return `${binding.kind === 'double' ? 'פעמיים ' : ''}${[...(binding.modifiers || []), key].join(' + ')}`;
}

function shortcutBindingFromEvent(event, template = {}) {
  if (!/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|PrintScreen|Numpad[0-9]|Space|Enter|Escape|Arrow(?:Up|Down|Left|Right)|(?:Shift|Control|Alt|Meta)(?:Left|Right))$/.test(event.code)) return null;
  const kind = ['single', 'double'].includes(template.kind) ? template.kind : 'chord';
  const modifiers = [];
  if (kind === 'chord') {
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Meta');
    if (!modifiers.length && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) return null;
  }
  const modifierOnly = /^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(event.code);
  if (modifierOnly) return null;
  return { kind, code: event.code, modifiers, scope: template.scope || 'global', intervalMs: Number(template.intervalMs) || (kind === 'double' ? 500 : 300) };
}

function shortcutEventMatches(event, binding) {
  if (!binding || event.code !== binding.code || event.repeat) return false;
  if (binding.kind !== 'chord') {
    if (/^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(binding.code)) return true;
    return !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  }
  const expected = new Set(binding.modifiers || []);
  return event.ctrlKey === expected.has('Ctrl') && event.altKey === expected.has('Alt') && event.shiftKey === expected.has('Shift') && event.metaKey === expected.has('Meta');
}

function handleFocusedShortcutEvent(event) {
  const match = Object.entries(state.shortcuts).find(([, binding]) => binding?.scope === 'focused' && shortcutEventMatches(event, binding));
  if (!match) return false;
  // Plain-key shortcuts must never steal letters while the user types or works in the image editor.
  const plainKey = !(match[1].modifiers || []).some((modifier) => modifier === 'Ctrl' || modifier === 'Alt' || modifier === 'Meta');
  const typing = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
  if (plainKey && (typing || window.aurumEditor?.isOpen())) return false;
  const [action, binding] = match;
  event.preventDefault();
  if (binding.kind !== 'double') {
    executeShortcutAction(action).catch((error) => showToast(`הפעלת הקיצור נכשלה: ${error.message}`));
    return true;
  }
  const now = performance.now();
  const previous = shortcutDoublePressState.get(action) || 0;
  shortcutDoublePressState.set(action, now);
  if (now - previous <= binding.intervalMs) {
    shortcutDoublePressState.delete(action);
    executeShortcutAction(action).catch((error) => showToast(`הפעלת הקיצור נכשלה: ${error.message}`));
  }
  return true;
}

function ensureShortcutRows() {
  const list = $('#shortcut-settings-list');
  if (!list || list.children.length) return;
  list.innerHTML = Object.entries(shortcutActions).map(([action, [category, label, description]]) => `<div data-shortcut-row="${action}" data-category="${category}"><div><b>${label}</b><small>${description}</small></div><select class="shortcut-kind" data-shortcut-kind="${action}"><option value="chord">צירוף</option><option value="single">מקש יחיד</option><option value="double">לחיצה כפולה</option></select><select class="shortcut-scope" data-shortcut-scope="${action}"><option value="global">גלובלי</option><option value="focused">באפליקציה</option></select><select class="shortcut-interval" data-shortcut-interval="${action}" title="מרווח מרבי בין שתי לחיצות"><option value="300">300ms</option><option value="400">400ms</option><option value="500">500ms</option><option value="650">650ms</option><option value="700">700ms</option></select><button class="shortcut-recorder" data-shortcut-action="${action}"></button><button class="shortcut-test" data-shortcut-test="${action}">בדיקה</button><button class="shortcut-clear" data-shortcut-clear="${action}" title="ניקוי">×</button></div>`).join('');
}

function filterShortcutRows() {
  const query = ($('#shortcut-search')?.value || '').trim().toLowerCase();
  const category = $('#shortcut-category')?.value || 'all';
  let visible = 0;
  $$('[data-shortcut-row]').forEach((row) => {
    const match = (category === 'all' || row.dataset.category === category) && (!query || row.textContent.toLowerCase().includes(query));
    row.classList.toggle('filtered-out', !match); if (match) visible += 1;
  });
  if ($('#shortcut-visible-count')) $('#shortcut-visible-count').textContent = visible;
}

function renderShortcutSettings(registration = {}) {
  ensureShortcutRows();
  if (Object.keys(registration).length) shortcutRegistrationState = registration;
  $$('[data-shortcut-action]').forEach((button) => {
    button.textContent = shortcutLabel(state.shortcuts[button.dataset.shortcutAction]);
    button.classList.toggle('listening', button.dataset.shortcutAction === listeningShortcutAction);
  });
  $$('[data-shortcut-kind]').forEach((select) => { select.value = state.shortcuts[select.dataset.shortcutKind]?.kind || select.dataset.pendingKind || 'chord'; });
  $$('[data-shortcut-scope]').forEach((select) => { select.value = state.shortcuts[select.dataset.shortcutScope]?.scope || select.dataset.pendingScope || 'global'; });
  $$('[data-shortcut-interval]').forEach((select) => { const binding = state.shortcuts[select.dataset.shortcutInterval]; select.value = String(binding?.intervalMs || 500); select.disabled = binding?.kind !== 'double'; });
  $$('[data-shortcut-summary]').forEach((element) => { element.textContent = shortcutLabel(state.shortcuts[element.dataset.shortcutSummary]); });
  const failed = Object.entries(shortcutRegistrationState).filter(([, registered]) => registered === false).map(([action]) => action);
  const banner = $('#shortcut-status-banner');
  if (banner) {
    banner.classList.toggle('error', Boolean(failed.length));
    banner.querySelector('b').textContent = failed.length ? `${failed.length} קיצורים לא נרשמו` : 'כל הקיצורים רשומים ופעילים';
    banner.querySelector('small').textContent = failed.length ? 'ייתכן שתוכנה אחרת משתמשת בהם. בחר שילוב אחר.' : 'הזיהוי מבוסס על מיקום המקש ולכן אינו תלוי בעברית או באנגלית.';
  }
  filterShortcutRows();
}

async function applyShortcutSettings(candidate, persist = true) {
  const result = await api.setShortcuts({ ...defaultShortcuts, ...candidate });
  if (!result.ok && result.conflicts?.length) {
    const [first] = result.conflicts;
    const reserved = typeof first[1] === 'string' && !Object.hasOwn(defaultShortcuts, first[1]);
    showToast(reserved ? `הקיצור שמור עבור ${first[1]}` : 'קיימת התנגשות בין שני קיצורים');
    renderShortcutSettings(result.registration);
    return false;
  }
  state.shortcuts = result.shortcuts;
  if (persist) localStorage.setItem('aurum-shortcuts', JSON.stringify(state.shortcuts));
  renderShortcutSettings(result.registration);
  return true;
}

async function loadShortcutSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('aurum-shortcuts') || '{}'); } catch {}
  const removedUnsafe = Object.entries(saved).filter(([, binding]) => binding?.kind === 'double' && /^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(binding.code));
  for (const [action] of removedUnsafe) saved[action] = null;
  state.shortcuts = { ...defaultShortcuts, ...saved };
  const accepted = await applyShortcutSettings(state.shortcuts, false);
  if (!accepted) {
    state.shortcuts = { ...defaultShortcuts };
    await applyShortcutSettings(state.shortcuts);
  } else localStorage.setItem('aurum-shortcuts', JSON.stringify(state.shortcuts));
  if (removedUnsafe.length) setTimeout(() => showToast(`${removedUnsafe.length} קיצורים כפולים לא אמינים הוסרו. מקשי Windows/Ctrl/Alt/Shift נתפסים בידי Windows.`), 400);
}

const themeVariables = ['--bg', '--top', '--panel', '--panel-2', '--text', '--muted', '--gold', '--line', '--success', '--danger'];
const themeDefinitions = {
  midnight: { '--bg': '#031126', '--top': '#151b22', '--panel': '#081c38', '--panel-2': '#06172f', '--text': '#f7f3e9', '--muted': '#7f9cbe', '--gold': '#f4bc3f', '--line': '#1c3453', '--success': '#79d8bb', '--danger': '#ef5b68' },
  porcelain: { '--bg': '#f1eee7', '--top': '#fffdf8', '--panel': '#fffefa', '--panel-2': '#f6f1e8', '--text': '#19283b', '--muted': '#6f7b89', '--gold': '#bc8727', '--line': '#d8d0c0', '--success': '#2a9d78', '--danger': '#c94f5d' },
  sky: { '--bg': '#e6f3fb', '--top': '#f8fcff', '--panel': '#f6fcff', '--panel-2': '#eaf6fc', '--text': '#15334b', '--muted': '#63869e', '--gold': '#2386b3', '--line': '#bcd8e8', '--success': '#258f75', '--danger': '#cf5260' },
  sand: { '--bg': '#efe5d3', '--top': '#fbf7ef', '--panel': '#fffaf0', '--panel-2': '#f5ecdd', '--text': '#392c21', '--muted': '#846f59', '--gold': '#b7712a', '--line': '#ddc9a8', '--success': '#4a8f68', '--danger': '#bd4f52' },
  mint: { '--bg': '#e6f4ef', '--top': '#f8fffc', '--panel': '#f8fffc', '--panel-2': '#eaf8f2', '--text': '#163b31', '--muted': '#61897c', '--gold': '#229879', '--line': '#b9dccd', '--success': '#178567', '--danger': '#c34e5c' },
  ivory: { '--bg': '#f8f6f1', '--top': '#fffefd', '--panel': '#fffefa', '--panel-2': '#faf7f0', '--text': '#3d3932', '--muted': '#928978', '--gold': '#bd8d2d', '--line': '#ddd5c7', '--success': '#00ac7c', '--danger': '#bd5a5a' }
};

const qualityPresets = {
  text: { fps: 15, bitrate: 30_000_000 },
  balanced: { fps: 30, bitrate: 18_000_000 },
  motion: { fps: 60, bitrate: 28_000_000 }
};

function showToast(message, duration = 4500) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.add('hidden'), duration);
}

function setStatus(label, mode = 'ready') {
  const pill = $('#status-pill');
  if (pill) {
    pill.lastChild.textContent = ` ${label}`;
    pill.style.color = mode === 'error' ? '#ff8fa0' : mode === 'busy' ? '#ffd37a' : '#81e5cf';
    pill.querySelector('span').style.background = mode === 'error' ? '#ff5d73' : mode === 'busy' ? '#ffc65c' : '#45e3b9';
  }
  document.documentElement.dataset.captureStatus = label;
  const recordLabel = $('#record-button span');
  if (recordLabel && !state.recorder) recordLabel.textContent = mode === 'busy' ? label : (state.captureKind === 'screenshot' ? 'צלם תמונה' : 'התחל הקלטה');
}

function applyCapturePreferences(kind = state.captureKind, scope = state.captureScope, persist = true) {
  state.captureKind = ['record', 'screenshot'].includes(kind) ? kind : 'record';
  state.captureScope = ['full', 'region', 'scroll'].includes(scope) ? scope : 'full';
  if ($('#default-capture-kind')) $('#default-capture-kind').value = state.captureKind;
  if ($('#default-capture-scope')) $('#default-capture-scope').value = state.captureScope;
  $$('input[name="screenshot-mode"]').forEach((radio) => { radio.checked = radio.value === state.captureScope; });
  const label = $('#record-button span');
  if (label && !state.recorder) label.textContent = state.captureKind === 'screenshot' ? 'צלם תמונה' : 'התחל הקלטה';
  if ($('#record-button')) $('#record-button').dataset.captureKind = state.captureKind;
  document.documentElement.dataset.defaultCaptureKind = state.captureKind;
  document.documentElement.dataset.defaultCaptureScope = state.captureScope;
  if ($('#capture-default-summary')) {
    const kindLabel = state.captureKind === 'screenshot' ? 'צילום מסך' : 'וידאו';
    const scopeLabel = state.captureScope === 'region' ? 'אזור לבחירה' : state.captureScope === 'scroll' ? 'עמוד גלילה' : 'מסך מלא';
    $('#capture-default-summary').textContent = `${kindLabel} · ${scopeLabel}`;
  }
  if (persist) {
    localStorage.setItem('aurum-default-capture-kind', state.captureKind);
    localStorage.setItem('aurum-default-capture-scope', state.captureScope);
  }
}

function applyAfterScreenshotAction(action = 'save', persist = true) {
  state.afterScreenshotAction = ['save', 'quick', 'professional', 'ocr', 'pin', 'share'].includes(action) ? action : 'save';
  if ($('#after-screenshot-action')) $('#after-screenshot-action').value = state.afterScreenshotAction;
  if (persist) localStorage.setItem('aurum-after-screenshot-action', state.afterScreenshotAction);
}

function closeCaptureSettingsDialog() {
  document.documentElement.dataset.captureSettingsOpen = 'false';
  $('#open-capture-settings')?.setAttribute('aria-expanded', 'false');
}

function openCaptureSettingsDialog() {
  if (state.captureLayout === 'professional') return;
  document.documentElement.dataset.captureSettingsOpen = 'true';
  $('#open-capture-settings')?.setAttribute('aria-expanded', 'true');
  $('#capture-settings')?.classList.remove('hidden');
  $('#close-capture-settings')?.focus();
}

function applyCaptureLayout(layout = 'clean', persist = true) {
  state.captureLayout = ['clean', 'professional', 'focus'].includes(layout) ? layout : 'clean';
  document.documentElement.dataset.captureLayout = state.captureLayout;
  if ($('#capture-layout-select')) $('#capture-layout-select').value = state.captureLayout;
  $$('[data-capture-layout-choice]').forEach((button) => {
    const active = button.dataset.captureLayoutChoice === state.captureLayout;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  $('#capture-layout-menu')?.classList.add('hidden');
  $('#capture-layout-button')?.setAttribute('aria-expanded', 'false');
  closeCaptureSettingsDialog();
  if (persist) localStorage.setItem('aurum-capture-layout', state.captureLayout);
}

function applyLibraryPreferences(view = state.libraryView, size = state.librarySize, persist = true) {
  state.libraryView = ['grid', 'list', 'table'].includes(view) ? view : 'grid';
  state.librarySize = ['small', 'medium', 'large'].includes(size) ? size : 'medium';
  const container = $('#library-list');
  if (container) container.className = `library-list view-${state.libraryView} size-${state.librarySize}`;
  $$('button[data-library-view]').forEach((button) => {
    const active = button.dataset.libraryView === state.libraryView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const sizes = { small: ['1', 'קטן'], medium: ['2', 'בינוני'], large: ['3', 'גדול'] };
  if ($('#library-size')) $('#library-size').value = sizes[state.librarySize][0];
  if ($('#library-size-output')) $('#library-size-output').textContent = sizes[state.librarySize][1];
  document.documentElement.dataset.libraryView = state.libraryView;
  document.documentElement.dataset.librarySize = state.librarySize;
  if (persist) {
    localStorage.setItem('aurum-library-view', state.libraryView);
    localStorage.setItem('aurum-library-size', state.librarySize);
  }
}

function applyRecentPreferences(filter = state.recentFilter, sort = state.recentSort, view = state.recentView, persist = true) {
  state.recentFilter = ['all', 'video', 'image'].includes(filter) ? filter : 'all';
  state.recentSort = ['date-desc', 'date-asc', 'name-asc', 'name-desc', 'size-desc'].includes(sort) ? sort : 'date-desc';
  state.recentView = ['cards', 'compact', 'list'].includes(view) ? view : 'cards';
  const container = $('#recent-library');
  if (container) container.className = `clip-grid recent-view-${state.recentView}`;
  $$('button[data-recent-filter]').forEach((button) => {
    const active = button.dataset.recentFilter === state.recentFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('button[data-recent-view]').forEach((button) => {
    const active = button.dataset.recentView === state.recentView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if ($('#recent-sort')) $('#recent-sort').value = state.recentSort;
  document.documentElement.dataset.recentFilter = state.recentFilter;
  document.documentElement.dataset.recentSort = state.recentSort;
  document.documentElement.dataset.recentView = state.recentView;
  if (persist) {
    localStorage.setItem('aurum-recent-filter', state.recentFilter);
    localStorage.setItem('aurum-recent-sort', state.recentSort);
    localStorage.setItem('aurum-recent-view', state.recentView);
  }
}

function restoreUserPreferences() {
  applyCaptureLayout(localStorage.getItem('aurum-capture-layout') || 'clean', false);
  applyCapturePreferences(localStorage.getItem('aurum-default-capture-kind') || 'record', localStorage.getItem('aurum-default-capture-scope') || 'full', false);
  applyAfterScreenshotAction(localStorage.getItem('aurum-after-screenshot-action') || 'save', false);
  applyCaptureDelay(localStorage.getItem('aurum-capture-delay') || '0', false);
  applyLibraryPreferences(localStorage.getItem('aurum-library-view') || 'grid', localStorage.getItem('aurum-library-size') || 'medium', false);
  applyRecentPreferences(localStorage.getItem('aurum-recent-filter') || 'all', localStorage.getItem('aurum-recent-sort') || 'date-desc', localStorage.getItem('aurum-recent-view') || 'cards', false);
  applyVisualCapturePreferences({
    previewFit: localStorage.getItem('aurum-preview-fit') || 'contain',
    previewZoom: Number(localStorage.getItem('aurum-preview-zoom') || 100),
    safeArea: localStorage.getItem('aurum-safe-area') === 'true',
    cameraPosition: localStorage.getItem('aurum-camera-position') || 'bottom-right',
    cameraSize: Number(localStorage.getItem('aurum-camera-size') || 20)
  }, false);
}

function applyCaptureDelay(value, persist = true) {
  state.captureDelay = [0, 3, 5, 10].includes(Number(value)) ? Number(value) : 0;
  if ($('#capture-delay')) $('#capture-delay').value = String(state.captureDelay);
  if ($('#countdown-note')) $('#countdown-note').textContent = state.captureDelay ? `◷ השהיה ${state.captureDelay} שניות` : '◷ צילום מיידי';
  document.documentElement.dataset.captureDelay = String(state.captureDelay);
  if (persist) localStorage.setItem('aurum-capture-delay', String(state.captureDelay));
}

async function runCaptureCountdown(seconds) {
  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    setStatus(`צילום בעוד ${remaining}…`, 'busy');
    if ($('#countdown-note')) $('#countdown-note').textContent = `◷ ${remaining}`;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  applyCaptureDelay(state.captureDelay, false);
}

function applyVisualCapturePreferences(candidate = {}, persist = true) {
  state.previewFit = ['contain', 'cover'].includes(candidate.previewFit) ? candidate.previewFit : state.previewFit;
  state.previewZoom = Math.max(100, Math.min(200, Number(candidate.previewZoom) || state.previewZoom));
  state.safeArea = candidate.safeArea === undefined ? state.safeArea : Boolean(candidate.safeArea);
  state.cameraPosition = ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(candidate.cameraPosition) ? candidate.cameraPosition : state.cameraPosition;
  state.cameraSize = Math.max(12, Math.min(35, Number(candidate.cameraSize) || state.cameraSize));
  document.documentElement.dataset.previewFit = state.previewFit;
  $('#display-video').style.transform = `scale(${state.previewZoom / 100})`;
  $('.capture-preview')?.classList.toggle('safe-area-visible', state.safeArea);
  $$('[data-preview-fit]').forEach((button) => button.classList.toggle('active', button.dataset.previewFit === state.previewFit));
  if ($('#preview-zoom')) $('#preview-zoom').value = String(state.previewZoom);
  if ($('#preview-zoom-output')) $('#preview-zoom-output').textContent = `${state.previewZoom}%`;
  if ($('#toggle-safe-area')) $('#toggle-safe-area').setAttribute('aria-pressed', String(state.safeArea));
  if ($('#camera-position')) $('#camera-position').value = state.cameraPosition;
  if ($('#camera-size')) $('#camera-size').value = String(state.cameraSize);
  if ($('#camera-size-output')) $('#camera-size-output').textContent = `${state.cameraSize}%`;
  document.documentElement.dataset.cameraPosition = state.cameraPosition;
  document.documentElement.dataset.cameraSize = String(state.cameraSize);
  if (persist) {
    localStorage.setItem('aurum-preview-fit', state.previewFit);
    localStorage.setItem('aurum-preview-zoom', String(state.previewZoom));
    localStorage.setItem('aurum-safe-area', String(state.safeArea));
    localStorage.setItem('aurum-camera-position', state.cameraPosition);
    localStorage.setItem('aurum-camera-size', String(state.cameraSize));
  }
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatMetricValue(value, unit = '') {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString('he-IL')} ${unit}`.trim();
}

function clearCustomThemeVariables() {
  themeVariables.forEach((name) => document.documentElement.style.removeProperty(name));
}

function readThemeLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem('aurum-theme-library') || '[]');
    if (Array.isArray(saved)) return saved;
  } catch {}
  return [];
}

function writeThemeLibrary(themes) {
  localStorage.setItem('aurum-theme-library', JSON.stringify(themes));
  renderCustomThemeMenus(themes);
}

function migrateLegacyTheme() {
  if (readThemeLibrary().length || !localStorage.getItem('aurum-custom-theme')) return;
  try {
    const legacy = JSON.parse(localStorage.getItem('aurum-custom-theme'));
    if (!legacy?.values) return;
    const id = `theme-${Date.now()}`;
    writeThemeLibrary([{ id, name: 'הערכה שלי', base: legacy.base || 'midnight', values: legacy.values, savedAt: legacy.savedAt }]);
    if (localStorage.getItem('aurum-theme') === 'custom') localStorage.setItem('aurum-theme', `custom:${id}`);
  } catch {}
}

function renderCustomThemeMenus(themes = readThemeLibrary()) {
  const menu = $('#custom-theme-menu-items');
  const select = $('#custom-theme-select');
  if (!menu || !select) return;
  menu.innerHTML = themes.map((theme) => `<button data-custom-theme-id="${escapeHtml(theme.id)}"><i class="swatch custom"></i>${escapeHtml(theme.name)}</button>`).join('');
  const selected = select.value;
  select.innerHTML = '<option value="">יצירת ערכה חדשה</option>' + themes.map((theme) => `<option value="${escapeHtml(theme.id)}">${escapeHtml(theme.name)}</option>`).join('');
  select.value = themes.some((theme) => theme.id === selected) ? selected : '';
}

function customThemeForChoice(choice) {
  const id = choice?.startsWith('custom:') ? choice.slice(7) : '';
  return readThemeLibrary().find((theme) => theme.id === id) || null;
}

function applyThemeChoice(choice, persist = false) {
  const custom = customThemeForChoice(choice);
  clearCustomThemeVariables();
  if (custom?.values) {
    document.documentElement.dataset.theme = custom.base || 'midnight';
    document.documentElement.dataset.themeMode = 'custom';
    document.documentElement.dataset.customThemeId = custom.id;
    for (const [name, value] of Object.entries(custom.values)) document.documentElement.style.setProperty(name, value);
  } else {
    document.documentElement.dataset.theme = themeDefinitions[choice] || window.aurumAppearance?.isLayoutTheme(choice) ? choice : 'midnight';
    delete document.documentElement.dataset.themeMode;
    delete document.documentElement.dataset.customThemeId;
  }
  if (persist) localStorage.setItem('aurum-theme', custom ? `custom:${custom.id}` : document.documentElement.dataset.theme);
}

function setThemeDraft(values, changed = true) {
  for (const input of $$('[data-theme-var]')) {
    const value = values[input.dataset.themeVar] || '#000000';
    input.value = value;
    input.nextElementSibling.textContent = value.toUpperCase();
    document.documentElement.style.setProperty(input.dataset.themeVar, value);
  }
  $('#theme-draft-status').textContent = changed ? 'שינויים שטרם נשמרו' : 'אין שינויים';
  $('#theme-draft-status').classList.toggle('changed', changed);
  document.documentElement.dataset.themeDraft = changed ? 'true' : 'false';
}

function openThemeEditor() {
  const savedChoice = localStorage.getItem('aurum-theme') || 'midnight';
  const custom = customThemeForChoice(savedChoice);
  const base = custom?.base || (themeDefinitions[savedChoice] ? savedChoice : 'midnight');
  $('#custom-theme-select').value = custom?.id || '';
  $('#custom-theme-name').value = custom?.name || '';
  $('#theme-base-select').value = base;
  // Layout colour themes live only in CSS: start the draft from the colours on screen instead of resetting to the base.
  const layoutTheme = !custom && window.aurumAppearance?.isLayoutTheme(savedChoice);
  const computed = layoutTheme ? getComputedStyle(document.documentElement) : null;
  const values = layoutTheme ? Object.fromEntries(Object.keys(themeDefinitions.midnight).map((name) => [name, computed.getPropertyValue(name).trim()])) : custom?.values || themeDefinitions[base];
  if (!layoutTheme) document.documentElement.dataset.theme = base;
  document.documentElement.dataset.themeMode = 'draft';
  setThemeDraft(values, false);
  updateThemeLibraryButtons();
  themeEditorOpen = true;
}

function newThemeDraft(base = 'midnight', name = '') {
  $('#custom-theme-select').value = '';
  $('#custom-theme-name').value = name;
  $('#theme-base-select').value = base;
  clearCustomThemeVariables();
  document.documentElement.dataset.theme = base;
  document.documentElement.dataset.themeMode = 'draft';
  setThemeDraft(themeDefinitions[base], true);
  updateThemeLibraryButtons();
  $('#custom-theme-name').focus();
}

function loadCustomThemeDraft(id) {
  const theme = readThemeLibrary().find((item) => item.id === id);
  if (!theme) return newThemeDraft();
  $('#custom-theme-name').value = theme.name;
  $('#theme-base-select').value = theme.base;
  document.documentElement.dataset.theme = theme.base;
  document.documentElement.dataset.themeMode = 'draft';
  setThemeDraft(theme.values, false);
  updateThemeLibraryButtons();
}

function updateThemeLibraryButtons() {
  const selected = Boolean($('#custom-theme-select').value);
  $('#duplicate-custom-theme').disabled = !selected;
  $('#delete-custom-theme').disabled = !selected;
}

function cancelThemeEditor(showMessage = true) {
  applyThemeChoice(localStorage.getItem('aurum-theme') || 'midnight');
  themeEditorOpen = false;
  document.documentElement.dataset.themeDraft = 'false';
  $('#theme-draft-status').textContent = 'אין שינויים';
  $('#theme-draft-status').classList.remove('changed');
  if (showMessage) showToast('השינויים בערכת הנושא בוטלו');
}

function saveCustomTheme() {
  const values = Object.fromEntries($$('[data-theme-var]').map((input) => [input.dataset.themeVar, input.value.toLowerCase()]));
  const themes = readThemeLibrary();
  const selectedId = $('#custom-theme-select').value;
  const id = selectedId || `theme-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const name = $('#custom-theme-name').value.trim() || `ערכה אישית ${themes.length + 1}`;
  const custom = { id, name, base: $('#theme-base-select').value, values, savedAt: new Date().toISOString() };
  const index = themes.findIndex((theme) => theme.id === id);
  if (index >= 0) themes[index] = custom; else themes.push(custom);
  writeThemeLibrary(themes);
  $('#custom-theme-select').value = id;
  localStorage.setItem('aurum-theme', `custom:${id}`);
  applyThemeChoice(`custom:${id}`);
  updateThemeLibraryButtons();
  $('#theme-draft-status').textContent = 'הערכה נשמרה';
  $('#theme-draft-status').classList.remove('changed');
  document.documentElement.dataset.themeDraft = 'false';
  showToast(`ערכת הנושא “${name}” נשמרה`);
}

function duplicateSelectedTheme() {
  const theme = readThemeLibrary().find((item) => item.id === $('#custom-theme-select').value);
  if (!theme) return;
  newThemeDraft(theme.base, `${theme.name} — עותק`);
  setThemeDraft(theme.values, true);
}

function deleteSelectedTheme() {
  const id = $('#custom-theme-select').value;
  if (!id) return;
  const themes = readThemeLibrary();
  const removed = themes.find((theme) => theme.id === id);
  writeThemeLibrary(themes.filter((theme) => theme.id !== id));
  if (localStorage.getItem('aurum-theme') === `custom:${id}`) localStorage.setItem('aurum-theme', 'midnight');
  newThemeDraft('midnight');
  showToast(`הערכה “${removed?.name || ''}” נמחקה`);
}

function openThemeManagement(createNew = false) {
  $('#theme-menu').classList.add('hidden');
  showPage('settings');
  $('[data-preference-tab="appearance"]').click();
  if (createNew) newThemeDraft(document.documentElement.dataset.theme || 'midnight');
}

function qaReportText(status) {
  if (!status?.report) return 'אין עדיין דוח QA';
  const lines = [
    `QA ${status.report.status.toUpperCase()} — ${status.report.finishedAt}`,
    `${status.report.summary.passed}/${status.report.summary.tests} tests | ${status.report.summary.metrics} metrics | ${status.report.summary.thresholdFailures} threshold failures`,
    ''
  ];
  status.comparisons.forEach((metric, index) => {
    const threshold = `${metric.direction === 'min' ? '≥' : '≤'} ${formatMetricValue(metric.threshold, metric.unit)}`;
    const delta = metric.delta === null ? 'אין בסיס השוואה' : `${metric.delta >= 0 ? '+' : ''}${formatMetricValue(metric.delta, metric.unit)}`;
    lines.push(`${index + 1}. ${metric.name}: ${formatMetricValue(metric.value, metric.unit)} | סף ${threshold} | שינוי ${delta} | ${metric.pass ? 'PASS' : 'FAIL'}${metric.regression ? ' | REGRESSION' : ''}`);
  });
  return lines.join('\n');
}

function renderQaStatus(status) {
  latestQaStatus = status;
  const report = status?.report;
  const root = $('[data-preference-section="development"]');
  root.classList.toggle('qa-running', Boolean(status?.running));
  $('#run-qa').disabled = status?.running || !status?.available;
  $('#run-qa').textContent = status?.running ? '● הבדיקות רצות…' : '▷ הפעל QA מלא';
  $('#qa-status').textContent = status?.running ? 'רץ כעת' : report ? (report.status === 'passed' ? 'עבר בהצלחה' : 'נכשל') : 'אין דוח';
  $('#qa-status').className = report?.status === 'passed' ? 'pass' : report ? 'fail' : '';
  $('#qa-tests-count').textContent = report ? `${report.summary.passed}/${report.summary.tests}` : '—';
  $('#qa-metrics-count').textContent = report?.summary.metrics ?? '—';
  $('#qa-failures-count').textContent = report?.summary.thresholdFailures ?? '—';
  $('#qa-failures-count').className = report?.summary.thresholdFailures ? 'fail' : report ? 'pass' : '';
  $('#qa-duration').textContent = report ? `${(report.durationMs / 1000).toFixed(1)} שנ׳` : '—';
  $('#qa-comparison-label').textContent = status?.previous
    ? `לעומת ${new Date(status.previous.finishedAt).toLocaleString('he-IL')}`
    : 'אין עדיין ריצה קודמת להשוואה';

  const body = $('#qa-metrics-body');
  if (!status?.comparisons?.length) body.innerHTML = '<tr><td colspan="6">אין עדיין תוצאות. לחץ על “הפעל QA מלא”.</td></tr>';
  else body.innerHTML = status.comparisons.map((metric, index) => {
    const threshold = `${metric.direction === 'min' ? '≥' : '≤'} ${formatMetricValue(metric.threshold, metric.unit)}`;
    const delta = metric.delta === null ? 'חדש' : `${metric.delta >= 0 ? '+' : ''}${formatMetricValue(metric.delta, metric.unit)}`;
    const deltaClass = metric.delta === null || metric.delta === 0 ? 'metric-neutral' : metric.regression ? 'metric-failed' : 'metric-improved';
    return `<tr class="${metric.pass ? '' : 'metric-fail'} ${metric.regression ? 'metric-regression' : ''}"><td>${index + 1}</td><td title="${escapeHtml(metric.testTitle)}">${escapeHtml(metric.name)}</td><td><span dir="ltr">${formatMetricValue(metric.value, metric.unit)}</span></td><td><span dir="ltr">${threshold}</span></td><td class="${deltaClass}"><span dir="ltr">${delta}</span></td><td class="${metric.pass ? 'metric-pass' : 'metric-failed'}">${metric.pass ? 'PASS' : 'FAIL'}</td></tr>`;
  }).join('');
  if (status?.console) qaConsoleText = status.console;
  $('#qa-console').textContent = qaConsoleText || 'הקונסול יופיע כאן בזמן הריצה.';
}

async function loadQaDashboard() {
  try { renderQaStatus(await api.getQaStatus()); }
  catch (error) { $('#qa-console').textContent = `לא ניתן לטעון QA: ${error.message}`; }
}

async function copyWithFeedback(button, text) {
  await api.copyText(text);
  const original = button.textContent;
  button.textContent = '✓ הועתק';
  setTimeout(() => { button.textContent = original; }, 1400);
}

async function refreshSources() {
  const grid = $('#source-grid');
  document.documentElement.dataset.sourcesLoading = 'true';
  grid.innerHTML = '<div class="loading">טוען מסכים וחלונות…</div>';
  try {
    state.sources = await api.listSources();
    if (!state.selectedSource && state.sources.length) state.selectedSource = state.sources[0];
    if (state.selectedSource) state.selectedSource = state.sources.find((item) => item.id === state.selectedSource.id) || state.sources[0];
    renderSources();
    if (state.selectedSource && !state.previewStream && !state.recorder && !api.browserMode) startLivePreview(state.selectedSource).catch(() => {});
    if (!state.sources.length) grid.innerHTML = '<div class="loading">לא נמצאו מסכים או חלונות לצילום.</div>';
  } catch (error) {
    grid.innerHTML = `<div class="loading">טעינת המקורות נכשלה: ${escapeHtml(error.message)}</div>`;
  } finally {
    document.documentElement.dataset.sourcesLoading = 'false';
    document.documentElement.dataset.sourcesRevision = String(Number(document.documentElement.dataset.sourcesRevision || 0) + 1);
  }
}

function renderSources() {
  const grid = $('#source-grid');
  grid.innerHTML = '';
  const visibleSources = state.sources.filter((source) => !state.sourceFilter || source.type === state.sourceFilter);
  for (const source of visibleSources) {
      const button = document.createElement('button');
      button.className = `source-card${source.id === state.selectedSource?.id ? ' selected' : ''}`;
      button.innerHTML = `<img alt="" src="${source.thumbnail}"><span title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span><em>${source.type === 'screen' ? 'מסך' : 'חלון'}</em>`;
      button.addEventListener('click', () => {
        state.selectedSource = source;
        $$('.source-card').forEach((card) => card.classList.remove('selected'));
        button.classList.add('selected');
        const label = $('#selected-source-label');
        if (label) label.textContent = `תצוגה מקדימה — ${source.name}`;
        startLivePreview(source).catch(() => {});
      });
      grid.append(button);
  }
  if (!visibleSources.length) grid.innerHTML = `<div class="loading">לא נמצאו מקורות מסוג ${state.sourceFilter === 'screen' ? 'מסך' : 'חלון'}.</div>`;
}

function setPreviewState(mode, message = '') {
  const stage = $('.capture-preview');
  if (!stage) return;
  stage.classList.remove('preview-loading', 'preview-ready', 'preview-error');
  if (mode) stage.classList.add(`preview-${mode}`);
  document.documentElement.dataset.previewState = mode || 'idle';
  const help = stage.querySelector('.empty-preview p');
  if (help && message) help.textContent = message;
}

function stopLivePreview({ preserveDisplay = false } = {}) {
  state.previewRequestId += 1;
  state.previewStream?.getTracks().forEach((track) => track.stop());
  if (displayVideo.srcObject === state.previewStream && !preserveDisplay) displayVideo.srcObject = null;
  state.previewStream = null;
  state.previewFrameCount = 0;
  document.documentElement.dataset.previewFrames = '0';
  if (!preserveDisplay) setPreviewState('', 'בחר מקור למעלה כדי להציג אותו כאן בזמן אמת');
}

function monitorPreviewFrames(requestId) {
  if (!displayVideo.requestVideoFrameCallback) {
    const startedAt = displayVideo.currentTime;
    setTimeout(() => {
      if (requestId !== state.previewRequestId || !state.previewStream) return;
      if (displayVideo.currentTime > startedAt) state.previewFrameCount += 1;
      document.documentElement.dataset.previewFrames = String(state.previewFrameCount);
      monitorPreviewFrames(requestId);
    }, 180);
    return;
  }
  displayVideo.requestVideoFrameCallback(() => {
    if (requestId !== state.previewRequestId || !state.previewStream) return;
    state.previewFrameCount += 1;
    document.documentElement.dataset.previewFrames = String(state.previewFrameCount);
    monitorPreviewFrames(requestId);
  });
}

async function startLivePreview(source = state.selectedSource) {
  if (!source || state.recorder || state.busy) return false;
  const sameSource = state.previewStream?.active && document.documentElement.dataset.previewSourceId === source.id;
  if (sameSource) return true;
  stopLivePreview();
  const requestId = ++state.previewRequestId;
  setPreviewState('loading', `פותח תצוגה חיה של ${source.name}…`);
  $('#selected-source-label').textContent = `מתחבר — ${source.name}`;
  try {
    await api.prepareCapture({ sourceId: source.id, includeSystemAudio: false });
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    if (requestId !== state.previewRequestId) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    state.previewStream = stream;
    displayVideo.srcObject = stream;
    await waitForVideo(displayVideo);
    if (requestId !== state.previewRequestId) return false;
    state.previewFrameCount = 0;
    document.documentElement.dataset.previewFrames = '0';
    document.documentElement.dataset.previewSourceId = source.id;
    document.documentElement.dataset.previewWidth = String(displayVideo.videoWidth);
    document.documentElement.dataset.previewHeight = String(displayVideo.videoHeight);
    $('#selected-source-label').textContent = `תצוגה חיה — ${source.name}`;
    setPreviewState('ready');
    monitorPreviewFrames(requestId);
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (state.previewStream !== stream) return;
      state.previewStream = null;
      displayVideo.srcObject = null;
      setPreviewState('error', 'שיתוף המקור הופסק. לחץ על המקור כדי להתחבר מחדש.');
    }, { once: true });
    return true;
  } catch (error) {
    if (requestId !== state.previewRequestId) return false;
    setPreviewState('error', `התצוגה החיה נכשלה: ${error.message}`);
    $('#selected-source-label').textContent = `לא ניתן להציג — ${source.name}`;
    return false;
  }
}

function restoreLivePreview() {
  if (!state.selectedSource || state.recorder || !$('#capture-page')?.classList.contains('active')) return;
  setTimeout(() => startLivePreview(state.selectedSource).catch(() => {}), 120);
}

function escapeHtml(text) {
  const node = document.createElement('span');
  node.textContent = text;
  // innerHTML leaves quotes as-is, which truncated values inside value="…" attributes.
  return node.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

async function ensureDevicePermission(kind) {
  const constraints = kind === 'audio' ? { audio: true } : { video: true };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  stream.getTracks().forEach((track) => track.stop());
  await refreshDevices();
}

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const container = $('#device-selects');
  const audioInputs = devices.filter((device) => device.kind === 'audioinput');
  const videoInputs = devices.filter((device) => device.kind === 'videoinput');
  container.innerHTML = '';
  if ($('#microphone').checked) container.append(createDeviceSelect('microphone-device', 'בחר מיקרופון', audioInputs));
  if ($('#camera').checked) container.append(createDeviceSelect('camera-device', 'בחר מצלמה', videoInputs));
}

function createDeviceSelect(id, placeholder, devices) {
  const select = document.createElement('select');
  select.id = id;
  const fallback = document.createElement('option');
  fallback.value = '';
  fallback.textContent = placeholder;
  select.append(fallback);
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${placeholder} ${index + 1}`;
    select.append(option);
  });
  return select;
}

function waitForVideo(video) {
  if (video.readyState >= 2 && video.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('לא התקבלה תמונה ממקור הצילום')), 10000);
    video.addEventListener('loadedmetadata', () => {
      clearTimeout(timeout);
      video.play().then(resolve, reject);
    }, { once: true });
  });
}

async function acquireInputs(includeRecordingInputs) {
  const includeSystemAudio = includeRecordingInputs && $('#system-audio').checked;
  await api.prepareCapture({ sourceId: state.selectedSource.id, includeSystemAudio });
  state.displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: qualityPresets[state.quality].fps },
    audio: includeSystemAudio
  });
  displayVideo.srcObject = state.displayStream;
  await waitForVideo(displayVideo);
  setPreviewState('ready');
  $('#selected-source-label').textContent = `${includeRecordingInputs ? 'מקליט' : 'מצלם'} — ${state.selectedSource.name}`;
  if (includeRecordingInputs && $('#cursor-highlight')?.checked) {
    state.cursorTimer = setInterval(() => api.getCursorPosition().then((info) => {
      state.cursorInfo = info;
      if (state.recorder && state.startedAt && info?.bounds?.width && info?.bounds?.height) {
        const previous = state.cursorSamples.at(-1);
        const at = recordingElapsedMs() / 1000;
        if (!previous || at - previous.at >= 0.1) state.cursorSamples.push({ at, x: (info.point.x - info.bounds.x) / info.bounds.width, y: (info.point.y - info.bounds.y) / info.bounds.height });
      }
    }).catch(() => {}), 40);
  }

  if (includeSystemAudio && api.qaEnabled) {
    state.displayStream.getAudioTracks().forEach((track) => {
      state.displayStream.removeTrack(track);
      track.stop();
    });
    state.qaSystemAudioContext = new AudioContext({ sampleRate: 48000 });
    if (state.qaSystemAudioContext.state === 'suspended') await state.qaSystemAudioContext.resume();
    const destination = state.qaSystemAudioContext.createMediaStreamDestination();
    const oscillator = state.qaSystemAudioContext.createOscillator();
    const gain = state.qaSystemAudioContext.createGain();
    oscillator.frequency.value = 997;
    gain.gain.value = 0.12;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    state.qaSystemAudioOscillator = oscillator;
    state.displayStream.addTrack(destination.stream.getAudioTracks()[0]);
  }

  if (includeRecordingInputs && $('#microphone').checked) {
    const selected = $('#microphone-device')?.value;
    state.microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selected ? { exact: selected } : undefined,
        echoCancellation: true,
        noiseSuppression: $('#noise-suppression')?.checked !== false,
        autoGainControl: true,
        channelCount: 2
      }
    });
  }
  if (includeRecordingInputs && $('#camera').checked) {
    const selected = $('#camera-device')?.value;
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: selected ? { exact: selected } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: false
    });
    cameraVideo.srcObject = state.cameraStream;
    await waitForVideo(cameraVideo);
    startCameraFrameMonitor();
  }
}

function startCameraFrameMonitor() {
  const token = ++state.cameraMonitorToken;
  state.cameraLastFrameAt = Date.now();
  state.cameraStallNotified = false;
  state.cameraFrameMonitoring = typeof cameraVideo.requestVideoFrameCallback === 'function';
  const frame = () => {
    if (token !== state.cameraMonitorToken || !state.cameraStream) return;
    state.cameraLastFrameAt = Date.now();
    cameraVideo.requestVideoFrameCallback(frame);
  };
  if (state.cameraFrameMonitoring) cameraVideo.requestVideoFrameCallback(frame);
}

function stopInputStreams() {
  for (const stream of [state.displayStream, state.microphoneStream, state.cameraStream, state.outputStream]) {
    stream?.getTracks().forEach((track) => track.stop());
  }
  state.displayStream = null;
  state.microphoneStream = null;
  state.cameraStream = null;
  state.cameraFrameMonitoring = false;
  state.outputStream = null;
  if (state.audioContext && state.audioContext.state !== 'closed') state.audioContext.close();
  state.audioContext = null;
  if (state.qaSystemAudioOscillator) state.qaSystemAudioOscillator.stop();
  state.qaSystemAudioOscillator = null;
  if (state.qaSystemAudioContext && state.qaSystemAudioContext.state !== 'closed') state.qaSystemAudioContext.close();
  state.qaSystemAudioContext = null;
  clearInterval(state.drawTimer);
  clearInterval(state.cursorTimer);
  clearInterval(state.healthTimer);
  state.drawTimer = null;
  state.cursorTimer = null;
  state.healthTimer = null;
  state.cameraMonitorToken += 1;
  state.cursorInfo = null;
  displayVideo.srcObject = null;
  cameraVideo.srcObject = null;
  setPreviewState('', 'מחזיר את התצוגה המקדימה…');
}

function drawFrame() {
  const sourceWidth = displayVideo.videoWidth;
  const sourceHeight = displayVideo.videoHeight;
  const crop = state.region;
  const sx = Math.round(crop.x * sourceWidth);
  const sy = Math.round(crop.y * sourceHeight);
  const sw = Math.max(2, Math.round(crop.width * sourceWidth));
  const sh = Math.max(2, Math.round(crop.height * sourceHeight));
  const scale = Math.min(1, state.targetHeight / sh);
  const outputWidth = Math.max(2, Math.round(sw * scale));
  const outputHeight = Math.max(2, Math.round(sh * scale));
  if (recordingCanvas.width !== outputWidth || recordingCanvas.height !== outputHeight) {
    recordingCanvas.width = outputWidth - (outputWidth % 2);
    recordingCanvas.height = outputHeight - (outputHeight % 2);
  }
  recordingContext.drawImage(displayVideo, sx, sy, sw, sh, 0, 0, recordingCanvas.width, recordingCanvas.height);
  if ($('#cursor-highlight')?.checked && state.cursorInfo && state.selectedSource?.type === 'screen') {
    const { point, bounds } = state.cursorInfo;
    const nx = (point.x - bounds.x) / bounds.width;
    const ny = (point.y - bounds.y) / bounds.height;
    if (nx >= crop.x && nx <= crop.x + crop.width && ny >= crop.y && ny <= crop.y + crop.height) {
      const x = ((nx - crop.x) / crop.width) * recordingCanvas.width;
      const y = ((ny - crop.y) / crop.height) * recordingCanvas.height;
      const radius = Math.max(14, recordingCanvas.width * 0.012);
      recordingContext.save();
      recordingContext.beginPath();
      recordingContext.arc(x, y, radius, 0, Math.PI * 2);
      recordingContext.fillStyle = '#f4bc3f44';
      recordingContext.fill();
      recordingContext.strokeStyle = '#f4bc3fee';
      recordingContext.lineWidth = Math.max(2, radius * 0.12);
      recordingContext.stroke();
      recordingContext.restore();
    }
  }
  if (state.cameraStream && cameraVideo.videoWidth) {
    const targetWidth = Math.round(recordingCanvas.width * state.cameraSize / 100);
    const targetHeight = Math.round(targetWidth * cameraVideo.videoHeight / cameraVideo.videoWidth);
    const margin = Math.max(16, Math.round(recordingCanvas.width * 0.018));
    const left = state.cameraPosition.endsWith('left');
    const top = state.cameraPosition.startsWith('top');
    const x = left ? margin : recordingCanvas.width - targetWidth - margin;
    const y = top ? margin : recordingCanvas.height - targetHeight - margin;
    recordingContext.save();
    const cameraShape = $('#camera-shape')?.value || 'rounded';
    const radius = cameraShape === 'circle' ? Math.min(targetWidth, targetHeight) / 2 : cameraShape === 'square' ? 0 : Math.max(12, targetWidth * 0.05);
    roundedRect(recordingContext, x, y, targetWidth, targetHeight, radius);
    recordingContext.clip();
    recordingContext.drawImage(cameraVideo, x, y, targetWidth, targetHeight);
    recordingContext.restore();
    recordingContext.strokeStyle = '#ffffffcc';
    recordingContext.lineWidth = Math.max(2, targetWidth * 0.008);
    roundedRect(recordingContext, x, y, targetWidth, targetHeight, radius);
    recordingContext.stroke();
  }
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function chooseRegion() {
  const modal = $('#region-modal');
  const canvas = $('#preview-canvas');
  const context = canvas.getContext('2d');
  const box = $('#selection-box');
  canvas.width = displayVideo.videoWidth;
  canvas.height = displayVideo.videoHeight;
  context.drawImage(displayVideo, 0, 0);
  modal.classList.remove('hidden');
  box.style.display = 'none';
  $('#confirm-region').disabled = true;

  const readStoredRegion = (key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (!value || !['x', 'y', 'width', 'height'].every((field) => Number.isFinite(value[field]))) return null;
      return value;
    } catch { return null; }
  };
  const readSavedRegions = () => {
    try {
      const value = JSON.parse(localStorage.getItem('aurum-saved-regions') || '[]');
      return Array.isArray(value) ? value.filter((item) => item?.name && item?.region) : [];
    } catch { return []; }
  };
  const savedSelect = $('#saved-region');
  const savedRegions = readSavedRegions();
  savedSelect.innerHTML = '<option value="">אזור שמור…</option>' + savedRegions.map((item, index) => `<option value="${index}">${escapeHtml(item.name)}</option>`).join('');

  return new Promise((resolve) => {
    let dragging = false;
    let start = null;
    let selection = null;

    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
        rect
      };
    };
    const renderBox = (from, to) => {
      const canvasRect = canvas.getBoundingClientRect();
      const wrapRect = $('#preview-wrap').getBoundingClientRect();
      const left = Math.min(from.x, to.x);
      const top = Math.min(from.y, to.y);
      const width = Math.abs(to.x - from.x);
      const height = Math.abs(to.y - from.y);
      box.style.display = 'block';
      box.style.left = `${canvasRect.left - wrapRect.left + left}px`;
      box.style.top = `${canvasRect.top - wrapRect.top + top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      selection = { x: left / canvasRect.width, y: top / canvasRect.height, width: width / canvasRect.width, height: height / canvasRect.height };
      $('#confirm-region').disabled = width < 8 || height < 8;
      $('#save-region').disabled = width < 8 || height < 8;
    };
    const renderNormalizedRegion = (region) => {
      if (!region) return;
      const canvasRect = canvas.getBoundingClientRect();
      renderBox(
        { x: region.x * canvasRect.width, y: region.y * canvasRect.height },
        { x: (region.x + region.width) * canvasRect.width, y: (region.y + region.height) * canvasRect.height }
      );
    };
    const down = (event) => { dragging = true; start = point(event); canvas.setPointerCapture(event.pointerId); renderBox(start, start); };
    const move = (event) => { if (dragging) renderBox(start, point(event)); };
    const up = (event) => { if (dragging) { dragging = false; renderBox(start, point(event)); } };
    const finish = (value) => {
      if (value && value.width > 0 && value.height > 0) localStorage.setItem('aurum-last-region', JSON.stringify(value));
      modal.classList.add('hidden');
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      $('#confirm-region').onclick = null;
      $('#full-region').onclick = null;
      $('#last-region').onclick = null;
      $('#save-region').onclick = null;
      savedSelect.onchange = null;
      $('#cancel-region').onclick = null;
      resolve(value);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    $('#confirm-region').onclick = () => finish(selection);
    $('#full-region').onclick = () => finish({ x: 0, y: 0, width: 1, height: 1 });
    $('#last-region').onclick = () => {
      const region = readStoredRegion('aurum-last-region');
      if (!region) return showToast('עדיין לא נשמר אזור צילום אחרון');
      renderNormalizedRegion(region);
    };
    savedSelect.onchange = () => renderNormalizedRegion(savedRegions[Number(savedSelect.value)]?.region);
    $('#save-region').onclick = () => {
      if (!selection) return;
      const regions = readSavedRegions();
      const name = `אזור ${regions.length + 1}`;
      regions.unshift({ name, region: selection, savedAt: new Date().toISOString() });
      localStorage.setItem('aurum-saved-regions', JSON.stringify(regions.slice(0, 12)));
      showToast(`${name} נשמר לשימוש חוזר`);
      finish(selection);
    };
    $('#cancel-region').onclick = () => finish(null);
  });
}

async function handleSavedScreenshot(result) {
  document.documentElement.dataset.lastSavedPath = result.path;
  setStatus('התמונה נשמרה');
  showToast(`התמונה נשמרה: ${result.path}`);
  await loadLibrary().catch(() => {});
  restoreLivePreview();
  const completed = new Set();
  if (['quick', 'professional'].includes(state.afterScreenshotAction) && window.aurumEditor) { await window.aurumEditor.open(result.path, state.afterScreenshotAction); completed.add('open-editor'); }
  if (state.afterScreenshotAction === 'ocr') { const ocr = await api.runOcr(result.path); completed.add('ocr'); showToast(`OCR הושלם: ${ocr.text.length} תווים נוספו לחיפוש`); await loadLibrary(); }
  if (state.afterScreenshotAction === 'pin') { await api.pinImage(result.path); showToast('הצילום הוצמד מעל החלונות'); }
  if (state.afterScreenshotAction === 'share') { const share = await api.shareLocal(result.path); completed.add('share'); showToast(`קישור מקומי פרטי הועתק, בתוקף עד ${new Date(share.expiresAt).toLocaleTimeString('he-IL')}`); }
  await runWorkflows('screenshot', result.path, completed);
}

const workflowActionLabels = { copy: 'העתקה', ocr: 'OCR', 'client-copy': 'העתק לתיקיית לקוח', 'open-editor': 'פתיחת העורך', share: 'שיתוף מקומי', 'open-folder': 'פתיחת תיקייה' };

function saveWorkflows() {
  localStorage.setItem('aurum-workflows', JSON.stringify(workflowDefinitions));
  renderWorkflows();
}

function renderWorkflows() {
  const container = $('#workflow-list');
  if (!container) return;
  if (!workflowDefinitions.length) { container.innerHTML = '<div class="loading">אין אוטומציות. בחר תבנית או צור חדשה.</div>'; return; }
  container.innerHTML = workflowDefinitions.map((workflow, index) => `<article class="workflow-card" data-workflow-index="${index}"><input type="checkbox" data-workflow-field="enabled" ${workflow.enabled ? 'checked' : ''} title="פעילה"><input data-workflow-field="name" value="${escapeHtml(workflow.name)}" aria-label="שם אוטומציה"><select data-workflow-field="trigger"><option value="screenshot" ${workflow.trigger === 'screenshot' ? 'selected' : ''}>אחרי צילום</option><option value="recording" ${workflow.trigger === 'recording' ? 'selected' : ''}>אחרי הקלטה</option></select><input data-workflow-field="client" value="${escapeHtml(workflow.client || '')}" placeholder="שם לקוח"><button class="danger-button" data-workflow-delete>⌫</button><div class="workflow-actions">${Object.entries(workflowActionLabels).map(([action, label]) => `<label><input type="checkbox" data-workflow-action="${action}" ${workflow.actions.includes(action) ? 'checked' : ''}>${label}</label>`).join('')}</div></article>`).join('');
}

function addWorkflow(template = 'blank') {
  const templates = {
    blank: { name: `אוטומציה ${workflowDefinitions.length + 1}`, trigger: 'screenshot', client: '', actions: ['copy'] },
    'copy-ocr': { name: 'העתקה ו־OCR', trigger: 'screenshot', client: '', actions: ['copy', 'ocr'] },
    'client-edit': { name: 'צילום לתיקיית לקוח ולעורך', trigger: 'screenshot', client: 'לקוח חדש', actions: ['client-copy', 'open-editor'] },
    'record-share': { name: 'שיתוף הקלטה', trigger: 'recording', client: '', actions: ['share', 'open-folder'] }
  };
  workflowDefinitions.push({ id: `workflow-${Date.now()}-${workflowDefinitions.length}`, enabled: true, ...templates[template] });
  saveWorkflows();
}

async function runWorkflows(trigger, filePath, completed = new Set()) {
  const rules = workflowDefinitions.filter((workflow) => workflow.enabled && workflow.trigger === trigger);
  if (!rules.length) return [];
  workflowExecutionLog = [`${new Date().toLocaleString('he-IL')} · ${trigger} · ${filePath}`];
  const results = [];
  for (const workflow of rules) {
    workflowExecutionLog.push(`▶ ${workflow.name}`);
    for (const action of workflow.actions) {
      if (completed.has(action)) { workflowExecutionLog.push(`  ↷ ${workflowActionLabels[action]} — דולג כדי למנוע כפילות`); continue; }
      let result;
      if (action === 'open-editor') { if (/\.png$/i.test(filePath)) await window.aurumEditor?.open(filePath, 'professional'); else { const item = state.libraryItems.find((entry) => entry.path === filePath) || { path: filePath, name: filePath.split(/[\\/]/).at(-1) }; await openVideoEditor(item); } result = { renderer: true }; }
      else result = await api.runWorkflowAction(filePath, action, { client: workflow.client });
      completed.add(action); results.push({ workflow: workflow.name, action, result });
      workflowExecutionLog.push(`  ✓ ${workflowActionLabels[action]}${result?.skipped ? ` — ${result.reason}` : ''}`);
    }
  }
  $('#workflow-log').textContent = workflowExecutionLog.join('\n');
  document.documentElement.dataset.workflowActions = String(results.length);
  localStorage.setItem('aurum-workflow-log', workflowExecutionLog.join('\n'));
  return results;
}

async function beginScrollingCapture() {
  const engine = window.AurumScrollCapture;
  if (!engine) throw new Error('מנוע צילום הגלילה לא נטען');
  stopLivePreview({ preserveDisplay: true });
  await acquireInputs(false);
  const sourceWidth = displayVideo.videoWidth;
  const sourceHeight = displayVideo.videoHeight;
  const scale = Math.min(1, 1600 / sourceWidth);
  const frameWidth = Math.max(2, Math.round(sourceWidth * scale));
  const frameHeight = Math.max(2, Math.round(sourceHeight * scale));
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = frameWidth;
  frameCanvas.height = frameHeight;
  const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
  let stitchedCanvas = null;
  let previousSignature = null;
  let frames = 0;
  let appended = 0;
  let lastMovementAt = Date.now();
  let finishing = false;
  let interval = null;
  let maximumTimer = null;
  const startedAt = Date.now();
  const bar = $('#scroll-capture-bar');
  const status = $('#scroll-capture-status');
  bar.classList.remove('hidden');
  document.documentElement.dataset.scrollCapture = 'active';

  const sample = () => {
    if (finishing || !displayVideo.videoWidth) return;
    frameContext.drawImage(displayVideo, 0, 0, sourceWidth, sourceHeight, 0, 0, frameWidth, frameHeight);
    const signature = engine.rowSignature(frameContext.getImageData(0, 0, frameWidth, frameHeight), frameWidth, frameHeight, 2);
    frames += 1;
    if (!stitchedCanvas) {
      stitchedCanvas = document.createElement('canvas');
      stitchedCanvas.width = frameWidth;
      stitchedCanvas.height = frameHeight;
      stitchedCanvas.getContext('2d').drawImage(frameCanvas, 0, 0);
      previousSignature = signature;
      status.textContent = 'הפריים הראשון נשמר — גלול לאט כלפי מטה';
      return;
    }
    const transition = engine.analyzeTransition(previousSignature, signature);
    if (transition.kind === 'append') {
      const nextHeight = engine.nextCanvasHeight(stitchedCanvas.height, frameHeight, transition.overlapPixels);
      if (nextHeight <= stitchedCanvas.height) return;
      const nextCanvas = document.createElement('canvas');
      nextCanvas.width = frameWidth;
      nextCanvas.height = nextHeight;
      const nextContext = nextCanvas.getContext('2d');
      nextContext.drawImage(stitchedCanvas, 0, 0);
      const appendHeight = nextHeight - stitchedCanvas.height;
      nextContext.drawImage(frameCanvas, 0, frameHeight - appendHeight, frameWidth, appendHeight, 0, stitchedCanvas.height, frameWidth, appendHeight);
      stitchedCanvas = nextCanvas;
      previousSignature = signature;
      appended += 1;
      lastMovementAt = Date.now();
      status.textContent = `${appended + 1} חלקים חוברו · ${stitchedCanvas.width}×${stitchedCanvas.height}px`;
    } else if (transition.kind === 'unmatched') {
      status.textContent = 'לא נמצאה חפיפה — גלול לאט יותר ובצע צעדים קטנים';
    } else if (appended && Date.now() - lastMovementAt > 3_500) {
      finish().catch(failScrollCapture);
    }
  };

  function failScrollCapture(error) {
    clearInterval(interval);
    clearTimeout(maximumTimer);
    stopInputStreams();
    state.scrollCapture = null;
    state.busy = false;
    bar.classList.add('hidden');
    document.documentElement.dataset.scrollCapture = 'failed';
    showToast(`צילום הגלילה נכשל: ${error.message}`, 8000);
    restoreLivePreview();
  }

  const finish = async () => {
    if (finishing) return;
    if (!stitchedCanvas) sample();
    finishing = true;
    clearInterval(interval);
    clearTimeout(maximumTimer);
    $('#finish-scroll-capture').onclick = null;
    bar.classList.add('hidden');
    document.documentElement.dataset.scrollCapture = 'saving';
    if (!stitchedCanvas) throw new Error('לא התקבל פריים לצילום');
    const blob = await new Promise((resolve) => stitchedCanvas.toBlob(resolve, 'image/png'));
    const result = await api.saveScreenshot(await blob.arrayBuffer());
    document.documentElement.dataset.scrollCapture = 'saved';
    document.documentElement.dataset.scrollFrames = String(frames);
    document.documentElement.dataset.scrollParts = String(appended + 1);
    document.documentElement.dataset.scrollHeight = String(stitchedCanvas.height);
    stopInputStreams();
    state.scrollCapture = null;
    state.busy = false;
    runAfterScreenshot(result);
  };

  state.scrollCapture = { finish };
  $('#finish-scroll-capture').onclick = () => finish().catch(failScrollCapture);
  sample();
  interval = setInterval(sample, 300);
  maximumTimer = setTimeout(() => finish().catch(failScrollCapture), 90_000);
  status.textContent = 'עבור למקור וגלול לאט כלפי מטה; העצירה אוטומטית בסוף';
  showToast('צילום גלילה התחיל — גלול לאט; בסיום לחץ על סיום ושמירה', 7000);
}

async function beginCapture(kind, forcedScope = null) {
  if (state.finalizing) return showToast('ההקלטה הקודמת עדיין נשמרת — אפשר להתחיל שוב בעוד רגע');
  if (state.busy || state.recorder) return;
  if (!state.selectedSource) return showToast('יש לבחור מסך או חלון תחילה');
  state.busy = true;
  setStatus('מכין מקורות…', 'busy');
  try {
    const scope = forcedScope || state.captureScope;
    if (kind === 'screenshot' && scope === 'scroll') {
      await beginScrollingCapture();
      return;
    }
    stopLivePreview({ preserveDisplay: true });
    await acquireInputs(kind === 'record');
    const region = scope === 'full' ? { x: 0, y: 0, width: 1, height: 1 } : await chooseRegion();
    if (!region) {
      stopInputStreams();
      setStatus('מוכן');
      restoreLivePreview();
      return;
    }
    state.region = region;
    if (kind === 'screenshot' && state.captureDelay) await runCaptureCountdown(state.captureDelay);
    drawFrame();
    if (kind === 'screenshot') await saveScreenshot();
    else await startRecording();
  } catch (error) {
    if (state.recorder && state.recorder.state === 'inactive') { state.recorder = null; state.recordingSession = null; }
    stopInputStreams();
    setStatus('שגיאה', 'error');
    showToast(`לא ניתן להתחיל צילום: ${error.message}`, 7000);
    restoreLivePreview();
  } finally {
    if (!state.scrollCapture) state.busy = false;
  }
}

async function saveScreenshot() {
  drawFrame();
  const blob = await new Promise((resolve) => recordingCanvas.toBlob(resolve, 'image/png'));
  const result = await api.saveScreenshot(await blob.arrayBuffer());
  stopInputStreams();
  // The file is safe on disk: free the capture now, so library refresh, OCR and automations never block the next shot.
  state.busy = false;
  runAfterScreenshot(result);
}

function runAfterScreenshot(result) {
  handleSavedScreenshot(result).catch((error) => showToast(`הצילום נשמר, אבל פעולת ההמשך נכשלה: ${error.message}`, 8000));
}

async function createMixedAudioTrack() {
  const audioStreams = [state.displayStream, state.microphoneStream].filter((stream) => stream?.getAudioTracks().length);
  if (!audioStreams.length) return null;
  state.audioContext = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  if (state.audioContext.state === 'suspended') await state.audioContext.resume();
  const destination = state.audioContext.createMediaStreamDestination();
  for (const stream of audioStreams) {
    const source = state.audioContext.createMediaStreamSource(stream);
    const gain = state.audioContext.createGain();
    gain.gain.value = stream === state.microphoneStream ? Number($('#mic-volume')?.value || 100) / 100 : Number($('#system-volume')?.value || 90) / 100;
    source.connect(gain).connect(destination);
  }
  return destination.stream.getAudioTracks()[0] || null;
}

function recorderMimeType() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function audioRecorderMimeType() {
  return ['audio/webm;codecs=opus', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function startIsolatedAudioRecorders() {
  state.audioRecorders = [];
  state.audioAppendQueue = Promise.resolve();
  const mimeType = audioRecorderMimeType();
  for (const [kind, stream] of [['system', state.displayStream], ['microphone', state.microphoneStream]]) {
    const track = stream?.getAudioTracks()[0];
    if (!track) continue;
    const recorder = new MediaRecorder(new MediaStream([track]), { mimeType, audioBitsPerSecond: 192_000 });
    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data.size || !state.recordingSession) return;
      state.audioAppendQueue = state.audioAppendQueue
        .then(() => event.data.arrayBuffer())
        .then((bytes) => api.appendRecordingAudio(state.recordingSession.id, kind, bytes))
        .catch((error) => { state.recordingWriteError ||= error; });
    });
    recorder.start(1000);
    state.audioRecorders.push(recorder);
  }
}

async function stopIsolatedAudioRecorders() {
  await Promise.all(state.audioRecorders.map((recorder) => new Promise((resolve) => {
    if (recorder.state === 'inactive') return resolve();
    recorder.addEventListener('stop', resolve, { once: true });
    recorder.stop();
  })));
  await state.audioAppendQueue;
  state.audioRecorders = [];
}

function startRecordingHealthMonitor() {
  clearInterval(state.healthTimer);
  state.healthTimer = setInterval(async () => {
    if (!state.recordingSession || !state.recorder || state.recorder.state === 'inactive') return;
    try {
      const cameraStalled = Boolean(state.cameraStream && state.cameraFrameMonitoring && Date.now() - state.cameraLastFrameAt > 5_000);
      if (cameraStalled && !state.cameraStallNotified) {
        state.cameraStallNotified = true;
        cameraVideo.srcObject = null;
        cameraVideo.srcObject = state.cameraStream;
        cameraVideo.play().catch(() => {});
        showToast('זוהתה תקיעת מצלמה — התצוגה הופעלה מחדש וההקלטה ממשיכה', 7000);
      }
      if (!cameraStalled) state.cameraStallNotified = false;
      const health = await api.recordingHeartbeat(state.recordingSession.id, { cameraStalled, recorderState: state.recorder.state, elapsedMs: recordingElapsedMs() });
      $('#recording-segments').textContent = `מקטע ${health.segments}`;
      document.documentElement.dataset.recordingSegments = String(health.segments);
      document.documentElement.dataset.cameraHealth = cameraStalled ? 'recovering' : 'healthy';
      if (health.storage.level === 'critical' && state.recorder.state !== 'inactive') {
        showToast('המקום הפנוי הגיע לסף קריטי — ההקלטה נעצרת ונשמרת בבטחה', 9000);
        state.recorder.stop();
      }
    } catch (error) {
      state.recordingWriteError ||= error;
    }
  }, 5_000);
}

async function startRecording() {
  const preset = qualityPresets[state.quality];
  const canvasStream = recordingCanvas.captureStream(preset.fps);
  const mixedTrack = await createMixedAudioTrack();
  if (mixedTrack) canvasStream.addTrack(mixedTrack);
  state.outputStream = canvasStream;
  const mimeType = recorderMimeType();
  // Open the file session first: if it fails (disk full) no half-started recorder is left behind.
  state.recordingSession = await api.beginRecordingFile({ mimeType, fps: preset.fps, targetHeight: state.targetHeight, segmentChunkTarget: api.qaEnabled ? 3 : 30 });
  state.recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: preset.bitrate, audioBitsPerSecond: 192_000 });
  state.recordingAppendQueue = Promise.resolve();
  state.recordingWriteError = null;
  state.recordingBytes = 0;
  state.recordingChunks = 0;
  state.cursorSamples = [];
  state.recorder.addEventListener('dataavailable', (event) => {
    if (!event.data.size) return;
    state.recordingAppendQueue = state.recordingAppendQueue.then(async () => {
      const result = await api.appendRecordingChunk(state.recordingSession.id, await event.data.arrayBuffer());
      state.recordingBytes = result.bytes;
      state.recordingChunks = result.chunks;
      document.documentElement.dataset.recordingBytes = String(result.bytes);
      document.documentElement.dataset.recordingChunks = String(result.chunks);
      document.documentElement.dataset.recordingSegments = String(result.segments || 1);
      $('#recording-segments').textContent = `מקטע ${result.segments || 1}`;
      if ($('#recording-size')) $('#recording-size').textContent = `${(result.bytes / 1024 / 1024).toFixed(1)} MB`;
    }).catch((error) => { state.recordingWriteError = error; });
  });
  state.recorder.addEventListener('stop', finalizeRecording, { once: true });
  state.displayStream.getVideoTracks()[0].addEventListener('ended', () => { if (state.recorder?.state !== 'inactive') state.recorder.stop(); }, { once: true });
  state.recorder.start(1000);
  startIsolatedAudioRecorders();
  drawFrame();
  state.drawTimer = setInterval(drawFrame, Math.max(8, Math.round(1000 / preset.fps)));
  state.startedAt = Date.now();
  state.pausedAt = 0;
  state.pausedMs = 0;
  startRecordingHealthMonitor();
  state.chapterMarkers = [];
  api.setQuickbarRecordingState(true).catch(() => {});
  $('#recording-time').textContent = '00:00';
  $('#recording-segments').textContent = 'מקטע 1';
  $('#recording-bar').classList.remove('hidden');
  $('#record-button span').textContent = 'עצור הקלטה';
  $('#record-button').dataset.recording = 'true';
  state.timer = setInterval(() => { $('#recording-time').textContent = formatTime(recordingElapsedMs()); }, 500);
  setStatus('מקליט', 'error');
  showToast('ההקלטה התחילה — קול המחשב והמיקרופון הפעילים מסונכרנים יחד');
}

async function finalizeRecording() {
  clearInterval(state.timer);
  clearInterval(state.drawTimer);
  clearInterval(state.healthTimer);
  state.drawTimer = null;
  state.healthTimer = null;
  $('#recording-bar').classList.add('hidden');
  $('#record-button span').textContent = 'התחל הקלטה';
  $('#record-button').dataset.recording = 'false';
  setStatus('שומר וממיר…', 'busy');
  state.recorder = null;
  // Saving/converting can take minutes; block a new capture until this session is fully closed.
  state.finalizing = true;
  const session = state.recordingSession;
  api.setQuickbarRecordingState(false).catch(() => {});
  try {
    await stopIsolatedAudioRecorders();
    await state.recordingAppendQueue;
    const writeError = state.recordingWriteError;
    // Even after a write error, close the session so the written segments are joined and kept.
    const result = await api.finishRecordingFile(session.id, $('#convert-mp4').checked, { chapters: state.chapterMarkers, cursorSamples: state.cursorSamples });
    state.recordingSession = null;
    if (writeError) showToast(`חלק מההקלטה לא נכתב לדיסק (${writeError.message}). מה שנשמר נשמר כאן: ${result.path}`, 10000);
    document.documentElement.dataset.lastSavedPath = result.path;
    stopInputStreams();
    const isolatedAudio = result.audioTracks?.length ? ` · ${result.audioTracks.length} ערוצי שמע נפרדים` : '';
    if (result.converted) showToast(`ההקלטה נשמרה כ-MP4${isolatedAudio}: ${result.path}`, 7000);
    else if (result.conversionError) showToast(`ה-WebM נשמר. המרת MP4 נכשלה: ${result.conversionError}`, 9000);
    else showToast(`ההקלטה נשמרה: ${result.path}`, 7000);
    setStatus('ההקלטה נשמרה');
    loadLibrary().catch(() => {});
    runWorkflows('recording', result.path).catch((error) => showToast(`אוטומציה נכשלה: ${error.message}`, 8000));
    restoreLivePreview();
  } catch (error) {
    stopInputStreams();
    setStatus('שגיאת שמירה', 'error');
    showToast(`שמירת ההקלטה נכשלה: ${error.message}`, 9000);
    restoreLivePreview();
  } finally {
    if (state.recordingSession === session) state.recordingSession = null;
    state.finalizing = false;
  }
}

async function refreshStorageStatus() {
  const status = await api.getStorageStatus();
  const freeLabel = Number.isFinite(status.freeBytes) ? `${(status.freeBytes / 1024 ** 3).toFixed(1)} GB פנויים` : 'לא ניתן למדוד';
  if ($('#storage-status')) $('#storage-status').textContent = freeLabel;
  if ($('#recovery-status')) $('#recovery-status').textContent = status.recovered ? `${status.recovered} שוחזרו` : 'אין הקלטות לשחזור';
  document.documentElement.dataset.storageLevel = status.level;
  document.documentElement.dataset.recoveredRecordings = String(status.recovered || 0);
  return status;
}

async function refreshCaptureCapabilities() {
  const capabilities = await api.getCaptureCapabilities();
  const status = $('#encoder-status');
  if (status) status.textContent = capabilities.hardware ? `${capabilities.preferredLabel} · חומרה` : capabilities.preferredLabel;
  document.documentElement.dataset.encoder = capabilities.preferred || 'unknown';
  document.documentElement.dataset.hardwareEncoder = String(Boolean(capabilities.hardware));
  return capabilities;
}

// Time inside the saved file: paused spans are excluded, as MediaRecorder excludes them.
function recordingElapsedMs() {
  if (!state.startedAt) return 0;
  const pausedNow = state.pausedAt ? Date.now() - state.pausedAt : 0;
  return Math.max(0, Date.now() - state.startedAt - (state.pausedMs || 0) - pausedNow);
}

function stopRecording() {
  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
}

function togglePause() {
  if (!state.recorder) return;
  const button = $('#pause-recording');
  if (state.recorder.state === 'recording') {
    state.recorder.pause();
    state.pausedAt = Date.now();
    state.audioRecorders.forEach((recorder) => { if (recorder.state === 'recording') recorder.pause(); });
    button.textContent = 'המשך';
    setStatus('מושהה', 'busy');
  } else if (state.recorder.state === 'paused') {
    state.recorder.resume();
    if (state.pausedAt) state.pausedMs += Date.now() - state.pausedAt;
    state.pausedAt = 0;
    state.audioRecorders.forEach((recorder) => { if (recorder.state === 'paused') recorder.resume(); });
    button.textContent = 'השהיה';
    setStatus('מקליט', 'error');
  }
}

async function executeShortcutAction(action) {
  if (action === 'record') return state.recorder ? stopRecording() : beginCapture('record', 'full');
  if (action === 'recordStart') return state.recorder ? showToast('כבר קיימת הקלטה פעילה') : beginCapture('record', 'full');
  if (action === 'recordStop') return state.recorder ? stopRecording() : showToast('אין הקלטה פעילה לעצירה');
  if (action === 'pause') return togglePause();
  if (action === 'screenshot') return beginCapture('screenshot', 'full');
  if (action === 'region') return beginCapture('screenshot', 'region');
  if (action === 'screenshotEdit') {
    const previous = state.afterScreenshotAction;
    state.afterScreenshotAction = 'professional';
    try { return await beginCapture('screenshot', 'full'); } finally { state.afterScreenshotAction = previous; }
  }
  if (action === 'microphone') {
    if (state.microphoneStream) return $('#recording-mic').click();
    return $('#mic-chip').click();
  }
  if (action === 'systemAudio') {
    if (state.displayStream && state.recorder) {
      const enabled = state.displayStream.getAudioTracks().some((track) => track.enabled);
      state.displayStream.getAudioTracks().forEach((track) => { track.enabled = !enabled; });
      return showToast(enabled ? 'קול המחשב הושתק' : 'קול המחשב הופעל');
    }
    $('#system-audio').checked = !$('#system-audio').checked;
    return showToast($('#system-audio').checked ? 'קול המחשב יוקלט' : 'קול המחשב לא יוקלט');
  }
  if (action === 'camera') {
    if (state.cameraStream) return $('#recording-camera').click();
    return $('#camera-source-shortcut').click();
  }
  if (action === 'openOutput') return api.openOutput();
  if (action === 'openLibrary') return showPage('library');
  if (action === 'openLatest') {
    if (!state.libraryItems.length) await loadLibrary();
    return state.libraryItems[0] ? api.openFile(state.libraryItems[0].path) : showToast('עדיין אין קבצים בספרייה');
  }
  if (action === 'editLatest') return openLatestScreenshotEditor('professional');
}

async function loadLibrary() {
  const items = await api.listLibrary();
  state.libraryItems = items;
  renderRecentLibrary(items);
  renderLibrary();
}

function sortedLibraryItems() {
  const query = $('#library-search')?.value.trim().toLocaleLowerCase('he') || '';
  const items = state.libraryItems.filter((item) => !query || [item.name, item.metadata?.ocrText, item.metadata?.transcriptText, item.metadata?.client, ...(item.metadata?.tags || [])].filter(Boolean).join(' ').toLocaleLowerCase('he').includes(query));
  const mode = $('#library-sort')?.value || 'date-desc';
  return [...items].sort((a, b) => {
    if (mode === 'date-asc') return a.modified - b.modified;
    if (mode === 'name-asc') return a.name.localeCompare(b.name, 'he');
    if (mode === 'name-desc') return b.name.localeCompare(a.name, 'he');
    if (mode === 'type') return a.extension.localeCompare(b.extension) || b.modified - a.modified;
    return b.modified - a.modified;
  });
}

function timeGroupLabel(modified) {
  const now = new Date();
  const date = new Date(modified);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((startToday - startDate) / 86_400_000);
  if (days === 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 7) return 'השבוע האחרון';
  if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) return 'החודש';
  return date.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

function libraryGroups(items) {
  const groupMode = $('#library-group')?.value || 'time';
  if (groupMode === 'none') return [['כל הקבצים', items]];
  const groups = new Map();
  for (const item of items) {
    const label = groupMode === 'type' ? (item.extension === 'png' ? 'תמונות' : 'סרטונים') : timeGroupLabel(item.modified);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  return [...groups.entries()];
}

function thumbnailMarkup(item, compact = false) {
  const isImage = item.extension === 'png';
  if (!item.thumbnail) return `${isImage ? '▣' : '▷'}`;
  return `<img src="${item.thumbnail}" alt="תמונה מקדימה של ${escapeHtml(item.name)}">${!isImage && compact ? '<span class="play-overlay">▷</span>' : ''}`;
}

function renderLibrary() {
  const container = $('#library-list');
  const items = sortedLibraryItems();
  if (!items.length) {
    container.innerHTML = `<div class="loading">${state.libraryItems.length ? 'לא נמצאו קבצים בשם הזה.' : 'עדיין אין קבצים. הצילום הראשון שלך יופיע כאן.'}</div>`;
    return;
  }
  container.innerHTML = '';
  for (const [label, groupItems] of libraryGroups(items)) {
    const heading = document.createElement('h3');
    heading.className = 'library-group-title';
    heading.textContent = `${label} · ${groupItems.length}`;
    container.append(heading);
    for (const item of groupItems) {
      const row = document.createElement('div');
      row.className = 'library-item';
      const baseName = item.name.replace(/\.[^.]+$/, '');
      const isImage = item.extension === 'png';
      const editButton = isImage ? '<button class="gold-button edit-image">עריכה</button><button class="ghost ocr">OCR</button><button class="ghost pin">הצמדה</button>' : '<button class="gold-button edit-video">עריכת וידאו</button><button class="ghost analyze">איכות</button><button class="ghost transcribe">תמלול</button>';
      const metadata = item.metadata || {};
      const metaBadges = [metadata.favorite ? '★ מועדף' : '', metadata.client ? `לקוח: ${escapeHtml(metadata.client)}` : '', ...(metadata.tags || []).map((tag) => `#${escapeHtml(tag)}`)].filter(Boolean).map((label) => `<span>${label}</span>`).join('');
      row.classList.toggle('favorite', Boolean(metadata.favorite));
      row.innerHTML = `<span class="file-icon">${thumbnailMarkup(item)}</span><div class="file-details"><strong>${escapeHtml(item.name)}${item.edited ? ' <em class="edited-badge">נערך</em>' : ''}</strong><small>${new Date(item.modified).toLocaleString('he-IL')} · ${formatBytes(item.size)} · ${item.extension.toUpperCase()}</small><div class="library-meta">${metaBadges}</div><div class="rename-editor hidden"><input maxlength="120" value="${escapeHtml(baseName)}" aria-label="שם קובץ חדש"><button class="gold-button save-name">שמירה</button><button class="ghost cancel-name">ביטול</button></div></div><div class="library-actions">${editButton}<button class="ghost metadata">פרטים</button><button class="ghost share">שיתוף פרטי</button><button class="ghost rename">שם</button><button class="ghost open">פתיחה</button><button class="ghost show">בתיקייה</button></div><div class="metadata-editor hidden"><input class="meta-client" maxlength="80" placeholder="לקוח / פרויקט" value="${escapeHtml(metadata.client || '')}"><input class="meta-tags" maxlength="160" placeholder="תגיות מופרדות בפסיק" value="${escapeHtml((metadata.tags || []).join(', '))}"><label><input class="meta-favorite" type="checkbox" ${metadata.favorite ? 'checked' : ''}> מועדף</label><button class="gold-button save-metadata">שמירה</button></div>`;
      row.querySelector('.edit-image')?.addEventListener('click', () => window.aurumEditor?.open(item.path, 'professional'));
      row.querySelector('.edit-video')?.addEventListener('click', () => openVideoEditor(item));
      row.querySelector('.ocr')?.addEventListener('click', async () => { try { showToast('מזהה טקסט מקומית…'); const result = await api.runOcr(item.path); showToast(`OCR הושלם: ${result.text.length} תווים`); await loadLibrary(); } catch (error) { showToast(`OCR נכשל: ${error.message}`); } });
      row.querySelector('.pin')?.addEventListener('click', async () => { try { await api.pinImage(item.path); showToast('הצילום הוצמד מעל החלונות'); } catch (error) { showToast(`הצמדה נכשלה: ${error.message}`); } });
      row.querySelector('.analyze')?.addEventListener('click', async () => { try { const result = await api.analyzeMedia(item.path); showToast(`ציון איכות ${result.score}/100 · ${result.fps} FPS · סנכרון ${result.avSyncOffsetMs ?? '—'}ms`, 9000); await loadLibrary(); } catch (error) { showToast(`ניתוח נכשל: ${error.message}`); } });
      row.querySelector('.transcribe')?.addEventListener('click', async () => { try { showToast('מתמלל במנוע המקומי הקיים…', 9000); const result = await api.transcribeMedia(item.path); showToast(`התמלול הושלם: ${result.wordCount} מילים וקובץ SRT נוצר`, 9000); await loadLibrary(); } catch (error) { showToast(`התמלול נכשל: ${error.message}`, 9000); } });
      row.querySelector('.open').addEventListener('click', () => api.openFile(item.path));
      row.querySelector('.show').addEventListener('click', () => api.showFile(item.path));
      row.querySelector('.share').addEventListener('click', async () => { const share = await api.shareLocal(item.path); showToast(`שיתוף פרטי מקומי הועתק · תפוגה ${new Date(share.expiresAt).toLocaleTimeString('he-IL')}`); });
      row.querySelector('.metadata').addEventListener('click', () => row.querySelector('.metadata-editor').classList.toggle('hidden'));
      row.querySelector('.save-metadata').addEventListener('click', async () => {
        await api.saveLibraryMetadata(item.path, { client: row.querySelector('.meta-client').value, tags: row.querySelector('.meta-tags').value, favorite: row.querySelector('.meta-favorite').checked });
        await loadLibrary();
      });
      row.querySelector('.rename').addEventListener('click', () => {
        row.querySelector('.rename-editor').classList.remove('hidden');
        row.querySelector('.rename-editor input').focus();
      });
      row.querySelector('.cancel-name').addEventListener('click', () => row.querySelector('.rename-editor').classList.add('hidden'));
      row.querySelector('.save-name').addEventListener('click', async () => {
        const input = row.querySelector('.rename-editor input');
        try {
          const result = await api.renameFile(item.path, input.value);
          showToast(`השם שונה ל־${result.name}`);
          await loadLibrary();
        } catch (error) { showToast(`שינוי השם נכשל: ${error.message}`); }
      });
      container.append(row);
    }
  }
}

function timelineDuration() { return Math.max(0.1, editingVideoProject?.duration || 0.1); }
function timelinePosition(time) { return `${Math.max(0, Math.min(100, Number(time || 0) / timelineDuration() * 100))}%`; }

function selectTimelineItem(type, id) {
  selectedTimelineItem = { type, id };
  const item = editingVideoProject?.[`${type}s`]?.find((candidate) => candidate.id === id);
  if (item) $('#video-editor-preview').currentTime = item.start;
  if (type === 'clip' && item) { $('#video-transition').value = item.transition; $('#video-transition-duration').value = item.transitionDuration; }
  if (type === 'caption' && item) { $('#video-caption-text').value = item.text; $('#video-caption-start').value = item.start.toFixed(2); $('#video-caption-end').value = item.end.toFixed(2); }
  renderVideoTimeline();
}

function renderVideoTimeline() {
  if (!editingVideoProject) return;
  const ruler = $('#timeline-ruler');
  const marks = Math.min(12, Math.max(4, Math.ceil(timelineDuration() / 5)));
  ruler.innerHTML = Array.from({ length: marks + 1 }, (_item, index) => `<span style="left:${index / marks * 100}%">${(timelineDuration() * index / marks).toFixed(1)}s</span>`).join('');
  const renderTrack = (type, label) => {
    const items = editingVideoProject[`${type}s`] || [];
    $(`#video-${type}-track`).innerHTML = items.map((item, index) => `<button class="timeline-block ${type} ${selectedTimelineItem?.type === type && selectedTimelineItem.id === item.id ? 'selected' : ''}" data-timeline-type="${type}" data-timeline-id="${item.id}" style="left:${timelinePosition(item.start)};width:${Math.max(0.7, (item.end - item.start) / timelineDuration() * 100)}%">${escapeHtml(type === 'caption' ? item.text : `${label} ${index + 1}`)}</button>`).join('');
  };
  renderTrack('clip', 'קליפ'); renderTrack('caption', 'כתובית'); renderTrack('zoom', 'זום');
  $('#timeline-status').textContent = `${editingVideoProject.clips.length} קליפים · ${editingVideoProject.captions.length} כתוביות · ${editingVideoProject.zooms.length} מקטעי זום · ${editingVideoProject.preset}`;
  $('.timeline-editor').dataset.timelineReady = 'true';
}

function updateTimelinePreview() {
  if (!editingVideoProject) return;
  const video = $('#video-editor-preview');
  $('#timeline-playhead').style.left = `calc(72px + (100% - 80px) * ${Math.max(0, Math.min(1, video.currentTime / timelineDuration()))})`;
  const caption = editingVideoProject.captions.find((item) => video.currentTime >= item.start && video.currentTime <= item.end);
  const overlay = $('#video-caption-overlay');
  overlay.classList.toggle('hidden', !caption);
  if (caption) { overlay.textContent = caption.text; overlay.style.left = `${caption.x * 100}%`; overlay.style.top = `${caption.y * 100}%`; overlay.dataset.captionId = caption.id; }
  if (!video.paused) {
    const activeIndex = editingVideoProject.clips.findIndex((clip) => video.currentTime >= clip.start && video.currentTime < clip.end);
    if (activeIndex >= 0 && video.currentTime >= editingVideoProject.clips[activeIndex].end - 0.04) {
      const next = editingVideoProject.clips[activeIndex + 1]; if (next) video.currentTime = next.start; else video.pause();
    } else if (activeIndex < 0) {
      const next = editingVideoProject.clips.find((clip) => clip.start > video.currentTime); if (next) video.currentTime = next.start;
    }
  }
}

async function openVideoEditor(item) {
  editingVideoItem = item;
  $('#video-editor-name').textContent = item.name;
  $('#video-mute').checked = false;
  $('#video-volume').value = '100';
  $('#video-volume-output').textContent = '100%';
  $('#video-editor-preview').src = `file:///${item.path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')}`;
  $('.timeline-editor').dataset.timelineReady = 'false';
  selectedTimelineItem = null;
  const loaded = await api.loadVideoTimeline(item.path);
  editingVideoProject = window.AurumTimeline.normalizeTimelineProject(loaded.project, loaded.quality.durationSeconds);
  editingVideoCursorSamples = loaded.cursorSamples || [];
  $('#video-export-preset').value = editingVideoProject.preset;
  $('#video-volume').value = String(editingVideoProject.volume);
  $('#video-volume-output').textContent = `${editingVideoProject.volume}%`;
  $('#video-mute').checked = editingVideoProject.mute;
  const waveform = $('#video-waveform');
  waveform.innerHTML = '<span>טוען צורת גל מקומית…</span>';
  api.getWaveform(item.path).then((dataUrl) => { if (editingVideoItem === item) waveform.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="צורת גל של ערוץ השמע">` : '<span>אין צורת גל</span>'; }).catch((error) => { waveform.innerHTML = `<span>${escapeHtml(error.message)}</span>`; });
  $('#video-editor-modal').classList.remove('hidden'); renderVideoTimeline();
}

function closeVideoEditor() {
  $('#video-editor-preview').pause();
  $('#video-editor-preview').removeAttribute('src');
  $('#video-editor-modal').classList.add('hidden');
  editingVideoItem = null;
  editingVideoProject = null;
  selectedTimelineItem = null;
}

function recentLibraryItems(items) {
  const filtered = items.filter((item) => {
    const isImage = item.extension === 'png';
    return state.recentFilter === 'all' || (state.recentFilter === 'image' ? isImage : !isImage);
  });
  return [...filtered].sort((a, b) => {
    if (state.recentSort === 'date-asc') return a.modified - b.modified;
    if (state.recentSort === 'name-asc') return a.name.localeCompare(b.name, 'he');
    if (state.recentSort === 'name-desc') return b.name.localeCompare(a.name, 'he');
    if (state.recentSort === 'size-desc') return b.size - a.size || b.modified - a.modified;
    return b.modified - a.modified;
  });
}

function renderRecentLibrary(items = state.libraryItems) {
  const recent = $('#recent-library');
  if (!recent) return;
  const counts = {
    all: items.length,
    image: items.filter((item) => item.extension === 'png').length
  };
  counts.video = counts.all - counts.image;
  Object.entries(counts).forEach(([kind, count]) => {
    const target = $(`[data-recent-count="${kind}"]`);
    if (target) target.textContent = count;
  });
  const visibleItems = recentLibraryItems(items);
  const filterLabels = { all: 'כל הפריטים', video: 'סרטונים', image: 'צילומי מסך' };
  $('#library-count').textContent = `${visibleItems.length} ${filterLabels[state.recentFilter]} · נשמרים מקומית`;
  recent.className = `clip-grid recent-view-${state.recentView}`;
  if (!visibleItems.length) {
    recent.innerHTML = `<div class="loading">${items.length ? `אין כרגע ${filterLabels[state.recentFilter]}` : 'הצילום הראשון שלך יופיע כאן'}</div>`;
    return;
  }
  recent.innerHTML = '';
  const limits = { cards: 4, compact: 8, list: 6 };
  for (const item of visibleItems.slice(0, limits[state.recentView])) {
    const card = document.createElement('article');
    card.className = 'clip-card';
    card.dataset.searchText = item.name.toLowerCase();
    const isImage = item.extension === 'png';
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${isImage ? 'צילום' : 'וידאו'}: ${item.name}`);
    card.innerHTML = `<div class="clip-thumb">${thumbnailMarkup(item, true)}<small>${isImage ? 'צילום' : 'וידאו'}</small></div><div class="clip-details"><b title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</b><small>${new Date(item.modified).toLocaleString('he-IL')} · ${formatBytes(item.size)}</small></div>`;
    card.addEventListener('dblclick', () => api.openFile(item.path));
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter') api.openFile(item.path); });
    recent.append(card);
  }
}

async function openLatestScreenshotEditor(mode = 'professional') {
  if (!state.libraryItems.length) await loadLibrary();
  const latestImage = state.libraryItems.find((item) => item.extension === 'png');
  if (!latestImage) {
    showPage('capture');
    $('[data-settings-tab="image"]')?.click();
    showToast('עדיין אין צילום מסך לעריכה — צלם תמונה ואז העורך ייפתח');
    return;
  }
  await window.aurumEditor?.open(latestImage.path, mode);
}

function showPage(page, navigationAction = null) {
  const titles = {
    capture: ['מה תרצה ליצור?', 'בחר מקור, איכות וקול — והתחל בלחיצה אחת.'],
    library: ['הספרייה שלי', 'כל הצילומים וההקלטות שנשמרו במחשב.'],
    tools: ['כלים חכמים', 'OCR, כתוביות, אבחון איכות ושיתוף פרטי מקומי.'],
    settings: ['הגדרות', 'תיקיית שמירה, פורמטים וקיצורי דרך.']
  };
  $$('.nav-item').forEach((button) => {
    const action = button.dataset.action || null;
    button.classList.toggle('active', button.dataset.page === page && action === navigationAction);
  });
  $('.content-shell').dataset.activePage = page;
  document.documentElement.dataset.activePage = page;
  $('.content-shell').dataset.activeNavigation = navigationAction || page;
  $('#theme-menu')?.classList.add('hidden');
  $('#capture-layout-menu')?.classList.add('hidden');
  closeCaptureSettingsDialog();
  if (page !== 'settings' && themeEditorOpen) cancelThemeEditor(false);
  $$('.page').forEach((section) => section.classList.remove('active'));
  $(`#${page}-page`).classList.add('active');
  if ($('#page-title')) $('#page-title').textContent = titles[page][0];
  if ($('#page-subtitle')) $('#page-subtitle').textContent = titles[page][1];
  $('#capture-settings').classList.toggle('hidden', page !== 'capture');
  if (page === 'capture') restoreLivePreview();
  else if (!state.recorder) stopLivePreview();
  if (page === 'library') loadLibrary();
  if (page === 'tools') refreshEngineStatus();
}

async function refreshEngineStatus() {
  const container = $('#engine-grid');
  if (!container) return;
  container.innerHTML = '<article><small>סורק מנועים קיימים…</small></article>';
  try {
    const engines = await api.getLocalEngines();
    const entries = [
      ['FFmpeg', engines.ffmpeg, engines.ffmpeg?.version], ['FFprobe', engines.ffprobe, engines.ffprobe?.version],
      ['OCR', engines.ocr, (engines.ocr?.languages || []).join(', ') || 'ללא שפות'], ['Whisper מקומי', engines.transcription, engines.transcription?.model || engines.transcription?.url]
    ];
    container.innerHTML = entries.map(([name, engine, detail]) => `<article><small>${escapeHtml(name)}</small><b class="${engine?.available ? 'ok' : 'missing'}">${engine?.available ? '● זמין וקיים' : '○ לא זמין'}</b><span>${escapeHtml(detail || '—')}</span></article>`).join('');
    document.documentElement.dataset.enginePolicy = engines.duplicatePolicy || 'unknown';
  } catch (error) { container.innerHTML = `<article><b class="missing">בדיקת המנועים נכשלה</b><span>${escapeHtml(error.message)}</span></article>`; }
}

async function runSmartAction(action, button) {
  if (!state.libraryItems.length) await loadLibrary();
  const image = state.libraryItems.find((item) => item.extension === 'png');
  const video = state.libraryItems.find((item) => item.extension !== 'png');
  const target = ['ocr', 'pin'].includes(action) ? image : video || image;
  if (!target) throw new Error('אין עדיין קובץ מתאים בספרייה');
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'מעבד מקומית…';
  try {
    let result;
    if (action === 'ocr') result = await api.runOcr(target.path);
    if (action === 'transcribe') result = await api.transcribeMedia(target.path);
    if (action === 'analyze') result = await api.analyzeMedia(target.path);
    if (action === 'pin') result = await api.pinImage(target.path);
    if (action === 'share') result = await api.shareLocal(target.path);
    $('#tool-result').textContent = `${original}\nקובץ: ${target.name}\n\n${JSON.stringify(result, null, 2)}`;
    await loadLibrary();
    showToast('הפעולה הסתיימה בהצלחה');
  } finally { button.disabled = false; button.textContent = original; }
}

async function initialize() {
  const appVersion = await api.getAppVersion().catch(() => 'לא ידועה');
  $('#app-version').textContent = `v${appVersion}`;
  document.documentElement.dataset.appVersion = appVersion;
  restoreUserPreferences();
  try { workflowDefinitions = JSON.parse(localStorage.getItem('aurum-workflows') || '[]'); } catch { workflowDefinitions = []; }
  if (!Array.isArray(workflowDefinitions)) workflowDefinitions = [];
  workflowExecutionLog = (localStorage.getItem('aurum-workflow-log') || 'עדיין לא הופעלה אוטומציה.').split('\n');
  $('#workflow-log').textContent = workflowExecutionLog.join('\n');
  renderWorkflows();
  await loadShortcutSettings();
  $$('.nav-item[data-page]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.action === 'edit') {
      openLatestScreenshotEditor('professional').catch((error) => showToast(`פתיחת העורך נכשלה: ${error.message}`));
      return;
    }
    showPage(button.dataset.page, button.dataset.action || null);
  }));
  $$('[data-page-link]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.pageLink)));
  $$('.page-tab').forEach((button) => button.addEventListener('click', () => {
    const previousTab = $('.page-tab.active')?.dataset.preferenceTab;
    if (previousTab === 'appearance' && button.dataset.preferenceTab !== 'appearance' && themeEditorOpen) cancelThemeEditor(false);
    $$('.page-tab').forEach((item) => item.classList.toggle('active', item === button));
    $$('.preference-section').forEach((section) => section.classList.toggle('active', section.dataset.preferenceSection === button.dataset.preferenceTab));
    if (button.dataset.preferenceTab === 'development') loadQaDashboard();
    if (button.dataset.preferenceTab === 'appearance') openThemeEditor();
    if (button.dataset.preferenceTab === 'workflows') renderWorkflows();
  }));
  $('#capture-layout-button').addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('#capture-layout-menu');
    const willOpen = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !willOpen);
    $('#capture-layout-button').setAttribute('aria-expanded', String(willOpen));
  });
  $$('[data-capture-layout-choice]').forEach((button) => button.addEventListener('click', () => applyCaptureLayout(button.dataset.captureLayoutChoice)));
  $('#capture-layout-select').addEventListener('change', (event) => applyCaptureLayout(event.target.value));
  $('#open-capture-settings').addEventListener('click', openCaptureSettingsDialog);
  $('#close-capture-settings').addEventListener('click', closeCaptureSettingsDialog);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.capture-layout-picker')) {
      $('#capture-layout-menu')?.classList.add('hidden');
      $('#capture-layout-button')?.setAttribute('aria-expanded', 'false');
    }
  });
  $$('[data-shortcut-action]').forEach((button) => button.addEventListener('click', () => {
    listeningShortcutAction = button.dataset.shortcutAction;
    const row = button.closest('[data-shortcut-row]');
    row.dataset.pendingKind = row.querySelector('[data-shortcut-kind]').value;
    row.dataset.pendingScope = row.querySelector('[data-shortcut-scope]').value;
    renderShortcutSettings();
    button.textContent = 'לחץ על הקיצור…';
    button.focus();
  }));
  $('#shortcut-settings-list').addEventListener('change', (event) => {
    const intervalAction = event.target.dataset.shortcutInterval;
    if (intervalAction) {
      const current = state.shortcuts[intervalAction];
      if (current?.kind === 'double') applyShortcutSettings({ ...state.shortcuts, [intervalAction]: { ...current, intervalMs: Number(event.target.value) } });
      return;
    }
    const action = event.target.dataset.shortcutKind || event.target.dataset.shortcutScope;
    if (!action) return;
    const row = event.target.closest('[data-shortcut-row]');
    row.dataset.pendingKind = row.querySelector('[data-shortcut-kind]').value;
    row.dataset.pendingScope = row.querySelector('[data-shortcut-scope]').value;
    listeningShortcutAction = action;
    const button = row.querySelector('[data-shortcut-action]');
    button.textContent = 'לחץ על המקש…'; button.classList.add('listening'); button.focus();
  });
  $('#shortcut-settings-list').addEventListener('click', async (event) => {
    const action = event.target.dataset.shortcutClear;
    if (!action) return;
    const candidate = { ...state.shortcuts, [action]: null };
    await applyShortcutSettings(candidate);
  });
  $('#shortcut-search').addEventListener('input', filterShortcutRows);
  $('#shortcut-category').addEventListener('change', filterShortcutRows);
  $$('[data-shortcut-test]').forEach((button) => button.addEventListener('click', async () => {
    const action = button.dataset.shortcutTest;
    button.textContent = 'בודק…';
    await api.testShortcut(action);
    setTimeout(() => { button.textContent = 'בדיקה'; }, 1200);
  }));
  $('#reset-shortcuts').addEventListener('click', () => applyShortcutSettings(defaultShortcuts));
  document.addEventListener('keydown', async (event) => {
    if (!listeningShortcutAction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      listeningShortcutAction = null;
      renderShortcutSettings();
      return;
    }
    const row = $(`[data-shortcut-row="${listeningShortcutAction}"]`);
    const intervalMs = Number(row?.querySelector('[data-shortcut-interval]')?.value) || ((row?.dataset.pendingKind || 'chord') === 'double' ? 500 : 300);
    const binding = shortcutBindingFromEvent(event, { kind: row?.dataset.pendingKind || 'chord', scope: row?.dataset.pendingScope || 'global', intervalMs });
    if (!binding) {
      if (/^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(event.code)) showToast('מקש Windows, Ctrl, Alt או Shift לבדו אינו מתאים ללחיצה כפולה. בחר F8–F11, Numpad או מקש רגיל במצב אפליקציה.');
      return;
    }
    if (binding.kind !== 'chord' && /^Key[A-Z]$/.test(binding.code) && binding.scope === 'global') {
      binding.scope = 'focused';
      showToast('מקש אות יחיד או כפול הוגבל לאפליקציה כדי שלא יופעל בזמן הקלדה');
    }
    const action = listeningShortcutAction;
    listeningShortcutAction = null;
    const previous = state.shortcuts[action];
    state.shortcuts[action] = binding;
    if (!await applyShortcutSettings(state.shortcuts)) state.shortcuts[action] = previous;
    renderShortcutSettings();
  }, true);
  document.addEventListener('keydown', (event) => handleFocusedShortcutEvent(event), true);
  $$('#quality-options button').forEach((button) => button.addEventListener('click', () => {
    $$('#quality-options button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.quality = button.dataset.quality;
  }));
  $('#refresh-sources').addEventListener('click', refreshSources);
  $('#expand-preview').addEventListener('click', () => {
    const stage = $('.capture-preview');
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen().catch((error) => showToast(`לא ניתן להגדיל: ${error.message}`));
  });
  $$('[data-preview-fit]').forEach((button) => button.addEventListener('click', () => applyVisualCapturePreferences({ previewFit: button.dataset.previewFit })));
  $('#preview-zoom').addEventListener('input', (event) => applyVisualCapturePreferences({ previewZoom: event.target.value }));
  $('#toggle-safe-area').addEventListener('click', () => applyVisualCapturePreferences({ safeArea: !state.safeArea }));
  $('#camera-position').addEventListener('change', (event) => applyVisualCapturePreferences({ cameraPosition: event.target.value }));
  $('#camera-size').addEventListener('input', (event) => applyVisualCapturePreferences({ cameraSize: event.target.value }));
  $('#screenshot-button').addEventListener('click', () => beginCapture('screenshot'));
  $('#record-button').addEventListener('click', () => state.recorder ? stopRecording() : beginCapture(state.captureKind));
  $('#stop-recording').addEventListener('click', stopRecording);
  $('#pause-recording').addEventListener('click', togglePause);
  $('#recording-pause').addEventListener('click', togglePause);
  $('#recording-chapter').addEventListener('click', () => {
    if (!state.recorder) return;
    const at = Math.max(0, recordingElapsedMs() / 1000);
    state.chapterMarkers.push({ at, label: `פרק ${state.chapterMarkers.length + 1}` });
    showToast(`סימון פרק ${state.chapterMarkers.length} נוסף ב־${formatTime(at * 1000)}`);
  });
  $('#recording-mic').addEventListener('click', () => {
    const muted = state.microphoneStream?.getAudioTracks().some((track) => track.enabled) ?? false;
    state.microphoneStream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    $('#recording-mic').classList.toggle('off', muted);
  });
  $('#recording-camera').addEventListener('click', () => {
    const enabled = state.cameraStream?.getVideoTracks().some((track) => track.enabled) ?? false;
    state.cameraStream?.getVideoTracks().forEach((track) => { track.enabled = !enabled; });
    $('#recording-camera').classList.toggle('off', enabled);
  });
  $('#close-video-editor').addEventListener('click', closeVideoEditor);
  $('#cancel-video-edit').addEventListener('click', closeVideoEditor);
  $('#video-volume').addEventListener('input', (event) => { $('#video-volume-output').textContent = `${event.target.value}%`; });
  $('#video-editor-preview').addEventListener('timeupdate', updateTimelinePreview);
  $('#video-timeline').addEventListener('click', (event) => {
    const block = event.target.closest('[data-timeline-type]');
    if (block) return selectTimelineItem(block.dataset.timelineType, block.dataset.timelineId);
    const track = event.target.closest('.timeline-track>div,.timeline-ruler');
    if (track && editingVideoProject) { const rect = track.getBoundingClientRect(); $('#video-editor-preview').currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * timelineDuration(); }
  });
  $('#video-split').addEventListener('click', () => {
    if (!editingVideoProject) return;
    const at = $('#video-editor-preview').currentTime;
    const clip = editingVideoProject.clips.find((item) => at > item.start && at < item.end);
    if (!clip) return showToast('מקם את הסמן בתוך קליפ כדי לפצל');
    const result = window.AurumTimeline.splitClip(editingVideoProject, clip.id, at);
    editingVideoProject = result; selectedTimelineItem = { type: 'clip', id: result.clips.find((item) => Math.abs(item.start - at) < 0.05)?.id || result.clips[0].id }; renderVideoTimeline();
  });
  $('#video-remove-silence').addEventListener('click', async () => {
    if (!editingVideoItem || !editingVideoProject) return;
    const button = $('#video-remove-silence'); button.disabled = true; button.textContent = 'מנתח שמע…';
    try { const silences = await api.detectVideoSilence(editingVideoItem.path, { noiseDb: -38, minimumSeconds: 0.55 }); editingVideoProject.clips = window.AurumTimeline.clipsWithoutSilence(editingVideoProject.duration, silences); selectedTimelineItem = null; renderVideoTimeline(); showToast(`${silences.length} קטעים שקטים זוהו והוסרו מה-Timeline`); }
    catch (error) { showToast(`זיהוי שתיקות נכשל: ${error.message}`, 8000); }
    finally { button.disabled = false; button.textContent = '≋ הסרת מילים שקטות'; }
  });
  $('#video-add-caption').addEventListener('click', () => {
    if (!editingVideoProject) return; const start = $('#video-editor-preview').currentTime;
    const caption = { id: `caption-${Date.now()}`, text: 'כתובית חדשה', start, end: Math.min(editingVideoProject.duration, start + 2), x: .5, y: .84 };
    editingVideoProject.captions.push(caption); selectTimelineItem('caption', caption.id);
  });
  $('#video-auto-zoom').addEventListener('click', () => {
    if (!editingVideoProject) return;
    const samples = editingVideoCursorSamples.length ? editingVideoCursorSamples : [{ at: $('#video-editor-preview').currentTime, x: .5, y: .5 }];
    editingVideoProject.zooms = window.AurumTimeline.cursorZooms(samples, editingVideoProject.duration); renderVideoTimeline();
    showToast(editingVideoCursorSamples.length ? `${editingVideoProject.zooms.length} מקטעי זום נוצרו מנתיב העכבר שהוקלט` : 'לא נמצא נתיב עכבר בהקלטה הישנה — נוסף זום במיקום הסמן');
  });
  $('#video-export-preset').addEventListener('change', (event) => { if (editingVideoProject) editingVideoProject.preset = event.target.value; renderVideoTimeline(); });
  $('#video-transition').addEventListener('change', (event) => { const item = editingVideoProject?.clips.find((clip) => selectedTimelineItem?.type === 'clip' && clip.id === selectedTimelineItem.id); if (item) { item.transition = event.target.value; renderVideoTimeline(); } });
  $('#video-transition-duration').addEventListener('change', (event) => { const item = editingVideoProject?.clips.find((clip) => selectedTimelineItem?.type === 'clip' && clip.id === selectedTimelineItem.id); if (item) item.transitionDuration = Number(event.target.value); });
  const updateCaption = () => { const item = editingVideoProject?.captions.find((caption) => selectedTimelineItem?.type === 'caption' && caption.id === selectedTimelineItem.id); if (!item) return; item.text = $('#video-caption-text').value; item.start = Number($('#video-caption-start').value); item.end = Number($('#video-caption-end').value); renderVideoTimeline(); updateTimelinePreview(); };
  $('#video-caption-text').addEventListener('input', updateCaption); $('#video-caption-start').addEventListener('change', updateCaption); $('#video-caption-end').addEventListener('change', updateCaption);
  $('#video-caption-overlay').addEventListener('pointerdown', (event) => {
    const overlay = event.currentTarget; const id = overlay.dataset.captionId; const stage = $('#video-preview-stage'); overlay.setPointerCapture(event.pointerId);
    const move = (moveEvent) => { const caption = editingVideoProject?.captions.find((item) => item.id === id); if (!caption) return; const rect = stage.getBoundingClientRect(); caption.x = Math.max(.05, Math.min(.95, (moveEvent.clientX - rect.left) / rect.width)); caption.y = Math.max(.05, Math.min(.95, (moveEvent.clientY - rect.top) / rect.height)); updateTimelinePreview(); };
    const up = () => { overlay.removeEventListener('pointermove', move); overlay.removeEventListener('pointerup', up); renderVideoTimeline(); };
    overlay.addEventListener('pointermove', move); overlay.addEventListener('pointerup', up);
  });
  $('#video-delete-item').addEventListener('click', () => { if (!editingVideoProject || !selectedTimelineItem) return; const key = `${selectedTimelineItem.type}s`; if (selectedTimelineItem.type === 'clip' && editingVideoProject.clips.length <= 1) return showToast('חייב להישאר לפחות קליפ אחד'); editingVideoProject[key] = editingVideoProject[key].filter((item) => item.id !== selectedTimelineItem.id); selectedTimelineItem = null; renderVideoTimeline(); });
  $('#save-video-project').addEventListener('click', async () => { if (!editingVideoItem || !editingVideoProject) return; const result = await api.saveVideoTimeline(editingVideoItem.path, editingVideoProject); editingVideoProject = result.project; showToast('פרויקט ה-Timeline נשמר ללא שינוי בקובץ המקור'); });
  $('#save-video-edit').addEventListener('click', async () => {
    if (!editingVideoItem) return;
    const button = $('#save-video-edit');
    button.disabled = true;
    button.textContent = 'מעבד…';
    try {
      editingVideoProject.volume = Number($('#video-volume').value); editingVideoProject.mute = $('#video-mute').checked; editingVideoProject.preset = $('#video-export-preset').value;
      const result = await api.exportVideoTimeline(editingVideoItem.path, editingVideoProject);
      closeVideoEditor();
      showToast(`העותק הערוך נשמר: ${result.path}`);
      await loadLibrary();
    } catch (error) { document.documentElement.dataset.videoExportError = error.message; showToast(`עריכת הווידאו נכשלה: ${error.message}`, 15_000); }
    finally { button.disabled = false; button.textContent = 'ייצוא עותק ערוך'; }
  });
  $('#add-workflow').addEventListener('click', () => addWorkflow());
  $$('[data-workflow-template]').forEach((button) => button.addEventListener('click', () => addWorkflow(button.dataset.workflowTemplate)));
  $('#workflow-list').addEventListener('change', (event) => { const card = event.target.closest('[data-workflow-index]'); if (!card) return; const workflow = workflowDefinitions[Number(card.dataset.workflowIndex)]; const field = event.target.dataset.workflowField; const action = event.target.dataset.workflowAction; if (field) workflow[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value; if (['name', 'client'].includes(field)) { localStorage.setItem('aurum-workflows', JSON.stringify(workflowDefinitions)); return; } if (action) { if (event.target.checked && !workflow.actions.includes(action)) workflow.actions.push(action); if (!event.target.checked) workflow.actions = workflow.actions.filter((item) => item !== action); } saveWorkflows(); });
  $('#workflow-list').addEventListener('input', (event) => { const card = event.target.closest('[data-workflow-index]'); const field = event.target.dataset.workflowField; if (!card || !['name', 'client'].includes(field)) return; workflowDefinitions[Number(card.dataset.workflowIndex)][field] = event.target.value; localStorage.setItem('aurum-workflows', JSON.stringify(workflowDefinitions)); });
  $('#workflow-list').addEventListener('click', (event) => { const button = event.target.closest('[data-workflow-delete]'); if (!button) return; const card = button.closest('[data-workflow-index]'); workflowDefinitions.splice(Number(card.dataset.workflowIndex), 1); saveWorkflows(); });
  $('#copy-workflow-log').addEventListener('click', () => api.copyText(workflowExecutionLog.join('\n')));
  $('#open-output').addEventListener('click', () => api.openOutput());
  $('#quick-open-output').addEventListener('click', () => api.openOutput());
  $('#edit-latest-image').addEventListener('click', () => openLatestScreenshotEditor('professional').catch((error) => showToast(`פתיחת העורך נכשלה: ${error.message}`)));
  $('#quick-edit-latest').addEventListener('click', () => openLatestScreenshotEditor('professional').catch((error) => showToast(`פתיחת העורך נכשלה: ${error.message}`)));
  $('#choose-output').addEventListener('click', async () => { $('#output-path').textContent = await api.chooseOutput(); });
  $('#autostart-app').addEventListener('change', async (event) => { event.target.checked = await api.setAutostart(event.target.checked); });
  const updateQuickbar = async (patch) => {
    const preferences = await api.setQuickbarPreferences(patch);
    $('#quickbar-enabled').checked = preferences.enabled;
    $('#quickbar-edge').value = preferences.edge;
    $('#quickbar-activation').value = preferences.activation;
    $('#quickbar-display').value = preferences.display;
    $('#quickbar-pinned').checked = preferences.pinned;
    $$('#quickbar-edge,#quickbar-activation,#quickbar-display,#quickbar-pinned').forEach((control) => { control.disabled = !preferences.enabled; });
  };
  $('#quickbar-enabled').addEventListener('change', (event) => updateQuickbar({ enabled: event.target.checked }));
  $('#quickbar-edge').addEventListener('change', (event) => updateQuickbar({ edge: event.target.value }));
  $('#quickbar-activation').addEventListener('change', (event) => updateQuickbar({ activation: event.target.value }));
  $('#quickbar-display').addEventListener('change', (event) => updateQuickbar({ display: event.target.value }));
  $('#quickbar-pinned').addEventListener('change', (event) => updateQuickbar({ pinned: event.target.checked }));
  $('#refresh-engines').addEventListener('click', refreshEngineStatus);
  $$('[data-smart-action]').forEach((button) => button.addEventListener('click', () => runSmartAction(button.dataset.smartAction, button).catch((error) => { $('#tool-result').textContent = `שגיאה: ${error.message}`; showToast(`הפעולה נכשלה: ${error.message}`, 9000); })));
  $('#microphone').addEventListener('change', async (event) => {
    try { if (event.target.checked) await ensureDevicePermission('audio'); else await refreshDevices(); }
    catch (error) { event.target.checked = false; showToast(`אין גישה למיקרופון: ${error.message}`); }
  });
  $('#camera').addEventListener('change', async (event) => {
    try { if (event.target.checked) await ensureDevicePermission('video'); else await refreshDevices(); }
    catch (error) { event.target.checked = false; showToast(`אין גישה למצלמה: ${error.message}`); }
  });
  $$('.settings-tab').forEach((button) => button.addEventListener('click', () => {
    $$('.settings-tab').forEach((item) => item.classList.toggle('active', item === button));
    $$('.settings-section').forEach((section) => section.classList.toggle('active', section.dataset.settingsSection === button.dataset.settingsTab));
  }));
  $$('.source-type[data-source-filter]').forEach((button) => button.addEventListener('click', () => {
    state.sourceFilter = button.dataset.sourceFilter;
    $$('.source-type[data-source-filter]').forEach((item) => item.classList.toggle('active', item === button));
    renderSources();
  }));
  $('#camera-source-shortcut').addEventListener('click', () => {
    $('#camera').checked = !$('#camera').checked;
    $('#camera').dispatchEvent(new Event('change'));
  });
  $('#mic-chip').addEventListener('click', () => {
    $('#microphone').checked = !$('#microphone').checked;
    $('#microphone').dispatchEvent(new Event('change'));
  });
  $('#camera-chip').addEventListener('click', () => $('#camera-source-shortcut').click());
  $('#resolution-select').addEventListener('change', (event) => {
    state.targetHeight = Number(event.target.value);
    $('#quality-status').textContent = `${event.target.options[event.target.selectedIndex].text.split(' ')[0]} · ${$('#fps-select').value}fps`;
  });
  $('#fps-select').addEventListener('change', (event) => {
    const fps = Number(event.target.value);
    qualityPresets.motion.fps = fps;
    state.quality = 'motion';
    $('#quality-status').textContent = `${$('#resolution-select').selectedOptions[0].text.split(' ')[0]} · ${fps}fps`;
  });
  $('#bitrate-range').addEventListener('input', (event) => {
    qualityPresets.motion.bitrate = Number(event.target.value) * 1_000_000;
    state.quality = 'motion';
    $('#bitrate-output').textContent = `${event.target.value} Mbps`;
  });
  $('#mic-volume').addEventListener('input', (event) => { $('#mic-volume-output').textContent = `${event.target.value}%`; });
  $('#system-volume').addEventListener('input', (event) => { $('#system-volume-output').textContent = `${event.target.value}%`; });
  $('#format-select').addEventListener('change', (event) => { $('#convert-mp4').checked = event.target.value === 'mp4'; });
  $('#theme-button').addEventListener('click', () => $('#theme-menu').classList.toggle('hidden'));
  $$('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => {
    applyThemeChoice(button.dataset.themeChoice, true);
    $('#theme-menu').classList.add('hidden');
  }));
  migrateLegacyTheme();
  renderCustomThemeMenus();
  applyThemeChoice(localStorage.getItem('aurum-theme') || 'midnight');
  $('#custom-theme-menu-items').addEventListener('click', (event) => {
    const button = event.target.closest('[data-custom-theme-id]');
    if (!button) return;
    applyThemeChoice(`custom:${button.dataset.customThemeId}`, true);
    $('#theme-menu').classList.add('hidden');
  });
  $('#create-theme-shortcut').addEventListener('click', () => openThemeManagement(true));
  $('#manage-themes-shortcut').addEventListener('click', () => openThemeManagement(false));
  $('#layouts-shortcut')?.addEventListener('click', () => { openThemeManagement(false); $('#appearance-picker')?.scrollIntoView({ block: 'start' }); });
  $('#new-custom-theme').addEventListener('click', () => newThemeDraft($('#theme-base-select').value));
  $('#custom-theme-select').addEventListener('change', (event) => event.target.value ? loadCustomThemeDraft(event.target.value) : newThemeDraft($('#theme-base-select').value));
  $('#duplicate-custom-theme').addEventListener('click', duplicateSelectedTheme);
  $('#delete-custom-theme').addEventListener('click', (event) => {
    const button = event.currentTarget;
    if (button.dataset.confirm !== 'true') {
      button.dataset.confirm = 'true';
      button.textContent = 'לחץ שוב למחיקה';
      setTimeout(() => { button.dataset.confirm = ''; button.textContent = '⌫ מחיקה'; }, 3500);
      return;
    }
    button.dataset.confirm = '';
    button.textContent = '⌫ מחיקה';
    deleteSelectedTheme();
  });
  $('#custom-theme-name').addEventListener('input', () => {
    $('#theme-draft-status').textContent = 'שינויים שטרם נשמרו';
    $('#theme-draft-status').classList.add('changed');
    document.documentElement.dataset.themeDraft = 'true';
  });
  $$('[data-theme-var]').forEach((input) => input.addEventListener('input', () => {
    const value = input.value.toLowerCase();
    input.nextElementSibling.textContent = value.toUpperCase();
    document.documentElement.style.setProperty(input.dataset.themeVar, value);
    $('#theme-draft-status').textContent = 'שינויים שטרם נשמרו';
    $('#theme-draft-status').classList.add('changed');
    document.documentElement.dataset.themeDraft = 'true';
  }));
  $('#theme-base-select').addEventListener('change', (event) => {
    const base = event.target.value;
    clearCustomThemeVariables();
    document.documentElement.dataset.theme = base;
    document.documentElement.dataset.themeMode = 'draft';
    setThemeDraft(themeDefinitions[base], true);
  });
  $('#reset-theme-draft').addEventListener('click', () => setThemeDraft(themeDefinitions[$('#theme-base-select').value], true));
  $('#cancel-theme-edit').addEventListener('click', () => cancelThemeEditor());
  $('#save-theme-edit').addEventListener('click', saveCustomTheme);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && themeEditorOpen && $('[data-preference-section="appearance"]').classList.contains('active')) cancelThemeEditor();
    if (event.key === 'Escape' && document.documentElement.dataset.captureSettingsOpen === 'true') closeCaptureSettingsDialog();
    if (event.key === 'Escape') {
      $('#capture-layout-menu')?.classList.add('hidden');
      $('#capture-layout-button')?.setAttribute('aria-expanded', 'false');
    }
  });
  $('#global-search').addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    $$('.clip-card').forEach((card) => { card.hidden = query && !card.dataset.searchText.includes(query); });
  });
  $('#library-search').addEventListener('input', renderLibrary);
  $('#library-sort').addEventListener('change', renderLibrary);
  $('#library-group').addEventListener('change', renderLibrary);
  $$('button[data-recent-filter]').forEach((button) => button.addEventListener('click', () => {
    applyRecentPreferences(button.dataset.recentFilter, state.recentSort, state.recentView);
    renderRecentLibrary();
  }));
  $('#recent-sort').addEventListener('change', (event) => {
    applyRecentPreferences(state.recentFilter, event.target.value, state.recentView);
    renderRecentLibrary();
  });
  $$('button[data-recent-view]').forEach((button) => button.addEventListener('click', () => {
    applyRecentPreferences(state.recentFilter, state.recentSort, button.dataset.recentView);
    renderRecentLibrary();
  }));
  $$('button[data-library-view]').forEach((button) => button.addEventListener('click', () => {
    applyLibraryPreferences(button.dataset.libraryView, state.librarySize);
    renderLibrary();
  }));
  $('#library-size').addEventListener('input', (event) => {
    applyLibraryPreferences(state.libraryView, ({ 1: 'small', 2: 'medium', 3: 'large' })[event.target.value]);
    renderLibrary();
  });
  $('#default-capture-kind').addEventListener('change', (event) => applyCapturePreferences(event.target.value, state.captureScope));
  $('#default-capture-scope').addEventListener('change', (event) => applyCapturePreferences(state.captureKind, event.target.value));
  $('#after-screenshot-action').addEventListener('change', (event) => applyAfterScreenshotAction(event.target.value));
  $('#capture-delay').addEventListener('change', (event) => applyCaptureDelay(event.target.value));
  $$('input[name="screenshot-mode"]').forEach((radio) => radio.addEventListener('change', (event) => {
    if (event.target.checked) applyCapturePreferences(state.captureKind, event.target.value);
  }));
  api.onQaOutput((text) => {
    qaConsoleText += text;
    const consoleElement = $('#qa-console');
    consoleElement.textContent = qaConsoleText;
    consoleElement.scrollTop = consoleElement.scrollHeight;
  });
  window.addEventListener('aurum:library-changed', () => loadLibrary().catch(() => {}));
  $('#refresh-qa').addEventListener('click', loadQaDashboard);
  $('#run-qa').addEventListener('click', async () => {
    qaConsoleText = '';
    renderQaStatus({ ...(latestQaStatus || {}), running: true, available: true, console: '' });
    try { renderQaStatus(await api.runQa()); }
    catch (error) {
      qaConsoleText += `\nשגיאה: ${error.message}`;
      await loadQaDashboard();
    }
  });
  $('#copy-qa-console').addEventListener('click', (event) => copyWithFeedback(event.currentTarget, $('#qa-console').textContent));
  $('#copy-qa-report').addEventListener('click', (event) => copyWithFeedback(event.currentTarget, qaReportText(latestQaStatus)));
  $('#open-qa-report').addEventListener('click', () => api.openQaReport());
  navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  api.onShortcut((action, meta = {}) => {
    if (meta.test) {
      const row = $(`[data-shortcut-row="${action}"]`);
      row?.classList.add('tested');
      setTimeout(() => row?.classList.remove('tested'), 1200);
      showToast(`הקיצור עבור ${row?.querySelector('b')?.textContent || action} מחובר ותקין`);
      return;
    }
    executeShortcutAction(action).catch((error) => showToast(`הפעלת הקיצור נכשלה: ${error.message}`));
  });
  api.onNavigate((page) => showPage(page));
  document.documentElement.dataset.appReady = 'true';
  setTimeout(() => Promise.all([
    api.getOutput().then((value) => { $('#output-path').textContent = value; }), api.getAutostart().then((enabled) => { $('#autostart-app').checked = enabled; }), api.getQuickbarPreferences().then((preferences) => {
      $('#quickbar-enabled').checked = preferences.enabled; $('#quickbar-edge').value = preferences.edge; $('#quickbar-activation').value = preferences.activation; $('#quickbar-display').value = preferences.display; $('#quickbar-pinned').checked = preferences.pinned;
      $$('#quickbar-edge,#quickbar-activation,#quickbar-display,#quickbar-pinned').forEach((control) => { control.disabled = !preferences.enabled; });
    }),
    refreshSources(), loadLibrary(), refreshStorageStatus()
  ]).catch((error) => {
    console.warn('Deferred library/status refresh failed', error);
  }), 0);
  setTimeout(() => refreshCaptureCapabilities().catch((error) => {
    if ($('#encoder-status')) $('#encoder-status').textContent = 'בדיקה נכשלה';
    console.warn('Video encoder capability probe failed', error);
  }), 250);
}

initialize().catch((error) => showToast(`אתחול האפליקציה נכשל: ${error.message}`, 10000));
