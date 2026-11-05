const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('liveDraw', {
  ready: () => ipcRenderer.send('live-draw:ready'),
  onState: (callback) => ipcRenderer.on('live-draw:state', (_event, state) => callback(state)),
  onCommand: (callback) => ipcRenderer.on('live-draw:command', (_event, name) => callback(name))
});
