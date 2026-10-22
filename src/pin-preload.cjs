// Only the three things the improved pin may ask for: a new size, a new opacity, back to the start.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pinApi', {
  resize: (factor) => ipcRenderer.send('pin:resize', Number(factor)),
  opacity: (delta) => ipcRenderer.send('pin:opacity', Number(delta)),
  reset: () => ipcRenderer.send('pin:reset')
});
