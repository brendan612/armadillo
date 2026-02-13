const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const http = require('http');
const path = require('node:path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const isDev = !app.isPackaged;
const deepLinkProtocol = 'armadillo';
const execFileAsync = promisify(execFile);
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

function toBase64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

async function runWindowsAutofill(username, password) {
  const userBase64 = toBase64(username);
  const passBase64 = toBase64(password);
  const script = `
$u=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${userBase64}'));
$p=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${passBase64}'));
Add-Type -AssemblyName System.Windows.Forms;
$ws=New-Object -ComObject WScript.Shell;
function Escape-SendKeys([string]$text){
  $escaped='';
  foreach($ch in $text.ToCharArray()){
    switch($ch){
      '+' {$escaped+='{+}'}
      '^' {$escaped+='{^}'}
      '%' {$escaped+='{%}'}
      '~' {$escaped+='{~}'}
      '(' {$escaped+='{(}'}
      ')' {$escaped+='{)}'}
      '[' {$escaped+='{[}'}
      ']' {$escaped+='{]}'}
      '{' {$escaped+='{{}'}
      '}' {$escaped+='{}}'}
      default {$escaped+=$ch}
    }
  }
  return $escaped;
}
Start-Sleep -Milliseconds 140;
$ws.SendKeys('%{TAB}');
Start-Sleep -Milliseconds 280;
$ws.SendKeys((Escape-SendKeys $u));
Start-Sleep -Milliseconds 90;
$ws.SendKeys('{TAB}');
Start-Sleep -Milliseconds 90;
$ws.SendKeys((Escape-SendKeys $p));
Start-Sleep -Milliseconds 90;
$ws.SendKeys('{ENTER}');
`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 760,
    title: 'Armadillo',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#f2ede4',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
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

  const emitMaximizedState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('armadillo:window-maximized-changed', mainWindow.isMaximized());
  };

  mainWindow.on('maximize', emitMaximizedState);
  mainWindow.on('unmaximize', emitMaximizedState);
  mainWindow.on('enter-full-screen', emitMaximizedState);
  mainWindow.on('leave-full-screen', emitMaximizedState);
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
  ipcMain.handle('armadillo:window-minimize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.minimize();
    return true;
  });
  ipcMain.handle('armadillo:window-toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });
  ipcMain.handle('armadillo:window-is-maximized', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return mainWindow.isMaximized();
  });
  ipcMain.handle('armadillo:window-close', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.close();
    return true;
  });
  ipcMain.handle('armadillo:autofill-credentials', async (_event, payload) => {
    const username = typeof payload?.username === 'string' ? payload.username : '';
    const password = typeof payload?.password === 'string' ? payload.password : '';
    if (!username && !password) {
      return { ok: false, error: 'Missing credentials.' };
    }
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Autofill is currently supported on Windows desktop only.' };
    }
    try {
      await runWindowsAutofill(username, password);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Desktop autofill failed.' };
    }
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
