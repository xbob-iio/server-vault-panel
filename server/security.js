import { config } from './config.js';
import { safeEqual } from './crypto.js';
import { getSession, SESSION_COOKIE } from './sessions.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

export function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key in out) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch { /* битая cookie — игнорируем */ }
  }
  return out;
}

export function cookieOptions(req, maxAge) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookies || req.secure,
    path: '/',
    ...(maxAge ? { maxAge } : {}),
  };
}

export function currentSession(req, touch = true) {
  return getSession(parseCookies(req)[SESSION_COOKIE], touch);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Отсекаем межсайтовые запросы: Sec-Fetch-Site и Origin должны указывать на нас. */
export function sameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return res.status(403).json({ error: 'Межсайтовый запрос отклонён' });
  }
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* null */ }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Межсайтовый запрос отклонён' });
  }
  next();
}

export function requireAuth(req, res, next) {
  const session = currentSession(req, req.get('x-background') !== '1');
  if (!session) return res.status(401).json({ error: 'Требуется вход', code: 'AUTH' });
  if (!SAFE_METHODS.has(req.method) && !safeEqual(req.get('x-csrf-token') || '', session.csrf)) {
    return res.status(403).json({ error: 'Неверный CSRF-токен. Обновите страницу.' });
  }
  req.session = session;
  next();
}

/** Только для администратора (после requireAuth). Помощнику настройки, журнал и бэкап недоступны. */
export function requireAdmin(req, res, next) {
  if (req.session?.role !== 'admin') return res.status(403).json({ error: 'Недостаточно прав' });
  next();
}

/** Скользящее окно в памяти. check() → секунд до разблокировки (0 — можно). */
export function createLimiter({ windowMs, max }) {
  const hits = new Map();
  const fresh = (key, now) => (hits.get(key) || []).filter((t) => now - t < windowMs);
  setInterval(() => {
    const now = Date.now();
    for (const key of [...hits.keys()]) {
      const list = fresh(key, now);
      if (list.length) hits.set(key, list); else hits.delete(key);
    }
  }, windowMs).unref();
  return {
    check(key) {
      const now = Date.now();
      const list = fresh(key, now);
      hits.set(key, list);
      return list.length >= max ? Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000)) : 0;
    },
    hit(key) {
      const list = hits.get(key) || [];
      list.push(Date.now());
      hits.set(key, list);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

export function retryMessage(seconds) {
  const min = Math.ceil(seconds / 60);
  return `Слишком много попыток. Повторите через ${min} мин.`;
}

export function rateLimit(limiter, keyFn = (req) => req.ip) {
  return (req, res, next) => {
    const key = keyFn(req);
    const retry = limiter.check(key);
    if (retry) {
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: retryMessage(retry) });
    }
    limiter.hit(key);
    next();
  };
}
