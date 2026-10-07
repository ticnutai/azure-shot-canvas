// Automatic updates from the project's GitHub releases: checks shortly after start and every six hours,
// downloads a new version in the background, and installs it when the program closes (or at once on request).
// Only in the installed program; development runs and automated tests never update.
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { autoUpdater = null; }

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

class Updater {
  constructor({ app, notify, onState }) {
    this.app = app;
    this.notify = notify;
    this.onState = onState || (() => {});
    // idle | checking | downloading | ready | latest | error | unavailable
    this.state = { status: 'idle', version: null, progress: 0, error: null, checkedAt: null };
    this.timer = null;
  }

  get enabled() {
    return Boolean(autoUpdater) && this.app.isPackaged && process.env.SCREEN_STUDIO_QA !== '1' && process.env.SCREEN_STUDIO_HEADLESS !== '1';
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  start() {
    if (!this.enabled) { this.setState({ status: 'unavailable' }); return; }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => this.setState({ status: 'downloading', version: info.version, progress: 0 }));
    autoUpdater.on('download-progress', (progress) => this.setState({ status: 'downloading', progress: Math.round(progress.percent || 0) }));
    autoUpdater.on('update-not-available', () => this.setState({ status: 'latest', checkedAt: new Date().toISOString() }));
    autoUpdater.on('update-downloaded', (info) => {
      this.setState({ status: 'ready', version: info.version, progress: 100, checkedAt: new Date().toISOString() });
      this.notify('גרסה חדשה מוכנה', `גרסה ${info.version} תותקן כשהתוכנה תיסגר — או עכשיו מתפריט המגש`);
    });
    autoUpdater.on('error', (error) => this.setState({ status: 'error', error: String(error?.message || error).slice(0, 200) }));
    setTimeout(() => this.check(), 20_000).unref?.();
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
    this.timer.unref?.();
  }

  async check() {
    if (!this.enabled) return this.state;
    if (['checking', 'downloading'].includes(this.state.status)) return this.state;
    try { await autoUpdater.checkForUpdates(); } catch (error) { this.setState({ status: 'error', error: String(error?.message || error).slice(0, 200) }); }
    return this.state;
  }

  // Closes the program, installs quietly and starts the new version.
  installNow() {
    if (this.state.status !== 'ready' || !autoUpdater) return false;
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }

  stop() { clearInterval(this.timer); }
}

module.exports = { Updater };
