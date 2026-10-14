// Passkeys: log in with the device's own lock (Face ID / Touch ID on Apple devices, Windows Hello
// face/fingerprint/PIN on Windows) instead of typing a password. POST /api/passkey
//
//   { action: "register-options", idToken }            → options for the browser to make a passkey
//   { action: "register", idToken, ticket, response }  → saves it          → { ok: true }
//   { action: "login-options" }                        → options for the browser to use a passkey
//   { action: "login", ticket, response }              → { token } for signInWithCustomToken
//
// The device keeps the private key and only unlocks it after its own face/finger/PIN check; this
// function keeps the matching public key in Firestore (passkeys/{credential id}, which the
// security rules let nobody read or write from the page) and checks each login is signed by it.
// Challenges aren't stored: each one travels in a "ticket" signed by this function, good for 5 min.
// Needs the same service account as reset.js (FIREBASE_SERVICE_ACCOUNT, set in Vercel).
const crypto = require('crypto');

const PROJECT = 'school-chat-9e4d8';
const SITE_HOST = 'chat-club-one.vercel.app';
const TICKET_MS = 5 * 60 * 1000;
const MAX_PER_USER = 10;

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
const emulated = () => !!(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);

// The site's own address, or a local one while testing against the emulators.
function siteOf(req) {
  let url;
  try { url = new URL(req.headers.origin || ''); } catch (e) { return null; }
  if (url.protocol === 'https:' && url.hostname === SITE_HOST) return { origin: url.origin, rpID: SITE_HOST };
  if (emulated() && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return { origin: url.origin, rpID: url.hostname };
  return null;
}

function ticketKey() {
  const secret = emulated() ? 'emulator' : process.env.FIREBASE_SERVICE_ACCOUNT;
  return crypto.createHash('sha256').update('passkey-ticket:' + secret).digest();
}
function makeTicket(data) {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + TICKET_MS })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', ticketKey()).update(body).digest('base64url');
}
function readTicket(ticket) {
  if (typeof ticket !== 'string' || ticket.length > 2000) return null;
  const [body, mac] = ticket.split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', ticketKey()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return data.exp > Date.now() ? data : null;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 20000) req.destroy(); });
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
  const site = siteOf(req);
  if (!site) return send(403, { error: 'Passkeys only work on the Chat Club site.' });
  const body = await readBody(req);

  let lib, webauthn;
  try {
    lib = getAdmin();
    webauthn = await import('@simplewebauthn/server');
  } catch (e) {
    return send(503, { error: 'Passkeys are not switched on yet.' });
  }
  const db = lib.firestore();

  try {
    if (body.action === 'register-options' || body.action === 'register') {
      // only for someone already logged in, adding a passkey to their own account
      const who = await lib.auth().verifyIdToken(String(body.idToken || '')).catch(() => null);
      if (!who) return send(401, { error: 'Please log in again first.' });

      if (body.action === 'register-options') {
        const existing = await db.collection('passkeys').where('uid', '==', who.uid).get();
        if (existing.size >= MAX_PER_USER) return send(400, { error: 'You already have the most passkeys allowed. Remove one first.' });
        const options = await webauthn.generateRegistrationOptions({
          rpName: 'Chat Club',
          rpID: site.rpID,
          userName: who.name || who.uid,
          userID: new TextEncoder().encode(who.uid),
          attestationType: 'none',
          excludeCredentials: existing.docs.map((d) => ({ id: d.id, transports: d.get('transports') || [] })),
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        });
        return send(200, { options, ticket: makeTicket({ c: options.challenge, uid: who.uid, kind: 'register' }) });
      }

      const ticket = readTicket(body.ticket);
      if (!ticket || ticket.kind !== 'register' || ticket.uid !== who.uid) return send(400, { error: 'That took too long. Please try again.' });
      const result = await webauthn.verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: ticket.c,
        expectedOrigin: site.origin,
        expectedRPID: site.rpID,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo) return send(400, { error: "That passkey couldn't be checked." });
      const cred = result.registrationInfo.credential;
      await db.collection('passkeys').doc(cred.id).set({
        uid: who.uid,
        publicKey: Buffer.from(cred.publicKey).toString('base64url'),
        counter: cred.counter || 0,
        transports: body.response?.response?.transports || [],
        device: result.registrationInfo.credentialDeviceType || '',
        createdAt: lib.firestore.FieldValue.serverTimestamp(),
      });
      return send(200, { ok: true });
    }

    if (body.action === 'login-options') {
      // no name needed: the device offers the passkeys it holds for this site
      const options = await webauthn.generateAuthenticationOptions({ rpID: site.rpID, userVerification: 'required' });
      return send(200, { options, ticket: makeTicket({ c: options.challenge, kind: 'login' }) });
    }

    if (body.action === 'login') {
      const ticket = readTicket(body.ticket);
      if (!ticket || ticket.kind !== 'login') return send(400, { error: 'That took too long. Please try again.' });
      const id = String(body.response?.id || '');
      if (!/^[A-Za-z0-9_-]{10,1400}$/.test(id)) return send(400, { error: "That passkey isn't one Chat Club knows." });
      const saved = await db.collection('passkeys').doc(id).get();
      if (!saved.exists) return send(400, { error: "That passkey isn't one Chat Club knows. It may have been removed." });
      const result = await webauthn.verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: ticket.c,
        expectedOrigin: site.origin,
        expectedRPID: site.rpID,
        requireUserVerification: true,
        credential: {
          id,
          publicKey: Buffer.from(saved.get('publicKey'), 'base64url'),
          counter: saved.get('counter') || 0,
          transports: saved.get('transports') || [],
        },
      });
      if (!result.verified) return send(400, { error: "That passkey couldn't be checked." });
      await saved.ref.update({ counter: result.authenticationInfo.newCounter, lastUsedAt: lib.firestore.FieldValue.serverTimestamp() });
      const token = await lib.auth().createCustomToken(saved.get('uid'));
      return send(200, { token });
    }

    return send(400, { error: 'Unknown action.' });
  } catch (e) {
    return send(400, { error: "That didn't work. Please try again." });
  }
};
