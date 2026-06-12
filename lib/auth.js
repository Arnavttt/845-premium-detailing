// Password auth (scrypt, Node built-in) + cookie sessions persisted to disk
// so the owner stays logged in across server restarts.
const crypto = require('crypto');
const store = require('./store');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password) {
  const auth = store.read('auth', null);
  if (!auth || typeof password !== 'string' || password.length === 0) return false;
  const candidate = Buffer.from(crypto.scryptSync(password, auth.salt, 64));
  const stored = Buffer.from(auth.hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function setPassword(password) {
  const { salt, hash } = hashPassword(password);
  store.write('auth', { salt, hash, updated: new Date().toISOString() });
}

// Seeds the password file on first boot. Returns true if it was created.
function ensurePassword(defaultPassword) {
  if (store.exists('auth')) return false;
  setPassword(defaultPassword);
  return true;
}

function loadSessions() {
  const sessions = store.read('sessions', {});
  const now = Date.now();
  let changed = false;
  for (const token of Object.keys(sessions)) {
    if (!sessions[token] || sessions[token].expires < now) {
      delete sessions[token];
      changed = true;
    }
  }
  if (changed) store.write('sessions', sessions);
  return sessions;
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = loadSessions();
  sessions[token] = { created: Date.now(), expires: Date.now() + SESSION_TTL_MS };
  store.write('sessions', sessions);
  return token;
}

function validSession(token) {
  if (!token || typeof token !== 'string') return false;
  const session = loadSessions()[token];
  return !!(session && session.expires > Date.now());
}

function destroySession(token) {
  const sessions = loadSessions();
  if (token in sessions) {
    delete sessions[token];
    store.write('sessions', sessions);
  }
}

module.exports = {
  verifyPassword,
  setPassword,
  ensurePassword,
  createSession,
  validSession,
  destroySession,
  SESSION_TTL_MS
};
