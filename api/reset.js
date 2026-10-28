// Setting a new password after the admin said yes: POST /api/reset
//   { id, secret, password }  →  { ok: true }  or  { error: "…" }
//
// Chat Club accounts have no real email unless one was added, so a forgotten
// password can't be reset by email. Instead (see "Forgot password" in
// index.html):
//   1. The person leaves a request: their name, and the SHA-256 of a secret
//      that stays in their browser.
//   2. The admin gets a notification and presses Allow (or Deny).
//   3. That same browser — the only one holding the secret — sends the new
//      password here, and this function sets it.
// Only this function can change someone else's password, which is why it
// needs the project's service account (FIREBASE_SERVICE_ACCOUNT, set in
// Vercel; never in the repo). Against the local emulators it needs nothing.
const crypto = require('crypto');

const PROJECT = 'school-chat-9e4d8';
const NAME_AUTH_DOMAIN = 'chatclub.local';
const ADMIN_AUTH_EMAIL = 'huey@' + NAME_AUTH_DOMAIN; // never reset this way
const ALLOWED_FOR_MS = 24 * 60 * 60 * 1000; // an Allow is good for a day
const MAX_TRIES = 5;
const RELAY_HTTP = 'https://dust-crawler-relay.onrender.com';

let admin = null;
function getAdmin() {
  if (admin) return admin;
  const lib = require('firebase-admin');
  if (!lib.apps.length) {
    if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      lib.initializeApp({ projectId: PROJECT });
    } else {
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
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 4000) req.destroy(); });
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
  // either the asking browser (with its secret), or huey picking the password for them (adminToken)
  // (relay: the request was left on the relay, because Firebase had run out for the day)
  const { id, secret, password, adminToken, relay } = await readBody(req);
  const byAdmin = typeof adminToken === 'string' && adminToken.length > 20 && adminToken.length < 5000;
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(id)
    || (!byAdmin && (typeof secret !== 'string' || secret.length < 20 || secret.length > 200))
    || typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return send(400, { error: 'Please use a password with at least 6 characters.' });
  }

  let lib;
  try {
    lib = getAdmin();
  } catch (e) {
    // why, for whoever is setting it up (never anything from the key itself)
    const why = e.message === 'not set up' ? 'no key' : e.code === 'MODULE_NOT_FOUND' ? 'library missing'
      : e instanceof SyntaxError ? 'the key is not valid JSON' : 'the key was not accepted';
    return send(503, { error: 'Password resets are not switched on yet. Ask huey.', why });
  }

  try {
    let ref;
    if (relay === true) {
      // the same steps, with the request kept on the relay (the address is fixed here, never taken from the request)
      const base = process.env.FIRESTORE_EMULATOR_HOST ? (process.env.RESET_RELAY_HTTP || 'http://127.0.0.1:10779') : RELAY_HTTP;
      const done = (status) => fetch(`${base}/reset-done?id=${encodeURIComponent(id)}&status=${status}`, { method: 'POST' }).catch(() => {});
      ref = { get: async () => { const r = await fetch(`${base}/reset-req?id=${encodeURIComponent(id)}`); const d = r.ok ? await r.json() : null; return { exists: !!d, data: () => d && { ...d, allowedAt: d.allowedAt ? { toMillis: () => d.allowedAt } : null } }; },
        delete: () => done('done'), update: (u) => u.status === 'set' ? done('set') : Promise.resolve() };
    } else ref = lib.firestore().collection('resetRequests').doc(id);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : null;
    if (!data) return send(400, { error: 'That request has expired. Tap Forgot password to ask again.' });
    if (byAdmin) {
      let who = null;
      try { who = await lib.auth().verifyIdToken(adminToken); } catch (e) { /* not valid */ }
      if (!who || who.email !== ADMIN_AUTH_EMAIL) return send(403, { error: 'Only huey can do that.' });
      if (data.status !== 'pending' && data.status !== 'allowed') return send(400, { error: 'That request was already answered.' });
    } else if (data.status !== 'allowed') return send(400, { error: 'huey has not allowed this yet.' });
    const allowedAt = data.allowedAt && data.allowedAt.toMillis ? data.allowedAt.toMillis() : 0;
    if (!byAdmin && (!allowedAt || Date.now() - allowedAt > ALLOWED_FOR_MS)) {
      await ref.delete();
      return send(400, { error: 'That request has expired. Tap Forgot password to ask again.' });
    }

    // only the browser that asked holds the secret
    const given = byAdmin ? null : crypto.createHash('sha256').update(secret).digest();
    const wanted = Buffer.from(String(data.keyHash || ''), 'hex');
    if (!byAdmin && (wanted.length !== given.length || !crypto.timingSafeEqual(given, wanted))) {
      const tries = (data.tries || 0) + 1;
      if (tries >= MAX_TRIES) await ref.delete(); else await ref.update({ tries });
      return send(400, { error: 'This device did not make that request. Tap Forgot password to ask again.' });
    }

    const email = String(data.name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') + '@' + NAME_AUTH_DOMAIN;
    if (email === ADMIN_AUTH_EMAIL || email === '@' + NAME_AUTH_DOMAIN) {
      await ref.delete();
      return send(400, { error: 'That account cannot be reset this way.' });
    }
    let user;
    try {
      user = await lib.auth().getUserByEmail(email);
    } catch (e) { user = null; }
    if (!user) {
      // not found by the made-up address (e.g. they added a real email, which replaces it): look for the
      // account whose name is the one they typed
      const want = String(data.name || '').trim().toLowerCase(), slug = want.replace(/[^a-z0-9]/g, '');
      let page;
      do {
        page = await lib.auth().listUsers(1000, page && page.pageToken);
        const found = page.users.filter((u) => u.displayName && (u.displayName.trim().toLowerCase() === want || u.displayName.toLowerCase().replace(/[^a-z0-9]/g, '') === slug));
        if (found.length === 1) user = found[0];
      } while (!user && page.pageToken);
      if (user && user.email === ADMIN_AUTH_EMAIL) user = null;
    }
    if (!user) {
      return send(400, { error: 'There is no account with that name (or it logs in with an email: use that to reset it).' });
    }
    await lib.auth().updateUser(user.uid, { password });
    await lib.auth().revokeRefreshTokens(user.uid); // signs out anywhere the old password was in use
    // huey's way: leave the request marked "set" so the asking browser can say so (tidied away later)
    if (byAdmin) await ref.update({ status: 'set' }); else await ref.delete();
    // (an account that logs in with an email it added can't log in by name: tell them, not which email)
    return send(200, { ok: true, useEmail: !String(user.email || '').endsWith('@' + NAME_AUTH_DOMAIN) });
  } catch (e) {
    return send(500, { error: 'Something went wrong. Please try again.' });
  }
};
