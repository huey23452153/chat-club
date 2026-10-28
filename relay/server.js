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
  if(new URL(req.url,'http://relay').pathname==='/rooms'){
    const live=[...rooms].filter(([,r])=>r.host?.readyState===1).map(([code,r])=>({code,host:r.info?.host||'Driver',map:r.info?.map||'unknown',mode:r.info?.mode||'free',players:r.info?.names?.length||r.clients.size,names:r.info?.names||[],updatedAt:r.info?.at||0}));
    res.writeHead(200,{...headers,'content-type':'application/json'});res.end(JSON.stringify({rooms:live,serverTime:Date.now()}));return;
  }
  res.writeHead(200,{...headers,'content-type':'text/plain'});res.end('dust crawler relay ok, '+rooms.size+' rooms');
});
const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });

// CHAT CLUB "WHO'S ONLINE": each open Chat Club connects to /presence?uid=… and says which friends it wants to
// know about ({ watch: [uids] }); this tells it which of them are connected right now, and again whenever one comes
// or goes. Nothing is stored and nothing touches Firebase (doing this with database writes used up its free limit).
const presence = new Map();                  // uid -> Set<socket>
const okUid = (s) => typeof s === 'string' && /^[A-Za-z0-9]{6,64}$/.test(s);
const tellWatchers = (uid) => { for (const c of wss.clients) if (c.watch && c.watch.has(uid) && c.readyState === 1) c.send(JSON.stringify({ t: 'online', uid, on: presence.has(uid) })); };
function presenceConnection(ws, q) {
  const uid = q.get('uid'); if (!okUid(uid)) return ws.close(4000, 'bad');
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  const first = !presence.has(uid); if (first) presence.set(uid, new Set()); presence.get(uid).add(ws);
  if (first) tellWatchers(uid);
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
    if (!Array.isArray(m.watch)) return;
    ws.watch = new Set(m.watch.filter(okUid).slice(0, 300));
    ws.send(JSON.stringify({ t: 'online-list', online: [...ws.watch].filter((u) => presence.has(u)) }));
  });
  ws.on('close', () => { const set = presence.get(uid); if (!set) return; set.delete(ws); if (!set.size) { presence.delete(uid); tellWatchers(uid); } });
}

// CHAT CLUB BACKUP CHAT: when Chat Club's Firebase runs out of its free daily limit, the app switches here. Each
// chat (by its id) keeps its last 200 messages for 12 hours in memory (gone if the server restarts), and new
// messages go straight to everyone in that chat who's connected. Text and GIPHY GIFs only (no photos).
const chats = new Map();                     // groupId -> { msgs: [], subs: Set<socket> }
const okGroup = (s) => typeof s === 'string' && /^[A-Za-z0-9]{10,64}$/.test(s);
const okGif = (u) => typeof u === 'string' && u.length < 300 && /^https:\/\/media\d*\.giphy\.com\/media\/(?:[\w.-]+\/)?[\w-]+\/[\w.-]+\.gif(\?[\w=&.-]*)?$/.test(u);
const KEEP_MS = 12 * 3600 * 1000, KEEP_N = 200;
const chatOf = (id) => { let c = chats.get(id); if (!c) { c = { msgs: [], subs: new Set() }; chats.set(id, c); } return c; };
function chatConnection(ws, q) {
  const uid = q.get('uid'), name = String(q.get('name') || 'Friend').replace(/[\u0000-\u001f]/g, '').slice(0, 30);
  if (!okUid(uid)) return ws.close(4000, 'bad');
  ws.alive = true; ws.on('pong', () => { ws.alive = true; }); ws.groups = new Set();
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
    if (m.t === 'join' && Array.isArray(m.groups)) {
      for (const g of m.groups.filter(okGroup).slice(0, 100)) {
        if (ws.groups.has(g)) continue; ws.groups.add(g); const c = chatOf(g); c.subs.add(ws);
        const now = Date.now(); c.msgs = c.msgs.filter((x) => now - x.at < KEEP_MS);
        ws.send(JSON.stringify({ t: 'history', groupId: g, msgs: c.msgs }));
      }
    } else if (m.t === 'msg' && ws.groups.has(m.groupId)) {
      const text = typeof m.text === 'string' ? m.text.slice(0, 500) : '', gifUrl = okGif(m.gifUrl) ? m.gifUrl : undefined;
      if (!text && !gifUrl) return;
      const msg = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), groupId: m.groupId, senderId: uid, senderName: name, text, gifUrl, at: Date.now() };
      const c = chatOf(m.groupId); c.msgs.push(msg); if (c.msgs.length > KEEP_N) c.msgs.splice(0, c.msgs.length - KEEP_N);
      const out = JSON.stringify({ t: 'msg', msg }); for (const sub of c.subs) if (sub.readyState === 1) sub.send(out);
    }
  });
  ws.on('close', () => { for (const g of ws.groups) { const c = chats.get(g); if (c) c.subs.delete(ws); } });
}

wss.on('connection', (ws, req) => {
  if (new URL(req.url, 'http://x').pathname === '/chat') return chatConnection(ws, new URL(req.url, 'http://x').searchParams);
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
    const s=String(data);
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
