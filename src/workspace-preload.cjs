const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('workspaceApi', {
  list: () => ipcRenderer.invoke('workspace:list'),
  action: (filePath, action) => ipcRenderer.invoke('workspace:item-action', filePath, action),
  runAction: (action) => ipcRenderer.invoke('workspace:run', action),
  startDrag: (filePath) => ipcRenderer.send('workspace:start-drag', filePath),
  close: () => ipcRenderer.invoke('workspace:close'),
  toggleMaximize: () => ipcRenderer.invoke('workspace:maximize'),
  setOnTop: (onTop) => ipcRenderer.invoke('workspace:on-top', onTop),
  openStudio: () => ipcRenderer.invoke('workspace:open-studio'),
  getState: () => ipcRenderer.invoke('workspace:state'),
  onChanged: (callback) => ipcRenderer.on('workspace:changed', () => callback()),
  setFolder: (paths, folder) => ipcRenderer.invoke('workspace:folder', paths, folder),
  createGuide: (options) => ipcRenderer.invoke('workspace:guide', options),
  trim: (filePath, start, end) => ipcRenderer.invoke('workspace:trim', filePath, start, end)
});
