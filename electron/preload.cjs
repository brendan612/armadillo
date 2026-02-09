const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('armadilloShell', {
  isElectron: true,
  platform: process.platform,
});
