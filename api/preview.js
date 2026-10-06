// Link previews: GET /api/preview?url=https://… → { title, description, image, site }
//
// A browser can't read another site's page (CORS), so the chat asks this
// little server function to fetch the page and pick out its title, blurb and
// picture (the Open Graph tags, falling back to <title>). Runs on Vercel.
//
// It fetches whatever address it's handed, so it is careful about where it
// goes: http(s) only, ordinary ports, and never an address inside a private
// network (checked for the link and again for every redirect). It reads at
// most MAX_BYTES and gives up after TIMEOUT_MS.
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 400 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
// the local test server sets this so tests can preview a page it serves itself
const ALLOW_LOCAL = process.env.PREVIEW_ALLOW_LOCAL === '1';

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8')
    || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff');
}

async function checkedUrl(raw) {
  let url;
  try { url = new URL(raw); } catch (e) { throw new Error('bad url'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
  if (url.username || url.password) throw new Error('bad url');
  if (ALLOW_LOCAL) return url;
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('bad port');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error('private address');
  return url;
}

async function fetchPage(raw) {
  let url = await checkedUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; ChatClubLinkPreview/1.0)', accept: 'text/html,application/xhtml+xml,image/*;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = await checkedUrl(new URL(res.headers.get('location'), url).href);
        continue;
      }
      if (!res.ok) throw new Error('status ' + res.status);
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (type.startsWith('image/')) return { url, image: true };
      if (!type.includes('html')) throw new Error('not a page');
      // read no more than MAX_BYTES of it
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      while (size < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
      reader.cancel().catch(() => {});
      return { url, html: Buffer.concat(chunks).toString('utf8') };
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16) || 32))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10) || 32))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// the content of the first <meta> whose property/name is one of `names`
function meta(html, names) {
  for (const name of names) {
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      const key = (tag.match(/\b(?:property|name)\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      if (!key || key.toLowerCase() !== name) continue;
      const content = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
      if (content) return decodeEntities(content).trim();
    }
  }
  return '';
}

function clip(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function absoluteHttpUrl(value, base) {
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch (e) { return ''; }
}

module.exports = async (req, res) => {
  const raw = (req.query && req.query.url) || new URL(req.url, 'http://x').searchParams.get('url') || '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!raw || raw.length > 2000) { res.statusCode = 400; res.end('{"error":"bad url"}'); return; }
  try {
    const page = await fetchPage(raw);
    const site = page.url.hostname.replace(/^www\./, '');
    let out;
    if (page.image) {
      out = { title: '', description: '', image: page.url.href, site };
    } else {
      const head = page.html;
      const title = meta(head, ['og:title', 'twitter:title']) || decodeEntities((head.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
      out = {
        title: clip(title, 140),
        description: clip(meta(head, ['og:description', 'twitter:description', 'description']), 220),
        image: absoluteHttpUrl(meta(head, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']), page.url),
        site: clip(meta(head, ['og:site_name']) || site, 60),
      };
    }
    // the same link is asked for by everyone in the chat: let Vercel's cache answer the rest
    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=600, max-age=300');
    res.statusCode = 200;
    res.end('{"error":"no preview"}');
  }
};
