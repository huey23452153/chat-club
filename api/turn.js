// Call relay servers: GET /api/turn → { iceServers: [...] }
//
// Two people on different wifi usually can't connect a call straight to each
// other, so the sound and video go through a TURN server in the middle. This
// asks Cloudflare's TURN service for short-lived logins (its key stays here on
// the server: CF_TURN_KEY_ID and CF_TURN_API_TOKEN, set in Vercel, never in
// the repo). Without them it just hands back the free STUN servers, which only
// work when the two people's networks allow a direct connection.
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

module.exports = async (req, res) => {
  const send = (body) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  // Metered's free plan, with the username and password of one credential from its dashboard
  // (TURN Server → Credentials): TURN_USERNAME and TURN_PASSWORD
  const user = process.env.TURN_USERNAME, pass = process.env.TURN_PASSWORD;
  if (user && pass) {
    const urls = ['turn:global.relay.metered.ca:80', 'turn:global.relay.metered.ca:80?transport=tcp', 'turn:global.relay.metered.ca:443', 'turns:global.relay.metered.ca:443?transport=tcp'];
    return send({ iceServers: STUN.concat(urls.map((u) => ({ urls: u, username: user, credential: pass }))), turn: true });
  }
  // or (older Metered dashboards): METERED_APP (the name in yourname.metered.live) and METERED_API_KEY
  const app = process.env.METERED_APP, key = process.env.METERED_API_KEY;
  if (app && key) {
    try {
      const host = String(app).replace(/^https?:\/\//, '').replace(/\.metered\.live.*$/, '');
      const r = await fetch(`https://${encodeURIComponent(host)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
      const servers = r.ok ? await r.json() : [];
      if (Array.isArray(servers) && servers.length) return send({ iceServers: STUN.concat(servers), turn: true });
    } catch (e) { /* fall through */ }
  }
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return send({ iceServers: STUN, turn: false });
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 6 * 3600 }), // a login lasts 6 hours: long enough for any call
    });
    if (!r.ok) return send({ iceServers: STUN, turn: false });
    const data = await r.json();
    const servers = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    return send({ iceServers: STUN.concat(servers), turn: servers.length > 0 });
  } catch (e) {
    return send({ iceServers: STUN, turn: false });
  }
};
