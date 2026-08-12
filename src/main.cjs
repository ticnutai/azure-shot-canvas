const { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { captureFilePath, developerShortcut } = require('./main-utils.cjs');
const { compareReports } = require('./qa-utils.cjs');
const { renamedLibraryPath } = require('./library-utils.cjs');
const { assertEditableImagePath, dataUrlBytes, editedCopyPath, projectPathFor } = require('./editor-utils.cjs');

let mainWindow;
let pendingCapture = null;
let outputDirectory;
let sourceCache = { at: 0, native: [], public: [] };
let qaProcess = null;
let qaConsole = '';
const thumbnailJobs = new Map();

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
    if (!action) return;
    event.preventDefault();
    if (action === 'hard-reload') mainWindow.webContents.reloadIgnoringCache();
    if (action === 'toggle-devtools') mainWindow.webContents.toggleDevTools();
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

function runFfmpeg(inputPath, outputPath) {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-f', 'mp4', outputPath
    ], { windowsHide: true });
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
    return { name: entry.name, path: fullPath, size: stat.size, modified: stat.mtimeMs, extension: path.extname(entry.name).slice(1).toLowerCase(), edited };
  }));
  const sorted = items.sort((a, b) => b.modified - a.modified);
  return Promise.all(sorted.map(async (item) => ({ ...item, thumbnail: await thumbnailFor(item) })));
}

function registerIpc() {
  ipcMain.handle('sources:list', getSources);
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
    if (!convertToMp4) return { path: webmPath, webmPath, converted: false };
    const mp4Path = webmPath.replace(/\.webm$/i, '.mp4');
    const temporaryMp4Path = mp4Path.replace(/\.mp4$/i, '.partial');
    const conversion = await runFfmpeg(webmPath, temporaryMp4Path);
    if (conversion.ok) {
      await fs.rename(temporaryMp4Path, mp4Path);
      return { path: mp4Path, webmPath, converted: true };
    }
    await fs.rm(temporaryMp4Path, { force: true }).catch(() => {});
    return { path: webmPath, webmPath, converted: false, conversionError: conversion.error };
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
    return { path: targetPath, name: path.basename(targetPath) };
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
  ipcMain.handle('qa:status', qaStatus);
  ipcMain.handle('qa:run', runQa);
  ipcMain.handle('qa:copy', (_event, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('qa:open-report', async () => {
    const status = await qaStatus();
    return status.report ? shell.openPath(status.reportPath) : 'אין עדיין דוח QA';
  });
}

function registerShortcuts() {
  const shortcuts = [
    ['CommandOrControl+Shift+1', 'screenshot'],
    ['CommandOrControl+Shift+2', 'record'],
    ['CommandOrControl+Shift+Q', 'stop']
  ];
  for (const [accelerator, action] of shortcuts) {
    globalShortcut.register(accelerator, () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('shortcut', action);
    });
  }
}

app.whenReady().then(async () => {
  await ensureOutputDirectory();
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
