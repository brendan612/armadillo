const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const http = require('http');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const APP_NAME = 'Armadillo';
const APP_ID = 'com.armadillo.desktop';

app.setName(APP_NAME);
process.title = APP_NAME;
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

const isDev = !app.isPackaged;
const deepLinkProtocol = 'armadillo';
const execFileAsync = promisify(execFile);
const WINDOW_SHOW_FALLBACK_MS = 8000;
const SPLASH_FADE_DURATION_MS = 180;
const SPLASH_FADE_STEP_MS = 18;
let mainWindow = null;
let splashWindow = null;
let oauthServer = null;
let oauthCallbackUrl = null;
let cachedSplashTheme = null;

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

function stripCssComments(cssText) {
  return cssText.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseCssVarBlock(cssText, selectorPattern) {
  const match = cssText.match(selectorPattern);
  if (!match || !match[1]) return {};
  const block = match[1];
  const vars = {};
  const varRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let row;
  while ((row = varRegex.exec(block)) !== null) {
    vars[row[1]] = row[2].trim();
  }
  return vars;
}

function resolveThemeCssPath() {
  const sourceCssPath = path.join(__dirname, '..', 'src', 'index.css');
  if (fs.existsSync(sourceCssPath)) {
    return sourceCssPath;
  }

  const distAssetsPath = path.join(__dirname, '..', 'dist', 'assets');
  if (!fs.existsSync(distAssetsPath)) {
    return '';
  }

  const candidates = fs.readdirSync(distAssetsPath)
    .filter((name) => /^index-.*\.css$/i.test(name))
    .map((name) => path.join(distAssetsPath, name))
    .map((filePath) => ({
      filePath,
      mtimeMs: fs.statSync(filePath).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.filePath || '';
}

function parseHexToRgb(value) {
  const hex = value.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(hex)) return null;
  const expanded = hex.length === 3 ? hex.split('').map((c) => `${c}${c}`).join('') : hex;
  const int = Number.parseInt(expanded, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function withAlpha(color, alpha) {
  const rgb = parseHexToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function resolveSplashTheme() {
  if (cachedSplashTheme) {
    return cachedSplashTheme;
  }

  const defaults = {
    bg0: '#0b0d13',
    bg1: '#10131c',
    bg2: '#171b27',
    ink: '#e4e7f2',
    inkSecondary: '#949bb5',
    lineStrong: 'rgba(255, 255, 255, 0.13)',
    accent: '#d4854a',
  };

  try {
    const cssPath = resolveThemeCssPath();
    if (!cssPath) {
      cachedSplashTheme = defaults;
      return cachedSplashTheme;
    }

    const cssText = stripCssComments(fs.readFileSync(cssPath, 'utf8'));
    const midnightVars = parseCssVarBlock(
      cssText,
      /:root\s*,\s*\[data-theme="midnight"\]\s*\{([\s\S]*?)\}/m,
    );
    const rootVars = parseCssVarBlock(cssText, /:root\s*\{([\s\S]*?)\}/m);
    const vars = { ...rootVars, ...midnightVars };

    cachedSplashTheme = {
      bg0: vars['bg-0'] || defaults.bg0,
      bg1: vars['bg-1'] || defaults.bg1,
      bg2: vars['bg-2'] || defaults.bg2,
      ink: vars.ink || defaults.ink,
      inkSecondary: vars['ink-secondary'] || defaults.inkSecondary,
      lineStrong: vars['line-strong'] || defaults.lineStrong,
      accent: vars.accent || defaults.accent,
    };
    return cachedSplashTheme;
  } catch {
    cachedSplashTheme = defaults;
    return cachedSplashTheme;
  }
}

async function runWindowsAutofill(username, password) {
  const userBase64 = toBase64(username);
  const passBase64 = toBase64(password);
  const script = `
$u=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${userBase64}'));
$p=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${passBase64}'));
Add-Type -AssemblyName System.Windows.Forms;
$ws=New-Object -ComObject WScript.Shell;
try {
  if ([System.Windows.Forms.Clipboard]::ContainsText()) {
    $previousClipboard = [System.Windows.Forms.Clipboard]::GetText();
    $hadClipboard = $true;
  } else {
    $previousClipboard = '';
    $hadClipboard = $false;
  }
} catch {
  $previousClipboard = '';
  $hadClipboard = $false;
}
Start-Sleep -Milliseconds 60;
$ws.SendKeys('%{TAB}');
Start-Sleep -Milliseconds 120;
[System.Windows.Forms.Clipboard]::SetText($u);
$ws.SendKeys('^v');
Start-Sleep -Milliseconds 45;
$ws.SendKeys('{TAB}');
Start-Sleep -Milliseconds 45;
[System.Windows.Forms.Clipboard]::SetText($p);
$ws.SendKeys('^v');
Start-Sleep -Milliseconds 45;
$ws.SendKeys('{ENTER}');
Start-Sleep -Milliseconds 35;
try {
  if ($hadClipboard) {
    [System.Windows.Forms.Clipboard]::SetText($previousClipboard);
  } else {
    [System.Windows.Forms.Clipboard]::Clear();
  }
} catch {}
`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-Command', script]);
}

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return;
  }

  const splashTheme = resolveSplashTheme();

  splashWindow = new BrowserWindow({
    show: false,
    width: 500,
    height: 360,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: splashTheme.bg0,
    roundedCorners: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.setIgnoreMouseEvents(true, { forward: true });

  const logoPath = path.join(__dirname, '..', 'src', 'assets', 'armadillo.png');
  let logoDataUrl = '';
  try {
    const logoBase64 = fs.readFileSync(logoPath).toString('base64');
    logoDataUrl = `data:image/png;base64,${logoBase64}`;
  } catch {
    logoDataUrl = '';
  }

  const splashHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;" />
    <title>Armadillo Loading</title>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background:
          radial-gradient(circle at 18% 20%, ${withAlpha(splashTheme.accent, 0.24)}, transparent 52%),
          radial-gradient(circle at 82% 84%, ${withAlpha(splashTheme.accent, 0.16)}, transparent 58%),
          ${splashTheme.bg0};
        color: ${splashTheme.ink};
        font-family: "Segoe UI", "Inter", system-ui, sans-serif;
      }
      .wrap {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        padding: 18px;
      }
      .card {
        width: 360px;
        border-radius: 20px;
        background: ${withAlpha(splashTheme.bg2, 0.92)};
        border: 1px solid ${withAlpha(splashTheme.lineStrong, 0.75)};
        box-shadow: 0 22px 44px ${withAlpha(splashTheme.bg0, 0.65)};
        padding: 30px 24px 22px;
        text-align: center;
        position: relative;
        overflow: hidden;
      }
      .card::before {
        content: "";
        position: absolute;
        inset: -2px;
        border-radius: inherit;
        pointer-events: none;
        border: 1px solid ${withAlpha(splashTheme.accent, 0.24)};
      }
      .hero {
        position: relative;
        width: 94px;
        height: 94px;
        margin: 0 auto 14px;
        display: grid;
        place-items: center;
      }
      .hero-glow {
        position: absolute;
        inset: 10px;
        border-radius: 999px;
        background: radial-gradient(circle, ${withAlpha(splashTheme.accent, 0.5)} 0%, ${withAlpha(splashTheme.accent, 0)} 70%);
        animation: breathe 2.2s ease-in-out infinite;
        filter: blur(1px);
      }
      .hero-logo {
        position: relative;
        z-index: 1;
        width: 72px;
        height: 72px;
        object-fit: contain;
      }
      h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 650;
        letter-spacing: 0.01em;
      }
      p {
        margin: 9px 0 18px;
        font-size: 13.5px;
        color: ${withAlpha(splashTheme.inkSecondary, 0.95)};
      }
      .bar {
        width: 100%;
        height: 7px;
        border-radius: 999px;
        background: ${withAlpha(splashTheme.lineStrong, 0.4)};
        overflow: hidden;
      }
      .bar > span {
        display: block;
        height: 100%;
        width: 38%;
        border-radius: inherit;
        background: linear-gradient(90deg, ${withAlpha(splashTheme.accent, 0.82)} 0%, ${splashTheme.accent} 100%);
        animation: move 1.15s ease-in-out infinite;
      }
      .meta {
        margin-top: 12px;
        font-size: 11px;
        letter-spacing: 0.04em;
        color: ${withAlpha(splashTheme.inkSecondary, 0.75)};
        text-transform: uppercase;
      }
      @keyframes move {
        0% { transform: translateX(-110%); }
        100% { transform: translateX(250%); }
      }
      @keyframes breathe {
        0%, 100% { transform: scale(0.92); opacity: 0.5; }
        50% { transform: scale(1.08); opacity: 0.95; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="hero">
          <div class="hero-glow"></div>
          ${logoDataUrl ? `<img class="hero-logo" src="${logoDataUrl}" alt="Armadillo" />` : '<div class="hero-logo" style="display:grid;place-items:center;font-weight:700;">A</div>'}
        </div>
        <h1>Armadillo</h1>
        <p>Preparing your secure workspace...</p>
        <div class="bar"><span></span></div>
        <div class="meta">Encrypted Vault</div>
      </div>
    </div>
  </body>
</html>`;

  splashWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(splashHtml)}`);
  splashWindow.once('ready-to-show', () => {
    if (!splashWindow || splashWindow.isDestroyed()) return;
    splashWindow.showInactive();
  });
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function closeSplashWindow() {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }

  const windowToClose = splashWindow;
  splashWindow = null;
  windowToClose.setIgnoreMouseEvents(true, { forward: true });
  windowToClose.setAlwaysOnTop(false);

  if (typeof windowToClose.setOpacity !== 'function') {
    windowToClose.destroy();
    return;
  }

  const steps = Math.max(1, Math.floor(SPLASH_FADE_DURATION_MS / SPLASH_FADE_STEP_MS));
  let currentStep = 0;
  const timer = setInterval(() => {
    if (windowToClose.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    currentStep += 1;
    const nextOpacity = Math.max(0, 1 - (currentStep / steps));
    windowToClose.setOpacity(nextOpacity);
    if (currentStep >= steps) {
      clearInterval(timer);
      windowToClose.destroy();
    }
  }, SPLASH_FADE_STEP_MS);
}

function createWindow() {
  const splashTheme = resolveSplashTheme();
  mainWindow = new BrowserWindow({
    show: false,
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 760,
    title: 'Armadillo',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: splashTheme.bg0,
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

  let revealed = false;
  const revealWindow = () => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
    revealed = true;
    closeSplashWindow();
    mainWindow.show();
    mainWindow.focus();
  };

  if (isDev) {
    mainWindow.loadURL('http://localhost:4000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', revealWindow);
  mainWindow.webContents.once('did-finish-load', revealWindow);
  const showFallbackTimer = setTimeout(revealWindow, WINDOW_SHOW_FALLBACK_MS);
  mainWindow.on('closed', () => {
    clearTimeout(showFallbackTimer);
  });

  const isAppPage = (url) => {
    if (!url) return false;
    if (url.startsWith('file://')) return true;
    if (isDev && url.startsWith('http://localhost:4000')) return true;
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
  ipcMain.handle('armadillo:choose-vault-open-path', async (_event, currentPath) => {
    const fallbackPath = path.join(app.getPath('documents'), 'vault.armadillo');
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: 'Open Existing Armadillo Vault',
      defaultPath: typeof currentPath === 'string' && currentPath.trim() ? currentPath : fallbackPath,
      properties: ['openFile'],
      filters: [{ name: 'Armadillo Vault', extensions: ['armadillo'] }],
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return null;
    }

    return result.filePaths[0];
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
  createSplashWindow();
  createWindow();
  const initialDeepLink = extractDeepLinkArg(process.argv);
  if (initialDeepLink) {
    handleDeepLink(initialDeepLink);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
