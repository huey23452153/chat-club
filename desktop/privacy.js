// "Someone's looking": while the computer is in use, the camera counts faces about 3 times a second.
// When a second face shows up (someone behind you), the app does what the person picked:
//   notify  - a notification
//   blur    - covers the screens with a blurred picture of themselves (click it to clear)
//   desktop - switches to the next virtual desktop (Windows), and back when they've gone if asked
// Off unless switched on in the site's settings. Pauses while the computer is locked.
const { app, BrowserWindow, Notification, desktopCapturer, screen, powerMonitor } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODES = ['notify', 'blur', 'desktop'];
const HOLD_MS = 2000;       // they count as gone once unseen this long (a face often drops out for a frame)
const SNOOZE_MS = 120000;   // after clicking the blur away
const settingsFile = () => path.join(app.getPath('userData'), 'privacy.json');
let settings = { enabled: false, mode: 'notify', switchBack: true };
let locked = false;
let camWin = null;
let busy = false;
let alerting = false;      // someone else is there and we've reacted
let lastCrowd = 0;
let snoozeUntil = 0;
let retryAt = 0;
let blurWins = [];

function load() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch (e) { /* defaults */ }
  if (!MODES.includes(settings.mode)) settings.mode = 'notify';
}
function get() { return { ...settings, canSwitchDesktop: process.platform === 'win32' }; }
function set(next) {
  const was = settings.mode;
  settings = {
    enabled: !!next.enabled,
    mode: MODES.includes(next.mode) ? next.mode : settings.mode,
    switchBack: next.switchBack !== false,
  };
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch (e) { /* not important */ }
  if (!settings.enabled || settings.mode !== was) clear(false);
  if (!settings.enabled) stopCamera();
  return get();
}

function isCameraWindow(webContents) { return !!camWin && !camWin.isDestroyed() && webContents === camWin.webContents; }
function startCamera() {
  camWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, experimentalFeatures: true },
  });
  camWin.on('closed', () => { camWin = null; });
  return camWin.loadFile(path.join(__dirname, 'privacy.html'));
}
function stopCamera() {
  if (camWin && !camWin.isDestroyed()) camWin.destroy();
  camWin = null;
}

// ctrl+win+right / left
function switchDesktop(next) {
  if (process.platform !== 'win32') return;
  const arrow = next ? '0x27' : '0x25';
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class K { [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e); }'
[K]::keybd_event(0x11,0,0,[UIntPtr]::Zero); [K]::keybd_event(0x5B,0,0,[UIntPtr]::Zero)
[K]::keybd_event(${arrow},0,1,[UIntPtr]::Zero); [K]::keybd_event(${arrow},0,3,[UIntPtr]::Zero)
[K]::keybd_event(0x5B,0,2,[UIntPtr]::Zero); [K]::keybd_event(0x11,0,2,[UIntPtr]::Zero)`;
  spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { stdio: 'ignore', windowsHide: true });
}

async function showBlur() {
  const displays = screen.getAllDisplays();
  const biggest = displays.reduce((m, d) => Math.max(m, d.size.width * d.scaleFactor), 0);
  const shots = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(biggest / 2), height: Math.round(biggest / 2) } });
  for (const d of displays) {
    const shot = shots.find((s) => s.display_id === String(d.id)) || shots[0];
    const win = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, resizable: false, movable: false, skipTaskbar: true, show: false, backgroundColor: '#111',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    const img = shot ? shot.thumbnail.toDataURL() : '';
    const html = `<!doctype html><meta charset="utf-8"><title>Privacy</title><style>
      html,body{margin:0;height:100%;overflow:hidden;cursor:pointer;background:#111}
      body::before{content:"";position:fixed;inset:-40px;background:url("${img}") center/cover;filter:blur(28px) brightness(.6)}
      p{position:fixed;inset:auto 0 40px;text-align:center;color:#fff;font:600 18px system-ui;opacity:.8}
    </style><p>Someone else is looking. Click to show your screen.</p>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.webContents.on('before-input-event', () => clear(true));
    win.webContents.executeJavaScript("document.addEventListener('mousedown', () => window.close())");
    win.on('closed', () => { if (blurWins.includes(win)) clear(true); });
    win.show();
    blurWins.push(win);
  }
}
function hideBlur() {
  const wins = blurWins;
  blurWins = [];
  for (const w of wins) if (!w.isDestroyed()) w.destroy();
}

async function react() {
  alerting = true;
  if (settings.mode === 'notify') {
    new Notification({ title: 'Someone is looking at your screen', body: 'The camera sees another face behind you.' }).show();
  } else if (settings.mode === 'blur') {
    await showBlur();
  } else if (settings.mode === 'desktop') {
    switchDesktop(true);
  }
}
// clicked: the person cleared it themselves, so leave them be for a while
function clear(clicked) {
  if (!alerting) return;
  alerting = false;
  if (clicked) snoozeUntil = Date.now() + SNOOZE_MS;
  if (settings.mode === 'blur') hideBlur();
  if (settings.mode === 'desktop' && settings.switchBack && !clicked) switchDesktop(false);
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (!settings.enabled || locked) { clear(false); stopCamera(); return; }
    if (!camWin) {
      if (Date.now() < retryAt) return;
      await startCamera();
      return;
    }
    const faces = await camWin.webContents.executeJavaScript('countFaces()');
    const now = Date.now();
    if (faces >= 2) {
      lastCrowd = now;
      if (!alerting && now > snoozeUntil) await react();
    } else if (alerting && now - lastCrowd >= HOLD_MS) {
      clear(false);
    }
  } catch (e) {
    stopCamera(); // camera busy or not allowed: try again in a bit
    retryAt = Date.now() + 30000;
  } finally {
    busy = false;
  }
}

function start() {
  load();
  powerMonitor.on('lock-screen', () => { locked = true; });
  powerMonitor.on('unlock-screen', () => { locked = false; });
  setInterval(tick, 300);
}

module.exports = { start, get, set, isCameraWindow };
