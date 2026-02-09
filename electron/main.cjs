const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const http = require('http');
const path = require('node:path');

const isDev = !app.isPackaged;
const deepLinkProtocol = 'armadillo';
let mainWindow = null;
let oauthServer = null;
let oauthCallbackUrl = null;

function extractDeepLinkArg(argv) {
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${deepLinkProtocol}://`)) || null;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // On Windows, focus() alone is often not enough to bring the window
  // to the foreground when another app (the browser) is active.
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(false);
}

function emitOAuthCallback(url) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('armadillo:oauth-callback', url);
  focusMainWindow();
}

function handleDeepLink(url) {
  // armadillo://oauth-complete is sent by the browser callback page
  // just to activate the Electron window; no IPC needed.
  if (url.startsWith(`${deepLinkProtocol}://oauth-complete`)) {
    focusMainWindow();
    return;
  }
  emitOAuthCallback(url);
}

function ensureOAuthServer() {
  if (oauthServer && oauthCallbackUrl) {
    return Promise.resolve(oauthCallbackUrl);
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const fullUrl = new URL(req.url || '/', base);

      if (fullUrl.pathname !== '/oauth/callback') {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not found');
        return;
      }

      emitOAuthCallback(fullUrl.toString());
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><head><title>Armadillo</title></head><body>
<h3>Armadillo sign-in complete.</h3>
<p id="msg">Returning to the app&hellip;</p>
<script>
// Try to activate the Electron app via deep link
location.href = '${deepLinkProtocol}://oauth-complete';
// Attempt to close this tab after a short delay
setTimeout(function() {
  window.close();
  document.getElementById('msg').textContent = 'You can close this tab and return to Armadillo.';
}, 500);
</script>
</body></html>`);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      oauthServer = server;
      oauthCallbackUrl = `http://127.0.0.1:${server.address().port}/oauth/callback`;
      resolve(oauthCallbackUrl);
    });
  });
}

function registerDeepLinkHandlers() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(deepLinkProtocol, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(deepLinkProtocol);
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 760,
    title: 'Armadillo',
    backgroundColor: '#f2ede4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  const isAppPage = (url) => {
    if (!url) return false;
    if (url.startsWith('file://')) return true;
    if (isDev && url.startsWith('http://localhost:5173')) return true;
    return false;
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppPage(url) && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppPage(url) && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = extractDeepLinkArg(argv);
    if (deepLink) {
      handleDeepLink(deepLink);
      return;
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  registerDeepLinkHandlers();
  ipcMain.handle('armadillo:get-oauth-callback-url', async () => {
    return await ensureOAuthServer();
  });
  ipcMain.handle('armadillo:choose-vault-save-path', async (_event, currentPath) => {
    const fallbackPath = path.join(app.getPath('documents'), 'vault.armadillo');
    const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
      title: 'Choose Armadillo Vault Location',
      defaultPath: typeof currentPath === 'string' && currentPath.trim() ? currentPath : fallbackPath,
      filters: [{ name: 'Armadillo Vault', extensions: ['armadillo'] }],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return result.filePath.toLowerCase().endsWith('.armadillo') ? result.filePath : `${result.filePath}.armadillo`;
  });
  createWindow();
  const initialDeepLink = extractDeepLinkArg(process.argv);
  if (initialDeepLink) {
    handleDeepLink(initialDeepLink);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
