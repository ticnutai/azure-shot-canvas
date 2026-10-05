const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('quickbarApi', {
  getState: () => ipcRenderer.invoke('quickbar:get-state'), setExpanded: (expanded) => ipcRenderer.invoke('quickbar:set-expanded', expanded),
  setPreferences: (patch) => ipcRenderer.invoke('quickbar:set-preferences', patch), runAction: (action) => ipcRenderer.invoke('quickbar:action', action),
  onRecordingState: (callback) => ipcRenderer.on('quickbar:recording-state', (_event, active) => callback(active)),
  onPreferences: (callback) => ipcRenderer.on('quickbar:preferences', (_event, value) => callback(value))
});
