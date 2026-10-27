// GIF search: GET /api/gifs?q=dog  (no q = what's trending) → { gifs: [{ id, preview, url, w, h }] }
//
// Asks GIPHY, keeping its key on the server (GIPHY_API_KEY, set in Vercel; never
// in the repo), and only ever asks for rating "g" GIFs: Chat Club is for kids.
// Only GIPHY's own picture addresses are handed back, so the chat only ever
// shows pictures from there.
const TIMEOUT_MS = 6000;
const isGiphyMedia = (u) => typeof u === 'string' && /^https:\/\/media\d*\.giphy\.com\/media\/(?:[\w.-]+\/)?[\w-]+\/[\w.-]+\.gif(\?[\w=&.-]*)?$/.test(u);

module.exports = async (req, res) => {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', status === 200 ? 'public, max-age=300' : 'no-store');
    res.end(JSON.stringify(body));
  };
  const key = process.env.GIPHY_API_KEY;
  if (!key) return send(503, { error: 'GIF search is not switched on yet. Ask huey.' });
  const url = new URL(req.url, 'http://x');
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 60);
  const offset = Math.max(0, Math.min(200, parseInt(url.searchParams.get('offset'), 10) || 0));
  const api = new URL(q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
  api.searchParams.set('api_key', key);
  if (q) api.searchParams.set('q', q);
  api.searchParams.set('limit', '24');
  api.searchParams.set('offset', String(offset));
  api.searchParams.set('rating', 'g');
  api.searchParams.set('lang', 'en');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(api, { signal: ctl.signal });
    if (!r.ok) return send(502, { error: 'GIPHY didn\'t answer. Try again in a bit.' });
    const data = await r.json();
    const gifs = (data.data || []).map((g) => {
      const im = g.images || {}, small = im.fixed_width_small || im.fixed_width || {}, big = im.fixed_height || im.downsized || {};
      return { id: String(g.id || ''), preview: small.url, url: big.url, w: Number(big.width) || 0, h: Number(big.height) || 0 };
    }).filter((g) => isGiphyMedia(g.preview) && isGiphyMedia(g.url));
    return send(200, { gifs });
  } catch (e) {
    return send(502, { error: 'Couldn\'t reach GIPHY. Try again in a bit.' });
  } finally {
    clearTimeout(timer);
  }
};
module.exports.isGiphyMedia = isGiphyMedia;
