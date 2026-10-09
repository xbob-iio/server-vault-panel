import crypto from 'node:crypto';
import { safeEqual, sha256 } from './crypto.js';

// RFC 6238 (TOTP, SHA-1, 6 цифр, шаг 30 с) — совместимо с Google Authenticator, Aegis, 2FAS и др.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => crypto.randomBytes(20);

function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/** Возвращает использованный шаг (для защиты от повтора) или null. Допуск ±30 с. */
export function verifyTotp(secret, code, lastStep = 0) {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(Date.now() / 1000 / STEP);
  for (const step of [now - 1, now, now + 1]) {
    if (step > lastStep && safeEqual(codeAt(secret, step), code)) return step;
  }
  return null;
}

export function totpUri(secret, account) {
  const label = encodeURIComponent(`ServerVault:${account}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=ServerVault&algorithm=SHA1&digits=6&period=${STEP}`;
}

const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    let raw = '';
    for (let j = 0; j < 10; j++) raw += RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export const normalizeRecovery = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashRecovery = (code) => sha256(`servervault-rc:${normalizeRecovery(code)}`);
