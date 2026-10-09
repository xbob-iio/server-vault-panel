import express from 'express';
import { audit } from '../audit.js';
import { openText, sealText } from '../crypto.js';
import { PERIOD_MONTHS, addMonths } from '../dates.js';
import { q, tx } from '../db.js';
import { ensureIcon } from '../favicon.js';
import { checkServer, forgetServer } from '../monitor.js';
import {
  HttpError, bad, bool, domainOf, host, id as validId, isoDate, notFound, oneOf, port, price, secret, siteUrl, str,
} from '../validate.js';

export const KINDS = ['vds', 'vpn', 'dedicated', 'other'];
export const PERIODS = ['month', 'quarter', 'half', 'year', 'once'];
export const CURRENCIES = ['RUB', 'USD', 'EUR', 'USDT'];

const SELECT = `SELECT s.*, i.id AS icon_id, i.mime AS icon_mime, i.fetched_at AS icon_ver, u.username AS owner_name, u.role AS owner_role
                FROM servers s
                LEFT JOIN icons i ON i.domain = s.hosting_domain
                LEFT JOIN users u ON u.id = s.owner_id`;

/*
 * Права:
 *  - администратор — полный доступ ко всем серверам;
 *  - помощник видит все серверы, но логин, пароль и заметки — только у своих,
 *    и изменять / удалять / отмечать оплату может только свои.
 * Серверы без владельца (созданные до появления помощников) принадлежат администратору.
 */
export const canManage = (session, row) => session.role === 'admin' || (row.owner_id != null && row.owner_id === session.userId);

function mustManage(req, row) {
  if (!canManage(req.session, row)) throw new HttpError(403, 'Это сервер другого пользователя — доступ только на просмотр');
}

function decrypt(dek, blob, field) {
  try {
    return openText(dek, blob, field);
  } catch {
    return '⚠ ошибка расшифровки';
  }
}

function toJson(row, session) {
  const full = canManage(session, row);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    host: row.host,
    port: row.port,
    login: full ? decrypt(session.dek, row.login_enc, 'login') : '',
    hasPassword: Boolean(row.password_enc),
    restricted: !full,
    canEdit: full,
    mine: row.owner_id === session.userId || (row.owner_id == null && session.role === 'admin'),
    owner: row.owner_name ? { name: row.owner_name, role: row.owner_role } : null,
    hostingUrl: row.hosting_url || '',
    hostingName: row.hosting_name || '',
    hostingDomain: row.hosting_domain || '',
    icon: row.icon_id && row.icon_mime ? `/api/icons/${row.icon_id}?v=${row.icon_ver}` : null,
    payDate: row.pay_date,
    period: row.period,
    price: row.price,
    currency: row.currency || 'RUB',
    remind: Boolean(row.remind),
    monitor: Boolean(row.monitor),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseServer(body) {
  if (!body || typeof body !== 'object') throw bad('Пустой запрос');
  const hostingUrl = siteUrl(body.hostingUrl);
  return {
    name: str(body.name, 'Название', { required: true, max: 60 }),
    kind: oneOf(body.kind, KINDS, 'vds'),
    host: host(body.host),
    port: port(body.port),
    login: str(body.login, 'Логин', { max: 128 }),
    password: secret(body.password, 'Пароль', { max: 1024 }),
    notes: str(body.notes, 'Заметки', { max: 4000, multiline: true }),
    hostingUrl,
    hostingDomain: hostingUrl ? domainOf(hostingUrl) : null,
    hostingName: str(body.hostingName, 'Хостинг', { max: 60 }),
    payDate: isoDate(body.payDate, 'Дата оплаты'),
    period: oneOf(body.period, PERIODS, 'month'),
    price: price(body.price),
    currency: oneOf(body.currency, CURRENCIES, 'RUB'),
    remind: bool(body.remind, true),
    monitor: bool(body.monitor, true),
  };
}

function columns(dek, s) {
  return [
    s.name, s.kind, s.host, s.port,
    sealText(dek, s.login, 'login'), sealText(dek, s.password, 'password'), sealText(dek, s.notes, 'notes'),
    s.hostingUrl || null, s.hostingName || null, s.hostingDomain,
    s.payDate, s.period, s.price, s.currency, s.remind ? 1 : 0, s.monitor ? 1 : 0,
  ];
}

export function insertServer(dek, s, ownerId, now = Date.now()) {
  return Number(q(`INSERT INTO servers (name, kind, host, port, login_enc, password_enc, notes_enc, hosting_url, hosting_name,
                     hosting_domain, pay_date, period, price, currency, remind, monitor, created_at, updated_at, owner_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(...columns(dek, s), now, now, ownerId).lastInsertRowid);
}

const getRow = (id) => q(`${SELECT} WHERE s.id = ?`).get(id);
function mustRow(req) {
  const row = getRow(validId(req.params.id));
  if (!row) throw notFound('Сервер не найден');
  return row;
}

function afterSave(s, id) {
  if (s.hostingUrl) ensureIcon(s.hostingUrl).catch(() => {});
  if (s.monitor) checkServer({ id, name: s.name, host: s.host, port: s.port }).catch(() => {});
  else forgetServer(id);
}

const router = express.Router();

router.get('/', (req, res) => {
  res.json(q(`${SELECT} ORDER BY s.pay_date, s.name`).all().map((r) => toJson(r, req.session)));
});

router.get('/:id/secret', (req, res) => {
  const row = mustRow(req);
  mustManage(req, row);
  const reason = oneOf(req.query.reason, ['view', 'copy', 'edit'], 'view');
  audit('secret_view', req, `${row.name} (${reason})`);
  res.json({
    password: decrypt(req.session.dek, row.password_enc, 'password'),
    notes: decrypt(req.session.dek, row.notes_enc, 'notes'),
  });
});

router.post('/', (req, res) => {
  const s = parseServer(req.body);
  const id = insertServer(req.session.dek, s, req.session.userId);
  audit('server_create', req, s.name);
  afterSave(s, id);
  res.status(201).json(toJson(getRow(id), req.session));
});

router.put('/:id', (req, res) => {
  const row = mustRow(req);
  mustManage(req, row);
  const s = parseServer(req.body);
  q(`UPDATE servers SET name = ?, kind = ?, host = ?, port = ?, login_enc = ?, password_enc = ?, notes_enc = ?, hosting_url = ?,
       hosting_name = ?, hosting_domain = ?, pay_date = ?, period = ?, price = ?, currency = ?, remind = ?, monitor = ?, updated_at = ?
     WHERE id = ?`).run(...columns(req.session.dek, s), Date.now(), row.id);
  audit('server_update', req, s.name);
  afterSave(s, row.id);
  res.json(toJson(getRow(row.id), req.session));
});

router.delete('/:id', (req, res) => {
  const row = mustRow(req);
  mustManage(req, row);
  q('DELETE FROM servers WHERE id = ?').run(row.id);
  forgetServer(row.id);
  audit('server_delete', req, row.name);
  res.json({ ok: true });
});

router.post('/:id/paid', (req, res) => {
  const row = mustRow(req);
  mustManage(req, row);
  const months = PERIOD_MONTHS[row.period];
  tx(() => {
    q('INSERT INTO payments (server_id, server_name, due_date, amount, currency, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.pay_date, row.price, row.currency, Date.now());
    if (months) q('UPDATE servers SET pay_date = ?, updated_at = ? WHERE id = ?').run(addMonths(row.pay_date, months), Date.now(), row.id);
    else q('UPDATE servers SET remind = 0, updated_at = ? WHERE id = ?').run(Date.now(), row.id);
  });
  audit('payment', req, row.name);
  res.json(toJson(getRow(row.id), req.session));
});

router.post('/:id/check', async (req, res) => {
  const row = mustRow(req);
  const entry = await checkServer({ id: row.id, name: row.name, host: row.host, port: row.port });
  res.json({ online: entry.online, ms: entry.ms, checkedAt: entry.checkedAt, history: entry.history });
});

export default router;
