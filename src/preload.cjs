const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenStudio', {
  qaEnabled: process.env.SCREEN_STUDIO_QA === '1',
  listSources: () => ipcRenderer.invoke('sources:list'),
  prepareCapture: (options) => ipcRenderer.invoke('capture:prepare', options),
  saveScreenshot: (bytes) => ipcRenderer.invoke('file:save-screenshot', bytes),
  saveRecording: (bytes, convertToMp4) => ipcRenderer.invoke('file:save-recording', bytes, convertToMp4),
  listLibrary: () => ipcRenderer.invoke('library:list'),
  openFile: (filePath) => ipcRenderer.invoke('library:open', filePath),
  showFile: (filePath) => ipcRenderer.invoke('library:show', filePath),
  renameFile: (filePath, name) => ipcRenderer.invoke('library:rename', filePath, name),
  loadEditorImage: (filePath) => ipcRenderer.invoke('editor:load', filePath),
  saveEditorImage: (payload) => ipcRenderer.invoke('editor:save', payload),
  copyEditorImage: (dataUrl) => ipcRenderer.invoke('editor:copy-image', dataUrl),
  openOutput: () => ipcRenderer.invoke('output:open'),
  chooseOutput: () => ipcRenderer.invoke('output:choose'),
  getOutput: () => ipcRenderer.invoke('output:get'),
  getQaStatus: () => ipcRenderer.invoke('qa:status'),
  runQa: () => ipcRenderer.invoke('qa:run'),
  copyText: (text) => ipcRenderer.invoke('qa:copy', text),
  openQaReport: () => ipcRenderer.invoke('qa:open-report'),
  onQaOutput: (callback) => ipcRenderer.on('qa:output', (_event, text) => callback(text)),
  onShortcut: (callback) => ipcRenderer.on('shortcut', (_event, action) => callback(action))
});
