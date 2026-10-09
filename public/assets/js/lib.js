// Общие утилиты фронтенда. Пользовательские данные вставляются ТОЛЬКО через textContent —
// innerHTML используется исключительно для статичных SVG-иконок ниже.

const ICONS = {
  server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.6 6.6A18.4 18.4 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  terminal: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  alert: '<path d="m10.3 3.86-8.47 14.14A2 2 0 0 0 3.54 21h16.92a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.4l-1.9-5.8L4 10.7l6.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
  wand: '<path d="m15 4-1 1M19 8l1-1M14 10l-9.5 9.5a1.5 1.5 0 0 0 2 2L16 12M17 3v2M21 7h-2M15 9l-2-2"/><path d="m18 12 1 1M12 6l-1-1"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  fingerprint: '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M17.29 21.02c.12-.6.43-2.3.5-3.02M2 12a10 10 0 0 1 18-6M2 16h.01M21.8 16c.2-2 .13-5.35 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M8.65 22c.21-.66.45-1.32.57-2M9 6.8a6 6 0 0 1 9 5.2v2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `i ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div', { class, text, onClick, ... }, ...children) — безопасное построение DOM. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') {
        for (const [prop, val] of Object.entries(v)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val);
          else el.style[prop] = val;
        }
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (['checked', 'disabled', 'hidden', 'selected', 'required', 'autofocus', 'readOnly'].includes(k)) el[k] = Boolean(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* ───────── API ───────── */

let csrfToken = null;
export const setCsrf = (t) => { csrfToken = t; };

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, background = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (background) headers['X-Background'] = '1';
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Нет связи с сервером', 0);
  }
  const data = (res.headers.get('content-type') || '').includes('application/json') ? await res.json().catch(() => null) : null;
  if (res.status === 401 && data?.code === 'AUTH' && location.pathname !== '/login') {
    location.replace('/login?expired=1');
    return new Promise(() => {});
  }
  if (!res.ok) throw new ApiError(data?.error || `Ошибка ${res.status}`, res.status, data?.code);
  return data;
}

/* ───────── уведомления ───────── */

const TOAST_ICONS = { info: 'info', ok: 'checkCircle', error: 'alert', warn: 'bell' };

export function toast(message, type = 'info', ms = 3800) {
  let root = $('#toasts');
  if (!root) {
    root = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(root);
  }
  const bar = h('i', { class: 'bar', style: { animationDuration: `${ms}ms` } });
  const el = h('div', { class: `toast ${type}`, role: 'status' }, icon(TOAST_ICONS[type] || 'info'), h('span', { text: message }), bar);
  root.append(el);
  const close = () => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 360);
  };
  const timer = setTimeout(close, ms);
  el.addEventListener('click', () => { clearTimeout(timer); close(); });
}

/* ───────── модальные окна ───────── */

export function openModal({ title, iconName = null, danger = false, content, footer, wide = false, onClose }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть' }, icon('x'));
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      iconName && h('div', { class: `m-icon${danger ? ' danger' : ''}` }, icon(iconName)),
      h('h3', { text: title }),
      closeBtn),
    h('div', { class: 'modal-body' }, content),
    footer && h('div', { class: 'modal-foot' }, footer));
  backdrop.append(box);

  let closed = false;
  const prevFocus = document.activeElement;
  const onKey = (e) => {
    if (e.key === 'Escape' && backdrop === $$('.modal-backdrop').at(-1)) close();
    if (e.key === 'Tab') {
      const items = $$('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])', box).filter((x) => !x.disabled && x.offsetParent);
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('open');
    backdrop.classList.add('closing');
    setTimeout(() => {
      backdrop.remove();
      if (!$('.modal-backdrop')) document.body.classList.remove('modal-open');
      prevFocus?.focus?.();
    }, 260);
    onClose?.(result);
  }
  closeBtn.addEventListener('click', () => close());
  let downOnBackdrop = false;
  backdrop.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === backdrop; });
  backdrop.addEventListener('click', (e) => { if (downOnBackdrop && e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('open')));
  setTimeout(() => ($('[autofocus]', box) || $('input:not([type=hidden]), select, textarea', box))?.focus(), 80);
  return { backdrop, box, close };
}

export function confirmDialog({ title, text, okText = 'Подтвердить', danger = false, iconName = 'alert' }) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { class: `btn ${danger ? 'btn-danger solid' : 'btn-primary'}`, type: 'button' }, okText);
    const cancel = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Отмена');
    const m = openModal({
      title, iconName, danger,
      content: h('p', { text }),
      footer: [cancel, ok],
      onClose: () => resolve(result),
    });
    ok.addEventListener('click', () => { result = true; m.close(); });
    cancel.addEventListener('click', () => m.close());
    setTimeout(() => ok.focus(), 90);
  });
}

/** Запрос пароля (подтверждение опасных действий). onSubmit(password) может бросить ошибку. */
export function passwordPrompt({ title, text, okText = 'Подтвердить', danger = false, onSubmit }) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Пароль от панели', autofocus: true });
    const error = h('p', { class: 'form-error', hidden: true });
    const ok = h('button', { class: `btn ${danger ? 'btn-danger solid' : 'btn-primary'}`, type: 'submit' }, h('span', { text: okText }), h('i', { class: 'spinner' }));
    const form = h('form', { class: 'stack' }, text && h('p', { class: 'muted', text }), input, error);
    const m = openModal({
      title, iconName: 'lock', danger,
      content: form,
      footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Отмена'), ok],
      onClose: () => { if (!done) resolve(null); },
    });
    ok.addEventListener('click', (e) => { e.preventDefault(); form.requestSubmit(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value) return input.focus();
      ok.classList.add('is-loading');
      error.hidden = true;
      try {
        const result = await onSubmit(input.value);
        done = true;
        m.close();
        resolve(result ?? true);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        input.select();
        m.box.classList.remove('shake');
        void m.box.offsetWidth;
        m.box.classList.add('shake');
      } finally {
        ok.classList.remove('is-loading');
      }
    });
  });
}

/* ───────── буфер обмена ───────── */

export async function copyText(text, label = 'Скопировано') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label, 'ok', 2200);
}

/* ───────── даты и числа ───────── */

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());

export function daysUntil(iso) {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86_400_000);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function fmtDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

export function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function relDays(left) {
  if (left < 0) return `просрочено на ${-left} ${plural(-left, 'день', 'дня', 'дней')}`;
  if (left === 0) return 'сегодня';
  if (left === 1) return 'завтра';
  return `через ${left} ${plural(left, 'день', 'дня', 'дней')}`;
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'только что';
  if (s < 60) return `${s} сек назад`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const hh = Math.round(m / 60);
  if (hh < 24) return `${hh} ч назад`;
  return fmtDateTime(ts);
}

export const CURRENCY = { RUB: '₽', USD: '$', EUR: '€', USDT: 'USDT' };
export function fmtMoney(amount, currency) {
  if (amount == null) return '';
  const n = Number(amount).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return currency === 'USD' ? `$${n}` : `${n} ${CURRENCY[currency] || currency || ''}`.trim();
}

export function countUp(el, to, ms = 900) {
  const from = Number(el.dataset.value || 0);
  el.dataset.value = to;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) {
    el.textContent = to;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ───────── пароли ───────── */

export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  if (/[^\x00-\x7F]/.test(pw)) pool += 60;
  let bits = pw.length * Math.log2(pool || 1);
  if (/(.)\1{2,}/.test(pw)) bits *= 0.75;
  if (/(0123|1234|2345|3456|4567|5678|6789|qwer|asdf|zxcv|pass|admin|йцук)/i.test(pw)) bits *= 0.6;
  const score = bits < 36 ? 1 : bits < 60 ? 2 : bits < 85 ? 3 : 4;
  return { score, bits: Math.round(bits), label: ['', 'Слабый', 'Средний', 'Хороший', 'Отличный'][score] };
}

function randInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

export function generatePassword({ length = 20, lower = true, upper = true, digits = true, symbols = true, noAmbiguous = false } = {}) {
  const strip = (s) => (noAmbiguous ? s.replace(/[Il1O0o|`'"]/g, '') : s);
  const sets = [
    lower && strip('abcdefghijklmnopqrstuvwxyz'),
    upper && strip('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    digits && strip('0123456789'),
    symbols && strip('!@#$%^&*()-_=+[]{};:,.<>?/~'),
  ].filter(Boolean);
  if (!sets.length) return '';
  const all = sets.join('');
  const chars = sets.map((s) => s[randInt(s.length)]);
  while (chars.length < length) chars.push(all[randInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, length).join('');
}

/** Полоска надёжности пароля, привязанная к input. */
export function strengthMeter(input) {
  const fill = h('i');
  const label = h('span');
  const el = h('div', { class: 'strength' }, h('div', { class: 'strength-bar' }, fill), label);
  const update = () => {
    const s = passwordStrength(input.value);
    el.dataset.score = s.score;
    fill.style.width = `${(s.score / 4) * 100}%`;
    label.textContent = s.label;
  };
  input.addEventListener('input', update);
  update();
  return el;
}

/* ───────── глобальные эффекты ───────── */

export function installEffects() {
  // волна при нажатии на кнопку
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const r = h('span', {
      class: 'ripple',
      style: { width: `${size}px`, height: `${size}px`, left: `${e.clientX - rect.left - size / 2}px`, top: `${e.clientY - rect.top - size / 2}px` },
    });
    btn.append(r);
    setTimeout(() => r.remove(), 650);
  });
  // подсветка карточек за курсором
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.spot');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    card.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, { passive: true });
}

/** Сегментированный переключатель с анимированной «таблеткой». */
export function segmented(options, value, onChange) {
  const pill = h('span', { class: 'seg-pill' });
  const root = h('div', { class: 'segmented', role: 'tablist' }, pill);
  const buttons = options.map(([val, label]) => {
    const b = h('button', { type: 'button', role: 'tab', class: val === value ? 'active' : '', text: label });
    b.addEventListener('click', () => {
      if (val === value) return;
      value = val;
      buttons.forEach((x) => x.classList.toggle('active', x === b));
      move();
      onChange(val);
    });
    return b;
  });
  root.append(...buttons);
  const move = () => {
    const active = buttons.find((b) => b.classList.contains('active'));
    if (!active) return;
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
  };
  requestAnimationFrame(move);
  new ResizeObserver(move).observe(root);
  root.getValue = () => value;
  return root;
}

export function toggle(label, checked, hint) {
  const input = h('input', { type: 'checkbox', checked });
  const el = h('label', { class: 'toggle' }, input, h('span', { class: 'track' }), h('span', { class: 't-text' }, label, hint && h('small', { text: hint })));
  el.input = input;
  return el;
}

export function setLoading(btn, on) {
  btn.classList.toggle('is-loading', on);
  if (on && !btn.querySelector('.spinner')) btn.append(h('i', { class: 'spinner' }));
}
