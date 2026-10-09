import crypto from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { KDF_PARAMS, deriveKeys, open, safeEqual, seal } from '../crypto.js';
import { q, tx } from '../db.js';
import { cookieOptions, createLimiter, currentSession, parseCookies, rateLimit, requireAdmin, requireAuth, retryMessage } from '../security.js';
import * as S from '../sessions.js';
import { base32Encode, hashRecovery, newRecoveryCodes, newTotpSecret, totpUri, verifyTotp } from '../totp.js';
import { HttpError, bad, notFound, secret, str, username as validUsername } from '../validate.js';

export const setupToken = { value: null };

const WINDOW = 15 * 60_000;
const loginLimiter = createLimiter({ windowMs: WINDOW, max: 10 });
const twoFaLimiter = createLimiter({ windowMs: WINDOW, max: 10 });
const setupLimiter = createLimiter({ windowMs: WINDOW, max: 10 });
const confirmLimiter = createLimiter({ windowMs: WINDOW, max: 10 });

const LOCK_AFTER = 20;
const LOCK_MS = 15 * 60_000;
const MIN_PASSWORD = 10;

const firstUser = () => q('SELECT * FROM users ORDER BY id LIMIT 1').get();
const userById = (id) => q('SELECT * FROM users WHERE id = ?').get(id);

// Для несуществующего логина всё равно считаем Argon2 — чтобы по времени ответа нельзя было подобрать логин.
const dummySalt = crypto.randomBytes(16);

/** Проверяет пароль и возвращает расшифрованный ключ данных (dek) или null. */
export async function unlock(user, password) {
  const keys = await deriveKeys(password, Buffer.from(user.kdf_salt), JSON.parse(user.kdf_params));
  try {
    if (!safeEqual(keys.auth, Buffer.from(user.auth_hash))) return null;
    return open(keys.kek, user.wrapped_dek, 'dek');
  } finally {
    keys.auth.fill(0);
    keys.kek.fill(0);
  }
}

export async function wrapForPassword(password, dek) {
  const salt = crypto.randomBytes(16);
  const keys = await deriveKeys(password, salt);
  const wrapped = { salt, params: JSON.stringify(KDF_PARAMS), auth: keys.auth, dek: seal(keys.kek, dek, 'dek') };
  keys.kek.fill(0);
  return wrapped;
}

export function passwordPolicy(value, name = 'Пароль') {
  const pw = secret(value, name, { required: true, min: MIN_PASSWORD, max: 256 });
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|qwertyuiop|password\d*)$/i.test(pw)) throw bad('Пароль слишком простой');
  return pw;
}

function tooMany(res, seconds) {
  res.set('Retry-After', String(seconds));
  return res.status(429).json({ error: retryMessage(seconds) });
}

/** Повторное подтверждение паролем для опасных действий. */
export async function confirmPassword(req, value) {
  const key = `${req.session.id}`;
  const retry = confirmLimiter.check(key);
  if (retry) throw new HttpError(429, retryMessage(retry));
  const password = secret(value, 'Пароль', { required: true, max: 256 });
  const dek = await unlock(userById(req.session.userId), password);
  if (!dek) {
    confirmLimiter.hit(key);
    audit('confirm_fail', req);
    throw new HttpError(403, 'Неверный пароль');
  }
  dek.fill(0);
}

function startSession(req, res, user, dek) {
  const { token } = S.createSession(user, dek, req);
  res.cookie(S.SESSION_COOKIE, token, cookieOptions(req));
  q('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
}

const router = express.Router();

router.get('/state', (req, res) => {
  res.json({
    setup: !firstUser(),
    authenticated: Boolean(currentSession(req, false)),
    pending2fa: Boolean(S.getPending(parseCookies(req)[S.PENDING_COOKIE])),
  });
});

router.post('/setup', rateLimit(setupLimiter), async (req, res) => {
  if (firstUser()) throw new HttpError(409, 'Администратор уже создан');
  const token = str(req.body?.token, 'Токен установки', { required: true, max: 100 }).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!setupToken.value || !safeEqual(token, setupToken.value.replace(/-/g, ''))) {
    audit('setup_fail', req);
    throw new HttpError(403, 'Неверный токен установки. Он выведен в консоли, где запущен сервер.');
  }
  const name = validUsername(req.body.username);
  const password = passwordPolicy(req.body.password);
  const dek = crypto.randomBytes(32);
  const w = await wrapForPassword(password, dek);
  const now = Date.now();
  const id = tx(() => {
    if (firstUser()) throw new HttpError(409, 'Администратор уже создан');
    return q(`INSERT INTO users (username, kdf_salt, kdf_params, auth_hash, wrapped_dek, created_at, password_changed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(name, w.salt, w.params, w.auth, w.dek, now, now).lastInsertRowid;
  });
  setupToken.value = null;
  startSession(req, res, userById(id), dek);
  audit('setup', req, name, name);
  res.json({ ok: true });
});

router.post('/login', async (req, res) => {
  const retry = loginLimiter.check(req.ip);
  if (retry) return tooMany(res, retry);

  const name = typeof req.body?.username === 'string' ? req.body.username.trim().slice(0, 64) : '';
  const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 256) : '';
  if (!name || !password) throw bad('Введите логин и пароль');

  const fail = () => {
    loginLimiter.hit(req.ip);
    audit('login_fail', req, name.slice(0, 32));
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  };

  const user = q('SELECT * FROM users WHERE username = ?').get(name);
  if (!user) {
    await deriveKeys(password, dummySalt);
    return fail();
  }
  if (user.locked_until > Date.now()) {
    loginLimiter.hit(req.ip);
    audit('login_locked', req, user.username);
    return res.status(429).json({ error: 'Вход временно заблокирован из-за множества неудачных попыток. Попробуйте через 15 минут.' });
  }

  const dek = await unlock(user, password);
  if (!dek) {
    const failed = user.failed_logins + 1;
    const lock = failed >= LOCK_AFTER;
    q('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock ? Date.now() + LOCK_MS : 0, user.id);
    return fail();
  }
  q('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(user.id);
  // Пароль верный — можно честно сообщить о блокировке, это не раскрывает существование логина.
  if (user.disabled) {
    dek.fill(0);
    loginLimiter.hit(req.ip);
    audit('login_disabled', req, user.username, user.username);
    return res.status(403).json({ error: 'Профиль заблокирован администратором' });
  }

  if (user.totp_secret) {
    const token = S.createPending(user, dek);
    res.cookie(S.PENDING_COOKIE, token, cookieOptions(req, 5 * 60_000));
    return res.json({ ok: true, need2fa: true });
  }
  loginLimiter.reset(req.ip);
  startSession(req, res, user, dek);
  audit('login_ok', req, user.username, user.username);
  res.json({ ok: true });
});

router.post('/2fa', async (req, res) => {
  const retry = twoFaLimiter.check(req.ip);
  if (retry) return tooMany(res, retry);

  const token = parseCookies(req)[S.PENDING_COOKIE];
  const pending = S.getPending(token);
  if (!pending) return res.status(401).json({ error: 'Время на ввод кода истекло. Войдите заново.', code: 'PENDING' });

  const user = userById(pending.userId);
  const code = String(req.body?.code ?? '').replace(/[\s-]/g, '').toUpperCase().slice(0, 20);
  let ok = false;
  let recoveryLeft;

  if (/^\d{6}$/.test(code)) {
    const totpSecret = open(pending.dek, user.totp_secret, 'totp');
    const step = verifyTotp(totpSecret, code, user.totp_last_step);
    totpSecret.fill(0);
    if (step) {
      q('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
      ok = true;
    }
  } else if (code.length === 10) {
    const hashes = JSON.parse(user.recovery_codes || '[]');
    const hash = hashRecovery(code);
    const idx = hashes.findIndex((h) => safeEqual(h, hash));
    if (idx >= 0) {
      hashes.splice(idx, 1);
      q('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(hashes), user.id);
      ok = true;
      recoveryLeft = hashes.length;
    }
  }

  if (!ok) {
    twoFaLimiter.hit(req.ip);
    pending.attempts++;
    audit('2fa_fail', req, user.username);
    if (pending.attempts >= 5) {
      S.dropPending(token);
      res.clearCookie(S.PENDING_COOKIE, cookieOptions(req));
      return res.status(401).json({ error: 'Слишком много неверных кодов. Войдите заново.', code: 'PENDING' });
    }
    return res.status(401).json({ error: 'Неверный код' });
  }

  const { dek } = S.takePending(token);
  res.clearCookie(S.PENDING_COOKIE, cookieOptions(req));
  loginLimiter.reset(req.ip);
  twoFaLimiter.reset(req.ip);
  startSession(req, res, user, dek);
  audit(recoveryLeft === undefined ? 'login_ok' : 'recovery_used', req, user.username, user.username);
  res.json({ ok: true, recoveryLeft });
});

router.post('/logout', requireAuth, (req, res) => {
  audit('logout', req, req.session.username);
  S.destroySession(req.session);
  res.clearCookie(S.SESSION_COOKIE, cookieOptions(req));
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = userById(req.session.userId);
  res.json({
    id: user.id,
    username: user.username,
    role: req.session.role,
    csrf: req.session.csrf,
    totp: Boolean(user.totp_secret),
    recoveryLeft: user.recovery_codes ? JSON.parse(user.recovery_codes).length : 0,
    passwordChangedAt: user.password_changed_at,
    createdAt: user.created_at,
    idleMinutes: Math.round(config.sessionIdleMs / 60_000),
  });
});

router.post('/password', requireAuth, requireAdmin, async (req, res) => {
  const next = passwordPolicy(req.body?.next, 'Новый пароль');
  await confirmPassword(req, req.body?.current);
  const w = await wrapForPassword(next, req.session.dek);
  q('UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, wrapped_dek = ?, password_changed_at = ? WHERE id = ?')
    .run(w.salt, w.params, w.auth, w.dek, Date.now(), req.session.userId);
  S.destroyUserSessions(req.session.userId, req.session);
  audit('password_change', req);
  res.json({ ok: true });
});

router.post('/totp/setup', requireAuth, requireAdmin, async (req, res) => {
  const totpSecret = newTotpSecret();
  req.session.totpDraft = { secret: totpSecret, expires: Date.now() + 10 * 60_000 };
  const svg = await QRCode.toString(totpUri(totpSecret, req.session.username), {
    type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' },
  });
  res.json({
    qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    secret: base32Encode(totpSecret).match(/.{1,4}/g).join(' '),
  });
});

router.post('/totp/enable', requireAuth, requireAdmin, (req, res) => {
  const draft = req.session.totpDraft;
  if (!draft || draft.expires < Date.now()) throw bad('Время настройки истекло — начните заново');
  const step = verifyTotp(draft.secret, String(req.body?.code ?? '').replace(/\s/g, ''), 0);
  if (!step) throw bad('Неверный код. Проверьте, что время на телефоне точное.');
  const codes = newRecoveryCodes();
  q('UPDATE users SET totp_secret = ?, totp_last_step = ?, recovery_codes = ? WHERE id = ?')
    .run(seal(req.session.dek, draft.secret, 'totp'), step, JSON.stringify(codes.map(hashRecovery)), req.session.userId);
  draft.secret.fill(0);
  delete req.session.totpDraft;
  audit('totp_enable', req);
  res.json({ ok: true, recoveryCodes: codes });
});

router.post('/totp/disable', requireAuth, requireAdmin, async (req, res) => {
  await confirmPassword(req, req.body?.password);
  q('UPDATE users SET totp_secret = NULL, totp_last_step = 0, recovery_codes = NULL WHERE id = ?').run(req.session.userId);
  audit('totp_disable', req);
  res.json({ ok: true });
});

router.post('/recovery', requireAuth, requireAdmin, async (req, res) => {
  await confirmPassword(req, req.body?.password);
  if (!userById(req.session.userId).totp_secret) throw bad('Сначала включите 2FA');
  const codes = newRecoveryCodes();
  q('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes.map(hashRecovery)), req.session.userId);
  audit('recovery_regen', req);
  res.json({ ok: true, recoveryCodes: codes });
});

router.get('/sessions', requireAuth, requireAdmin, (req, res) => {
  res.json(S.listSessions()
    .map((s) => ({
      id: s.id, username: s.username, role: s.role, ip: s.ip, ua: s.ua,
      createdAt: s.createdAt, lastSeen: s.lastSeen, current: s === req.session,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeen - a.lastSeen));
});

router.delete('/sessions/:id', requireAuth, requireAdmin, (req, res) => {
  const target = S.findSessionById(String(req.params.id));
  if (!target) throw notFound('Сессия не найдена');
  S.destroySession(target);
  audit('session_revoke', req, `${target.username} · ${target.ip}`);
  res.json({ ok: true });
});

export default router;
