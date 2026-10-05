const { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell, Tray } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { captureFilePath, developerShortcut } = require('./main-utils.cjs');
const { compareReports } = require('./qa-utils.cjs');
const { renamedLibraryPath } = require('./library-utils.cjs');
const { assertEditableImagePath, dataUrlBytes, editedCopyPath, projectPathFor } = require('./editor-utils.cjs');
const { ACTION_DEFINITIONS, DEFAULT_SHORTCUTS, acceleratorForBinding, inputMatchesBinding, normalizeShortcutMap, reservedShortcutConflicts, shortcutConflicts } = require('./shortcut-utils.cjs');
const { recordingAudioPath, recordingPaths, recordingSegmentPath, recoveryPathFor, storageLevel } = require('./recording-utils.cjs');
const { encoderCandidates, parseVideoEncoders } = require('./encoder-utils.cjs');
const { PrivateShareServer, analyzeMedia, discoverLocalEngines, runHidden, runOcr, runOcrWords, transcribeMedia } = require('./studio-tools.cjs');
const { DEFAULT_QUICKBAR_PREFERENCES, addRecentCapture, normalizeQuickbarPreferences, quickbarBounds: calculateQuickbarBounds, shouldHideMainWindowOnClose } = require('./quickbar-utils.cjs');
const { normalizeTimelineProject } = require('./video-timeline-utils.cjs');
const { findSensitiveRegions, parseTesseractTsv, summarizeRegions } = require('./redact-utils.cjs');
const { ACTIONS: WORKFLOW_ACTIONS } = require('./workflow-utils.cjs');

if (process.env.SCREEN_STUDIO_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.SCREEN_STUDIO_USER_DATA_DIR));

let mainWindow;
let pendingCapture = null;
let outputDirectory;
let sourceCache = { at: 0, native: [], public: [] };
let qaProcess = null;
let qaConsole = '';
let activeShortcuts = { ...DEFAULT_SHORTCUTS };
let shortcutRegistration = {};
const lastShortcutDispatch = new Map();
const pendingDoublePress = new Map();
const recordingSessions = new Map();
let recoveredRecordings = [];
const thumbnailJobs = new Map();
let encoderCapabilities = null;
let tray = null;
let quickbarWindow = null;
let quickbarExpanded = false;
let quickbarPreferences = { ...DEFAULT_QUICKBAR_PREFERENCES };
let quickbarCursorTimer = null;
// Post-capture card: which view the bar shows and the recent captures it lists (newest first).
let quickbarView = 'actions';
let recentCaptures = [];
let isQuitting = false;
const privateShareServer = new PrivateShareServer();

const projectDirectory = path.resolve(__dirname, '..');
const qaDirectory = process.env.SCREEN_STUDIO_QA_REPORT_DIR || path.join(projectDirectory, 'artifacts', 'qa');

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return null; }
}

function quickbarPreferencesPath() { return path.join(app.getPath('userData'), 'quickbar-preferences.json'); }
async function loadQuickbarPreferences() {
  const saved = await readJson(quickbarPreferencesPath()) || {};
  quickbarPreferences = normalizeQuickbarPreferences(saved);
  return quickbarPreferences;
}
async function saveQuickbarPreferences(patch = {}) {
  quickbarPreferences = normalizeQuickbarPreferences(patch, quickbarPreferences);
  await fs.writeFile(quickbarPreferencesPath(), JSON.stringify(quickbarPreferences, null, 2), 'utf8');
  return quickbarPreferences;
}

function quickbarDisplay() {
  return quickbarPreferences.display === 'primary' ? screen.getPrimaryDisplay() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}
function quickbarBounds(expanded = quickbarExpanded) {
  return calculateQuickbarBounds(quickbarDisplay().workArea, quickbarPreferences, expanded, { view: quickbarView, hasRecent: recentCaptures.length > 0 });
}
function positionQuickbar(expanded = quickbarExpanded) {
  if (!quickbarWindow || quickbarWindow.isDestroyed()) return;
  quickbarExpanded = Boolean(expanded || quickbarPreferences.pinned);
  if (!quickbarExpanded) quickbarView = 'actions';
  quickbarWindow.setBounds(quickbarBounds(quickbarExpanded), false);
  quickbarWindow.setAlwaysOnTop(true, 'floating');
  // With the bar switched off, the window only exists to show the capture card: no edge tab once it closes.
  const canShow = process.env.SCREEN_STUDIO_QA !== '1' && process.env.SCREEN_STUDIO_HEADLESS !== '1';
  if (!quickbarPreferences.enabled) {
    if (quickbarExpanded) { if (canShow) quickbarWindow.showInactive(); }
    else quickbarWindow.hide();
  } else if (canShow && !quickbarWindow.isVisible()) quickbarWindow.showInactive();
}
function updateQuickbarCursorTracking() {
  clearInterval(quickbarCursorTimer);
  quickbarCursorTimer = null;
  if (!quickbarPreferences.enabled || quickbarPreferences.display !== 'cursor') return;
  quickbarCursorTimer = setInterval(() => {
    if (!quickbarExpanded && quickbarWindow && !quickbarWindow.isDestroyed()) positionQuickbar(false);
  }, 800);
  quickbarCursorTimer.unref?.();
}
async function createQuickbarWindow({ forCapture = false } = {}) {
  if ((!quickbarPreferences.enabled && !forCapture) || quickbarWindow) return quickbarWindow;
  quickbarExpanded = Boolean(quickbarPreferences.pinned);
  quickbarWindow = new BrowserWindow({
    ...quickbarBounds(quickbarExpanded), show: false, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
    type: 'toolbar', backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'quickbar-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  quickbarWindow.setMenuBarVisibility(false);
  quickbarWindow.setAlwaysOnTop(true, 'floating');
  await quickbarWindow.loadFile(path.join(__dirname, 'quickbar.html'));
  quickbarWindow.setFocusable(false);
  quickbarWindow.setAlwaysOnTop(true, 'floating');
  quickbarWindow.on('closed', () => { quickbarWindow = null; });
  if (quickbarPreferences.enabled && process.env.SCREEN_STUDIO_QA !== '1' && process.env.SCREEN_STUDIO_HEADLESS !== '1') quickbarWindow.showInactive();
  quickbarWindow.setContentProtection(true);
  quickbarWindow.webContents.send('quickbar:recording-state', Boolean(recordingSessions.size));
  updateQuickbarCursorTracking();
  return quickbarWindow;
}
async function applyQuickbarPreferences(patch = {}) {
  const wasEnabled = quickbarPreferences.enabled;
  await saveQuickbarPreferences(patch);
  // Switching the bar off closes its window; other setting changes while it is off keep the capture card's window.
  if (!quickbarPreferences.enabled && wasEnabled) { clearInterval(quickbarCursorTimer); quickbarCursorTimer = null; quickbarWindow?.destroy(); quickbarWindow = null; quickbarExpanded = false; quickbarView = 'actions'; }
  else if (!quickbarPreferences.enabled) { quickbarWindow?.webContents.send('quickbar:preferences', quickbarPreferences); }
  else {
    await createQuickbarWindow();
    updateQuickbarCursorTracking();
    // Unpinning keeps the bar open under the pointer; it then closes like any unpinned bar (pointer leaves / collapse button).
    positionQuickbar(quickbarPreferences.pinned || quickbarExpanded);
    quickbarWindow?.webContents.send('quickbar:preferences', quickbarPreferences);
  }
  return quickbarPreferences;
}

// One implementation for library actions, used by automations (workflow:action) and the capture card.
async function runLibraryAction(filePath, action, options = {}) {
  const resolved = await assertLibraryFile(filePath);
  if (action === 'copy') {
    if (/\.png$/i.test(resolved)) clipboard.writeImage(nativeImage.createFromPath(resolved));
    else clipboard.writeText(resolved);
    return { action, path: resolved };
  }
  if (action === 'ocr') {
    if (!/\.png$/i.test(resolved)) return { action, skipped: true, reason: 'OCR מיועד לתמונה' };
    const result = await runOcr(resolved, { tessdataDirectory: await ensureOcrLanguageData() });
    await updateMetadata(resolved, { ocrText: result.text, ocrLanguage: result.language, ocrAt: new Date().toISOString() });
    return { action, characters: result.text.length };
  }
  if (action === 'client-copy') {
    const client = String(options.client || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 60);
    if (!client) return { action, skipped: true, reason: 'לא הוגדר שם לקוח' };
    const clientDirectory = path.join(await ensureOutputDirectory(), 'לקוחות', client);
    await fs.mkdir(clientDirectory, { recursive: true });
    const target = path.join(clientDirectory, path.basename(resolved));
    await fs.copyFile(resolved, target);
    return { action, path: target };
  }
  if (action === 'share') { const share = await privateShareServer.share(resolved, 30); clipboard.writeText(share.url); return { action, ...share }; }
  if (action === 'open-folder') { shell.showItemInFolder(resolved); return { action, path: resolved }; }
  if (action === 'pin') return { action, ...(await pinImageWindow(resolved)) };
  return { action, renderer: true, path: resolved };
}

async function pinImageWindow(resolved) {
  if (!/\.png$/i.test(resolved)) throw new Error('אפשר להצמיד רק תמונה');
  const bytes = await fs.readFile(resolved);
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
  const image = nativeImage.createFromBuffer(bytes);
  const size = image.getSize();
  const scale = Math.min(1, 900 / Math.max(size.width, 1), 700 / Math.max(size.height, 1));
  const pinWindow = new BrowserWindow({ show: process.env.SCREEN_STUDIO_QA !== '1' && process.env.SCREEN_STUDIO_HEADLESS !== '1', width: Math.max(260, Math.round(size.width * scale)), height: Math.max(180, Math.round(size.height * scale)), frame: false, resizable: true, alwaysOnTop: true, backgroundColor: '#111111', webPreferences: { contextIsolation: true, sandbox: true } });
  await pinWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111;border-radius:12px;-webkit-app-region:drag}img{width:100%;height:100%;object-fit:contain;display:block}button{position:fixed;top:8px;left:8px;width:28px;height:28px;border:0;border-radius:50%;background:#000a;color:#fff;font:16px Segoe UI;cursor:pointer;opacity:0;transition:opacity .15s;-webkit-app-region:no-drag}body:hover button{opacity:1}</style><img draggable="false" src="${dataUrl}"><button title="סגירה (Esc)" onclick="window.close()">×</button>`)}`);
  pinWindow.setAlwaysOnTop(true, 'floating');
  pinWindow.webContents.on('before-input-event', (_inputEvent, input) => { if (input.type === 'keyDown' && input.key === 'Escape') pinWindow.close(); });
  return { pinned: true, bounds: pinWindow.getBounds() };
}

// Shows the post-capture card on the floating bar (created on demand even if the bar itself is switched off).
async function showCapturePreview(filePath) {
  const resolved = await assertLibraryFile(filePath);
  const stat = await fs.stat(resolved);
  const extension = path.extname(resolved).slice(1).toLowerCase();
  const thumbnail = await thumbnailFor({ path: resolved, extension, modified: stat.mtimeMs, size: stat.size });
  const kind = extension === 'png' ? 'image' : 'video';
  const durationSeconds = kind === 'video' ? (await readJson(`${resolved}.quality.json`))?.durationSeconds || null : null;
  recentCaptures = addRecentCapture(recentCaptures, { path: resolved, name: path.basename(resolved), kind, size: stat.size, durationSeconds, thumbnail, at: Date.now() });
  if (!quickbarPreferences.capturePreview) return { shown: false, recent: recentCaptures.length };
  await createQuickbarWindow({ forCapture: true });
  quickbarView = 'capture';
  positionQuickbar(true);
  // Recordings need longer to notice than a screenshot: never hide their card in under 10 seconds.
  const timeout = quickbarPreferences.captureTimeout && kind === 'video' ? Math.max(10, quickbarPreferences.captureTimeout) : quickbarPreferences.captureTimeout;
  quickbarWindow?.webContents.send('quickbar:captures', { captures: recentCaptures, fresh: true, timeout });
  return { shown: true, recent: recentCaptures.length };
}

async function runCaptureCardAction(filePath, action) {
  const resolved = await assertLibraryFile(filePath);
  if (action === 'edit') {
    showMainWindow();
    mainWindow?.focus();
    mainWindow?.webContents.send('app:open-editor', resolved);
  } else if (action === 'trash') {
    await shell.trashItem(resolved);
    for (const sidecar of [projectPathFor(resolved), `${resolved}.meta.json`]) await shell.trashItem(sidecar).catch(() => {});
    recentCaptures = recentCaptures.filter((entry) => entry.path !== resolved);
    mainWindow?.webContents.send('app:library-changed');
    quickbarWindow?.webContents.send('quickbar:captures', { captures: recentCaptures, fresh: false });
    if (!recentCaptures.length) positionQuickbar(false);
  } else await runLibraryAction(resolved, action);
  return { action, path: resolved };
}

async function assertLibraryFile(filePath, extensions = /\.(png|webm|mp4)$/i) {
  const directory = path.resolve(await ensureOutputDirectory());
  const resolved = path.resolve(String(filePath || ''));
  if (path.dirname(resolved).toLowerCase() !== directory.toLowerCase() || !extensions.test(resolved)) throw new Error('הקובץ אינו קובץ מדיה תקין בספרייה המקומית');
  await fs.access(resolved);
  return resolved;
}

async function updateMetadata(filePath, patch) {
  const current = await readJson(`${filePath}.meta.json`) || {};
  const updated = { ...current, ...patch };
  await fs.writeFile(`${filePath}.meta.json`, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

async function ensureOcrLanguageData() {
  const cacheDirectory = path.join(app.getPath('userData'), 'ocr-tessdata');
  await fs.mkdir(cacheDirectory, { recursive: true });
  const installedDirectory = process.env.TESSDATA_PREFIX || 'C:\\Program Files\\Tesseract-OCR\\tessdata';
  const sources = {
    heb: path.join(__dirname, 'tessdata', 'heb.traineddata'),
    eng: path.join(installedDirectory, 'eng.traineddata'),
    osd: path.join(installedDirectory, 'osd.traineddata')
  };
  for (const [language, source] of Object.entries(sources)) {
    const target = path.join(cacheDirectory, `${language}.traineddata`);
    try { await fs.access(target); }
    catch { await fs.copyFile(source, target); }
  }
  return cacheDirectory;
}

async function qaStatus() {
  let history = [];
  try {
    history = (await fs.readdir(qaDirectory))
      .filter((name) => /^report-.*\.json$/i.test(name))
      .sort().reverse();
  } catch {}
  const report = await readJson(path.join(qaDirectory, 'latest-report.json'));
  const newestHistory = history.length ? await readJson(path.join(qaDirectory, history[0])) : null;
  const previousIndex = newestHistory?.finishedAt === report?.finishedAt ? 1 : 0;
  const previous = history[previousIndex] ? await readJson(path.join(qaDirectory, history[previousIndex])) : null;
  let savedConsole = qaConsole;
  if (!savedConsole) {
    try { savedConsole = await fs.readFile(path.join(qaDirectory, 'latest-console.log'), 'utf8'); } catch {}
  }
  return {
    available: !app.isPackaged && process.env.SCREEN_STUDIO_QA !== '1',
    running: Boolean(qaProcess), report, previous,
    comparisons: compareReports(report, previous),
    console: savedConsole,
    reportPath: path.join(qaDirectory, 'latest-report.html')
  };
}

async function persistQaConsole() {
  await fs.mkdir(qaDirectory, { recursive: true });
  await fs.writeFile(path.join(qaDirectory, 'latest-console.log'), qaConsole, 'utf8');
}

function appendQaConsole(text) {
  qaConsole = `${qaConsole}${text}`.slice(-200_000);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('qa:output', text);
}

function runQa() {
  if (qaProcess) return Promise.reject(new Error('בדיקות QA כבר רצות'));
  if (app.isPackaged || process.env.SCREEN_STUDIO_QA === '1') return Promise.reject(new Error('הרצת QA זמינה רק בסביבת הפיתוח'));
  qaConsole = `[${new Date().toLocaleString('he-IL')}] מתחיל QA מלא במצב headless…\n`;
  appendQaConsole('פקודה: npm run test:qa\n\n');
  return new Promise((resolve) => {
    const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', 'run', 'test:qa'] : ['run', 'test:qa'];
    qaProcess = spawn(executable, args, { cwd: projectDirectory, windowsHide: true, env: { ...process.env } });
    qaProcess.stdout.on('data', (chunk) => appendQaConsole(chunk.toString()));
    qaProcess.stderr.on('data', (chunk) => appendQaConsole(chunk.toString()));
    qaProcess.on('error', async (error) => {
      appendQaConsole(`\nשגיאת הפעלה: ${error.message}\n`);
      qaProcess = null;
      await persistQaConsole();
      resolve(await qaStatus());
    });
    qaProcess.on('close', async (code) => {
      appendQaConsole(`\n[הסתיים עם קוד ${code}]\n`);
      qaProcess = null;
      await persistQaConsole();
      resolve(await qaStatus());
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: process.env.SCREEN_STUDIO_QA !== '1' && process.env.SCREEN_STUDIO_HEADLESS !== '1',
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#07111f',
    title: 'אולפן צילום מסך',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const action = developerShortcut(input);
    if (action) {
      event.preventDefault();
      if (action === 'hard-reload') mainWindow.webContents.reloadIgnoringCache();
      if (action === 'toggle-devtools') mainWindow.webContents.toggleDevTools();
      return;
    }
    const shortcutAction = Object.keys(activeShortcuts).find((name) => activeShortcuts[name]?.scope === 'global' && inputMatchesBinding(input, activeShortcuts[name]));
    if (shortcutAction) {
      event.preventDefault();
      handleShortcutPress(shortcutAction, activeShortcuts[shortcutAction], 'focused-physical-key');
    }
  });
  const devUrl = process.env.SCREEN_STUDIO_DEV_URL;
  // The preload API can open and rename files, so the window must never show any page but the app itself.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL().split('#')[0];
    const allowed = devUrl ? url.startsWith(`${devUrl}/`) || url === devUrl : url.split('#')[0] === current;
    if (!allowed) event.preventDefault();
  });
  if (devUrl && /^http:\/\/127\.0\.0\.1:\d+$/.test(devUrl)) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('close', (event) => {
    if (shouldHideMainWindowOnClose(quickbarPreferences, { quitting: isQuitting, qa: process.env.SCREEN_STUDIO_QA === '1', headless: process.env.SCREEN_STUDIO_HEADLESS === '1' })) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function ensureOutputDirectory() {
  outputDirectory ||= process.env.SCREEN_STUDIO_OUTPUT_DIR || path.join(app.getPath('videos'), 'אולפן צילום מסך');
  await fs.mkdir(outputDirectory, { recursive: true });
  return outputDirectory;
}

async function storageStatus() {
  const directory = await ensureOutputDirectory();
  try {
    const stats = await fs.statfs(directory);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    return { directory, freeBytes, totalBytes, level: storageLevel(freeBytes), recovered: recoveredRecordings.length };
  } catch {
    return { directory, freeBytes: null, totalBytes: null, level: 'unknown', recovered: recoveredRecordings.length };
  }
}

async function concatenateFiles(files, outputPath) {
  const output = await fs.open(outputPath, 'w');
  try {
    for (const filePath of files) {
      const input = await fs.open(filePath, 'r');
      try {
        for await (const chunk of input.createReadStream()) await output.write(chunk);
      } finally { await input.close().catch(() => {}); }
    }
  } finally { await output.close(); }
  return outputPath;
}

async function writeRecordingJournal(session, patch = {}) {
  const journal = {
    id: session.id,
    startedAt: session.startedAt,
    updatedAt: new Date().toISOString(),
    mimeType: session.mimeType,
    partialPath: session.partialPath,
    finalPath: session.finalPath,
    segmentDirectory: session.segmentDirectory,
    segmentIndex: session.segmentIndex,
    bytes: session.bytes,
    chunks: session.chunks,
    audioBytes: session.audioBytes,
    ...patch
  };
  await fs.writeFile(session.journalPath, JSON.stringify(journal, null, 2), 'utf8');
}

async function normalizeAudioSidecar(inputPath, outputPath, durationSeconds = 0) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-af', 'aresample=async=1:first_pts=0'];
  if (durationSeconds > 0) args.push('-t', String(durationSeconds));
  args.push('-c:a', 'aac', '-b:a', '192k', outputPath);
  return runProcess('ffmpeg', args);
}

async function recoverInterruptedRecordings() {
  const directory = await ensureOutputDirectory();
  const names = await fs.readdir(directory).catch(() => []);
  const recovered = [];
  const handledPartials = new Set();
  for (const name of names.filter((item) => /\.recording\.json$/i.test(item))) {
    const journalPath = path.join(directory, name);
    const journal = await readJson(journalPath);
    if (!journal) continue;
    const partialPath = path.resolve(String(journal.partialPath || ''));
    if (path.dirname(partialPath).toLowerCase() !== path.resolve(directory).toLowerCase()) continue;
    handledPartials.add(partialPath.toLowerCase());
    const segmentDirectory = path.resolve(String(journal.segmentDirectory || ''));
    const segmentNames = path.dirname(segmentDirectory).toLowerCase() === path.resolve(directory).toLowerCase()
      ? (await fs.readdir(segmentDirectory).catch(() => [])).filter((item) => /^video-\d+\.part$/i.test(item)).sort()
      : [];
    if (segmentNames.length) await concatenateFiles(segmentNames.map((item) => path.join(segmentDirectory, item)), partialPath).catch(() => {});
    const stat = await fs.stat(partialPath).catch(() => null);
    if (stat?.size) {
      const recoveredPath = recoveryPathFor(partialPath);
      await fs.rename(partialPath, recoveredPath).catch(() => {});
      try { await fs.access(recoveredPath); recovered.push(recoveredPath); } catch {}
      for (const [kind, label] of [['system', 'קול-מחשב'], ['microphone', 'מיקרופון']]) {
        const audioPartial = recordingAudioPath(segmentDirectory, kind);
        const audioStat = await fs.stat(audioPartial).catch(() => null);
        if (audioStat?.size) await fs.rename(audioPartial, recoveredPath.replace(/\.webm$/i, `_${label}_שוחזר.webm`)).catch(() => {});
      }
    }
    await fs.rm(segmentDirectory, { recursive: true, force: true }).catch(() => {});
    await fs.rm(journalPath, { force: true }).catch(() => {});
  }
  for (const name of names.filter((item) => /\.partial\.webm$/i.test(item))) {
    const partialPath = path.join(directory, name);
    if (handledPartials.has(path.resolve(partialPath).toLowerCase())) continue;
    const stat = await fs.stat(partialPath).catch(() => null);
    if (!stat?.size) continue;
    const recoveredPath = recoveryPathFor(partialPath);
    await fs.rename(partialPath, recoveredPath).catch(() => {});
    const journalPath = partialPath.replace(/\.partial\.webm$/i, '.recording.json');
    await fs.rm(journalPath, { force: true }).catch(() => {});
    try { await fs.access(recoveredPath); recovered.push(recoveredPath); } catch {}
  }
  for (const file of recovered) await remuxWebm(file);
  recoveredRecordings = recovered;
  return recovered;
}

// MediaRecorder writes WebM with no duration and no seek index, so players show no length and seek slowly.
// A stream copy into a fresh container adds both in seconds, without re-encoding.
async function remuxWebm(webmPath) {
  const stat = await fs.stat(webmPath).catch(() => null);
  if (!stat?.size) return false;
  const temporaryPath = `${webmPath}.remuxing`;
  const timeoutMs = Math.min(10 * 60_000, Math.max(60_000, Math.round(stat.size / 20_000)));
  const result = await runHidden('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-fflags', '+genpts', '-i', webmPath, '-map', '0', '-c', 'copy', '-cues_to_front', '1', '-f', 'webm', temporaryPath], { timeoutMs });
  if (!result.ok) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    return false;
  }
  await fs.rename(temporaryPath, webmPath);
  return true;
}

async function convertRecording(webmPath, convertToMp4) {
  await remuxWebm(webmPath);
  if (!convertToMp4) {
    const quality = await analyzeMedia(webmPath).catch((error) => ({ valid: false, error: error.message }));
    return { path: webmPath, webmPath, converted: false, quality };
  }
  const mp4Path = webmPath.replace(/\.webm$/i, '.mp4');
  const temporaryMp4Path = mp4Path.replace(/\.mp4$/i, '.partial');
  const conversion = await runFfmpeg(webmPath, temporaryMp4Path);
  if (conversion.ok) {
    await fs.rename(temporaryMp4Path, mp4Path);
    const quality = await analyzeMedia(mp4Path).catch((error) => ({ valid: false, error: error.message }));
    return { path: mp4Path, webmPath, converted: true, encoder: conversion.encoder, hardwareEncoder: conversion.hardware, quality };
  }
  await fs.rm(temporaryMp4Path, { force: true }).catch(() => {});
  const quality = await analyzeMedia(webmPath).catch((error) => ({ valid: false, error: error.message }));
  return { path: webmPath, webmPath, converted: false, conversionError: conversion.error, quality };
}

async function getSources() {
  if (Date.now() - sourceCache.at < 750 && sourceCache.public.length) return sourceCache.public;
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 240, height: 135 },
    fetchWindowIcons: false
  });
  const publicSources = sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    thumbnail: source.thumbnail.toDataURL(),
    appIcon: source.appIcon?.toDataURL() || null,
    type: source.id.startsWith('screen:') ? 'screen' : 'window'
  }));
  sourceCache = { at: Date.now(), native: sources, public: publicSources };
  return publicSources;
}

function runProcess(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let outputText = '';
    let errorText = '';
    child.stdout?.on('data', (data) => { outputText += data.toString(); });
    child.stderr.on('data', (data) => { errorText += data.toString(); });
    child.on('error', (error) => resolve({ ok: false, error: error.message }));
    child.on('close', (code) => resolve(code === 0 ? { ok: true, stdout: outputText, stderr: errorText } : { ok: false, stdout: outputText, error: errorText || `${command} exited with ${code}` }));
  });
}

async function getEncoderCapabilities(force = false) {
  if (encoderCapabilities && !force) return encoderCapabilities;
  const result = await runProcess('ffmpeg', ['-hide_banner', '-encoders']);
  const detected = result.ok ? parseVideoEncoders(`${result.stdout}\n${result.stderr}`) : parseVideoEncoders('');
  const encoders = [];
  for (const encoder of detected) {
    if (!encoder.available) { encoders.push({ ...encoder, usable: false }); continue; }
    const probe = await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=size=64x64:rate=1', ...encoder.args, '-frames:v', '1', '-f', 'null', '-']);
    encoders.push({ ...encoder, available: probe.ok, usable: probe.ok });
  }
  const candidates = encoderCandidates(encoders);
  encoderCapabilities = {
    ffmpeg: result.ok,
    encoders: encoders.map(({ id, label, hardware, available, usable }) => ({ id, label, hardware, available, usable })),
    preferred: candidates[0]?.id || 'libx264',
    preferredLabel: candidates[0]?.label || 'H.264 תוכנה',
    hardware: Boolean(candidates[0]?.hardware),
    error: result.ok ? null : result.error
  };
  return encoderCapabilities;
}

async function runFfmpeg(inputPath, outputPath) {
  const capabilities = await getEncoderCapabilities();
  const candidates = encoderCandidates(capabilities.encoders);
  let lastError = '';
  for (const encoder of candidates) {
    await fs.rm(outputPath, { force: true }).catch(() => {});
    const result = await runProcess('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      ...encoder.args, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-f', 'mp4', outputPath
    ]);
    if (result.ok) return { ok: true, encoder: encoder.id, hardware: encoder.hardware };
    lastError = result.error;
  }
  return { ok: false, error: lastError || 'לא נמצא מקודד H.264 תקין' };
}

function runVideoEdit(inputPath, outputPath, options = {}) {
  return new Promise((resolve) => {
    const start = Math.max(0, Number(options.start) || 0);
    const end = Number(options.end) > start ? Number(options.end) : null;
    const speed = Math.max(0.5, Math.min(2, Number(options.speed) || 1));
    const requestedVolume = options.volume === undefined ? 100 : Number(options.volume);
    const volume = Math.max(0, Math.min(2, Number.isFinite(requestedVolume) ? requestedVolume / 100 : 1));
    const fadeIn = Math.max(0, Math.min(3, Number(options.fadeIn) || 0));
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(start), '-i', inputPath];
    if (end) args.push('-t', String(end - start));
    const videoFilters = [];
    if (speed !== 1) videoFilters.push(`setpts=PTS/${speed}`);
    if (fadeIn) videoFilters.push(`fade=t=in:st=0:d=${fadeIn}`);
    if (videoFilters.length) args.push('-vf', videoFilters.join(','));
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p');
    if (options.mute) args.push('-an');
    else {
      const audioFilters = [];
      if (speed !== 1) audioFilters.push(`atempo=${speed}`);
      if (volume !== 1) audioFilters.push(`volume=${volume}`);
      if (fadeIn) audioFilters.push(`afade=t=in:st=0:d=${fadeIn}`);
      if (audioFilters.length) args.push('-af', audioFilters.join(','));
      args.push('-c:a', 'aac', '-b:a', '192k');
    }
    args.push('-movflags', '+faststart', outputPath);
    const child = spawn('ffmpeg', args, { windowsHide: true });
    let errorText = '';
    child.stderr.on('data', (data) => { errorText += data.toString(); });
    child.on('error', (error) => resolve({ ok: false, error: error.message }));
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: errorText || `FFmpeg exited with ${code}` }));
  });
}

// ffmpeg filter option paths: forward slashes, drive colon escaped, inside single quotes.
function filterPath(value) {
  return path.resolve(value).replaceAll('\\', '/').replace(/^([A-Za-z]):/, '$1\\:').replaceAll("'", "'\\\\''");
}

async function detectSilences(inputPath, options = {}) {
  const noise = Math.max(-70, Math.min(-20, Number(options.noiseDb) || -38));
  const minimum = Math.max(0.15, Math.min(5, Number(options.minimumSeconds) || 0.55));
  const result = await runHidden('ffmpeg', ['-hide_banner', '-i', inputPath, '-af', `silencedetect=noise=${noise}dB:d=${minimum}`, '-f', 'null', '-'], { timeoutMs: 120_000 });
  if (!result.ok) throw new Error(result.error || 'זיהוי השתיקות נכשל');
  const starts = [...result.stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  const ends = [...result.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  return starts.map((start, index) => ({ start, end: ends[index] ?? start + minimum })).filter((item) => item.end > item.start);
}

async function exportTimeline(inputPath, outputPath, candidate) {
  const quality = await analyzeMedia(inputPath, { countFrames: false, persist: false });
  const project = normalizeTimelineProject(candidate, quality.durationSeconds);
  const hasAudio = Boolean(quality.audioCodec) && !project.mute;
  const filters = [];
  project.clips.forEach((clip, index) => {
    const duration = clip.end - clip.start;
    const transition = clip.transition === 'none' ? 0 : Math.min(clip.transitionDuration, duration / 3);
    const fades = transition ? `,fade=t=in:st=0:d=${transition},fade=t=out:st=${Math.max(0, duration - transition)}:d=${transition}${clip.transition === 'black' ? ':color=black' : ''}` : '';
    filters.push(`[0:v]trim=start=${clip.start}:end=${clip.end},setpts=PTS-STARTPTS${fades}[v${index}]`);
    if (hasAudio) filters.push(`[0:a]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS${transition ? `,afade=t=in:st=0:d=${transition},afade=t=out:st=${Math.max(0, duration - transition)}:d=${transition}` : ''}[a${index}]`);
  });
  const concatInputs = project.clips.map((_clip, index) => `[v${index}]${hasAudio ? `[a${index}]` : ''}`).join('');
  filters.push(`${concatInputs}concat=n=${project.clips.length}:v=1:a=${hasAudio ? 1 : 0}[vjoined]${hasAudio ? '[ajoined]' : ''}`);
  let videoLabel = 'vjoined';
  const outputDuration = project.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
  const sourceToOutput = (time) => {
    let offset = 0;
    for (const clip of project.clips) {
      if (time >= clip.start && time <= clip.end) return offset + time - clip.start;
      offset += clip.end - clip.start;
    }
    return null;
  };
  const postFilters = [];
  // Captions go through textfile=: quotes inside text='…' cannot be escaped reliably and broke the filter.
  const captionDirectory = project.captions.length ? await fs.mkdtemp(path.join(os.tmpdir(), 'aurum-captions-')) : null;
  const captionFiles = [];
  for (const caption of project.captions) {
    const captionPath = path.join(captionDirectory, `caption-${captionFiles.length}.txt`);
    await fs.writeFile(captionPath, String(caption.text || '').replaceAll('\n', ' '), 'utf8');
    captionFiles.push(captionPath);
  }
  project.captions.forEach((caption, index) => {
    const start = sourceToOutput(caption.start); const end = sourceToOutput(caption.end);
    if (start === null || end === null || end <= start) return;
    postFilters.push(`drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile='${filterPath(captionFiles[index])}':fontcolor=white:fontsize=h/24:borderw=3:bordercolor=black@0.8:x=(w-text_w)*${caption.x}:y=(h-text_h)*${caption.y}:enable='between(t,${start},${end})'`);
  });
  project.zooms.forEach((zoom) => {
    const start = sourceToOutput(zoom.start); const end = sourceToOutput(zoom.end);
    if (start === null || end === null || end <= start) return;
    const width = quality.width || 1920; const height = quality.height || 1080;
    postFilters.push(`crop=w='if(between(t,${start},${end}),iw/${zoom.scale},iw)':h='if(between(t,${start},${end}),ih/${zoom.scale},ih)':x='if(between(t,${start},${end}),(iw-ow)*${zoom.x},0)':y='if(between(t,${start},${end}),(ih-oh)*${zoom.y},0)',scale=${width}:${height}`);
  });
  const preset = {
    quality: { crf: 16, preset: 'slow', scale: null }, balanced: { crf: 20, preset: 'veryfast', scale: null },
    small: { crf: 28, preset: 'veryfast', scale: 'scale=w=min(1280\\,iw):h=-2' },
    social: { crf: 20, preset: 'veryfast', scale: 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2' }
  }[project.preset];
  if (preset.scale) postFilters.push(preset.scale);
  if (postFilters.length) { filters.push(`[${videoLabel}]${postFilters.join(',')}[vout]`); videoLabel = 'vout'; }
  if (hasAudio && project.volume !== 100) filters.push(`[ajoined]volume=${project.volume / 100}[aout]`);
  const audioLabel = hasAudio ? (project.volume !== 100 ? 'aout' : 'ajoined') : null;
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-filter_complex', filters.join(';'), '-map', `[${videoLabel}]`];
  if (audioLabel) args.push('-map', `[${audioLabel}]`);
  args.push('-c:v', 'libx264', '-preset', preset.preset, '-crf', String(preset.crf), '-pix_fmt', 'yuv420p');
  if (audioLabel) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', outputPath);
  const timeoutMs = Math.max(300_000, Math.round(outputDuration * 4000));
  const result = await runHidden('ffmpeg', args, { timeoutMs }).finally(() => captionDirectory && fs.rm(captionDirectory, { recursive: true, force: true }));
  if (!result.ok) throw new Error(result.error || 'ייצוא ה-Timeline נכשל');
  const outputQuality = await analyzeMedia(outputPath);
  return { path: outputPath, duration: outputDuration, quality: outputQuality, project };
}

function runThumbnailFfmpeg(inputPath, outputPath) {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.2', '-i', inputPath, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '3', outputPath], { windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

// Library reloads are frequent; without this every screenshot was decoded at full size on each load.
const thumbnailMemory = new Map();

async function thumbnailFor(item) {
  const memoryKey = `${item.path}|${item.modified}|${item.size}`;
  if (thumbnailMemory.has(memoryKey)) return thumbnailMemory.get(memoryKey);
  const dataUrl = await createThumbnail(item);
  if (dataUrl) {
    thumbnailMemory.set(memoryKey, dataUrl);
    if (thumbnailMemory.size > 400) thumbnailMemory.delete(thumbnailMemory.keys().next().value);
  }
  return dataUrl;
}

async function createThumbnail(item) {
  try {
    const cacheDirectory = path.join(app.getPath('userData'), 'library-thumbnails');
    await fs.mkdir(cacheDirectory, { recursive: true });
    const cacheKey = crypto.createHash('sha1').update(`${item.path}|${item.modified}|${item.size}`).digest('hex');
    const thumbnailPath = path.join(cacheDirectory, `${cacheKey}.jpg`);
    if (item.extension === 'png') {
      const cached = await fs.readFile(thumbnailPath).catch(() => null);
      if (cached) return `data:image/jpeg;base64,${cached.toString('base64')}`;
      const image = nativeImage.createFromPath(item.path);
      if (image.isEmpty()) return null;
      const jpeg = image.resize({ width: 480, quality: 'good' }).toJPEG(82);
      await fs.writeFile(thumbnailPath, jpeg).catch(() => {});
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    }
    try { await fs.access(thumbnailPath); }
    catch {
      if (!thumbnailJobs.has(thumbnailPath)) thumbnailJobs.set(thumbnailPath, (async () => {
        const temporaryPath = path.join(cacheDirectory, `${cacheKey}.${process.pid}.partial.jpg`);
        const generated = await runThumbnailFfmpeg(item.path, temporaryPath);
        if (!generated) return false;
        await fs.rename(temporaryPath, thumbnailPath).catch(async (error) => {
          try { await fs.access(thumbnailPath); await fs.rm(temporaryPath, { force: true }); }
          catch { throw error; }
        });
        return true;
      })().finally(() => thumbnailJobs.delete(thumbnailPath)));
      if (!await thumbnailJobs.get(thumbnailPath)) return null;
    }
    return `data:image/jpeg;base64,${(await fs.readFile(thumbnailPath)).toString('base64')}`;
  } catch { return null; }
}

async function listLibrary() {
  const directory = await ensureOutputDirectory();
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const supported = entries.filter((entry) => entry.isFile() && /\.(png|webm|mp4)$/i.test(entry.name));
  const items = await Promise.all(supported.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    const stat = await fs.stat(fullPath);
    let edited = false;
    if (/\.png$/i.test(entry.name)) edited = Boolean(await readJson(projectPathFor(fullPath)));
    const metadata = await readJson(`${fullPath}.meta.json`) || {};
    return { name: entry.name, path: fullPath, size: stat.size, modified: stat.mtimeMs, extension: path.extname(entry.name).slice(1).toLowerCase(), edited, metadata };
  }));
  const sorted = items.sort((a, b) => b.modified - a.modified);
  return Promise.all(sorted.map(async (item) => ({ ...item, thumbnail: await thumbnailFor(item) })));
}

// Only the app's own pages may call the main process: a foreign page that slipped into a window
// would otherwise reach file, clipboard and ffmpeg handlers through the preload bridge.
function isTrustedSender(event) {
  return isAppUrl(event.senderFrame?.url);
}

function isAppUrl(url = '') {
  const devUrl = process.env.SCREEN_STUDIO_DEV_URL;
  if (devUrl && (url === devUrl || url.startsWith(`${devUrl}/`))) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const filePath = path.normalize(decodeURIComponent(parsed.pathname).replace(/^\/([A-Za-z]:)/, '$1'));
    return path.dirname(filePath).toLowerCase() === path.normalize(__dirname).toLowerCase();
  } catch {
    return false;
  }
}

function registerIpc() {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('בקשה ממקור לא מורשה נחסמה');
    return listener(event, ...args);
  });
  ipcMain.handle('sources:list', getSources);
  // Hides the studio window from screen captures (Windows excludes it from capture), so a live preview of the
  // whole screen does not show itself recursively and full-screen recordings do not include the studio.
  ipcMain.handle('window:capture-exclusion', (_event, enabled) => { mainWindow?.setContentProtection(Boolean(enabled)); return Boolean(enabled); });
  ipcMain.handle('capture:capabilities', () => getEncoderCapabilities());
  ipcMain.handle('capture:prepare', (_event, options) => {
    pendingCapture = { sourceId: options.sourceId, includeSystemAudio: Boolean(options.includeSystemAudio) };
    return true;
  });
  ipcMain.handle('file:save-screenshot', async (_event, bytes) => {
    const directory = await ensureOutputDirectory();
    const filePath = captureFilePath(directory, 'screenshot', 'png');
    await fs.writeFile(filePath, Buffer.from(bytes));
    return { path: filePath };
  });
  ipcMain.handle('file:save-recording', async (_event, bytes, convertToMp4) => {
    const directory = await ensureOutputDirectory();
    const webmPath = captureFilePath(directory, 'recording', 'webm');
    await fs.writeFile(webmPath, Buffer.from(bytes));
    return convertRecording(webmPath, convertToMp4);
  });
  ipcMain.handle('recording:begin', async (_event, details = {}) => {
    const status = await storageStatus();
    if (status.level === 'critical') throw new Error('אין מספיק מקום פנוי להקלטה בטוחה');
    const id = crypto.randomUUID();
    const paths = recordingPaths(await ensureOutputDirectory());
    await fs.mkdir(paths.segmentDirectory, { recursive: true });
    const session = { id, ...paths, startedAt: new Date().toISOString(), mimeType: details.mimeType || 'video/webm', bytes: 0, chunks: 0, segmentIndex: 1, segmentBytes: 0, segmentChunks: 0, segmentChunkTarget: Math.max(3, Math.min(120, Number(details.segmentChunkTarget) || 30)), audioBytes: { system: 0, microphone: 0 } };
    await writeRecordingJournal(session, { state: 'recording', fps: details.fps, targetHeight: details.targetHeight });
    recordingSessions.set(id, session);
    return { id, path: paths.partialPath, storage: status };
  });
  ipcMain.handle('recording:append', async (_event, id, bytes) => {
    const session = recordingSessions.get(id);
    if (!session) throw new Error('Recording session is not active');
    const buffer = Buffer.from(bytes);
    await fs.appendFile(recordingSegmentPath(session.segmentDirectory, session.segmentIndex), buffer);
    session.bytes += buffer.length;
    session.chunks += 1;
    session.segmentBytes += buffer.length;
    session.segmentChunks += 1;
    if (session.segmentChunks >= session.segmentChunkTarget || session.segmentBytes >= 64 * 1024 * 1024) {
      session.segmentIndex += 1;
      session.segmentBytes = 0;
      session.segmentChunks = 0;
      await writeRecordingJournal(session, { state: 'recording', rotatedAt: new Date().toISOString() });
    }
    if (session.chunks % 5 === 0) await writeRecordingJournal(session, { state: 'recording' });
    return { bytes: session.bytes, chunks: session.chunks, segments: session.segmentIndex };
  });
  ipcMain.handle('recording:audio-append', async (_event, id, kind, bytes) => {
    const session = recordingSessions.get(id);
    if (!session) throw new Error('Recording session is not active');
    const buffer = Buffer.from(bytes);
    await fs.appendFile(recordingAudioPath(session.segmentDirectory, kind), buffer);
    session.audioBytes[kind] += buffer.length;
    return { kind, bytes: session.audioBytes[kind] };
  });
  ipcMain.handle('recording:heartbeat', async (_event, id, health = {}) => {
    const session = recordingSessions.get(id);
    if (!session) throw new Error('Recording session is not active');
    const storage = await storageStatus();
    await writeRecordingJournal(session, { state: 'recording', health, storageLevel: storage.level });
    return { storage, bytes: session.bytes, chunks: session.chunks, segments: session.segmentIndex };
  });
  ipcMain.handle('recording:finish', async (_event, id, convertToMp4, details = {}) => {
    const session = recordingSessions.get(id);
    if (!session) throw new Error('Recording session is not active');
    recordingSessions.delete(id);
    const segmentNames = (await fs.readdir(session.segmentDirectory)).filter((item) => /^video-\d+\.part$/i.test(item)).sort();
    if (!segmentNames.length) throw new Error('לא נשמרו מקטעי וידאו תקינים');
    await concatenateFiles(segmentNames.map((item) => path.join(session.segmentDirectory, item)), session.partialPath);
    await fs.rename(session.partialPath, session.finalPath);
    const result = { ...(await convertRecording(session.finalPath, convertToMp4)), bytes: session.bytes, chunks: session.chunks, recovered: false };
    result.segments = segmentNames.length;
    result.audioTracks = [];
    for (const [kind, label] of [['system', 'קול-מחשב'], ['microphone', 'מיקרופון']]) {
      const partialAudio = recordingAudioPath(session.segmentDirectory, kind);
      const stat = await fs.stat(partialAudio).catch(() => null);
      if (!stat?.size) continue;
      const rawPath = session.finalPath.replace(/\.webm$/i, `_${label}.webm`);
      const normalizedPath = session.finalPath.replace(/\.webm$/i, `_${label}.m4a`);
      await fs.rename(partialAudio, rawPath);
      const normalized = await normalizeAudioSidecar(rawPath, normalizedPath, result.quality?.durationSeconds || 0);
      if (normalized.ok) { await fs.rm(rawPath, { force: true }); result.audioTracks.push({ kind, path: normalizedPath, driftCorrected: true }); }
      else result.audioTracks.push({ kind, path: rawPath, driftCorrected: false, error: normalized.error });
    }
    await fs.writeFile(`${result.path}.recording-health.json`, JSON.stringify({ segments: result.segments, audioTracks: result.audioTracks, bytes: session.bytes, chunks: session.chunks, finishedAt: new Date().toISOString() }, null, 2), 'utf8');
    await fs.rm(session.segmentDirectory, { recursive: true, force: true });
    await fs.rm(session.journalPath, { force: true });
    if (Array.isArray(details.chapters) && details.chapters.length) {
      const chapters = details.chapters.slice(0, 500).map((chapter, index) => ({ index: index + 1, at: Math.max(0, Number(chapter.at) || 0), label: String(chapter.label || `פרק ${index + 1}`).slice(0, 80) }));
      await fs.writeFile(`${result.path}.chapters.json`, JSON.stringify(chapters, null, 2), 'utf8');
      result.chapters = chapters;
    }
    if (Array.isArray(details.cursorSamples) && details.cursorSamples.length) {
      const cursorSamples = details.cursorSamples.slice(0, 36_000).map((sample) => ({ at: Math.max(0, Number(sample.at) || 0), x: Math.max(0, Math.min(1, Number(sample.x) || 0)), y: Math.max(0, Math.min(1, Number(sample.y) || 0)) }));
      await fs.writeFile(`${result.path}.cursor.json`, JSON.stringify(cursorSamples), 'utf8');
      result.cursorSamples = cursorSamples.length;
    }
    return result;
  });
  ipcMain.handle('storage:status', storageStatus);
  ipcMain.handle('tools:engines', async () => {
    const engines = await discoverLocalEngines();
    try { await ensureOcrLanguageData(); engines.ocr.languages = [...new Set([...(engines.ocr.languages || []), 'heb'])]; engines.ocr.hebrewBundled = true; } catch {}
    return engines;
  });
  ipcMain.handle('cursor:position', () => {
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    return { point, displayId: String(display.id), bounds: display.bounds };
  });
  ipcMain.handle('library:list', listLibrary);
  const openableLibraryFile = /\.(png|webm|mp4|m4a)$/i;
  ipcMain.handle('library:open', async (_event, filePath) => shell.openPath(await assertLibraryFile(filePath, openableLibraryFile)));
  ipcMain.handle('library:show', async (_event, filePath) => shell.showItemInFolder(await assertLibraryFile(filePath, openableLibraryFile)));
  ipcMain.handle('library:rename', async (_event, filePath, requestedName) => {
    const directory = await ensureOutputDirectory();
    const targetPath = renamedLibraryPath(filePath, directory, requestedName);
    if (targetPath.toLowerCase() === path.resolve(filePath).toLowerCase()) return { path: filePath, name: path.basename(filePath) };
    try { await fs.access(targetPath); throw new Error('כבר קיים קובץ בשם הזה'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(filePath, targetPath);
    const oldProjectPath = projectPathFor(filePath);
    const newProjectPath = projectPathFor(targetPath);
    try {
      await fs.rename(oldProjectPath, newProjectPath);
      const project = await readJson(newProjectPath);
      if (project) await fs.writeFile(newProjectPath, JSON.stringify({ ...project, sourcePath: targetPath, outputPath: targetPath }, null, 2), 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const suffix of ['.meta.json', '.quality.json', '.transcript.json', '.srt', '.chapters.json', '.cursor.json', '.timeline.json']) {
      await fs.rename(`${filePath}${suffix}`, `${targetPath}${suffix}`).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
    return { path: targetPath, name: path.basename(targetPath) };
  });
  ipcMain.handle('library:metadata', async (_event, filePath, metadata) => {
    const directory = path.resolve(await ensureOutputDirectory());
    const resolved = path.resolve(filePath);
    if (path.dirname(resolved).toLowerCase() !== directory.toLowerCase()) throw new Error('הקובץ אינו בספרייה המקומית');
    const current = await readJson(`${resolved}.meta.json`) || {};
    const safe = { ...current, client: String(metadata.client || '').trim().slice(0, 80), tags: String(metadata.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12), favorite: Boolean(metadata.favorite), note: String(metadata.note || '').trim().slice(0, 500) };
    await fs.writeFile(`${resolved}.meta.json`, JSON.stringify(safe, null, 2), 'utf8');
    return safe;
  });
  ipcMain.handle('library:share-local', async (_event, filePath) => {
    const resolved = await assertLibraryFile(filePath);
    const share = await privateShareServer.share(resolved, 30);
    clipboard.writeText(share.url);
    return { ...share, path: resolved };
  });
  ipcMain.handle('library:analyze', async (_event, filePath) => {
    const resolved = await assertLibraryFile(filePath, /\.(webm|mp4)$/i);
    const quality = await analyzeMedia(resolved);
    await updateMetadata(resolved, { quality });
    return quality;
  });
  // Smart redact: OCR the editor's current background (it may already be cropped), return boxes in its pixels.
  ipcMain.handle('editor:detect-sensitive', async (_event, dataUrl) => {
    const imagePath = path.join(os.tmpdir(), `aurum-redact-${crypto.randomUUID()}.png`);
    await fs.writeFile(imagePath, dataUrlBytes(dataUrl));
    try {
      const words = parseTesseractTsv(await runOcrWords(imagePath, { tessdataDirectory: await ensureOcrLanguageData() }));
      const regions = findSensitiveRegions(words, { padding: 6 });
      return { regions, summary: summarizeRegions(regions), words: words.length };
    } finally {
      await fs.rm(imagePath, { force: true }).catch(() => {});
    }
  });
  ipcMain.handle('library:ocr', async (_event, filePath) => {
    const resolved = await assertLibraryFile(filePath, /\.png$/i);
    const result = await runOcr(resolved, { tessdataDirectory: await ensureOcrLanguageData() });
    await updateMetadata(resolved, { ocrText: result.text, ocrLanguage: result.language, ocrAt: new Date().toISOString() });
    return result;
  });
  ipcMain.handle('library:transcribe', async (_event, filePath) => {
    const resolved = await assertLibraryFile(filePath, /\.(webm|mp4)$/i);
    const result = await transcribeMedia(resolved, { language: 'he' });
    await updateMetadata(resolved, { transcriptText: result.text, transcriptPath: result.transcriptPath, srtPath: result.srtPath, transcribedAt: new Date().toISOString() });
    return result;
  });
  ipcMain.handle('library:waveform', async (_event, filePath) => {
    const resolved = await assertLibraryFile(filePath, /\.(webm|mp4)$/i);
    const cacheDirectory = path.join(app.getPath('userData'), 'waveforms');
    await fs.mkdir(cacheDirectory, { recursive: true });
    const outputPath = path.join(cacheDirectory, `${crypto.createHash('sha1').update(resolved).digest('hex')}.png`);
    try { await fs.access(outputPath); }
    catch {
      const result = await runHidden('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', resolved, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1200x160:colors=0xc99124', '-frames:v', '1', outputPath], { timeoutMs: 120_000 });
      if (!result.ok) throw new Error('לא ניתן ליצור צורת גל לקובץ ללא ערוץ שמע תקין');
    }
    return `data:image/png;base64,${(await fs.readFile(outputPath)).toString('base64')}`;
  });
  ipcMain.handle('library:pin', async (_event, filePath) => pinImageWindow(await assertLibraryFile(filePath, /\.png$/i)));
  ipcMain.handle('video:edit', async (_event, filePath, options) => {
    const directory = path.resolve(await ensureOutputDirectory());
    const resolved = path.resolve(filePath);
    if (path.dirname(resolved).toLowerCase() !== directory.toLowerCase() || !/\.(mp4|webm)$/i.test(resolved)) throw new Error('קובץ וידאו לא תקין');
    const outputPath = path.join(directory, `${path.basename(resolved, path.extname(resolved))} — ערוך.mp4`);
    const result = await runVideoEdit(resolved, outputPath, options);
    if (!result.ok) throw new Error(result.error);
    return { path: outputPath };
  });
  ipcMain.handle('video:timeline-load', async (_event, filePath) => {
    const resolved = await assertLibraryFile(filePath, /\.(webm|mp4)$/i);
    const quality = await analyzeMedia(resolved, { countFrames: false, persist: false });
    const project = await readJson(`${resolved}.timeline.json`);
    const cursorSamples = await readJson(`${resolved}.cursor.json`) || [];
    return { project: normalizeTimelineProject(project || {}, quality.durationSeconds), cursorSamples, quality };
  });
  ipcMain.handle('video:timeline-save', async (_event, filePath, candidate) => {
    const resolved = await assertLibraryFile(filePath, /\.(webm|mp4)$/i);
    const quality = await analyzeMedia(resolved, { countFrames: false, persist: false });
    const project = normalizeTimelineProject(candidate, quality.durationSeconds);
    const projectPath = `${resolved}.timeline.json`;
    await fs.writeFile(projectPath, JSON.stringify(project, null, 2), 'utf8');
    return { project, projectPath };
  });
  ipcMain.handle('video:timeline-export', async (_event, filePath, candidate) => {
    const resolved = await assertLibraryFile(filePath, /\.(webm|mp4)$/i);
    const outputPath = path.join(path.dirname(resolved), `${path.basename(resolved, path.extname(resolved))} — Timeline.mp4`);
    const result = await exportTimeline(resolved, outputPath, candidate);
    await fs.writeFile(`${resolved}.timeline.json`, JSON.stringify(result.project, null, 2), 'utf8');
    return result;
  });
  ipcMain.handle('video:detect-silence', async (_event, filePath, options) => detectSilences(await assertLibraryFile(filePath, /\.(webm|mp4)$/i), options));
  ipcMain.handle('workflow:action', async (_event, filePath, action, options = {}) => {
    if (!WORKFLOW_ACTIONS.has(action)) throw new Error('פעולת אוטומציה אינה מוכרת');
    return runLibraryAction(filePath, action, options);
  });
  ipcMain.handle('editor:load', async (_event, filePath) => {
    const sourcePath = assertEditableImagePath(filePath, await ensureOutputDirectory());
    const bytes = await fs.readFile(sourcePath);
    const project = await readJson(projectPathFor(sourcePath));
    return { path: sourcePath, name: path.basename(sourcePath), dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, project };
  });
  ipcMain.handle('editor:save', async (_event, payload) => {
    const sourcePath = assertEditableImagePath(payload.sourcePath, await ensureOutputDirectory());
    const imageBytes = dataUrlBytes(payload.dataUrl);
    const saveCopy = payload.mode === 'copy';
    const hasExistingProject = Boolean(await readJson(projectPathFor(sourcePath)));
    const targetPath = (saveCopy || !hasExistingProject) ? editedCopyPath(sourcePath, (candidate) => require('node:fs').existsSync(candidate)) : sourcePath;
    const temporaryPath = `${targetPath}.${process.pid}.partial`;
    await fs.writeFile(temporaryPath, imageBytes);
    await fs.rename(temporaryPath, targetPath);
    const project = { ...payload.project, sourcePath: targetPath, outputPath: targetPath, savedAt: new Date().toISOString() };
    await fs.writeFile(projectPathFor(targetPath), JSON.stringify(project, null, 2), 'utf8');
    return { path: targetPath, projectPath: projectPathFor(targetPath), name: path.basename(targetPath), copied: targetPath !== sourcePath };
  });
  ipcMain.handle('editor:copy-image', async (_event, dataUrl) => {
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) throw new Error('לא ניתן להעתיק את התמונה');
    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle('output:open', async () => shell.openPath(await ensureOutputDirectory()));
  ipcMain.handle('output:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled && result.filePaths[0]) outputDirectory = result.filePaths[0];
    await ensureOutputDirectory();
    return outputDirectory;
  });
  ipcMain.handle('output:get', ensureOutputDirectory);
  ipcMain.handle('app:autostart-get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:autostart-set', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('quickbar:get-state', () => ({ preferences: quickbarPreferences, expanded: quickbarExpanded, recording: Boolean(recordingSessions.size), view: quickbarView, captures: recentCaptures }));
  ipcMain.handle('capture:preview', (_event, filePath) => showCapturePreview(filePath));
  ipcMain.handle('quickbar:capture-action', (_event, filePath, action) => {
    if (!['edit', 'copy', 'pin', 'open-folder', 'trash'].includes(action)) throw new Error('פעולה לא מוכרת בכרטיס הצילום');
    return runCaptureCardAction(filePath, action);
  });
  ipcMain.handle('quickbar:set-view', (_event, view) => { quickbarView = view === 'capture' && recentCaptures.length ? 'capture' : 'actions'; positionQuickbar(quickbarExpanded); return quickbarView; });
  // Drag a capture out of the card straight into another program (must run synchronously during dragstart).
  ipcMain.on('quickbar:start-drag', async (event, filePath) => {
    if (!isTrustedSender(event)) return;
    try {
      const resolved = await assertLibraryFile(filePath);
      const entry = recentCaptures.find((item) => item.path === resolved);
      const icon = entry?.thumbnail ? nativeImage.createFromDataURL(entry.thumbnail).resize({ width: 96 }) : nativeImage.createFromPath(resolved).resize({ width: 96 });
      event.sender.startDrag({ file: resolved, icon });
    } catch {}
  });
  ipcMain.handle('quickbar:get-preferences', () => quickbarPreferences);
  ipcMain.handle('quickbar:set-preferences', (_event, patch) => applyQuickbarPreferences(patch));
  ipcMain.handle('quickbar:set-expanded', (_event, expanded) => { positionQuickbar(Boolean(expanded)); return { expanded: quickbarExpanded, bounds: quickbarWindow?.getBounds() || null }; });
  ipcMain.handle('quickbar:action', (_event, action) => {
    if (!Object.hasOwn(ACTION_DEFINITIONS, action)) throw new Error('פעולת סרגל מהיר אינה מוכרת');
    if (['openLibrary'].includes(action)) showMainWindow('library');
    else if (action === 'openOutput') ensureOutputDirectory().then((directory) => shell.openPath(directory));
    else mainWindow?.webContents.send('shortcut', action, { source: 'quickbar' });
    return true;
  });
  ipcMain.handle('quickbar:recording-state', (_event, active) => { quickbarWindow?.webContents.send('quickbar:recording-state', Boolean(active)); return true; });
  ipcMain.handle('shortcuts:get', () => ({ shortcuts: activeShortcuts, registration: shortcutRegistration }));
  ipcMain.handle('shortcuts:set', (_event, candidate) => {
    const shortcuts = normalizeShortcutMap(candidate);
    const conflicts = [...shortcutConflicts(shortcuts), ...reservedShortcutConflicts(shortcuts)];
    if (conflicts.length) return { ok: false, conflicts, shortcuts: activeShortcuts, registration: shortcutRegistration };
    activeShortcuts = shortcuts;
    shortcutRegistration = registerShortcuts();
    return { ok: Object.values(shortcutRegistration).every((registered) => registered !== false), shortcuts: activeShortcuts, registration: shortcutRegistration };
  });
  ipcMain.handle('shortcuts:test', (_event, action) => {
    if (!Object.hasOwn(ACTION_DEFINITIONS, action)) return false;
    mainWindow?.webContents.send('shortcut', action, { test: true });
    return true;
  });
  ipcMain.handle('qa:status', qaStatus);
  ipcMain.handle('qa:run', runQa);
  ipcMain.handle('qa:copy', (_event, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('qa:open-report', async () => {
    const status = await qaStatus();
    return status.report ? shell.openPath(status.reportPath) : 'אין עדיין דוח QA';
  });
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  if (process.env.SCREEN_STUDIO_QA === '1') {
    shortcutRegistration = Object.fromEntries(Object.keys(activeShortcuts).map((action) => [action, true]));
    return shortcutRegistration;
  }
  const result = {};
  for (const [action, binding] of Object.entries(activeShortcuts)) {
    if (!binding) {
      result[action] = null;
      continue;
    }
    if (binding.scope === 'focused') {
      result[action] = true;
      continue;
    }
    const accelerator = acceleratorForBinding(binding);
    result[action] = Boolean(accelerator && globalShortcut.register(accelerator, () => handleShortcutPress(action, binding, 'global')));
  }
  shortcutRegistration = result;
  return result;
}

function handleShortcutPress(action, binding, source) {
  if (binding?.kind !== 'double') return dispatchShortcut(action, source);
  const now = Date.now();
  const previous = pendingDoublePress.get(action) || 0;
  pendingDoublePress.set(action, now);
  if (now - previous < 60) return false;
  if (now - previous > binding.intervalMs) return false;
  pendingDoublePress.delete(action);
  return dispatchShortcut(action, `${source}-double`);
}

function dispatchShortcut(action, source = 'unknown') {
  if (!mainWindow) return false;
  const now = Date.now();
  if (now - (lastShortcutDispatch.get(action) || 0) < 180) return false;
  lastShortcutDispatch.set(action, now);
  if (action === 'toggleWindow') {
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
    else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); }
    return true;
  }
  if (action === 'openOutput') {
    ensureOutputDirectory().then((directory) => shell.openPath(directory)).catch(() => {});
    return true;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.webContents.send('shortcut', action, { source });
  return true;
}

function showMainWindow(page = null) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  if (page) mainWindow.webContents.send('app:navigate', page);
}

function createTray() {
  if (tray || process.env.SCREEN_STUDIO_QA === '1' || process.env.SCREEN_STUDIO_HEADLESS === '1') return;
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="#c99124"/><circle cx="16" cy="16" r="7" fill="#071a34"/><circle cx="16" cy="16" r="3" fill="#fff"/></svg>').toString('base64')}`).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('אורום סטודיו — צילום והקלטת מסך');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'פתיחת אורום סטודיו', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'התחל / עצור הקלטה', click: () => dispatchShortcut('record', 'tray') },
    { label: 'צילום מסך מלא', click: () => dispatchShortcut('screenshot', 'tray') },
    { label: 'פתיחת הספרייה', click: () => showMainWindow('library') },
    { label: 'פתיחת תיקיית השמירה', click: () => ensureOutputDirectory().then((directory) => shell.openPath(directory)) },
    { type: 'separator' },
    { label: 'יציאה', click: () => app.quit() }
  ]));
  tray.on('double-click', () => showMainWindow());
}

// A second copy would run crash recovery on the first copy's live recording and delete its segments.
// QA and live-reload dev runs restart the process back-to-back, so they skip the lock.
const singleInstance = process.env.SCREEN_STUDIO_QA === '1' || Boolean(process.env.SCREEN_STUDIO_DEV_URL) || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else app.on('second-instance', () => { showMainWindow(); mainWindow?.focus(); });

app.whenReady().then(async () => {
  if (!singleInstance) return;
  await ensureOutputDirectory();
  await recoverInterruptedRecordings();
  await loadQuickbarPreferences();
  registerIpc();
  // Deny every permission except the three the app uses, and only for its own pages.
  const allowedPermissions = new Set(['media', 'display-capture', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(allowedPermissions.has(permission) && isAppUrl(details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => allowedPermissions.has(permission) && (String(requestingOrigin).startsWith('file://') || isAppUrl(requestingOrigin)));
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      if (!pendingCapture) return callback({});
      let sources = sourceCache.native.length && Date.now() - sourceCache.at < 30_000 ? sourceCache.native : null;
      if (!sources) {
        sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
        sourceCache = { ...sourceCache, at: Date.now(), native: sources };
      }
      const source = sources.find((item) => item.id === pendingCapture.sourceId);
      if (!source) return callback({});
      const audio = pendingCapture.includeSystemAudio ? 'loopback' : undefined;
      pendingCapture = null;
      callback({ video: source, audio });
    } catch {
      pendingCapture = null;
      callback({});
    }
  }, { useSystemPicker: false });
  createWindow();
  createTray();
  await createQuickbarWindow();
  // Prepare the capture card's window in the background, so the first capture after start shows its card at once.
  if (quickbarPreferences.capturePreview) setTimeout(() => createQuickbarWindow({ forCapture: true }).catch(() => {}), 2500).unref?.();
  screen.on('display-metrics-changed', () => positionQuickbar());
  screen.on('display-removed', () => positionQuickbar());
  const devParentPid = Number(process.env.SCREEN_STUDIO_DEV_PARENT_PID);
  if (devParentPid > 0) setInterval(() => {
    try { process.kill(devParentPid, 0); } catch { app.quit(); }
  }, 1500).unref();
  registerShortcuts();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => {
  clearInterval(quickbarCursorTimer);
  if (qaProcess?.pid) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(qaProcess.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else qaProcess.kill('SIGTERM');
    qaProcess = null;
  }
  globalShortcut.unregisterAll();
  privateShareServer.stop();
  tray?.destroy();
});
