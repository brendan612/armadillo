const { contextBridge, ipcRenderer, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const vaultDir = path.join(os.homedir(), '.armadillo');
const defaultVaultPath = path.join(vaultDir, 'vault.armadillo');

function readVaultFile(filePath = defaultVaultPath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function writeVaultFile(contents, filePath = defaultVaultPath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function deleteVaultFile(filePath = defaultVaultPath) {
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
  readVaultFile,
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
