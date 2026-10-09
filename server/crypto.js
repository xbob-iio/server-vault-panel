import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/*
 * Модель ключей:
 *   master = Argon2id(пароль, соль)              — вычисляется только при входе
 *   auth   = HKDF(master, "auth")                — хранится в БД, сверяется при входе
 *   kek    = HKDF(master, "kek")                 — нигде не хранится
 *   dek    = случайные 32 байта                  — хранится в БД только в виде AES-GCM(kek, dek)
 * Данные серверов шифруются dek. Dek живёт в памяти процесса только пока открыта сессия,
 * поэтому копия базы данных (и даже .env) без пароля бесполезна.
 */

export const KDF_PARAMS = Object.freeze({ memory: 65536, passes: 3, parallelism: 1 });

// Argon2id жрёт 64 МБ на вызов — ограничиваем параллелизм, чтобы перебор не съел память.
const MAX_KDF = 2;
let running = 0;
const queue = [];
async function withKdfSlot(fn) {
  if (running >= MAX_KDF) await new Promise((resolve) => queue.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

export function argon2id(password, salt, params = KDF_PARAMS) {
  return withKdfSlot(() => new Promise((resolve, reject) => {
    crypto.argon2('argon2id', {
      message: Buffer.from(String(password).normalize('NFKC'), 'utf8'),
      nonce: salt,
      memory: params.memory,
      passes: params.passes,
      parallelism: params.parallelism,
      tagLength: 32,
    }, (err, key) => (err ? reject(err) : resolve(Buffer.from(key))));
  }));
}

export function hkdf(ikm, info) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), info, 32));
}

export async function deriveKeys(password, salt, params = KDF_PARAMS) {
  const master = await argon2id(password, salt, params);
  const keys = { auth: hkdf(master, 'servervault/auth'), kek: hkdf(master, 'servervault/kek') };
  master.fill(0);
  return keys;
}

const VERSION = 1;

/** AES-256-GCM: [версия 1Б][iv 12Б][tag 16Б][шифротекст] */
export function seal(key, data, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const plain = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function open(key, blob, aad) {
  const buf = Buffer.from(blob);
  if (buf.length < 29 || buf[0] !== VERSION) throw new Error('bad ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]);
}

export const sealText = (key, text, aad) => (text ? seal(key, text, aad) : null);
export const openText = (key, blob, aad) => (blob ? open(key, blob, aad).toString('utf8') : '');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// Ключ приложения шифрует то, что нужно фоновым задачам без открытой сессии (токен Telegram-бота).
let appKey;
export function getAppKey() {
  if (appKey) return appKey;
  const file = path.join(config.dataDir, 'app.key');
  if (!fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  appKey = fs.readFileSync(file);
  if (appKey.length !== 32) throw new Error(`${file} повреждён`);
  return appKey;
}
