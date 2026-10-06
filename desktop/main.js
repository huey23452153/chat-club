// Chat Club as a desktop app (Windows and Mac).
//
// A window around the live site, so the app is always the newest Chat Club
// without anyone reinstalling. On top of what a browser tab gives you:
// its own window and icon, the unread count on the icon, one copy at a time,
// it remembers where its window was, and the remote-control helper is built in
// (control-helper/server.js, which otherwise is a separate install).
const { app, BrowserWindow, shell, session, desktopCapturer, Menu, systemPreferences, utilityProcess, dialog, net } = require('electron');
const fs = require('fs');
const path = require('path');

const SITE = 'https://chat-club-one.vercel.app';
const SMOKE = process.argv.includes('--smoke'); // open, report the page's title, quit (for checking a build)

let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

// The remote-control helper: the same little local server as the separate
// install, run in a process of its own for as long as the app is open. If one
// is already running on this computer (the separate install), this one finds
// the port taken and steps aside.
let helper = null;
function startHelper() {
  const script = app.isPackaged ? path.join(__dirname, 'helper', 'server.js') : path.join(__dirname, '..', 'control-helper', 'server.js');
  try {
    helper = utilityProcess.fork(script, [], { stdio: 'pipe', serviceName: 'Chat Club remote control' });
    helper.stdout.on('data', (d) => console.log('helper: ' + String(d).trim()));
    helper.stderr.on('data', (d) => console.log('helper: ' + String(d).trim()));
    helper.on('exit', (code) => { console.log('helper stopped (' + code + ')'); helper = null; });
  } catch (e) {
    console.log('helper could not start: ' + e.message);
  }
}
app.on('will-quit', () => { if (helper) helper.kill(); });

// New versions. Chat Club itself is the live site, so that is always current;
// this looks for a newer build of the app around it: the newest release on
// GitHub tagged desktop-vX.Y.Z. It asks at most once per version, when the app
// starts and then every few hours, and "Download" opens the installer's page.
const RELEASES = 'https://api.github.com/repos/huey23452153/chat-club/releases?per_page=20';
const RELEASES_PAGE = 'https://github.com/huey23452153/chat-club/releases';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
let offeredVersion = null;

function isNewer(a, b) { // is version a newer than b? ("1.10.0" vs "1.9.2")
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

async function checkForUpdate() {
  try {
    const res = await net.fetch(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'chat-club-desktop' } });
    if (!res.ok) return null;
    const releases = await res.json();
    const latest = (Array.isArray(releases) ? releases : [])
      .filter((r) => !r.draft && !r.prerelease && /^desktop-v[0-9]+[.][0-9]+[.][0-9]+$/.test(r.tag_name || ''))
      .map((r) => ({ version: r.tag_name.slice('desktop-v'.length), url: r.html_url }))
      .sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1))[0];
    if (!latest || !isNewer(latest.version, app.getVersion())) return null;
    return latest;
  } catch (e) {
    return null; // offline, or GitHub said no: try again next time
  }
}

async function offerUpdate() {
  const latest = await checkForUpdate();
  if (!latest || !win || latest.version === offeredVersion) return;
  offeredVersion = latest.version;
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Chat Club',
    message: 'A new version of Chat Club is ready (' + latest.version + ')',
    detail: 'You have ' + app.getVersion() + '. Download the new one and run it — it replaces this one and keeps you signed in.',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) shell.openExternal(String(latest.url).startsWith(RELEASES_PAGE) ? latest.url : RELEASES_PAGE);
}

const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    if (b.width >= 400 && b.height >= 400) return b;
  } catch (e) { /* first run */ }
  return { width: 1100, height: 760 };
}

function isSite(url) {
  try { return new URL(url).origin === SITE; } catch (e) { return false; }
}

function createWindow() {
  win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 380,
    minHeight: 520,
    show: !SMOKE,
    title: 'Chat Club',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // links to other sites open in the real browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isSite(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  win.on('close', () => {
    try { fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds())); } catch (e) { /* not important */ }
  });
  win.on('closed', () => { win = null; });

  if (SMOKE) {
    win.webContents.once('did-finish-load', () => {
      console.log('SMOKE loaded: ' + win.webContents.getTitle());
      setTimeout(() => app.quit(), 4000);
    });
    win.webContents.once('did-fail-load', (e, code, text) => {
      console.log('SMOKE failed: ' + code + ' ' + text);
      app.exit(1);
    });
  }
  win.loadURL(SITE);
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('app.vercel.chat-club-one'); // notifications show the app's name
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  // camera, microphone and notifications: yes for Chat Club itself, no for anything else
  const allowed = new Set(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'display-capture']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(isSite(details.requestingUrl || wc.getURL()) && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => isSite(origin) && allowed.has(permission));

  // Share screen: the Mac's own picker where it has one, otherwise the main screen
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (!sources.length) return callback({});
      callback({ video: sources[0] });
    } catch (e) {
      callback({});
    }
  }, { useSystemPicker: true });

  if (process.platform === 'darwin' && !SMOKE) {
    // ask once, up front, rather than in the middle of the first call
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
    systemPreferences.askForMediaAccess('camera').catch(() => {});
  }

  startHelper();
  createWindow();
  if (!SMOKE) {
    setTimeout(offerUpdate, 8000);
    setInterval(offerUpdate, CHECK_EVERY_MS);
  } else {
    checkForUpdate().then((u) => console.log('SMOKE update check: ' + (u ? 'newer ' + u.version : 'nothing newer than ' + app.getVersion())));
  }
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
