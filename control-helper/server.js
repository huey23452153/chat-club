// chat-club control helper
//
// A web page can't move the real mouse or press real keys — browsers block
// that on purpose. This tiny local program is the missing piece: while you
// share your *entire screen* in a chat-club call and click "Allow" on
// someone's control request, your chat-club tab forwards their mouse and
// keyboard input here over a local WebSocket, and this program performs it.
//
// It only listens on 127.0.0.1 (never reachable from other computers), and
// only accepts connections from chat-club's own web pages (checked by the
// browser-set Origin header), so random websites you visit can't use it.
//
// Run:   npm install   (first time only)
//        npm start
// Stop:  Ctrl+C — control stops instantly.

const http = require("http");
const { WebSocketServer } = require("ws");
const { mouse, keyboard, screen, Point, Button, Key } = require("@nut-tree-fork/nut-js");

const PORT = Number(process.env.CONTROL_HELPER_PORT) || 47615;

// Pages allowed to drive this computer. Localhost (any port) covers local
// development; add your own hosting URL with --origin https://example.com
// (repeatable) or the CONTROL_HELPER_ORIGINS env var (comma-separated).
const ALLOWED_ORIGINS = new Set([
  "https://chat-club-one.vercel.app",
  "https://huey23452153.github.io",
  "https://school-chat-9e4d8.web.app",
  "https://school-chat-9e4d8.firebaseapp.com",
  ...(process.env.CONTROL_HELPER_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),
]);
process.argv.forEach((arg, i) => {
  if(arg === "--origin" && process.argv[i + 1]) ALLOWED_ORIGINS.add(process.argv[i + 1].replace(/\/$/, ""));
});

function isAllowedOrigin(origin){
  if(!origin) return false;
  if(ALLOWED_ORIGINS.has(origin)) return true;
  try{
    const u = new URL(origin);
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch(e){ return false; }
}

// No per-step pauses — remote control should feel as live as possible.
mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

// KeyboardEvent.code (physical key position) -> nut-js key. Using `code`
// rather than `key` means shortcuts like Ctrl+C work regardless of what
// character a key happens to produce.
const CODE_TO_KEY = {
  Escape: Key.Escape, Tab: Key.Tab, CapsLock: Key.CapsLock, Space: Key.Space,
  Enter: Key.Enter, NumpadEnter: Key.Enter, Backspace: Key.Backspace, Delete: Key.Delete, Insert: Key.Insert,
  Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
  ArrowLeft: Key.Left, ArrowRight: Key.Right, ArrowUp: Key.Up, ArrowDown: Key.Down,
  ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
  MetaLeft: Key.LeftSuper, MetaRight: Key.RightSuper, ContextMenu: Key.Menu,
  Minus: Key.Minus, Equal: Key.Equal, BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket,
  Backslash: Key.Backslash, Semicolon: Key.Semicolon, Quote: Key.Quote, Backquote: Key.Grave,
  Comma: Key.Comma, Period: Key.Period, Slash: Key.Slash,
  PrintScreen: Key.Print, ScrollLock: Key.ScrollLock, Pause: Key.Pause, NumLock: Key.NumLock,
  NumpadDivide: Key.Divide, NumpadMultiply: Key.Multiply, NumpadSubtract: Key.Subtract,
  NumpadAdd: Key.Add, NumpadDecimal: Key.Decimal,
};
for(let c = 65; c <= 90; c++){ const ch = String.fromCharCode(c); CODE_TO_KEY[`Key${ch}`] = Key[ch]; }
for(let d = 0; d <= 9; d++){ CODE_TO_KEY[`Digit${d}`] = Key[`Num${d}`]; CODE_TO_KEY[`Numpad${d}`] = Key[`NumPad${d}`]; }
for(let f = 1; f <= 12; f++) CODE_TO_KEY[`F${f}`] = Key[`F${f}`];

const BUTTONS = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT };

// Everything currently held down, so a dropped connection or a revoked
// control session never leaves a stuck mouse button or modifier key behind.
const heldButtons = new Set();
const heldKeys = new Set();

async function releaseEverything(){
  for(const b of heldButtons){ try{ await mouse.releaseButton(b); } catch(e){} }
  heldButtons.clear();
  for(const k of heldKeys){ try{ await keyboard.releaseKey(k); } catch(e){} }
  heldKeys.clear();
}

let screenSize = null;
async function getScreenSize(){
  if(!screenSize) screenSize = { w: await screen.width(), h: await screen.height() };
  return screenSize;
}
// Screen resolution can change (monitor plugged in, scaling changed) —
// re-read it now and then rather than trusting the startup value forever.
setInterval(() => { screenSize = null; }, 5000);

function clamp01(n){ return Math.min(1, Math.max(0, Number(n) || 0)); }

async function moveTo(x, y){
  const { w, h } = await getScreenSize();
  await mouse.setPosition(new Point(Math.round(clamp01(x) * (w - 1)), Math.round(clamp01(y) * (h - 1))));
}

async function perform(msg){
  switch(msg.kind){
    case "move":
      await moveTo(msg.x, msg.y);
      break;
    case "down": {
      const b = BUTTONS[msg.button];
      if(b === undefined) return;
      await moveTo(msg.x, msg.y);
      await mouse.pressButton(b);
      heldButtons.add(b);
      break;
    }
    case "up": {
      const b = BUTTONS[msg.button];
      if(b === undefined) return;
      await moveTo(msg.x, msg.y);
      await mouse.releaseButton(b);
      heldButtons.delete(b);
      break;
    }
    case "wheel": {
      // Browsers report wheel deltas in pixels (~100 per wheel notch).
      // nut-js's scroll amount means different things per OS: raw wheel
      // units on Windows (120 = one notch — measured), pixels on macOS, and
      // individual wheel clicks on Linux.
      const steps = (d) => {
        const px = Math.min(3000, Math.abs(d));
        if(process.platform === "win32") return Math.max(1, Math.round(px * 1.2));
        if(process.platform === "darwin") return Math.max(1, Math.round(px));
        return Math.min(30, Math.max(1, Math.round(px / 100)));
      };
      if(msg.dy > 0) await mouse.scrollDown(steps(msg.dy));
      else if(msg.dy < 0) await mouse.scrollUp(steps(msg.dy));
      if(msg.dx > 0) await mouse.scrollRight(steps(msg.dx));
      else if(msg.dx < 0) await mouse.scrollLeft(steps(msg.dx));
      break;
    }
    case "keydown": {
      const k = CODE_TO_KEY[msg.code];
      if(k === undefined) return;
      await keyboard.pressKey(k);
      heldKeys.add(k);
      break;
    }
    case "keyup": {
      const k = CODE_TO_KEY[msg.code];
      if(k === undefined) return;
      await keyboard.releaseKey(k);
      heldKeys.delete(k);
      break;
    }
    case "release-all":
      await releaseEverything();
      break;
  }
}

// Inputs must happen strictly in order (a click's "down" before its "up"),
// but mouse moves arrive far faster than they can be performed — so run one
// at a time, and collapse a backlog of moves down to just the latest one.
const queue = [];
let running = false;
function enqueue(msg){
  const last = queue[queue.length - 1];
  if(msg.kind === "move" && last && last.kind === "move") queue[queue.length - 1] = msg;
  else queue.push(msg);
  if(!running) drain();
}
async function drain(){
  running = true;
  while(queue.length){
    const msg = queue.shift();
    try{ await perform(msg); } catch(err){ console.error("Input failed:", msg.kind, err?.message || err); }
  }
  running = false;
}

const server = http.createServer((req, res) => {
  // Lets the installer stop an older running copy before replacing it. The
  // custom header means a web page can't trigger this: browsers won't send
  // it cross-origin without a CORS preflight, which this server never allows.
  if(req.method === "POST" && req.url === "/quit" && req.headers["x-chat-club-helper"] === "quit"){
    res.end("bye\n");
    releaseEverything().finally(() => process.exit(0));
    return;
  }
  // Lets the page check "is the helper running?" before asking to connect.
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("chat-club control helper is running\n");
});

const wss = new WebSocketServer({
  server,
  verifyClient: ({ origin }) => {
    const ok = isAllowedOrigin(origin);
    if(!ok) console.warn(`Refused a connection from ${origin || "an unknown page"} (not a chat-club page).`);
    return ok;
  },
});

let activeSocket = null;

wss.on("connection", (ws, req) => {
  // Only one chat-club tab drives input at a time — a newer one replaces
  // the old, rather than two sessions fighting over the mouse.
  if(activeSocket && activeSocket !== ws) activeSocket.close(4000, "replaced");
  activeSocket = ws;
  console.log(`chat-club connected (${req.headers.origin}). Remote control is possible while you allow it in the call.`);
  ws.send(JSON.stringify({ type: "helper-ready" }));

  ws.on("message", (data) => {
    let msg;
    try{ msg = JSON.parse(data.toString()); } catch(e){ return; }
    if(msg && msg.type === "input" && typeof msg.kind === "string") enqueue(msg);
  });
  ws.on("close", () => {
    if(activeSocket === ws) activeSocket = null;
    queue.length = 0;
    releaseEverything();
    console.log("chat-club disconnected — remote control stopped.");
  });
});

server.on("error", (err) => {
  if(err.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use — is the helper already running in another window?`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`chat-club control helper listening on 127.0.0.1:${PORT}`);
  console.log("Leave this window open during calls where you want to allow remote control. Ctrl+C to quit.");
});

process.on("SIGINT", async () => { await releaseEverything(); process.exit(0); });
