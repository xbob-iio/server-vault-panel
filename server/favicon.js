import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { q } from './db.js';
import { domainOf } from './validate.js';

/*
 * Загрузка иконки хостинга с защитой от SSRF:
 *  - только http/https на портах 80/443, без логина в URL;
 *  - каждый резолв DNS проверяется в момент соединения (защита от DNS-rebinding):
 *    приватные, loopback, link-local, multicast и т.п. адреса запрещены;
 *  - редиректы проверяются заново, лимиты на время, размер и число переходов;
 *  - тип картинки определяется по сигнатуре байтов, а не по заголовкам сервера.
 */

const blocked = new net.BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(ip, prefix, 'ipv4');
for (const [ip, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96],
  ['100::', 64], ['2001:db8::', 32], ['2002::', 16],
]) blocked.addSubnet(ip, prefix, 'ipv6');

export function isPublicIp(address) {
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 6) {
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return isPublicIp(mapped[1]);
    return !blocked.check(address, 'ipv6');
  }
  return !blocked.check(address, 'ipv4');
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || !addresses.every((a) => isPublicIp(a.address))) {
      return callback(Object.assign(new Error('Адрес запрещён'), { code: 'EBLOCKED' }));
    }
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT = 7000;

function checkUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Только http/https');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Нестандартный порт');
  if (url.username || url.password) throw new Error('Логин в URL запрещён');
  const bare = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare) && !isPublicIp(bare)) throw new Error('Адрес запрещён');
}

function requestOnce(url, maxBytes, accept) {
  checkUrl(url);
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'GET',
      lookup: safeLookup,
      agent: false,
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'ru,en;q=0.8' },
    });
    const timer = setTimeout(() => req.destroy(new Error('Таймаут')), TIMEOUT);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        res.resume();
        req.destroy();
        return resolve({ redirect: new URL(res.headers.location, url) });
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          clearTimeout(timer);
          req.destroy();
          return resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated: true, url });
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated: false, url });
      });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.end();
  });
}

function decode(res, maxBytes) {
  const enc = String(res.headers['content-encoding'] || '').toLowerCase();
  if (!enc || enc === 'identity' || res.truncated) return res.body;
  const opts = { maxOutputLength: maxBytes, finishFlush: zlib.constants.Z_SYNC_FLUSH };
  try {
    if (enc === 'gzip') return zlib.gunzipSync(res.body, opts);
    if (enc === 'deflate') return zlib.inflateSync(res.body, opts);
    if (enc === 'br') return zlib.brotliDecompressSync(res.body, { maxOutputLength: maxBytes });
  } catch { /* не смогли распаковать */ }
  return Buffer.alloc(0);
}

async function get(urlStr, { maxBytes, accept }) {
  let url = new URL(urlStr);
  for (let i = 0; i < 5; i++) {
    const res = await requestOnce(url, maxBytes, accept);
    if (res.redirect) { url = res.redirect; continue; }
    return { ...res, body: decode(res, maxBytes) };
  }
  throw new Error('Слишком много редиректов');
}

export function sniffImage(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  if ((head.startsWith('<svg') || head.startsWith('<?xml')) && head.includes('<svg')) return 'image/svg+xml';
  return null;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

function parseHtml(html, baseUrl) {
  const icons = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href || !/\bicon\b|apple-touch-icon/.test(rel) || rel.includes('mask-icon')) continue;
    let url;
    try { url = new URL(decodeEntities(href), baseUrl); } catch { continue; }
    if (!['http:', 'https:', 'data:'].includes(url.protocol)) continue;
    const sizes = attr(tag, 'sizes') || '';
    const type = (attr(tag, 'type') || '').toLowerCase();
    const size = Number((sizes.match(/(\d+)x\d+/i) || [])[1]) || 0;
    let score = size || (rel.includes('apple-touch-icon') ? 180 : 32);
    if (type.includes('svg') || /\.svg(\?|$)/i.test(url.pathname)) score = 160;
    if (score > 256) score = 256 - (score - 256) / 10;
    icons.push({ url: url.href, score });
  }
  icons.sort((a, b) => b.score - a.score);

  const og = html.match(/<meta\b[^>]*property\s*=\s*["']og:site_name["'][^>]*>/i);
  let siteName = og ? attr(og[0], 'content') : null;
  if (!siteName) {
    const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    if (title) siteName = title[1].split(/\s+[|•·—–-]\s+/)[0];
  }
  siteName = siteName ? decodeEntities(siteName).replace(/\s+/g, ' ').trim().slice(0, 40) : null;
  return { icons, siteName };
}

const MAX_ICON = 300 * 1024;

async function downloadIcon(url) {
  if (url.startsWith('data:')) {
    const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) return null;
    const data = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    const mime = sniffImage(data);
    return mime && data.length <= MAX_ICON ? { mime, data } : null;
  }
  const res = await get(url, { maxBytes: MAX_ICON, accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8' });
  if (res.status !== 200 || res.truncated || !res.body.length) return null;
  const mime = sniffImage(res.body);
  return mime ? { mime, data: res.body } : null;
}

function prettyName(domain) {
  const base = domain.split('.').slice(-2, -1)[0] || domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

async function fetchIcon(siteUrl) {
  const origin = new URL(siteUrl).origin;
  let siteName = null;
  let candidates = [];
  try {
    const page = await get(siteUrl, { maxBytes: 512 * 1024, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' });
    if (page.status < 400) {
      const parsed = parseHtml(page.body.toString('utf8'), page.url);
      siteName = parsed.siteName;
      candidates = parsed.icons.slice(0, 4).map((i) => i.url);
    }
  } catch { /* сайт недоступен — пробуем запасные варианты */ }

  candidates.push(`${origin}/favicon.ico`);
  candidates.push(`https://icons.duckduckgo.com/ip3/${new URL(siteUrl).hostname}.ico`);

  for (const url of [...new Set(candidates)]) {
    try {
      const icon = await downloadIcon(url);
      if (icon) return { ...icon, siteName };
    } catch { /* следующий кандидат */ }
  }
  return { mime: null, data: null, siteName };
}

const inflight = new Map();
const REFRESH_MS = 30 * 86_400_000;
const RETRY_MS = 6 * 3_600_000;

/** Иконка кэшируется по домену. Возвращает { id, domain, siteName, hasIcon }. */
export async function ensureIcon(siteUrl, { force = false } = {}) {
  const domain = domainOf(siteUrl);
  if (!domain) return null;
  const row = q('SELECT id, mime, site_name, fetched_at FROM icons WHERE domain = ?').get(domain);
  const age = row ? Date.now() - row.fetched_at : Infinity;
  const fresh = row && (row.mime ? age < REFRESH_MS : age < RETRY_MS);
  if (fresh && !force) return { id: row.id, domain, siteName: row.site_name || prettyName(domain), hasIcon: !!row.mime };

  if (!inflight.has(domain)) {
    inflight.set(domain, fetchIcon(siteUrl).finally(() => inflight.delete(domain)));
  }
  const result = await inflight.get(domain);
  const siteName = result.siteName || prettyName(domain);
  if (result.data || !row?.mime) {
    q(`INSERT INTO icons (domain, mime, data, site_name, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET mime = excluded.mime, data = excluded.data,
         site_name = excluded.site_name, fetched_at = excluded.fetched_at`)
      .run(domain, result.mime, result.data, siteName, Date.now());
  } else {
    q('UPDATE icons SET fetched_at = ? WHERE domain = ?').run(Date.now(), domain);
  }
  const saved = q('SELECT id, mime FROM icons WHERE domain = ?').get(domain);
  return { id: saved.id, domain, siteName, hasIcon: !!saved.mime };
}
