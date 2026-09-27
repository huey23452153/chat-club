// One-time setup for the chat-club control helper.
//
// Copies the helper somewhere permanent, installs what it needs, and makes
// it start by itself (hidden, in the background) every time you log in —
// so after this, allowing remote control in a call is just clicking Allow.
//
//   node install.js              install / update
//   node install.js --uninstall  remove it completely
//
// Or just double-click "Install (Windows).bat" / "Install (Mac).command".

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execSync, spawn } = require("child_process");

const PORT = 47615;
const NODE = process.execPath;
const HOME = os.homedir();
const platform = process.platform;

const INSTALL_DIR =
  platform === "win32" ? path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "chat-club-helper")
  : platform === "darwin" ? path.join(HOME, "Library", "Application Support", "chat-club-helper")
  : path.join(HOME, ".local", "share", "chat-club-helper");

const WIN_STARTUP = path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"),
  "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "chat-club-helper.vbs");
const MAC_AGENT_LABEL = "com.chatclub.controlhelper";
const MAC_AGENT = path.join(HOME, "Library", "LaunchAgents", `${MAC_AGENT_LABEL}.plist`);
const LINUX_AUTOSTART = path.join(HOME, ".config", "autostart", "chat-club-helper.desktop");

function sh(cmd, opts = {}){ return execSync(cmd, { stdio: "inherit", ...opts }); }
function quiet(cmd){ try{ execSync(cmd, { stdio: "ignore" }); } catch(e){} }

// Ask a running helper (e.g. an older version) to exit, and wait until the
// port is actually free.
function stopRunningHelper(){
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method: "POST", path: "/quit",
      headers: { "X-Chat-Club-Helper": "quit" }, timeout: 2000 }, (res) => { res.resume(); setTimeout(resolve, 700); });
    req.on("error", () => resolve()); // nothing running
    req.on("timeout", () => { req.destroy(); resolve(); });
    req.end();
  });
}

function isHelperRunning(){
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1500 }, (res) => { res.resume(); resolve(true); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function removeAutostart(){
  if(platform === "win32"){
    fs.rmSync(WIN_STARTUP, { force: true });
  } else if(platform === "darwin"){
    quiet(`launchctl unload "${MAC_AGENT}"`);
    fs.rmSync(MAC_AGENT, { force: true });
  } else {
    fs.rmSync(LINUX_AUTOSTART, { force: true });
  }
}

function addAutostartAndStart(){
  const serverJs = path.join(INSTALL_DIR, "server.js");
  if(platform === "win32"){
    // A .vbs in the Startup folder runs at every login; window style 0 keeps
    // it hidden (no console window hanging around).
    const q = (s) => s.replace(/"/g, '""');
    fs.writeFileSync(WIN_STARTUP,
      `Set sh = CreateObject("WScript.Shell")\r\n` +
      `sh.CurrentDirectory = "${q(INSTALL_DIR)}"\r\n` +
      `sh.Run """${q(NODE)}"" ""${q(serverJs)}""", 0, False\r\n`);
    spawn("wscript.exe", [WIN_STARTUP], { detached: true, stdio: "ignore" }).unref();
  } else if(platform === "darwin"){
    const log = path.join(INSTALL_DIR, "helper.log");
    fs.mkdirSync(path.dirname(MAC_AGENT), { recursive: true });
    fs.writeFileSync(MAC_AGENT, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${NODE}</string><string>${serverJs}</string></array>
  <key>WorkingDirectory</key><string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`);
    quiet(`launchctl unload "${MAC_AGENT}"`);
    sh(`launchctl load -w "${MAC_AGENT}"`);
  } else {
    fs.mkdirSync(path.dirname(LINUX_AUTOSTART), { recursive: true });
    fs.writeFileSync(LINUX_AUTOSTART,
      `[Desktop Entry]\nType=Application\nName=chat-club control helper\nExec="${NODE}" "${serverJs}"\nNoDisplay=true\n`);
    spawn(NODE, [serverJs], { cwd: INSTALL_DIR, detached: true, stdio: "ignore" }).unref();
  }
}

async function install(){
  console.log("Installing the chat-club control helper...\n");
  await stopRunningHelper();

  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  for(const f of ["server.js", "package.json", "package-lock.json"]){
    fs.copyFileSync(path.join(__dirname, f), path.join(INSTALL_DIR, f));
  }
  sh("npm install --omit=dev --no-audit --no-fund", { cwd: INSTALL_DIR, shell: true });

  addAutostartAndStart();

  // Give it a moment to come up, then confirm.
  let running = false;
  for(let i = 0; i < 20 && !running; i++){
    await new Promise(r => setTimeout(r, 500));
    running = await isHelperRunning();
  }
  if(!running){
    console.error("\nInstalled, but the helper didn't start. Try restarting your computer.");
    process.exitCode = 1;
    return;
  }

  console.log("\n✅ Done! The control helper is running, and will start by itself whenever you log in.");
  console.log("   In a chat-club call: share your entire screen, and click Allow when someone asks for control.");
  if(platform === "darwin"){
    console.log("\n⚠️  One more step on Mac: the first time someone controls this Mac, macOS will ask to let");
    console.log("   \"node\" control your computer. Turn it on in System Settings → Privacy & Security → Accessibility.");
    quiet(`open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"`);
  }
}

async function uninstall(){
  await stopRunningHelper();
  removeAutostart();
  fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
  console.log("✅ The chat-club control helper has been removed.");
}

(process.argv.includes("--uninstall") ? uninstall() : install()).catch((err) => {
  console.error("\nSomething went wrong:", err?.message || err);
  process.exitCode = 1;
});
