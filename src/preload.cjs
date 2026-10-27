const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('island', {
  call: (action, payload) => ipcRenderer.invoke('island:action', action, payload),
  filePath: file => webUtils.getPathForFile(file),
  onState: (callback) => { const listener = (_, state) => callback(state); ipcRenderer.on('island:state', listener); return () => ipcRenderer.removeListener('island:state', listener); }
});
