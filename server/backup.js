import crypto from 'node:crypto';
import { KDF_PARAMS, argon2id, open, openText, seal } from './crypto.js';
import { q, tx } from './db.js';
import { sniffImage } from './favicon.js';
import { CURRENCIES, insertServer, parseServer } from './routes/servers.js';
import { bad } from './validate.js';

/*
 * Формат файла .svbak: JSON-конверт, внутри которого AES-256-GCM от JSON с данными.
 * Ключ — Argon2id(пароль бэкапа, соль). Без пароля файл бесполезен.
 */

const FORMAT = 'servervault-backup';
const AAD = 'servervault-backup/v1';

export async function exportBackup(dek, password) {
  const icons = new Map();
  const servers = q('SELECT * FROM servers ORDER BY id').all().map((r) => {
    if (r.hosting_domain && !icons.has(r.hosting_domain)) {
      const icon = q('SELECT domain, mime, data, site_name FROM icons WHERE domain = ? AND mime IS NOT NULL').get(r.hosting_domain);
      if (icon) icons.set(icon.domain, { domain: icon.domain, data: Buffer.from(icon.data).toString('base64'), siteName: icon.site_name });
    }
    return {
      name: r.name, kind: r.kind, host: r.host, port: r.port,
      login: openText(dek, r.login_enc, 'login'),
      password: openText(dek, r.password_enc, 'password'),
      notes: openText(dek, r.notes_enc, 'notes'),
      hostingUrl: r.hosting_url || '', hostingName: r.hosting_name || '',
      payDate: r.pay_date, period: r.period, price: r.price, currency: r.currency,
      remind: Boolean(r.remind), monitor: Boolean(r.monitor),
      payments: q('SELECT due_date AS dueDate, amount, currency, paid_at AS paidAt FROM payments WHERE server_id = ? ORDER BY paid_at').all(r.id),
    };
  });

  const payload = Buffer.from(JSON.stringify({ app: 'ServerVault', exportedAt: new Date().toISOString(), servers, icons: [...icons.values()] }));
  const salt = crypto.randomBytes(16);
  const key = await argon2id(password, salt);
  const data = seal(key, payload, AAD);
  key.fill(0);
  payload.fill(0);
  return {
    format: FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    kdf: { name: 'argon2id', salt: salt.toString('base64'), ...KDF_PARAMS },
    data: data.toString('base64'),
  };
}

function kdfParams(kdf) {
  const memory = Number(kdf?.memory);
  const passes = Number(kdf?.passes);
  const parallelism = Number(kdf?.parallelism);
  // Ограничиваем параметры — иначе подсунутый файл мог бы заставить сервер выделить гигабайты памяти.
  if (!(memory >= 8192 && memory <= 262144 && passes >= 1 && passes <= 10 && parallelism >= 1 && parallelism <= 4)) {
    throw bad('Файл бэкапа повреждён');
  }
  return { memory, passes, parallelism };
}

function parsePayment(p) {
  const paidAt = Number(p?.paidAt);
  if (!Number.isSafeInteger(paidAt) || paidAt <= 0) return null;
  const amount = p.amount == null ? null : Number(p.amount);
  return {
    dueDate: typeof p.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? p.dueDate : null,
    amount: Number.isFinite(amount) ? amount : null,
    currency: CURRENCIES.includes(p.currency) ? p.currency : null,
    paidAt,
  };
}

export async function importBackup(dek, text, password, mode) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw bad('Это не файл бэкапа ServerVault');
  }
  if (file?.format !== FORMAT || file.version !== 1 || typeof file.data !== 'string' || typeof file.kdf?.salt !== 'string') {
    throw bad('Это не файл бэкапа ServerVault');
  }

  const key = await argon2id(password, Buffer.from(file.kdf.salt, 'base64'), kdfParams(file.kdf));
  let payload;
  try {
    payload = JSON.parse(open(key, Buffer.from(file.data, 'base64'), AAD).toString('utf8'));
  } catch {
    throw bad('Неверный пароль бэкапа или файл повреждён');
  } finally {
    key.fill(0);
  }

  if (!Array.isArray(payload?.servers) || payload.servers.length > 5000) throw bad('Файл бэкапа повреждён');
  const servers = payload.servers.map((raw, i) => {
    try {
      const payments = Array.isArray(raw.payments) ? raw.payments.slice(0, 2000).map(parsePayment).filter(Boolean) : [];
      return { ...parseServer(raw), payments };
    } catch (e) {
      throw bad(`Сервер №${i + 1} в бэкапе: ${e.message}`);
    }
  });
  const icons = (Array.isArray(payload.icons) ? payload.icons : []).flatMap((icon) => {
    if (typeof icon?.domain !== 'string' || icon.domain.length > 253 || typeof icon.data !== 'string') return [];
    const data = Buffer.from(icon.data, 'base64');
    const mime = sniffImage(data);
    if (!mime || data.length > 300 * 1024) return [];
    return [{ domain: icon.domain.toLowerCase(), data, mime, siteName: typeof icon.siteName === 'string' ? icon.siteName.slice(0, 40) : null }];
  });

  tx(() => {
    if (mode === 'replace') {
      q('DELETE FROM servers').run();
      q('DELETE FROM payments').run();
    }
    for (const icon of icons) {
      q(`INSERT INTO icons (domain, mime, data, site_name, fetched_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET mime = excluded.mime, data = excluded.data, site_name = excluded.site_name
         WHERE icons.mime IS NULL`).run(icon.domain, icon.mime, icon.data, icon.siteName, Date.now());
    }
    for (const s of servers) {
      const id = insertServer(dek, s);
      for (const p of s.payments) {
        q('INSERT INTO payments (server_id, server_name, due_date, amount, currency, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, s.name, p.dueDate, p.amount, p.currency, p.paidAt);
      }
    }
  });
  return servers.length;
}
