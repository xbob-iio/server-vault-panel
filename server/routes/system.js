import express from 'express';
import { audit } from '../audit.js';
import { exportBackup, importBackup } from '../backup.js';
import { todayISO } from '../dates.js';
import { getSetting, q, setSetting } from '../db.js';
import { ensureIcon } from '../favicon.js';
import { runChecks, statusSnapshot } from '../monitor.js';
import { remindDays, remindHour, runReminders } from '../reminders.js';
import { createLimiter, rateLimit, requireAdmin } from '../security.js';
import { TOKEN_RE, getBotToken, notify, setBotToken, telegramReady, tgCall } from '../telegram.js';
import { HttpError, bad, id as validId, notFound, oneOf, secret, siteUrl, str } from '../validate.js';
import { confirmPassword } from './auth.js';

const router = express.Router();
const bySession = (req) => req.session.id;
const iconLimiter = createLimiter({ windowMs: 60_000, max: 30 });
const backupLimiter = createLimiter({ windowMs: 15 * 60_000, max: 10 });
const telegramLimiter = createLimiter({ windowMs: 60_000, max: 15 });

/* ───── Иконки хостингов ───── */

router.post('/icons/fetch', rateLimit(iconLimiter, bySession), async (req, res) => {
  const url = siteUrl(req.body?.url);
  if (!url) throw bad('Укажите сайт хостинга');
  try {
    const icon = await ensureIcon(url, { force: req.body?.force === true });
    res.json({ domain: icon.domain, siteName: icon.siteName, icon: icon.hasIcon ? `/api/icons/${icon.id}?v=${Date.now()}` : null });
  } catch {
    res.json({ domain: null, siteName: null, icon: null });
  }
});

router.get('/icons/:id', (req, res) => {
  const row = q('SELECT mime, data FROM icons WHERE id = ?').get(validId(req.params.id));
  if (!row?.mime) throw notFound();
  // sandbox-CSP: даже если открыть SVG напрямую, скрипты внутри не выполнятся.
  res.set({
    'Content-Type': row.mime,
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': 'private, max-age=86400',
  });
  res.send(Buffer.from(row.data));
});

/* ───── Мониторинг ───── */

router.get('/status', (req, res) => res.json(statusSnapshot()));

router.post('/status/refresh', async (req, res) => {
  await runChecks();
  res.json(statusSnapshot());
});

/* ───── История оплат ───── */

router.get('/payments', (req, res) => {
  res.json(q(`SELECT id, server_id AS serverId, server_name AS serverName, due_date AS dueDate, amount, currency, paid_at AS paidAt
              FROM payments ORDER BY paid_at DESC LIMIT 300`).all());
});

/* ───── Дальше — только администратор ───── */

router.use(requireAdmin);

/* ───── Настройки ───── */

router.get('/settings', (req, res) => {
  res.json({
    telegram: {
      hasToken: Boolean(getBotToken()),
      botName: getSetting('tg_bot_name'),
      chatTitle: getSetting('tg_chat_title'),
      ready: telegramReady(),
    },
    remindDays: remindDays(),
    remindHour: remindHour(),
    downAlerts: getSetting('down_alerts', '1') === '1',
  });
});

router.put('/settings', (req, res) => {
  const b = req.body || {};
  if (b.remindDays !== undefined) {
    if (!Array.isArray(b.remindDays) || !b.remindDays.length || b.remindDays.length > 10) throw bad('Укажите от 1 до 10 дней');
    const days = b.remindDays.map(Number);
    if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 60)) throw bad('Дни напоминаний — числа от 0 до 60');
    setSetting('remind_days', [...new Set(days)].sort((x, y) => y - x).join(','));
  }
  if (b.remindHour !== undefined) {
    const hour = Number(b.remindHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw bad('Час — от 0 до 23');
    setSetting('remind_hour', hour);
  }
  if (b.downAlerts !== undefined) setSetting('down_alerts', b.downAlerts ? '1' : '0');
  audit('settings_update', req);
  res.json({ ok: true });
});

/* ───── Telegram ───── */

const tg = express.Router();
tg.use(rateLimit(telegramLimiter, bySession));

const asBad = (e) => { throw bad(e.message); };

tg.post('/token', async (req, res) => {
  const token = str(req.body?.token, 'Токен бота', { required: true, max: 100 });
  if (!TOKEN_RE.test(token)) throw bad('Токен не похож на настоящий. Формат: 123456789:AAH…');
  const me = await tgCall(token, 'getMe').catch(asBad);
  setBotToken(token);
  setSetting('tg_bot_name', me.username);
  setSetting('tg_chat_id', null);
  setSetting('tg_chat_title', null);
  audit('telegram_set', req, `@${me.username}`);
  res.json({ ok: true, botName: me.username });
});

tg.post('/detect', async (req, res) => {
  const token = getBotToken();
  if (!token) throw bad('Сначала сохраните токен бота');
  const updates = await tgCall(token, 'getUpdates', { limit: 100, allowed_updates: ['message'] }).catch(asBad);
  const message = [...updates].reverse().map((u) => u.message).find((m) => m?.chat?.type === 'private');
  if (!message) throw bad(`Отправьте боту @${getSetting('tg_bot_name')} сообщение /start и нажмите ещё раз`);
  const chat = message.chat;
  const title = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || (chat.username ? `@${chat.username}` : String(chat.id));
  setSetting('tg_chat_id', chat.id);
  setSetting('tg_chat_title', chat.username ? `${title} (@${chat.username})` : title);
  await notify('✅ <b>ServerVault</b> подключён.\nСюда будут приходить напоминания об оплате серверов.').catch(() => {});
  audit('telegram_chat', req, title);
  res.json({ ok: true, chatTitle: getSetting('tg_chat_title') });
});

tg.post('/test', async (req, res) => {
  if (!telegramReady()) throw bad('Telegram ещё не настроен');
  await notify('🧪 Тестовое сообщение от <b>ServerVault</b> — всё работает!').catch(asBad);
  res.json({ ok: true });
});

tg.post('/remind-now', async (req, res) => {
  if (!telegramReady()) throw bad('Telegram ещё не настроен');
  const sent = await runReminders({ force: true }).catch(asBad);
  res.json({ ok: true, sent });
});

tg.delete('/', (req, res) => {
  setBotToken(null);
  for (const key of ['tg_bot_name', 'tg_chat_id', 'tg_chat_title']) setSetting(key, null);
  audit('telegram_remove', req);
  res.json({ ok: true });
});

router.use('/telegram', tg);

/* ───── Журнал ───── */

router.get('/audit', (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number.parseInt(req.query.limit, 10) || 300));
  res.json(q('SELECT id, ts, event, ip, ua, detail, actor FROM audit ORDER BY id DESC LIMIT ?').all(limit));
});

/* ───── Бэкап ───── */

router.post('/backup/export', rateLimit(backupLimiter, bySession), async (req, res) => {
  const password = secret(req.body?.password, 'Пароль бэкапа', { required: true, min: 8, max: 256 });
  const file = await exportBackup(req.session.dek, password);
  audit('backup_export', req);
  res.set('Content-Disposition', `attachment; filename="servervault-${todayISO()}.svbak"`);
  res.json(file);
});

router.post('/backup/import', rateLimit(backupLimiter, bySession), async (req, res) => {
  const mode = oneOf(req.body?.mode, ['merge', 'replace'], 'merge');
  const password = secret(req.body?.password, 'Пароль бэкапа', { required: true, max: 256 });
  const text = typeof req.body?.file === 'string' ? req.body.file : '';
  if (!text) throw bad('Выберите файл бэкапа');
  if (mode === 'replace') await confirmPassword(req, req.body?.accountPassword);
  const count = await importBackup(req.session.dek, text, password, mode, req.session.userId);
  audit('backup_import', req, `${count} шт., режим: ${mode === 'replace' ? 'замена' : 'добавление'}`);
  runChecks().catch(() => {});
  res.json({ ok: true, count });
});

router.use((req, res) => {
  throw new HttpError(404, 'Не найдено');
});

export default router;
