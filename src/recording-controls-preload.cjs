const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recordingControls', {
  action: (name) => ipcRenderer.invoke('recording-controls:action', name),
  state: () => ipcRenderer.invoke('recording-controls:state'),
  onState: (callback) => ipcRenderer.on('recording-controls:state', (_event, state) => callback(state))
});
