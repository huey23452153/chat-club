// Wake the screen when the camera sees a face (an opt-in setting).
//
// Only while the computer is locked: then the camera is switched on 15 seconds after the last
// key or mouse move, one picture a second is checked for a face, and a face turns the screen
// back on. The computer stays locked; this never unlocks anything. At any other time the camera
// is left alone, so it can't get in the way of calls.
const { app, BrowserWindow, powerMonitor } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const settingsFile = () => path.join(app.getPath('userData'), 'facewake.json');
let enabled = false;
let locked = false;
let camWin = null;     // hidden window that owns the camera while watching
let cooldownUntil = 0; // after waking the screen, give the person time to sign in
let busy = false;

function load() {
  try { enabled = !!JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).enabled; } catch (e) { enabled = false; }
}
function setEnabled(on) {
  enabled = !!on;
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ enabled })); } catch (e) { /* not important */ }
  if (!enabled) stopCamera();
  return enabled;
}
const isEnabled = () => enabled;

function isCameraWindow(webContents) { return !!camWin && !camWin.isDestroyed() && webContents === camWin.webContents; }

function startCamera() {
  camWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, experimentalFeatures: true },
  });
  camWin.on('closed', () => { camWin = null; });
  return camWin.loadFile(path.join(__dirname, 'facewake.html'));
}
function stopCamera() {
  if (camWin && !camWin.isDestroyed()) camWin.destroy();
  camWin = null;
}

function wakeScreen() {
  if (process.platform === 'darwin') {
    spawn('caffeinate', ['-u', '-t', '2'], { stdio: 'ignore' }); // same as touching the mouse
    return;
  }
  if (process.platform !== 'win32') return;
  // "monitor on" to every window, then "display needed", then a 1-pixel mouse nudge
  const script = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
}
'@
$r = [IntPtr]::Zero
[W]::SendMessageTimeout([IntPtr]0xffff, 0x0112, [IntPtr]0xF170, [IntPtr](-1), 2, 1000, [ref]$r) | Out-Null
[W]::SetThreadExecutionState(3) | Out-Null
[W]::mouse_event(1, 1, 0, 0, [UIntPtr]::Zero); [W]::mouse_event(1, -1, 0, 0, [UIntPtr]::Zero)`;
  spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { stdio: 'ignore', windowsHide: true });
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const watch = enabled && locked && Date.now() > cooldownUntil && powerMonitor.getSystemIdleTime() >= 15;
    if (!watch) { stopCamera(); return; }
    if (!camWin) { await startCamera(); return; } // first picture next time round, once the camera is going
    const faces = await camWin.webContents.executeJavaScript('countFaces()');
    if (faces > 0) {
      wakeScreen();
      stopCamera();
      cooldownUntil = Date.now() + 60000;
    }
  } catch (e) {
    stopCamera(); // camera busy or not allowed: try again in a bit
    cooldownUntil = Date.now() + 10000;
  } finally {
    busy = false;
  }
}

function start() {
  load();
  powerMonitor.on('lock-screen', () => { locked = true; });
  powerMonitor.on('unlock-screen', () => { locked = false; cooldownUntil = 0; stopCamera(); });
  setInterval(tick, 1000);
}

// For checking a build: switch the camera on, look once, report how many faces it saw.
async function selfTest() {
  await startCamera();
  await new Promise((r) => setTimeout(r, 2500));
  let faces = -1;
  for (let i = 0; i < 5 && faces < 1; i++) {
    faces = await camWin.webContents.executeJavaScript('countFaces()').catch((e) => 'error ' + e.message);
    await new Promise((r) => setTimeout(r, 400));
  }
  stopCamera();
  return faces;
}

module.exports = { start, setEnabled, isEnabled, isCameraWindow, selfTest };
