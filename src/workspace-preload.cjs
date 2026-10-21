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
  rename: (filePath, name) => ipcRenderer.invoke('workspace:rename', filePath, name),
  copy: (paths) => ipcRenderer.invoke('workspace:copy', paths),
  setDock: (patch) => ipcRenderer.invoke('workspace:dock', patch),
  dragDock: (active) => ipcRenderer.invoke('workspace:dock-drag', active),
  setBusy: (busy) => ipcRenderer.send('workspace:busy', busy),
  onDock: (callback) => ipcRenderer.on('workspace:dock', (_event, state) => callback(state)),
  createGuide: (options) => ipcRenderer.invoke('workspace:guide', options),
  trim: (filePath, start, end) => ipcRenderer.invoke('workspace:trim', filePath, start, end)
});
