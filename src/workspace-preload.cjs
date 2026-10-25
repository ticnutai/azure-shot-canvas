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
  copy: (paths) => ipcRenderer.invoke('captures:copy', paths),
  trashMany: (paths) => ipcRenderer.invoke('captures:trash', paths),
  setDock: (patch) => ipcRenderer.invoke('workspace:dock', patch),
  dragDock: (active) => ipcRenderer.invoke('workspace:dock-drag', active),
  resizeFrom: (grip) => ipcRenderer.send('workspace:resize', grip),
  setBusy: (busy) => ipcRenderer.send('workspace:busy', busy),
  onDock: (callback) => ipcRenderer.on('workspace:dock', (_event, state) => callback(state)),
  // Split in two windows: the list shares its choice with the tools window, which hands its buttons back to the list.
  setSplit: (split) => ipcRenderer.invoke('workspace:split', split),
  onSplit: (callback) => ipcRenderer.on('workspace:split', (_event, split) => callback(split)),
  shareSelection: (chosen) => ipcRenderer.send('workspace:selection', chosen),
  onSelection: (callback) => ipcRenderer.on('workspace:selection', (_event, chosen) => callback(chosen)),
  runInList: (action) => ipcRenderer.invoke('workspace:run-item', action),
  fitHeight: (height) => ipcRenderer.send('workspace:fit', height),
  onRunItem: (callback) => ipcRenderer.on('workspace:run-item', (_event, action) => callback(action)),
  createGuide: (options) => ipcRenderer.invoke('workspace:guide', options),
  trim: (filePath, start, end) => ipcRenderer.invoke('workspace:trim', filePath, start, end)
});

// The keys of each action, shown in the buttons' hints, and the right-click menu to change them (shortcut-hints.js).
contextBridge.exposeInMainWorld('shortcutHintsApi', {
  labels: () => ipcRenderer.invoke('shortcuts:labels'),
  onLabels: (callback) => ipcRenderer.on('shortcuts:labels', (_event, labels) => callback(labels)),
  menu: (action) => ipcRenderer.send('shortcuts:menu', action)
});
