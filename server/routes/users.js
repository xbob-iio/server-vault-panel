import express from 'express';
import { audit } from '../audit.js';
import { q, tx } from '../db.js';
import * as S from '../sessions.js';
import { HttpError, bool, id as validId, notFound, username as validUsername } from '../validate.js';
import { confirmPassword, passwordPolicy, wrapForPassword } from './auth.js';

/*
 * Помощники. Каждому выдаётся своя копия ключа данных (dek), зашифрованная его паролем —
 * так же, как у администратора. Создать её можно только из сессии администратора,
 * где dek уже расшифрован. Что помощник может делать с серверами, решает routes/servers.js.
 */

const MAX_ASSISTANTS = 50;
const router = express.Router();

const COUNT_SERVERS = '(SELECT COUNT(*) FROM servers s WHERE s.owner_id = u.id) AS servers';

function toJson(u) {
  return {
    id: u.id,
    username: u.username,
    disabled: Boolean(u.disabled),
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    servers: u.servers ?? 0,
    online: S.hasActiveSession(u.id),
  };
}

function getAssistant(req) {
  const user = q(`SELECT u.*, ${COUNT_SERVERS} FROM users u WHERE u.id = ? AND u.role = 'assistant'`).get(validId(req.params.id));
  if (!user) throw notFound('Помощник не найден');
  return user;
}

router.get('/', (req, res) => {
  res.json(q(`SELECT u.*, ${COUNT_SERVERS} FROM users u WHERE u.role = 'assistant' ORDER BY u.created_at`).all().map(toJson));
});

router.post('/', async (req, res) => {
  const name = validUsername(req.body?.username);
  const password = passwordPolicy(req.body?.password, 'Пароль помощника');
  const taken = () => q('SELECT 1 FROM users WHERE username = ?').get(name);
  if (taken()) throw new HttpError(409, 'Такой логин уже занят');
  if (q("SELECT COUNT(*) AS n FROM users WHERE role = 'assistant'").get().n >= MAX_ASSISTANTS) {
    throw new HttpError(400, `Не больше ${MAX_ASSISTANTS} помощников`);
  }
  await confirmPassword(req, req.body?.adminPassword);

  const w = await wrapForPassword(password, req.session.dek);
  const now = Date.now();
  const id = tx(() => {
    if (taken()) throw new HttpError(409, 'Такой логин уже занят');
    return q(`INSERT INTO users (username, kdf_salt, kdf_params, auth_hash, wrapped_dek, created_at, password_changed_at, role, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'assistant', ?)`)
      .run(name, w.salt, w.params, w.auth, w.dek, now, now, req.session.userId).lastInsertRowid;
  });
  audit('assistant_create', req, name);
  res.status(201).json(toJson(q(`SELECT u.*, ${COUNT_SERVERS} FROM users u WHERE u.id = ?`).get(id)));
});

router.post('/:id/password', async (req, res) => {
  const user = getAssistant(req);
  const password = passwordPolicy(req.body?.password, 'Новый пароль');
  await confirmPassword(req, req.body?.adminPassword);
  const w = await wrapForPassword(password, req.session.dek);
  q(`UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, wrapped_dek = ?, password_changed_at = ?,
       failed_logins = 0, locked_until = 0 WHERE id = ?`).run(w.salt, w.params, w.auth, w.dek, Date.now(), user.id);
  S.destroyUserSessions(user.id);
  audit('assistant_password', req, user.username);
  res.json({ ok: true });
});

router.post('/:id/disabled', (req, res) => {
  const user = getAssistant(req);
  const disabled = bool(req.body?.disabled, true);
  q('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
  if (disabled) S.destroyUserSessions(user.id);
  audit(disabled ? 'assistant_disable' : 'assistant_enable', req, user.username);
  res.json(toJson({ ...user, disabled }));
});

router.delete('/:id', (req, res) => {
  const user = getAssistant(req);
  // Серверы удалённого помощника не теряются — они переходят администратору.
  tx(() => {
    q('UPDATE servers SET owner_id = ? WHERE owner_id = ?').run(req.session.userId, user.id);
    q('DELETE FROM users WHERE id = ?').run(user.id);
  });
  S.destroyUserSessions(user.id);
  audit('assistant_delete', req, user.servers ? `${user.username} (серверов передано: ${user.servers})` : user.username);
  res.json({ ok: true });
});

export default router;
