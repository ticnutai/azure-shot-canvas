const api = window.screenStudio;

const state = {
  sources: [],
  selectedSource: null,
  quality: 'balanced',
  recorder: null,
  displayStream: null,
  microphoneStream: null,
  cameraStream: null,
  outputStream: null,
  audioContext: null,
  qaSystemAudioContext: null,
  qaSystemAudioOscillator: null,
  drawTimer: null,
  chunks: [],
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
  afterScreenshotAction: 'save',
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
  state.captureScope = ['full', 'region'].includes(scope) ? scope : 'full';
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
    const scopeLabel = state.captureScope === 'region' ? 'אזור לבחירה' : 'מסך מלא';
    $('#capture-default-summary').textContent = `${kindLabel} · ${scopeLabel}`;
  }
  if (persist) {
    localStorage.setItem('aurum-default-capture-kind', state.captureKind);
    localStorage.setItem('aurum-default-capture-scope', state.captureScope);
  }
}

function applyAfterScreenshotAction(action = 'save', persist = true) {
  state.afterScreenshotAction = ['save', 'quick', 'professional'].includes(action) ? action : 'save';
  if ($('#after-screenshot-action')) $('#after-screenshot-action').value = state.afterScreenshotAction;
  if (persist) localStorage.setItem('aurum-after-screenshot-action', state.afterScreenshotAction);
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
  applyCapturePreferences(localStorage.getItem('aurum-default-capture-kind') || 'record', localStorage.getItem('aurum-default-capture-scope') || 'full', false);
  applyAfterScreenshotAction(localStorage.getItem('aurum-after-screenshot-action') || 'save', false);
  applyLibraryPreferences(localStorage.getItem('aurum-library-view') || 'grid', localStorage.getItem('aurum-library-size') || 'medium', false);
  applyRecentPreferences(localStorage.getItem('aurum-recent-filter') || 'all', localStorage.getItem('aurum-recent-sort') || 'date-desc', localStorage.getItem('aurum-recent-view') || 'cards', false);
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
    document.documentElement.dataset.theme = themeDefinitions[choice] ? choice : 'midnight';
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
  document.documentElement.dataset.theme = base;
  document.documentElement.dataset.themeMode = 'draft';
  setThemeDraft(custom?.values || themeDefinitions[base], false);
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
      });
      grid.append(button);
  }
  if (!visibleSources.length) grid.innerHTML = `<div class="loading">לא נמצאו מקורות מסוג ${state.sourceFilter === 'screen' ? 'מסך' : 'חלון'}.</div>`;
}

function escapeHtml(text) {
  const node = document.createElement('span');
  node.textContent = text;
  return node.innerHTML;
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
  }
}

function stopInputStreams() {
  for (const stream of [state.displayStream, state.microphoneStream, state.cameraStream, state.outputStream]) {
    stream?.getTracks().forEach((track) => track.stop());
  }
  state.displayStream = null;
  state.microphoneStream = null;
  state.cameraStream = null;
  state.outputStream = null;
  if (state.audioContext && state.audioContext.state !== 'closed') state.audioContext.close();
  state.audioContext = null;
  if (state.qaSystemAudioOscillator) state.qaSystemAudioOscillator.stop();
  state.qaSystemAudioOscillator = null;
  if (state.qaSystemAudioContext && state.qaSystemAudioContext.state !== 'closed') state.qaSystemAudioContext.close();
  state.qaSystemAudioContext = null;
  clearInterval(state.drawTimer);
  state.drawTimer = null;
  displayVideo.srcObject = null;
  cameraVideo.srcObject = null;
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
  if (state.cameraStream && cameraVideo.videoWidth) {
    const targetWidth = Math.round(recordingCanvas.width * 0.2);
    const targetHeight = Math.round(targetWidth * cameraVideo.videoHeight / cameraVideo.videoWidth);
    const margin = Math.max(16, Math.round(recordingCanvas.width * 0.018));
    const x = recordingCanvas.width - targetWidth - margin;
    const y = recordingCanvas.height - targetHeight - margin;
    recordingContext.save();
    roundedRect(recordingContext, x, y, targetWidth, targetHeight, Math.max(12, targetWidth * 0.05));
    recordingContext.clip();
    recordingContext.drawImage(cameraVideo, x, y, targetWidth, targetHeight);
    recordingContext.restore();
    recordingContext.strokeStyle = '#ffffffcc';
    recordingContext.lineWidth = Math.max(2, targetWidth * 0.008);
    roundedRect(recordingContext, x, y, targetWidth, targetHeight, Math.max(12, targetWidth * 0.05));
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
    };
    const down = (event) => { dragging = true; start = point(event); canvas.setPointerCapture(event.pointerId); renderBox(start, start); };
    const move = (event) => { if (dragging) renderBox(start, point(event)); };
    const up = (event) => { if (dragging) { dragging = false; renderBox(start, point(event)); } };
    const finish = (value) => {
      modal.classList.add('hidden');
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      $('#confirm-region').onclick = null;
      $('#full-region').onclick = null;
      $('#cancel-region').onclick = null;
      resolve(value);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    $('#confirm-region').onclick = () => finish(selection);
    $('#full-region').onclick = () => finish({ x: 0, y: 0, width: 1, height: 1 });
    $('#cancel-region').onclick = () => finish(null);
  });
}

async function beginCapture(kind) {
  if (state.busy || state.recorder) return;
  if (!state.selectedSource) return showToast('יש לבחור מסך או חלון תחילה');
  state.busy = true;
  setStatus('מכין מקורות…', 'busy');
  try {
    await acquireInputs(kind === 'record');
    const region = state.captureScope === 'full' ? { x: 0, y: 0, width: 1, height: 1 } : await chooseRegion();
    if (!region) {
      stopInputStreams();
      setStatus('מוכן');
      return;
    }
    state.region = region;
    drawFrame();
    if (kind === 'screenshot') await saveScreenshot();
    else await startRecording();
  } catch (error) {
    stopInputStreams();
    setStatus('שגיאה', 'error');
    showToast(`לא ניתן להתחיל צילום: ${error.message}`, 7000);
  } finally {
    state.busy = false;
  }
}

async function saveScreenshot() {
  drawFrame();
  const blob = await new Promise((resolve) => recordingCanvas.toBlob(resolve, 'image/png'));
  const result = await api.saveScreenshot(await blob.arrayBuffer());
  document.documentElement.dataset.lastSavedPath = result.path;
  stopInputStreams();
  setStatus('התמונה נשמרה');
  showToast(`התמונה נשמרה: ${result.path}`);
  await loadLibrary().catch(() => {});
  if (state.afterScreenshotAction !== 'save' && window.aurumEditor) await window.aurumEditor.open(result.path, state.afterScreenshotAction);
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
    gain.gain.value = stream === state.microphoneStream ? Number($('#mic-volume')?.value || 100) / 100 : 0.9;
    source.connect(gain).connect(destination);
  }
  return destination.stream.getAudioTracks()[0] || null;
}

function recorderMimeType() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function startRecording() {
  const preset = qualityPresets[state.quality];
  const canvasStream = recordingCanvas.captureStream(preset.fps);
  const mixedTrack = await createMixedAudioTrack();
  if (mixedTrack) canvasStream.addTrack(mixedTrack);
  state.outputStream = canvasStream;
  state.chunks = [];
  const mimeType = recorderMimeType();
  state.recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: preset.bitrate, audioBitsPerSecond: 192_000 });
  state.recorder.addEventListener('dataavailable', (event) => { if (event.data.size) state.chunks.push(event.data); });
  state.recorder.addEventListener('stop', finalizeRecording, { once: true });
  state.displayStream.getVideoTracks()[0].addEventListener('ended', () => { if (state.recorder?.state !== 'inactive') state.recorder.stop(); }, { once: true });
  state.recorder.start(1000);
  drawFrame();
  state.drawTimer = setInterval(drawFrame, Math.max(8, Math.round(1000 / preset.fps)));
  state.startedAt = Date.now();
  $('#recording-time').textContent = '00:00';
  $('#recording-bar').classList.remove('hidden');
  $('#record-button span').textContent = 'עצור הקלטה';
  state.timer = setInterval(() => { $('#recording-time').textContent = formatTime(Date.now() - state.startedAt); }, 500);
  setStatus('מקליט', 'error');
  showToast('ההקלטה התחילה — קול המחשב והמיקרופון הפעילים מסונכרנים יחד');
}

async function finalizeRecording() {
  clearInterval(state.timer);
  clearInterval(state.drawTimer);
  state.drawTimer = null;
  $('#recording-bar').classList.add('hidden');
  $('#record-button span').textContent = 'התחל הקלטה';
  setStatus('שומר וממיר…', 'busy');
  const recorder = state.recorder;
  state.recorder = null;
  try {
    const blob = new Blob(state.chunks, { type: recorder.mimeType || 'video/webm' });
    const result = await api.saveRecording(await blob.arrayBuffer(), $('#convert-mp4').checked);
    document.documentElement.dataset.lastSavedPath = result.path;
    stopInputStreams();
    if (result.converted) showToast(`ההקלטה נשמרה כ-MP4: ${result.path}`, 7000);
    else if (result.conversionError) showToast(`ה-WebM נשמר. המרת MP4 נכשלה: ${result.conversionError}`, 9000);
    else showToast(`ההקלטה נשמרה: ${result.path}`, 7000);
    setStatus('ההקלטה נשמרה');
    loadLibrary().catch(() => {});
  } catch (error) {
    stopInputStreams();
    setStatus('שגיאת שמירה', 'error');
    showToast(`שמירת ההקלטה נכשלה: ${error.message}`, 9000);
  }
}

function stopRecording() {
  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
}

function togglePause() {
  if (!state.recorder) return;
  const button = $('#pause-recording');
  if (state.recorder.state === 'recording') {
    state.recorder.pause();
    button.textContent = 'המשך';
    setStatus('מושהה', 'busy');
  } else if (state.recorder.state === 'paused') {
    state.recorder.resume();
    button.textContent = 'השהיה';
    setStatus('מקליט', 'error');
  }
}

async function loadLibrary() {
  const items = await api.listLibrary();
  state.libraryItems = items;
  renderRecentLibrary(items);
  renderLibrary();
}

function sortedLibraryItems() {
  const query = $('#library-search')?.value.trim().toLocaleLowerCase('he') || '';
  const items = state.libraryItems.filter((item) => !query || item.name.toLocaleLowerCase('he').includes(query));
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
      const editButton = item.extension === 'png' ? '<button class="gold-button edit-image">עריכה</button>' : '';
      row.innerHTML = `<span class="file-icon">${thumbnailMarkup(item)}</span><div class="file-details"><strong>${escapeHtml(item.name)}${item.edited ? ' <em class="edited-badge">נערך</em>' : ''}</strong><small>${new Date(item.modified).toLocaleString('he-IL')} · ${formatBytes(item.size)} · ${item.extension.toUpperCase()}</small><div class="rename-editor hidden"><input maxlength="120" value="${escapeHtml(baseName)}" aria-label="שם קובץ חדש"><button class="gold-button save-name">שמירה</button><button class="ghost cancel-name">ביטול</button></div></div><div class="library-actions">${editButton}<button class="ghost rename">שינוי שם</button><button class="ghost open">פתיחה</button><button class="ghost show">בתיקייה</button></div>`;
      row.querySelector('.edit-image')?.addEventListener('click', () => window.aurumEditor?.open(item.path, 'professional'));
      row.querySelector('.open').addEventListener('click', () => api.openFile(item.path));
      row.querySelector('.show').addEventListener('click', () => api.showFile(item.path));
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

function showPage(page) {
  const titles = {
    capture: ['מה תרצה ליצור?', 'בחר מקור, איכות וקול — והתחל בלחיצה אחת.'],
    library: ['הספרייה שלי', 'כל הצילומים וההקלטות שנשמרו במחשב.'],
    settings: ['הגדרות', 'תיקיית שמירה, פורמטים וקיצורי דרך.']
  };
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $('#theme-menu')?.classList.add('hidden');
  if (page !== 'settings' && themeEditorOpen) cancelThemeEditor(false);
  $$('.page').forEach((section) => section.classList.remove('active'));
  $(`#${page}-page`).classList.add('active');
  if ($('#page-title')) $('#page-title').textContent = titles[page][0];
  if ($('#page-subtitle')) $('#page-subtitle').textContent = titles[page][1];
  $('#capture-settings').classList.toggle('hidden', page !== 'capture');
  if (page === 'library') loadLibrary();
}

async function initialize() {
  restoreUserPreferences();
  $$('.nav-item[data-page]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.action === 'edit') {
      openLatestScreenshotEditor('professional').catch((error) => showToast(`פתיחת העורך נכשלה: ${error.message}`));
      return;
    }
    showPage(button.dataset.page);
    if (button.dataset.action === 'screenshot') $('[data-settings-tab="image"]').click();
  }));
  $$('[data-page-link]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.pageLink)));
  $$('.page-tab').forEach((button) => button.addEventListener('click', () => {
    const previousTab = $('.page-tab.active')?.dataset.preferenceTab;
    if (previousTab === 'appearance' && button.dataset.preferenceTab !== 'appearance' && themeEditorOpen) cancelThemeEditor(false);
    $$('.page-tab').forEach((item) => item.classList.toggle('active', item === button));
    $$('.preference-section').forEach((section) => section.classList.toggle('active', section.dataset.preferenceSection === button.dataset.preferenceTab));
    if (button.dataset.preferenceTab === 'development') loadQaDashboard();
    if (button.dataset.preferenceTab === 'appearance') openThemeEditor();
  }));
  $$('#quality-options button').forEach((button) => button.addEventListener('click', () => {
    $$('#quality-options button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.quality = button.dataset.quality;
  }));
  $('#refresh-sources').addEventListener('click', refreshSources);
  $('#screenshot-button').addEventListener('click', () => beginCapture('screenshot'));
  $('#record-button').addEventListener('click', () => state.recorder ? stopRecording() : beginCapture(state.captureKind));
  $('#stop-recording').addEventListener('click', stopRecording);
  $('#pause-recording').addEventListener('click', togglePause);
  $('#open-output').addEventListener('click', () => api.openOutput());
  $('#quick-open-output').addEventListener('click', () => api.openOutput());
  $('#edit-latest-image').addEventListener('click', () => openLatestScreenshotEditor('professional').catch((error) => showToast(`פתיחת העורך נכשלה: ${error.message}`)));
  $('#quick-edit-latest').addEventListener('click', () => openLatestScreenshotEditor('professional').catch((error) => showToast(`פתיחת העורך נכשלה: ${error.message}`)));
  $('#choose-output').addEventListener('click', async () => { $('#output-path').textContent = await api.chooseOutput(); });
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
  api.onShortcut((action) => {
    if (action === 'stop') stopRecording();
    else beginCapture(action === 'screenshot' ? 'screenshot' : 'record');
  });
  $('#output-path').textContent = await api.getOutput();
  await Promise.all([refreshSources(), loadLibrary()]);
  document.documentElement.dataset.appReady = 'true';
}

initialize().catch((error) => showToast(`אתחול האפליקציה נכשל: ${error.message}`, 10000));
