// Entry point for the single-file ChatClubHelper.exe (built with `npm run build:exe`).
//
//   double-click          install (or update) to %LOCALAPPDATA%\chat-club-helper,
//                         start it hidden at every login, and start it now
//   ChatClubHelper.exe --run        run the helper itself (what login starts)
//   ChatClubHelper.exe --uninstall  stop it and remove everything
//
// Same behavior as install.js, but needs no Node.js or npm on the computer.

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const PORT = 47615;
const INSTALL_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "chat-club-helper");
const INSTALLED_EXE = path.join(INSTALL_DIR, "ChatClubHelper.exe");
const STARTUP_VBS = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "chat-club-helper.vbs");

function stopRunningHelper(){
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method: "POST", path: "/quit",
      headers: { "X-Chat-Club-Helper": "quit" }, timeout: 2000 }, (res) => { res.resume(); setTimeout(resolve, 1000); });
    req.on("error", () => resolve());
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

function waitForEnter(){
  console.log("\nPress Enter to close this window.");
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

async function install(){
  console.log("Setting up the chat-club control helper...\n");
  await stopRunningHelper();
  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  // Copy this exe somewhere permanent, so the downloaded copy can be deleted.
  if(path.resolve(process.execPath).toLowerCase() !== INSTALLED_EXE.toLowerCase()){
    let copied = false;
    for(let i = 0; i < 10 && !copied; i++){
      try{ fs.copyFileSync(process.execPath, INSTALLED_EXE); copied = true; }
      catch(err){ await new Promise(r => setTimeout(r, 500)); } // old copy still shutting down
    }
    if(!copied) throw new Error("Couldn't copy the helper into place. Restart your computer and try again.");
  }
  // Leftovers from the older Node.js-based install aren't needed any more.
  // (Best effort: the old helper can hold them open for a moment after
  // quitting, and harmless leftovers must never fail the install.)
  for(const old of ["server.js", "package.json", "package-lock.json", "node_modules", "helper.log"]){
    try{ fs.rmSync(path.join(INSTALL_DIR, old), { recursive: true, force: true }); } catch(err){}
  }

  // Start hidden (window style 0) at every login, and right now.
  const q = (s) => s.replace(/"/g, '""');
  fs.writeFileSync(STARTUP_VBS,
    `Set sh = CreateObject("WScript.Shell")\r\n` +
    `sh.CurrentDirectory = "${q(INSTALL_DIR)}"\r\n` +
    `sh.Run """${q(INSTALLED_EXE)}"" --run", 0, False\r\n`);
  spawn("wscript.exe", [STARTUP_VBS], { detached: true, stdio: "ignore" }).unref();

  let running = false;
  for(let i = 0; i < 20 && !running; i++){
    await new Promise(r => setTimeout(r, 500));
    running = await isHelperRunning();
  }
  if(!running) throw new Error("It installed, but didn't start. Try restarting your computer.");

  console.log("✅ Done! The control helper is running, and will start by itself whenever you log in.");
  console.log("   In a chat-club call: share your entire screen, and click Allow when someone asks for control.");
  console.log("   You can delete the file you downloaded now.");
}

async function uninstall(){
  await stopRunningHelper();
  fs.rmSync(STARTUP_VBS, { force: true });
  // The exe can't delete itself while running, so remove everything else and
  // have Windows clean up the folder a moment after this process exits.
  for(const entry of fs.existsSync(INSTALL_DIR) ? fs.readdirSync(INSTALL_DIR) : []){
    const p = path.join(INSTALL_DIR, entry);
    if(p.toLowerCase() !== path.resolve(process.execPath).toLowerCase()) fs.rmSync(p, { recursive: true, force: true });
  }
  spawn("cmd.exe", ["/c", `timeout /t 2 /nobreak >nul & rmdir /s /q "${INSTALL_DIR}"`],
    { detached: true, stdio: "ignore", windowsHide: true }).unref();
  console.log("✅ The chat-club control helper has been removed.");
}

const args = process.argv.slice(2);
if(args.includes("--run")){
  require("./server.js");
} else {
  (args.includes("--uninstall") ? uninstall() : install())
    .catch((err) => { console.error("\nSomething went wrong:", err?.message || err); process.exitCode = 1; })
    .finally(() => waitForEnter().then(() => process.exit()));
}
