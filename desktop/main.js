// Chat Club as a desktop app (Windows and Mac).
//
// A window around the live site, so the app is always the newest Chat Club
// without anyone reinstalling. On top of what a browser tab gives you:
// its own window and icon, the unread count on the icon, one copy at a time,
// it remembers where its window was, and the remote-control helper is built in
// (control-helper/server.js, which otherwise is a separate install).
const { app, BrowserWindow, shell, session, desktopCapturer, Menu, systemPreferences, utilityProcess, dialog, net, ipcMain, Tray, nativeImage } = require('electron');
const faceWake = require('./facewake');
const privacy = require('./privacy');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');

const SITE = 'https://chat-club-one.vercel.app';
const SMOKE = process.argv.includes('--smoke'); // open, report the page's title, quit (for checking a build)

// a check run keeps to itself, so it works while the real app is open
if (SMOKE) app.setPath('userData', path.join(app.getPath('temp'), 'chat-club-smoke'));

let win = null;
// Closing the window keeps Chat Club running in the tray (by the clock), so new-message
// notifications still pop up. Quit from the tray icon's menu to really close it.
let tray = null, quitting = false, toldAboutTray = false;
const KEEP_IN_TRAY = process.platform === 'win32';
app.on('before-quit', () => { quitting = true; });
function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function makeTray() {
  if (!KEEP_IN_TRAY || tray || SMOKE) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Chat Club');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Chat Club', click: showWindow },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }) },
    { type: 'separator' },
    { label: 'Quit Chat Club', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('right-click', () => tray.setContextMenu(menu()));
  tray.on('click', showWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
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
// GitHub tagged desktop-vX.Y.Z, looked for when the app starts and then every
// 10 minutes. A newer one is downloaded quietly in the background (and checked
// against the size and SHA-256 GitHub lists for it); then:
//   Windows  "Restart now" runs the installer silently and reopens the app.
//            "Later" installs it when you close the app.
//   Mac      the app isn't signed, so it can't replace itself: the new .dmg
//            is put in Downloads and opened, to drag over the old one.
const RELEASES = 'https://api.github.com/repos/huey23452153/chat-club/releases?per_page=20';
const RELEASES_PAGE = 'https://github.com/huey23452153/chat-club/releases';
const CHECK_EVERY_MS = 10 * 60 * 1000;
const DOWNLOAD_PREFIX = 'https://github.com/huey23452153/chat-club/releases/download/';
const FAKE_OLD = process.argv.includes('--smoke-update'); // pretend to be an old version, to check the download
let offeredVersion = null;
let installOnQuit = null; // Windows: the downloaded installer waiting for the app to close

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
      .map((r) => ({ version: r.tag_name.slice('desktop-v'.length), url: r.html_url, assets: r.assets || [] }))
      .sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1))[0];
    if (!latest || !isNewer(latest.version, FAKE_OLD ? '0.0.1' : app.getVersion())) return null;
    return latest;
  } catch (e) {
    return null; // offline, or GitHub said no: try again next time
  }
}

// the installer for this computer among a release's files
function installerFor(latest) {
  const name = process.platform === 'win32' ? 'Chat-Club-Setup.exe' : process.platform === 'darwin' ? 'Chat-Club-' + process.arch + '.dmg' : null;
  const asset = name && latest.assets.find((x) => x.name === name);
  if (!asset || !String(asset.browser_download_url).startsWith(DOWNLOAD_PREFIX)) return null;
  return asset;
}

// Downloads it and returns where it is, or null if anything about it is off.
async function downloadInstaller(latest) {
  const asset = installerFor(latest);
  if (!asset) return null;
  const dir = process.platform === 'darwin' ? app.getPath('downloads') : path.join(app.getPath('userData'), 'updates');
  const file = path.join(dir, process.platform === 'darwin' ? 'Chat-Club-' + latest.version + '.dmg' : 'Chat-Club-Setup-' + latest.version + '.exe');
  const part = file + '.part';
  try {
    fs.mkdirSync(dir, { recursive: true });
    const wanted = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7) : null;
    const sha256 = (f) => new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      fs.createReadStream(f).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
    });
    const good = async (f) => fs.existsSync(f) && fs.statSync(f).size === asset.size && (!wanted || (await sha256(f)) === wanted);
    if (await good(file)) return file; // already fetched last time
    const res = await net.fetch(asset.browser_download_url, { headers: { 'user-agent': 'chat-club-desktop' } });
    if (!res.ok || !res.body) return null;
    const out = fs.createWriteStream(part);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
    if (!(await good(part))) { fs.rmSync(part, { force: true }); return null; }
    fs.renameSync(part, file);
    return file;
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch (e2) { /* nothing to tidy */ }
    return null;
  }
}

function runInstaller(file, reopen) {
  // electron-builder's installer: /S = no questions, --force-run = open the app again afterwards
  spawn(file, reopen ? ['/S', '--force-run'] : ['/S'], { detached: true, stdio: 'ignore' }).unref();
}

async function offerUpdate() {
  const latest = await checkForUpdate();
  if (!latest || latest.version === offeredVersion) return;
  const file = await downloadInstaller(latest);
  if (!win) return;
  offeredVersion = latest.version;
  if (!file) {
    // couldn't fetch it: fall back to pointing at the page
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', title: 'Chat Club',
      message: 'A new version of Chat Club is ready (' + latest.version + ')',
      detail: 'It could not be downloaded automatically. Download it from the Chat Club releases page and run it.',
      buttons: ['Open the page', 'Later'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) shell.openExternal(String(latest.url).startsWith(RELEASES_PAGE) ? latest.url : RELEASES_PAGE);
    return;
  }
  if (process.platform === 'win32') {
    installOnQuit = file;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', title: 'Chat Club',
      message: 'Chat Club ' + latest.version + ' is downloaded',
      detail: 'Restart to finish updating. It takes a few seconds and keeps you signed in. If you choose Later it updates when you close Chat Club.',
      buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) {
      installOnQuit = null;
      runInstaller(file, true);
      app.quit();
    }
    return;
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'info', title: 'Chat Club',
    message: 'Chat Club ' + latest.version + ' is downloaded',
    detail: 'It is in your Downloads folder. Open it, drag Chat Club onto Applications and choose Replace, then open Chat Club again.',
    buttons: ['Open it', 'Later'], defaultId: 0, cancelId: 1,
  });
  if (response === 0) shell.openPath(file);
}
app.on('quit', () => { if (installOnQuit) runInstaller(installOnQuit, false); });

const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
// Where the window was last time, kept on the screen: if the screen got smaller (a lower
// resolution, or a different monitor) the old size could hang off the edge and be cut
// off. It opens maximized unless you last had it smaller.
function savedBounds() {
  const { screen } = require('electron');
  let b = null;
  try { b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8')); } catch (e) { /* first run */ }
  if (!b || !(b.width >= 400 && b.height >= 400)) b = { width: 1100, height: 760, maximized: true };
  const area = (Number.isFinite(b.x) ? screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height }) : screen.getPrimaryDisplay()).workArea;
  const width = Math.min(b.width, area.width), height = Math.min(b.height, area.height);
  const x = Number.isFinite(b.x) ? Math.min(Math.max(b.x, area.x), area.x + area.width - width) : undefined;
  const y = Number.isFinite(b.y) ? Math.min(Math.max(b.y, area.y), area.y + area.height - height) : undefined;
  return { width, height, ...(x !== undefined ? { x, y } : {}), maximized: b.maximized !== false };
}

function isSite(url) {
  try { return new URL(url).origin === SITE; } catch (e) { return false; }
}

function createWindow() {
  const bounds = savedBounds();
  win = new BrowserWindow({
    width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y,
    minWidth: 380,
    minHeight: 520,
    show: !SMOKE && !process.argv.includes('--hidden'),      // (started with Windows: wait quietly in the tray)
    title: 'Chat Club',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    // (backgroundThrottling off: messages keep arriving on time while the window is hidden in the tray)
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') },
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

  win.on('close', (event) => {
    try { fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch (e) { /* not important */ }
    if (KEEP_IN_TRAY && !quitting && !SMOKE) {
      event.preventDefault(); win.hide();
      if (!toldAboutTray && tray) { toldAboutTray = true; tray.displayBalloon({ title: 'Chat Club is still running', content: "You'll still get message notifications. Right-click the icon by the clock to quit." }); }
    }
  });
  win.on('closed', () => { win = null; });

  if (SMOKE) {
    win.webContents.once('did-finish-load', () => {
      console.log('SMOKE loaded: ' + win.webContents.getTitle());
      setTimeout(() => app.quit(), FAKE_OLD ? 180000 : 4000);
    });
    win.webContents.once('did-fail-load', (e, code, text) => {
      console.log('SMOKE failed: ' + code + ' ' + text);
      app.exit(1);
    });
  }
  if (bounds.maximized && !SMOKE) win.maximize();
  win.loadURL(SITE);
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('app.vercel.chat-club-one'); // notifications show the app's name
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  makeTray();
  // (the site can bring the window back, e.g. when you click a notification)
  ipcMain.on('window:show', (e) => { if (isSite(e.senderFrame.url)) showWindow(); });
  // (after a pop-up box on Windows the page stops getting key presses: blur and refocus fixes it)
  ipcMain.on('window:refocus', (e) => { if (!win || !isSite(e.senderFrame.url)) return; win.blur(); win.focus(); win.webContents.focus(); });

  // camera, microphone and notifications: yes for Chat Club itself, no for anything else
  const allowed = new Set(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'display-capture']);
  // (plus the camera for the app's own hidden face check, when that setting is on)
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (faceWake.isCameraWindow(wc) || privacy.isCameraWindow(wc)) return callback(permission === 'media');
    callback(isSite(details.requestingUrl || wc.getURL()) && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) =>
    (wc && (faceWake.isCameraWindow(wc) || privacy.isCameraWindow(wc)) && permission === 'media') || (isSite(origin) && allowed.has(permission)));

  // the "wake screen when it sees me" switch in the site's settings
  ipcMain.handle('facewake:get', (e) => isSite(e.senderFrame.url) && faceWake.isEnabled());
  ipcMain.handle('facewake:set', (e, on) => isSite(e.senderFrame.url) ? faceWake.setEnabled(on) : false);
  if (process.argv.includes('--facewake-test')) {
    console.log('FACEWAKE faces seen: ' + await faceWake.selfTest());
    return app.quit();
  }
  faceWake.start();

  // the "someone's looking" settings in the site's settings
  ipcMain.handle('privacy:get', (e) => isSite(e.senderFrame.url) ? privacy.get() : null);
  ipcMain.handle('privacy:set', (e, next) => isSite(e.senderFrame.url) && next && typeof next === 'object' ? privacy.set(next) : null);
  privacy.start();

  // Share screen: the Mac's own picker where it has one, otherwise the main screen
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (!sources.length) return callback({});
      // with the computer's sound, where the system can capture it (Windows)
      callback(request.audioRequested && process.platform === 'win32' ? { video: sources[0], audio: 'loopback' } : { video: sources[0] });
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
  // (the copy from the Microsoft Store is kept up to date by the Store)
  if (process.windowsStore) {
    // nothing to do
  } else if (!SMOKE) {
    setTimeout(offerUpdate, 8000);
    setInterval(offerUpdate, CHECK_EVERY_MS);
  } else {
    checkForUpdate().then(async (u) => {
      console.log('SMOKE update check: ' + (u ? 'newer ' + u.version : 'nothing newer than ' + app.getVersion()));
      if (u && FAKE_OLD) {
        console.log('SMOKE download: ' + ((await downloadInstaller(u)) || 'FAILED'));
        app.quit();
      }
    });
  }
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (quitting || !KEEP_IN_TRAY)) app.quit();
});
