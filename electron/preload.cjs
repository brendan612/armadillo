const { contextBridge, ipcRenderer, shell } = require('electron');
const os = require('os');
const path = require('path');

const vaultDir = path.join(os.homedir(), '.armadillo');
const defaultVaultPath = path.join(vaultDir, 'vault.armadillo');

function writeVaultFile(contents, filePath = defaultVaultPath) {
  const fs = require('fs');
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function deleteVaultFile(filePath = defaultVaultPath) {
  const fs = require('fs');
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}

contextBridge.exposeInMainWorld('armadilloShell', {
  isElectron: true,
  platform: process.platform,
  getDefaultVaultPath: () => defaultVaultPath,
  readVaultFile: (filePath) => ipcRenderer.invoke('armadillo:read-vault-file', filePath),
  readVaultFileMeta: (filePath) => ipcRenderer.invoke('armadillo:read-vault-file-meta', filePath),
  writeVaultFile,
  deleteVaultFile,
  openExternal: (url) => shell.openExternal(url),
  chooseVaultSavePath: (currentPath) => ipcRenderer.invoke('armadillo:choose-vault-save-path', currentPath),
  chooseVaultOpenPath: (currentPath) => ipcRenderer.invoke('armadillo:choose-vault-open-path', currentPath),
  getOAuthCallbackUrl: () => ipcRenderer.invoke('armadillo:get-oauth-callback-url'),
  autofillCredentials: (username, password) => ipcRenderer.invoke('armadillo:autofill-credentials', { username, password }),
  minimizeWindow: () => ipcRenderer.invoke('armadillo:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('armadillo:window-toggle-maximize'),
  isWindowMaximized: () => ipcRenderer.invoke('armadillo:window-is-maximized'),
  closeWindow: () => ipcRenderer.invoke('armadillo:window-close'),
  onWindowMaximizedChanged: (callback) => {
    const listener = (_, maximized) => callback(Boolean(maximized));
    ipcRenderer.on('armadillo:window-maximized-changed', listener);
    return () => {
      ipcRenderer.removeListener('armadillo:window-maximized-changed', listener);
    };
  },
  onOAuthCallback: (callback) => {
    const listener = (_, url) => callback(url);
    ipcRenderer.on('armadillo:oauth-callback', listener);
    return () => {
      ipcRenderer.removeListener('armadillo:oauth-callback', listener);
    };
  },
});
