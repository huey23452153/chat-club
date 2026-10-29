// DUST CRAWLER RELAY: when two players' internet won't let them connect straight to each other, the game sends its
// messages here instead and this passes them on to everyone else in the same room. It keeps nothing: rooms exist only
// while their host is connected. Open / to check it's awake.
const http = require('http');
const { WebSocketServer } = require('ws');

const rooms = new Map();                     // code -> { host: socket, clients: Set<socket> }
const ok = (s) => /^[A-Z]{4}$/.test(s), okId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 80;
const MAX_ROOMS = 200, MAX_PER_ROOM = 12, MAX_MSG = 8000;

const server = http.createServer((req, res) => {
  const headers={'access-control-allow-origin':'*','cache-control':'no-store'};
  // Chat Club backup forgot-password requests (see resetConnection below): looked at by id, and closed off once used
  { const u = new URL(req.url, 'http://relay');
    if (u.pathname === '/reset-req' || u.pathname === '/reset-done') {
      const id = u.searchParams.get('id'), r = resetReqs.get(id);
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', 'no-store');
      if (u.pathname === '/reset-req') return res.end(JSON.stringify(r ? { name: r.name, keyHash: r.keyHash, status: r.status, allowedAt: r.allowedAt || 0 } : null));
      if (req.method !== 'POST') { res.statusCode = 405; return res.end('{}'); }
      if (r) { const st = u.searchParams.get('status') === 'set' ? 'set' : 'done'; resetStatus(id, st); }
      return res.end('{"ok":true}');
    }
  }
  if(new URL(req.url,'http://relay').pathname==='/rooms'){
    const live=[...rooms].filter(([,r])=>r.host?.readyState===1).map(([code,r])=>({code,host:r.info?.host||'Driver',map:r.info?.map||'unknown',mode:r.info?.mode||'free',players:r.info?.names?.length||r.clients.size,names:r.info?.names||[],updatedAt:r.info?.at||0}));
    res.writeHead(200,{...headers,'content-type':'application/json'});res.end(JSON.stringify({rooms:live,serverTime:Date.now()}));return;
  }
  res.writeHead(200,{...headers,'content-type':'text/plain'});res.end('dust crawler relay ok, '+rooms.size+' rooms');
});
// (big enough for a Chat Club photo on the backup chat; the game rooms still only pass on MAX_MSG-sized messages)
const MAX_PHOTO = 950000;
const wss = new WebSocketServer({ server, maxPayload: MAX_PHOTO + 4000 });

// CHAT CLUB "WHO'S ONLINE": each open Chat Club connects to /presence?uid=… and says which friends it wants to
// know about ({ watch: [uids] }); this tells it which of them are connected right now, and again whenever one comes
// or goes. Nothing is stored and nothing touches Firebase (doing this with database writes used up its free limit).
const presence = new Map();                  // uid -> Set<socket>
const seenStore = new Map();                 // groupId -> Map<uid, when they last saw it>
const okUid = (s) => typeof s === 'string' && /^[A-Za-z0-9]{6,64}$/.test(s);
const tellWatchers = (uid) => { for (const c of wss.clients) if (c.watch && c.watch.has(uid) && c.readyState === 1) c.send(JSON.stringify({ t: 'online', uid, on: presence.has(uid) })); };
function presenceConnection(ws, q) {
  const uid = q.get('uid'); if (!okUid(uid)) return ws.close(4000, 'bad');
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  const first = !presence.has(uid); if (first) presence.set(uid, new Set()); presence.get(uid).add(ws);
  if (first) tellWatchers(uid);
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
    // Chat Club "seen" and "typing…": passed straight to everyone watching this person (they pick out the chat
    // that's open); the last "seen" per chat is kept so someone opening the chat later still sees it
    if ((m.t === 'seen' || m.t === 'typing') && okGroup(m.g)) {
      const out = { t: m.t, uid, g: m.g };
      if (m.t === 'seen') { out.at = Date.now(); let g = seenStore.get(m.g); if (!g) { if (seenStore.size > 5000) seenStore.clear(); g = new Map(); seenStore.set(m.g, g); } g.set(uid, out.at); }
      else { out.on = !!m.on; out.name = String(m.name || 'Someone').replace(/[\u0000-\u001f]/g, '').slice(0, 30); }
      const s = JSON.stringify(out);
      for (const c of wss.clients) if (c !== ws && c.watch && c.watch.has(uid) && c.readyState === 1) c.send(s);
      return;
    }
    if (m.t === 'seen-get' && okGroup(m.g)) { const g = seenStore.get(m.g); ws.send(JSON.stringify({ t: 'seen-list', g: m.g, seen: g ? Object.fromEntries([...g].filter(([u]) => !ws.watch || ws.watch.has(u)).map(([u, at]) => [u, Date.now() - at])) : {} })); return; }
    if (!Array.isArray(m.watch)) return;
    ws.watch = new Set(m.watch.filter(okUid).slice(0, 300));
    ws.send(JSON.stringify({ t: 'online-list', online: [...ws.watch].filter((u) => presence.has(u)) }));
  });
  ws.on('close', () => { const set = presence.get(uid); if (!set) return; set.delete(ws); if (!set.size) { presence.delete(uid); tellWatchers(uid); } });
}

// CHAT CLUB BACKUP CALLS: video calls connect people through a small "call document" per chat (who's in it, and the
// offers/answers/connection details between each pair). When Firebase has run out for the day the app keeps that
// document here instead: same shape, same updates ("a.b.c" paths; {$:'now'} = the time, {$:'del'} = remove,
// {$:'union', v:[…]} = add to a list), and everyone in that chat's call gets the whole document whenever it changes.
// Only in memory, and forgotten after 6 hours without changes. (The video itself goes directly between people.)
const callDocs = new Map();                  // groupId -> { data: object|null, subs: Set<socket>, at }
const callOf = (g) => { let c = callDocs.get(g); if (!c) { c = { data: null, subs: new Set(), at: Date.now() }; callDocs.set(g, c); } return c; };
const BAD_KEY = /^(__proto__|constructor|prototype)$/;
function callValue(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (v.$ === 'now') return { $ts: Date.now() };
    const out = {}; for (const [k, x] of Object.entries(v)) if (!BAD_KEY.test(k) && !(x && x.$ === 'del')) out[k] = callValue(x); return out;
  }
  return Array.isArray(v) ? v.map(callValue) : v;
}
function callUpdate(doc, update) {
  for (const [path, v] of Object.entries(update)) {
    const parts = path.split('.'); if (parts.some((k) => !k || BAD_KEY.test(k)) || parts.length > 5) continue;
    let o = doc; for (const k of parts.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object' || Array.isArray(o[k])) o[k] = {}; o = o[k]; }
    const last = parts[parts.length - 1];
    if (v && v.$ === 'del') delete o[last];
    else if (v && v.$ === 'union' && Array.isArray(v.v)) { const list = Array.isArray(o[last]) ? o[last] : (o[last] = []); for (const x of v.v) if (!list.some((y) => JSON.stringify(y) === JSON.stringify(x)) && list.length < 200) list.push(callValue(x)); }
    else o[last] = callValue(v);
  }
}
function callConnection(ws, q) {
  if (!okUid(q.get('uid'))) return ws.close(4000, 'bad');
  ws.alive = true; ws.on('pong', () => { ws.alive = true; }); ws.callGroups = new Set();
  const show = (g, c, to) => { const out = JSON.stringify({ t: 'doc', g, data: c.data }); for (const sub of to) if (sub.readyState === 1) sub.send(out); };
  ws.on('message', (data) => {
    if (data.length > 200000) return;
    let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
    if (!okGroup(m.g)) return;
    const c = callOf(m.g);
    if (m.t === 'sub') { if (ws.callGroups.size < 20) { ws.callGroups.add(m.g); c.subs.add(ws); } show(m.g, c, [ws]); }
    else if (m.t === 'unsub') { ws.callGroups.delete(m.g); c.subs.delete(ws); }
    else if (m.t === 'get') ws.send(JSON.stringify({ t: 'got', rid: m.rid, data: c.data }));
    else if ((m.t === 'set' || m.t === 'upd') && m.data && typeof m.data === 'object') {
      if (m.t === 'set') c.data = callValue(m.data);
      else { if (!c.data) { if (m.rid) ws.send(JSON.stringify({ t: 'done', rid: m.rid, error: 'not-found' })); return; } callUpdate(c.data, m.data); }
      c.at = Date.now();
      if (m.rid) ws.send(JSON.stringify({ t: 'done', rid: m.rid }));
      show(m.g, c, c.subs);
    }
  });
  ws.on('close', () => { for (const g of ws.callGroups) { const c = callDocs.get(g); if (c) c.subs.delete(ws); } });
}
setInterval(() => { const old = Date.now() - 6 * 3600e3; for (const [g, c] of callDocs) if (!c.subs.size && c.at < old) callDocs.delete(g); }, 600e3);

// CHAT CLUB BACKUP CHAT: when Chat Club's Firebase runs out of its free daily limit, the app switches here. Each
// chat (by its id) keeps its last 200 messages for 12 hours in memory (gone if the server restarts), and new
// messages go straight to everyone in that chat who's connected. Text and GIPHY GIFs only (no photos).
const chats = new Map();                     // groupId -> { msgs: [], subs: Set<socket> }
const okGroup = (s) => typeof s === 'string' && /^[A-Za-z0-9]{10,64}$/.test(s);
const okGif = (u) => typeof u === 'string' && u.length < 300 && /^https:\/\/media\d*\.giphy\.com\/media\/(?:[\w.-]+\/)?[\w-]+\/[\w.-]+\.gif(\?[\w=&.-]*)?$/.test(u);
const KEEP_MS = 12 * 3600 * 1000, KEEP_N = 200, KEEP_PHOTOS = 15;
const chatOf = (id) => { let c = chats.get(id); if (!c) { c = { msgs: [], subs: new Set() }; chats.set(id, c); } return c; };
function chatConnection(ws, q) {
  const uid = q.get('uid'), name = String(q.get('name') || 'Friend').replace(/[\u0000-\u001f]/g, '').slice(0, 30);
  if (!okUid(uid)) return ws.close(4000, 'bad');
  ws.alive = true; ws.on('pong', () => { ws.alive = true; }); ws.groups = new Set();
  ws.on('message', async (data) => {
    let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
    if (m.t === 'join' && Array.isArray(m.groups)) {
      for (const g of m.groups.filter(okGroup).slice(0, 100)) {
        if (ws.groups.has(g)) continue; ws.groups.add(g); const c = chatOf(g); c.subs.add(ws);
        const now = Date.now(); c.msgs = c.msgs.filter((x) => now - x.at < KEEP_MS);
        ws.send(JSON.stringify({ t: 'history', groupId: g, msgs: c.msgs }));
      }
    } else if (m.t === 'del' && ws.groups.has(m.groupId) && typeof m.id === 'string') {
      // taking a message back: your own, or any of them for huey (who proves it with his login token)
      const c = chatOf(m.groupId), i = c.msgs.findIndex((x) => x.id === m.id); if (i < 0) return;
      if (c.msgs[i].senderId !== uid && !(await adminFromToken(m.token))) return;
      c.msgs.splice(i, 1);
      const out = JSON.stringify({ t: 'del', groupId: m.groupId, id: m.id }); for (const sub of c.subs) if (sub.readyState === 1) sub.send(out);
    } else if (m.t === 'msg' && ws.groups.has(m.groupId)) {
      const text = typeof m.text === 'string' ? m.text.slice(0, 500) : '', gifUrl = okGif(m.gifUrl) ? m.gifUrl : undefined;
      const imageData = typeof m.imageData === 'string' && m.imageData.length <= MAX_PHOTO && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(m.imageData) ? m.imageData : undefined;
      if (!text && !gifUrl && !imageData) return;
      const msg = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), groupId: m.groupId, senderId: uid, senderName: name, text, gifUrl, imageData, at: Date.now() };
      const c = chatOf(m.groupId); c.msgs.push(msg); if (c.msgs.length > KEEP_N) c.msgs.splice(0, c.msgs.length - KEEP_N);
      // (photos take a lot of memory: only the newest few in each chat keep theirs)
      let photos = 0; for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].imageData && ++photos > KEEP_PHOTOS) { c.msgs[i].imageData = undefined; c.msgs[i].photoGone = true; }
      const out = JSON.stringify({ t: 'msg', msg }); for (const sub of c.subs) if (sub.readyState === 1) sub.send(out);
    }
  });
  ws.on('close', () => { for (const g of ws.groups) { const c = chats.get(g); if (c) c.subs.delete(ws); } });
}

// ---- Chat Club "watch together": a YouTube video everyone in a chat plays at the same time ----
// One state per chat, kept here in memory: what's playing, where it's up to, the queue,
// and the votes to skip. Anyone in the chat can add, pause, play or seek; a song is
// skipped once half the people watching vote to skip it.
const watches = new Map();                   // groupId -> { now, queue, votes, subs }
const okVideo = (v) => typeof v === 'string' && /^[\w-]{11}$/.test(v);
const watchOf = (id) => { let w = watches.get(id); if (!w) { w = { now: null, queue: [], votes: new Set(), subs: new Set() }; watches.set(id, w); } return w; };
// where the video is up to, in seconds
const posOf = (n) => n ? (n.paused ? n.pos : n.pos + (Date.now() - n.since) / 1000) : 0;
function watchSend(w) {
  const watching = [...w.subs].filter((c) => c.readyState === 1);
  const names = [...new Set(watching.map((c) => c.watchName))];
  const out = JSON.stringify({ t: 'watch', now: w.now && { ...w.now, pos: posOf(w.now) }, at: Date.now(), queue: w.queue, votes: w.votes.size, need: Math.max(1, Math.ceil(names.length / 2)), watching: names });
  for (const c of watching) c.send(out);
}
async function titleOf(id) {
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { signal: AbortSignal.timeout(4000) });
    if (r.ok) { const d = await r.json(); if (typeof d.title === 'string') return d.title.replace(/[\u0000-\u001f]/g, '').slice(0, 100); }
  } catch (e) { /* no title then */ }
  return 'YouTube video';
}
function watchNext(w) {
  const next = w.queue.shift();
  w.now = next ? { ...next, pos: 0, since: Date.now(), paused: false } : null;
  w.votes.clear();
  watchSend(w);
}
function watchConnection(ws, q) {
  const uid = q.get('uid'), name = String(q.get('name') || 'Friend').replace(/[\u0000-\u001f]/g, '').slice(0, 30), g = q.get('group');
  if (!okUid(uid) || !okGroup(g)) return ws.close(4000, 'bad');
  ws.alive = true; ws.on('pong', () => { ws.alive = true; }); ws.watchName = name; ws.watchUid = uid;
  const w = watchOf(g); w.subs.add(ws); watchSend(w);
  ws.on('message', async (data) => {
    let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
    // (clock check, so everyone works out the same moment of the video: see watchClock in index.html)
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', c: m.c, s: Date.now() }));
    const n = w.now, pos = Number.isFinite(m.pos) ? Math.max(0, Math.min(m.pos, 36000)) : posOf(n);
    if (m.t === 'add' && okVideo(m.videoId)) {
      if (w.queue.length >= 30) return;
      const item = { videoId: m.videoId, title: await titleOf(m.videoId), by: name };
      if (!w.now) { w.now = { ...item, pos: 0, since: Date.now(), paused: false }; w.votes.clear(); } else w.queue.push(item);
      watchSend(w);
    } else if (m.t === 'pause' && n) { n.pos = pos; n.paused = true; n.since = Date.now(); watchSend(w); }
    else if (m.t === 'play' && n) { n.pos = pos; n.paused = false; n.since = Date.now(); watchSend(w); }
    else if (m.t === 'seek' && n) { n.pos = pos; n.since = Date.now(); watchSend(w); }
    else if (m.t === 'vote' && n) {
      if (w.votes.has(uid)) w.votes.delete(uid); else w.votes.add(uid);
      const people = new Set([...w.subs].filter((c) => c.readyState === 1).map((c) => c.watchUid)).size;
      if (w.votes.size >= Math.max(1, Math.ceil(people / 2))) watchNext(w); else watchSend(w);
    } else if (m.t === 'ended' && n && m.videoId === n.videoId && posOf(n) > 3) watchNext(w);
    else if (m.t === 'broken' && n && m.videoId === n.videoId) watchNext(w); // can't be played inside other sites
    else if (m.t === 'unqueue' && Number.isInteger(m.i) && w.queue[m.i]) { w.queue.splice(m.i, 1); watchSend(w); }
    else if (m.t === 'stop') { w.now = null; w.queue = []; w.votes.clear(); watchSend(w); }
  });
  ws.on('close', () => {
    w.subs.delete(ws); w.votes.delete(uid);
    if (!w.subs.size) { watches.delete(g); return; } // nobody left watching: forget it
    watchSend(w);
  });
}

// ---- one-off mailbox: hands a small message from one page to another under a random code ----
// (Chat Club waits on ?role=get; Dust Crawler, open in your normal browser, sends your controls with ?role=put)
const mailboxes = new Map();                 // code -> Set<waiting socket>
function mailConnection(ws, q) {
  const box = q.get('box'), role = q.get('role');
  if (typeof box !== 'string' || !/^[A-Za-z0-9]{12,40}$/.test(box)) return ws.close(4000, 'bad');
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  if (role === 'get') {
    let set = mailboxes.get(box); if (!set) { if (mailboxes.size >= 500) return ws.close(4002, 'full'); set = new Set(); mailboxes.set(box, set); }
    set.add(ws);
    const bye = setTimeout(() => ws.close(), 10 * 60 * 1000); // nobody waits forever
    ws.on('close', () => { clearTimeout(bye); set.delete(ws); if (!set.size) mailboxes.delete(box); });
  } else if (role === 'put') {
    ws.on('message', (data) => {
      const set = mailboxes.get(box), s = String(data);
      let n = 0; if (set) for (const c of set) if (c.readyState === 1) { c.send(s); n++; }
      ws.send(JSON.stringify({ t: n ? 'delivered' : 'nobody' }));
    });
  } else ws.close(4000, 'bad');
}

// ---- Chat Club forgot password, for when Firebase has run out for the day ----
// Same idea as the Firebase version: someone leaves a request (their name and the SHA-256 of a secret their
// browser keeps), huey's Chat Club gets it and answers Allow / Deny, and the asking browser then sends the new
// password to Chat Club's /api/reset (which checks the request here, by its id, before changing anything).
// Only huey's account can see the list or answer: it proves who it is with its Firebase login token.
const resetReqs = new Map();                 // id -> { name, keyHash, status, createdAt, allowedAt, waiters: Set }
const resetAdmins = new Set();
const FIREBASE_PROJECT = 'school-chat-9e4d8', RESET_ADMIN = 'huey@chatclub.local';
const EMULATOR_TOKENS = process.env.RESET_EMULATOR === '1'; // (local tests only: the emulator's tokens aren't signed)
let googleCerts = { at: 0, keys: {} };
async function adminFromToken(token) {
  try {
    const [h, p, sig] = String(token).split('.'); if (!h || !p) return false;
    const head = JSON.parse(Buffer.from(h, 'base64url')), body = JSON.parse(Buffer.from(p, 'base64url')), now = Date.now() / 1000;
    if (body.aud !== FIREBASE_PROJECT || body.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT || !(body.exp > now) || body.email !== RESET_ADMIN) return false;
    if (EMULATOR_TOKENS) return true;
    if (head.alg !== 'RS256' || !sig) return false;
    if (Date.now() - googleCerts.at > 3600e3 || !googleCerts.keys[head.kid]) {
      const r = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', { signal: AbortSignal.timeout(5000) });
      googleCerts = { at: Date.now(), keys: await r.json() };
    }
    const cert = googleCerts.keys[head.kid]; if (!cert) return false;
    return require('crypto').createVerify('RSA-SHA256').update(h + '.' + p).verify(cert, Buffer.from(sig, 'base64url'));
  } catch (e) { return false; }
}
const resetView = (id, r) => ({ id, name: r.name, status: r.status, createdAt: r.createdAt });
function resetStatus(id, status) {
  const r = resetReqs.get(id); if (!r) return;
  r.status = status; if (status === 'allowed') r.allowedAt = Date.now();
  const out = JSON.stringify({ t: 'status', id, status });
  for (const c of r.waiters) if (c.readyState === 1) c.send(out);
  const card = JSON.stringify({ t: 'req', req: resetView(id, r) });
  for (const c of resetAdmins) if (c.readyState === 1) c.send(card);
  if (status === 'done') resetReqs.delete(id);
}
function tidyResets() { const old = Date.now() - 2 * 864e5; for (const [id, r] of resetReqs) if (r.createdAt < old) resetReqs.delete(id); }
async function resetConnection(ws, q) {
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  const role = q.get('role');
  if (role === 'admin') {
    ws.on('message', async (data) => {
      let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
      if (m.t === 'login') {
        if (!(await adminFromToken(m.token))) return ws.close(4003, 'not huey');
        ws.isAdmin = true; resetAdmins.add(ws); tidyResets();
        ws.send(JSON.stringify({ t: 'list', reqs: [...resetReqs].filter(([, r]) => r.status === 'pending').map(([id, r]) => resetView(id, r)) }));
      } else if (m.t === 'answer' && ws.isAdmin && resetReqs.has(m.id) && (m.status === 'allowed' || m.status === 'denied')) resetStatus(m.id, m.status);
    });
    ws.on('close', () => resetAdmins.delete(ws));
    return;
  }
  // the asking browser: makes a request (or picks its old one back up) and hears the answer
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
    if (m.t === 'ask' && typeof m.name === 'string' && m.name.trim() && m.name.length <= 24 && /^[0-9a-f]{64}$/.test(m.keyHash || '')) {
      tidyResets(); if (resetReqs.size >= 300) return ws.close(4002, 'full');
      const id = require('crypto').randomBytes(12).toString('hex'), r = { name: m.name.replace(/[\u0000-\u001f]/g, ''), keyHash: m.keyHash, status: 'pending', createdAt: Date.now(), waiters: new Set([ws]) };
      resetReqs.set(id, r); ws.resetId = id;
      ws.send(JSON.stringify({ t: 'asked', id }));
      const card = JSON.stringify({ t: 'req', req: resetView(id, r) }); for (const c of resetAdmins) if (c.readyState === 1) c.send(card);
    } else if (m.t === 'wait' && resetReqs.has(m.id)) {
      const r = resetReqs.get(m.id); r.waiters.add(ws); ws.resetId = m.id;
      ws.send(JSON.stringify({ t: 'status', id: m.id, status: r.status }));
    } else if (m.t === 'wait') ws.send(JSON.stringify({ t: 'status', id: m.id, status: 'gone' }));
  });
  ws.on('close', () => { const r = resetReqs.get(ws.resetId); if (r) r.waiters.delete(ws); });
}

wss.on('connection', (ws, req) => {
  if (new URL(req.url, 'http://x').pathname === '/reset') return resetConnection(ws, new URL(req.url, 'http://x').searchParams);
  if (new URL(req.url, 'http://x').pathname === '/mail') return mailConnection(ws, new URL(req.url, 'http://x').searchParams);
  if (new URL(req.url, 'http://x').pathname === '/watch') return watchConnection(ws, new URL(req.url, 'http://x').searchParams);
  if (new URL(req.url, 'http://x').pathname === '/chat') return chatConnection(ws, new URL(req.url, 'http://x').searchParams);
  if (new URL(req.url, 'http://x').pathname === '/call') return callConnection(ws, new URL(req.url, 'http://x').searchParams);
  if (new URL(req.url, 'http://x').pathname === '/presence') return presenceConnection(ws, new URL(req.url, 'http://x').searchParams);
  const q = new URL(req.url, 'http://x').searchParams, code = String(q.get('room') || '').toUpperCase(), role = q.get('role'), id = q.get('id');
  if (!ok(code) || !okId(id) || (role !== 'host' && role !== 'join')) return ws.close(4000, 'bad');
  let room = rooms.get(code);
  if (role === 'host') {
    if (room && room.host && room.host.readyState === 1) return ws.close(4001, 'taken');
    if (!room && rooms.size >= MAX_ROOMS) return ws.close(4002, 'full');
    room = room || { host: null, clients: new Set() }; room.host = ws; rooms.set(code, room);
  } else {
    if (!room || !room.host || room.host.readyState !== 1) return ws.close(4004, 'no-such-room');
    if (room.clients.size >= MAX_PER_ROOM) return ws.close(4002, 'full');
  }
  room.clients.add(ws); ws.id = id; ws.alive = true;
  ws.send(JSON.stringify({ t: 'relay-ok' }));
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data) => {
    const s=String(data); if(s.length>MAX_MSG)return;
    if(s.includes('"room-info"')){
      if(ws!==room.host)return;
      try{const m=JSON.parse(s);if(m.t==='room-info'){
        const names=Array.isArray(m.players)?m.players.slice(0,64).map(p=>typeof p?.name==='string'?p.name.replace(/[\u0000-\u001f]/g,'').slice(0,14):'Driver'):[];
        room.info={host:typeof m.host==='string'?m.host.slice(0,14):'Driver',map:['valley','outback','highcountry'].includes(m.map)?m.map:'unknown',mode:['free','expedition','chase'].includes(m.mode)?m.mode:'free',names,at:Date.now()};return;
      }}catch{return;}
    }
    for(const c of room.clients)if(c!==ws&&c.readyState===1)c.send(s);
  });
  ws.on('close', () => {
    room.clients.delete(ws);
    if (room.host === ws) { for (const c of room.clients) { try { c.send(JSON.stringify({ t: 'host-left' })); c.close(); } catch (e) {} } rooms.delete(code); }
    else { const bye = JSON.stringify({ t: 'bye', id }); for (const c of room.clients) if (c.readyState === 1) c.send(bye); }
  });
});
// drop connections that have silently died
const pulse=setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 25000);pulse.unref();

if(require.main===module)server.listen(process.env.PORT || 10000, () => console.log('relay listening'));
module.exports={server,wss,rooms};
