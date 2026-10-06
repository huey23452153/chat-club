// Minimal static file server for the test suite — serves the repo root on
// the given port (default 8934). Plain Node so tests don't need Python
// installed; equivalent to `python3 -m http.server 8934`.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 8934;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// The link-preview function runs on Vercel on the real site (api/preview.js).
// Here it's mounted at the same address, and allowed to fetch local pages so
// a test can preview a page this server serves.
process.env.PREVIEW_ALLOW_LOCAL = '1';
const preview = require('../api/preview.js');
// ...and the password-reset function, pointed at the local emulators.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const reset = require('../api/reset.js');

http.createServer((req, res) => {
  if (req.url.startsWith('/api/reset')) {
    reset(req, res);
    return;
  }
  if (req.url.startsWith('/api/preview')) {
    preview(req, res);
    return;
  }
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Serving ${ROOT} on http://localhost:${PORT}`));
