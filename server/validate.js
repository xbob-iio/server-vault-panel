import net from 'node:net';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);
export const notFound = (message = 'Не найдено') => new HttpError(404, message);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function str(value, name, { max = 200, min = 0, required = false, multiline = false } = {}) {
  if (value == null || value === '') {
    if (required) throw bad(`Заполните поле «${name}»`);
    return '';
  }
  if (typeof value !== 'string') throw bad(`Поле «${name}» должно быть строкой`);
  let s = value.replace(CONTROL, '').trim();
  if (!multiline) s = s.replace(/[\r\n\t]+/g, ' ');
  if (required && !s) throw bad(`Заполните поле «${name}»`);
  if (s.length > max) throw bad(`Поле «${name}»: не больше ${max} символов`);
  if (s.length < min) throw bad(`Поле «${name}»: не меньше ${min} символов`);
  return s;
}

/** Секреты не обрезаем: пробелы по краям могут быть частью пароля. */
export function secret(value, name, { max = 512, min = 0, required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw bad(`Заполните поле «${name}»`);
    return '';
  }
  if (typeof value !== 'string') throw bad(`Поле «${name}» должно быть строкой`);
  if (value.length > max) throw bad(`Поле «${name}»: не больше ${max} символов`);
  if (value.length < min) throw bad(`Поле «${name}»: не меньше ${min} символов`);
  return value;
}

export function username(value) {
  const s = str(value, 'Логин', { required: true, min: 3, max: 32 });
  if (!/^[a-zA-Z0-9_.-]+$/.test(s)) throw bad('Логин: только латиница, цифры и символы _ . -');
  return s;
}

export function host(value) {
  let s = str(value, 'IP / хост', { required: true, max: 253 });
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (net.isIP(s)) return s;
  const label = '(?!-)[a-z0-9-]{1,63}(?<!-)';
  if (new RegExp(`^${label}(\\.${label})*\\.?$`, 'i').test(s)) return s.toLowerCase();
  throw bad('Некорректный IP-адрес или домен');
}

export function port(value, def = 22) {
  if (value == null || value === '') return def;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw bad('Порт должен быть от 1 до 65535');
  return n;
}

export function siteUrl(value) {
  let s = str(value, 'Сайт хостинга', { max: 300 });
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let url;
  try {
    url = new URL(s);
  } catch {
    throw bad('Некорректный адрес сайта хостинга');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) {
    throw bad('Некорректный адрес сайта хостинга');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function isoDate(value, name) {
  const s = str(value, name, { required: true, max: 10 });
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw bad(`Некорректная дата в поле «${name}»`);
  }
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) throw bad(`Некорректная дата в поле «${name}»`);
  return s;
}

export function oneOf(value, allowed, def) {
  if (value == null || value === '') return def;
  if (!allowed.includes(value)) throw bad('Недопустимое значение');
  return value;
}

export function price(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw bad('Некорректная цена');
  return Math.round(n * 100) / 100;
}

export const bool = (value, def) => (value == null ? def : value === true || value === 1 || value === '1' || value === 'true');

export function id(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw notFound();
  return n;
}
