// DUST CRAWLER RELAY: when two players' internet won't let them connect straight to each other, the game sends its
// messages here instead and this passes them on to everyone else in the same room. It keeps nothing: rooms exist only
// while their host is connected. Open / to check it's awake.
const http = require('http');
const { WebSocketServer } = require('ws');

const rooms = new Map();                     // code -> { host: socket, clients: Set<socket> }
const ok = (s) => /^[A-Z]{4}$/.test(s), okId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 80;
const MAX_ROOMS = 200, MAX_PER_ROOM = 12, MAX_MSG = 8000;

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('dust crawler relay ok, ' + rooms.size + ' rooms'); });
const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });

wss.on('connection', (ws, req) => {
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
  ws.on('message', (data) => { const s = String(data); for (const c of room.clients) if (c !== ws && c.readyState === 1) c.send(s); });     // pass it on to the others
  ws.on('close', () => {
    room.clients.delete(ws);
    if (room.host === ws) { for (const c of room.clients) { try { c.send(JSON.stringify({ t: 'host-left' })); c.close(); } catch (e) {} } rooms.delete(code); }
    else { const bye = JSON.stringify({ t: 'bye', id }); for (const c of room.clients) if (c.readyState === 1) c.send(bye); }
  });
});
// drop connections that have silently died
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 25000);

server.listen(process.env.PORT || 10000, () => console.log('relay listening'));
