const { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, screen, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { captureFilePath, developerShortcut } = require('./main-utils.cjs');
const { compareReports } = require('./qa-utils.cjs');
const { renamedLibraryPath } = require('./library-utils.cjs');
const { assertEditableImagePath, dataUrlBytes, editedCopyPath, projectPathFor } = require('./editor-utils.cjs');
const { DEFAULT_SHORTCUTS, acceleratorForBinding, actionForInput, normalizeShortcutMap, reservedShortcutConflicts, shortcutConflicts } = require('./shortcut-utils.cjs');
const { recordingPaths, recoveryPathFor, storageLevel } = require('./recording-utils.cjs');
const { encoderCandidates, parseVideoEncoders } = require('./encoder-utils.cjs');

let mainWindow;
let pendingCapture = null;
let outputDirectory;
let sourceCache = { at: 0, native: [], public: [] };
let qaProcess = null;
let qaConsole = '';
let activeShortcuts = { ...DEFAULT_SHORTCUTS };
let shortcutRegistration = {};
const lastShortcutDispatch = new Map();
const recordingSessions = new Map();
let recoveredRecordings = [];
const thumbnailJobs = new Map();
let encoderCapabilities = null;

const projectDirectory = path.resolve(__dirname, '..');
const qaDirectory = process.env.SCREEN_STUDIO_QA_REPORT_DIR || path.join(projectDirectory, 'artifacts', 'qa');

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return null; }
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
    const captureAction = actionForInput(input, activeShortcuts);
    if (captureAction) {
      event.preventDefault();
      dispatchShortcut(captureAction, 'focused-physical-key');
    }
  });
  const devUrl = process.env.SCREEN_STUDIO_DEV_URL;
  if (devUrl && /^http:\/\/127\.0\.0\.1:\d+$/.test(devUrl)) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, 'index.html'));
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

async function recoverInterruptedRecordings() {
  const directory = await ensureOutputDirectory();
  const names = await fs.readdir(directory).catch(() => []);
  const recovered = [];
  for (const name of names.filter((item) => /\.partial\.webm$/i.test(item))) {
    const partialPath = path.join(directory, name);
    const stat = await fs.stat(partialPath).catch(() => null);
    if (!stat?.size) continue;
    const recoveredPath = recoveryPathFor(partialPath);
    await fs.rename(partialPath, recoveredPath).catch(() => {});
    const journalPath = partialPath.replace(/\.partial\.webm$/i, '.recording.json');
    await fs.rm(journalPath, { force: true }).catch(() => {});
    try { await fs.access(recoveredPath); recovered.push(recoveredPath); } catch {}
  }
  recoveredRecordings = recovered;
  return recovered;
}

async function convertRecording(webmPath, convertToMp4) {
  if (!convertToMp4) return { path: webmPath, webmPath, converted: false };
  const mp4Path = webmPath.replace(/\.webm$/i, '.mp4');
  const temporaryMp4Path = mp4Path.replace(/\.mp4$/i, '.partial');
  const conversion = await runFfmpeg(webmPath, temporaryMp4Path);
  if (conversion.ok) {
    await fs.rename(temporaryMp4Path, mp4Path);
    return { path: mp4Path, webmPath, converted: true, encoder: conversion.encoder, hardwareEncoder: conversion.hardware };
  }
  await fs.rm(temporaryMp4Path, { force: true }).catch(() => {});
  return { path: webmPath, webmPath, converted: false, conversionError: conversion.error };
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

function runThumbnailFfmpeg(inputPath, outputPath) {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.2', '-i', inputPath, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '3', outputPath], { windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function thumbnailFor(item) {
  try {
    if (item.extension === 'png') {
      const image = nativeImage.createFromPath(item.path);
      if (image.isEmpty()) return null;
      return `data:image/jpeg;base64,${image.resize({ width: 480, quality: 'good' }).toJPEG(82).toString('base64')}`;
    }
    const cacheDirectory = path.join(app.getPath('userData'), 'library-thumbnails');
    await fs.mkdir(cacheDirectory, { recursive: true });
    const cacheKey = crypto.createHash('sha1').update(`${item.path}|${item.modified}|${item.size}`).digest('hex');
    const thumbnailPath = path.join(cacheDirectory, `${cacheKey}.jpg`);
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

function registerIpc() {
  ipcMain.handle('sources:list', getSources);
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
    await fs.writeFile(paths.partialPath, Buffer.alloc(0));
    await fs.writeFile(paths.journalPath, JSON.stringify({ id, startedAt: new Date().toISOString(), mimeType: details.mimeType || 'video/webm', partialPath: paths.partialPath }, null, 2), 'utf8');
    recordingSessions.set(id, { ...paths, bytes: 0, chunks: 0 });
    return { id, path: paths.partialPath, storage: status };
  });
  ipcMain.handle('recording:append', async (_event, id, bytes) => {
    const session = recordingSessions.get(id);
    if (!session) throw new Error('Recording session is not active');
    const buffer = Buffer.from(bytes);
    await fs.appendFile(session.partialPath, buffer);
    session.bytes += buffer.length;
    session.chunks += 1;
    return { bytes: session.bytes, chunks: session.chunks };
  });
  ipcMain.handle('recording:finish', async (_event, id, convertToMp4) => {
    const session = recordingSessions.get(id);
    if (!session) throw new Error('Recording session is not active');
    recordingSessions.delete(id);
    await fs.rename(session.partialPath, session.finalPath);
    await fs.rm(session.journalPath, { force: true });
    return { ...(await convertRecording(session.finalPath, convertToMp4)), bytes: session.bytes, chunks: session.chunks, recovered: false };
  });
  ipcMain.handle('storage:status', storageStatus);
  ipcMain.handle('cursor:position', () => {
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    return { point, displayId: String(display.id), bounds: display.bounds };
  });
  ipcMain.handle('library:list', listLibrary);
  ipcMain.handle('library:open', async (_event, filePath) => shell.openPath(filePath));
  ipcMain.handle('library:show', async (_event, filePath) => shell.showItemInFolder(filePath));
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
    await fs.rename(`${filePath}.meta.json`, `${targetPath}.meta.json`).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    return { path: targetPath, name: path.basename(targetPath) };
  });
  ipcMain.handle('library:metadata', async (_event, filePath, metadata) => {
    const directory = path.resolve(await ensureOutputDirectory());
    const resolved = path.resolve(filePath);
    if (path.dirname(resolved).toLowerCase() !== directory.toLowerCase()) throw new Error('הקובץ אינו בספרייה המקומית');
    const safe = { client: String(metadata.client || '').trim().slice(0, 80), tags: String(metadata.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12), favorite: Boolean(metadata.favorite), note: String(metadata.note || '').trim().slice(0, 500) };
    await fs.writeFile(`${resolved}.meta.json`, JSON.stringify(safe, null, 2), 'utf8');
    return safe;
  });
  ipcMain.handle('library:share-local', async (_event, filePath) => {
    clipboard.writeText(filePath);
    return { path: filePath, private: true };
  });
  ipcMain.handle('video:edit', async (_event, filePath, options) => {
    const directory = path.resolve(await ensureOutputDirectory());
    const resolved = path.resolve(filePath);
    if (path.dirname(resolved).toLowerCase() !== directory.toLowerCase() || !/\.(mp4|webm)$/i.test(resolved)) throw new Error('קובץ וידאו לא תקין');
    const outputPath = path.join(directory, `${path.basename(resolved, path.extname(resolved))} — ערוך.mp4`);
    const result = await runVideoEdit(resolved, outputPath, options);
    if (!result.ok) throw new Error(result.error);
    return { path: outputPath };
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
  ipcMain.handle('shortcuts:get', () => ({ shortcuts: activeShortcuts, registration: shortcutRegistration }));
  ipcMain.handle('shortcuts:set', (_event, candidate) => {
    const shortcuts = normalizeShortcutMap(candidate);
    const conflicts = [...shortcutConflicts(shortcuts), ...reservedShortcutConflicts(shortcuts)];
    if (conflicts.length) return { ok: false, conflicts, shortcuts: activeShortcuts, registration: shortcutRegistration };
    activeShortcuts = shortcuts;
    shortcutRegistration = registerShortcuts();
    return { ok: Object.values(shortcutRegistration).every(Boolean), shortcuts: activeShortcuts, registration: shortcutRegistration };
  });
  ipcMain.handle('shortcuts:test', (_event, action) => {
    if (!Object.hasOwn(DEFAULT_SHORTCUTS, action)) return false;
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
    const accelerator = acceleratorForBinding(binding);
    result[action] = Boolean(accelerator && globalShortcut.register(accelerator, () => dispatchShortcut(action, 'global')));
  }
  shortcutRegistration = result;
  return result;
}

function dispatchShortcut(action, source = 'unknown') {
  if (!mainWindow) return false;
  const now = Date.now();
  if (now - (lastShortcutDispatch.get(action) || 0) < 180) return false;
  lastShortcutDispatch.set(action, now);
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.webContents.send('shortcut', action, { source });
  return true;
}

app.whenReady().then(async () => {
  await ensureOutputDirectory();
  await recoverInterruptedRecordings();
  registerIpc();
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
  const devParentPid = Number(process.env.SCREEN_STUDIO_DEV_PARENT_PID);
  if (devParentPid > 0) setInterval(() => {
    try { process.kill(devParentPid, 0); } catch { app.quit(); }
  }, 1500).unref();
  registerShortcuts();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
