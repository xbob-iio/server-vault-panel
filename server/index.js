import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { pruneAudit } from './audit.js';
import { ROOT, config } from './config.js';
import { getAppKey } from './crypto.js';
import { db, q } from './db.js';
import { startMonitor } from './monitor.js';
import { startReminders } from './reminders.js';
import authRoutes, { setupToken } from './routes/auth.js';
import serverRoutes from './routes/servers.js';
import systemRoutes from './routes/system.js';
import userRoutes from './routes/users.js';
import { createLimiter, currentSession, noStore, rateLimit, requireAdmin, requireAuth, sameOrigin, securityHeaders } from './security.js';
import { base32Encode } from './totp.js';
import { HttpError } from './validate.js';

getAppKey();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(securityHeaders);

/* ───── API ───── */

const smallJson = express.json({ limit: '64kb' });
const bigJson = express.json({ limit: '20mb' });
const apiLimiter = createLimiter({ windowMs: 60_000, max: 300 });

const api = express.Router();
api.use(noStore, sameOrigin, rateLimit(apiLimiter));
api.use((req, res, next) => (req.path === '/backup/import' ? bigJson : smallJson)(req, res, next));
api.use('/auth', authRoutes);
api.use('/servers', requireAuth, serverRoutes);
api.use('/users', requireAuth, requireAdmin, userRoutes);
api.use(requireAuth, systemRoutes);
app.use('/api', api);

/* ───── Страницы и статика ───── */

const PUBLIC = path.join(ROOT, 'public');
const sendPage = (res, name, status = 200) => res.status(status).set('Cache-Control', 'no-store').sendFile(path.join(PUBLIC, name));

app.use('/assets', express.static(path.join(PUBLIC, 'assets'), {
  index: false,
  dotfiles: 'ignore',
  setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
}));

app.get('/favicon.ico', (req, res) => res.type('image/svg+xml').sendFile(path.join(PUBLIC, 'assets/img/logo.svg')));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

app.get('/', (req, res) => (currentSession(req) ? sendPage(res, 'app.html') : res.redirect(302, '/login')));
app.get('/login', (req, res) => (currentSession(req, false) ? res.redirect(302, '/') : sendPage(res, 'login.html')));

app.use((req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') return sendPage(res, '404.html', 404);
  res.status(404).json({ error: 'Не найдено' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error('[error]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

/* ───── Запуск ───── */

if (!q('SELECT 1 FROM users LIMIT 1').get()) {
  setupToken.value = base32Encode(crypto.randomBytes(10)).match(/.{4}/g).join('-');
}

const server = app.listen(config.port, config.host, () => {
  const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
  const blue = (s) => `\x1b[38;5;39m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  console.log(`\n  ${blue('◆')} ${bold('ServerVault')} запущен → ${blue(url)}\n`);
  if (setupToken.value) {
    console.log(`  Первый запуск. Откройте панель и введите токен установки:\n`);
    console.log(`      ${bold(blue(setupToken.value))}\n`);
    console.log('  Токен одноразовый и действует до перезапуска сервера.\n');
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host) && !config.secureCookies) {
    console.warn('  \x1b[33m⚠ Панель доступна по сети без SECURE_COOKIES=true. Используйте HTTPS (см. README).\x1b[0m\n');
  }
});

startMonitor();
startReminders();
pruneAudit();
setInterval(pruneAudit, 3_600_000).unref();

function shutdown() {
  server.close();
  try { db.close(); } catch { /* уже закрыта */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
