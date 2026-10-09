import { config } from './config.js';
import { randomToken, sha256 } from './crypto.js';

/*
 * Сессии хранятся только в памяти: в них лежит ключ расшифровки (dek).
 * Перезапуск процесса = выход всех пользователей и стирание ключей.
 * В Map ключом служит sha256(токена) — сам токен есть только в cookie браузера.
 */

export const SESSION_COOKIE = 'sv_session';
export const PENDING_COOKIE = 'sv_2fa';
const PENDING_TTL = 5 * 60_000;

const sessions = new Map();
const pending = new Map();

function wipe(entry) {
  entry.dek?.fill(0);
  entry.dek = null;
}

function expired(s, now) {
  return now - s.lastSeen > config.sessionIdleMs || now - s.createdAt > config.sessionMaxMs;
}

export function createSession(user, dek, req) {
  const token = randomToken(32);
  const now = Date.now();
  const session = {
    key: sha256(token),
    id: randomToken(9),
    userId: user.id,
    username: user.username,
    dek,
    csrf: randomToken(24),
    createdAt: now,
    lastSeen: now,
    ip: req.ip,
    ua: String(req.get('user-agent') || '').slice(0, 200),
  };
  sessions.set(session.key, session);
  return { token, session };
}

/** touch=false — фоновые запросы (опрос статуса) не продлевают сессию. */
export function getSession(token, touch = true) {
  if (!token) return null;
  const s = sessions.get(sha256(token));
  if (!s) return null;
  const now = Date.now();
  if (expired(s, now)) {
    destroySession(s);
    return null;
  }
  if (touch) s.lastSeen = now;
  return s;
}

export function destroySession(s) {
  if (!s) return;
  wipe(s);
  sessions.delete(s.key);
}

export function destroyUserSessions(userId, keep = null) {
  for (const s of [...sessions.values()]) if (s.userId === userId && s !== keep) destroySession(s);
}

export function listSessions(userId) {
  return [...sessions.values()].filter((s) => s.userId === userId);
}

export function findSessionById(userId, id) {
  return listSessions(userId).find((s) => s.id === id) || null;
}

export function createPending(user, dek) {
  const token = randomToken(32);
  pending.set(sha256(token), { userId: user.id, dek, attempts: 0, expires: Date.now() + PENDING_TTL });
  return token;
}

export function getPending(token) {
  if (!token) return null;
  const key = sha256(token);
  const p = pending.get(key);
  if (!p) return null;
  if (p.expires < Date.now()) {
    wipe(p);
    pending.delete(key);
    return null;
  }
  return p;
}

/** Забирает dek из ожидающего входа (без затирания) и удаляет запись. */
export function takePending(token) {
  const key = sha256(token);
  const p = pending.get(key);
  pending.delete(key);
  return p;
}

export function dropPending(token) {
  const key = sha256(token);
  const p = pending.get(key);
  if (p) wipe(p);
  pending.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const s of [...sessions.values()]) if (expired(s, now)) destroySession(s);
  for (const [key, p] of pending) if (p.expires < now) { wipe(p); pending.delete(key); }
}, 60_000).unref();
