// huey (the admin) deleting any chat, even one someone else made: POST /api/delete-group
//   { groupId, adminToken }  →  { ok: true }  or  { error: "…" }
// The database rules only let a chat's owner delete it, so this does it with the project's service account
// (FIREBASE_SERVICE_ACCOUNT, set in Vercel, never in the repo), after checking the login really is huey's.
const PROJECT = 'school-chat-9e4d8';
const ADMIN_AUTH_EMAIL = 'huey@chatclub.local';

let admin = null;
function getAdmin() {
  if (admin) return admin;
  const lib = require('firebase-admin');
  if (!lib.apps.length) {
    if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) lib.initializeApp({ projectId: PROJECT });
    else {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('not set up');
      lib.initializeApp({ credential: lib.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
  }
  admin = lib;
  return admin;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 8000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, { error: 'POST only' });
  const { groupId, adminToken } = await readBody(req);
  if (typeof groupId !== 'string' || !/^[A-Za-z0-9]{10,64}$/.test(groupId) || typeof adminToken !== 'string' || adminToken.length > 5000) {
    return send(400, { error: 'Bad request.' });
  }
  let lib;
  try { lib = getAdmin(); } catch (e) { return send(503, { error: 'Not switched on yet.' }); }
  try {
    let who = null;
    try { who = await lib.auth().verifyIdToken(adminToken); } catch (e) { /* not valid */ }
    if (!who || who.email !== ADMIN_AUTH_EMAIL) return send(403, { error: 'Only huey can do that.' });
    await lib.firestore().collection('groups').doc(groupId).delete();
    return send(200, { ok: true });
  } catch (e) {
    return send(500, { error: 'Something went wrong. Please try again.' });
  }
};
