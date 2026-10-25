// The shortcut window may only ask about its own action, check a combination, save it, and close.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shortcutEditorApi', {
  info: () => ipcRenderer.invoke('shortcut-editor:info'),
  check: (binding) => ipcRenderer.invoke('shortcut-editor:check', binding),
  save: (binding) => ipcRenderer.invoke('shortcut-editor:save', binding),
  close: () => ipcRenderer.invoke('shortcut-editor:close')
});
