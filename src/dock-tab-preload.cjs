const { contextBridge, ipcRenderer } = require('electron');
// The folded captures window's tab talks to the same handlers as the window itself.
contextBridge.exposeInMainWorld('dockTabApi', {
  setDock: (patch) => ipcRenderer.invoke('workspace:dock', patch),
  dragDock: (active) => ipcRenderer.invoke('workspace:dock-drag', active),
  onState: (callback) => ipcRenderer.on('dock-tab:state', (_event, state) => callback(state)),
  onBox: (callback) => ipcRenderer.on('dock-tab:box', (_event, box) => callback(box))
});
