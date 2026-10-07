const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('regionApi', {
  onStart: (callback) => ipcRenderer.on('region:start', (_event, data) => callback(data)),
  onShown: (callback) => ipcRenderer.on('region:shown', () => callback()),
  onKey: (callback) => ipcRenderer.on('region:key', (_event, key) => callback(key)),
  ready: (displayId) => ipcRenderer.send('region:ready', displayId),
  visible: (displayId) => ipcRenderer.send('region:visible', displayId),
  finish: (displayId, rect, options) => ipcRenderer.send('region:finish', displayId, rect, options),
  cancel: () => ipcRenderer.send('region:cancel'),
  saveArea: (displayId, rect) => ipcRenderer.invoke('region:save-area', displayId, rect),
  copyText: (text) => ipcRenderer.invoke('region:copy-text', text)
});
