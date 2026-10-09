import {
  $, $$, api, daysUntil, fmtDate, h, icon, installEffects, relDays, setCsrf, toast,
} from './lib.js';
import { dueServers, loadServers, loadStatus, store, subscribe } from './state.js';
import * as audit from './views/audit.js';
import { serverIcon, toneOf } from './views/common.js';
import * as generator from './views/generator.js';
import * as payments from './views/payments.js';
import { openServerForm } from './views/serverForm.js';
import * as servers from './views/servers.js';
import * as settings from './views/settings.js';
import * as team from './views/team.js';

// admin: true — раздел только для администратора (сервер всё равно проверяет права сам).
const ROUTES = {
  servers: { title: 'Серверы', sub: 'Доступы, статус и сроки оплаты', view: servers },
  payments: { title: 'Оплаты', sub: 'Календарь платежей и история', view: payments },
  generator: { title: 'Генератор паролей', sub: 'Криптостойкие пароли прямо в браузере', view: generator },
  team: { title: 'Помощники', sub: 'Профили с ограниченным доступом', view: team, admin: true },
  audit: { title: 'Журнал', sub: 'Входы и действия в панели', view: audit, admin: true },
  settings: { title: 'Настройки', sub: 'Безопасность, Telegram и резервные копии', view: settings, admin: true },
};

const isAdmin = () => store.me?.role === 'admin';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

installEffects();
for (const el of $$('[data-icon]')) el.replaceWith(icon(el.dataset.icon, el.className));

/* ───── навигация ───── */

let cleanup = null;
let navToken = 0;
let rendered = false;

function moveIndicator(route) {
  const link = $(`.nav a[data-route="${route}"]`);
  const ind = $('#nav-indicator');
  if (!link) return;
  ind.style.transform = `translateY(${link.offsetTop}px)`;
  ind.style.opacity = '1';
}

async function navigate() {
  const token = ++navToken;
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const allowed = ROUTES[name] && (!ROUTES[name].admin || isAdmin());
  const route = allowed ? name : 'servers';
  if (name && !allowed) history.replaceState(null, '', '#/servers');
  document.body.classList.remove('nav-open');

  for (const a of $$('.nav a')) a.classList.toggle('active', a.dataset.route === route);
  moveIndicator(route);

  const { title, sub, view } = ROUTES[route];
  const titleBox = $('.page-title');
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  titleBox.classList.remove('swap');
  void titleBox.offsetWidth;
  titleBox.classList.add('swap');
  document.title = `${title} · ServerVault`;
  $('#add-btn').hidden = !['servers', 'payments'].includes(route);

  const viewEl = $('#view');
  if (rendered) {
    viewEl.classList.add('leaving');
    await wait(150);
    if (token !== navToken) return;
  }
  cleanup?.();
  cleanup = null;
  viewEl.classList.remove('leaving');
  viewEl.replaceChildren();
  window.scrollTo({ top: 0 });
  rendered = true;
  try {
    const result = await view.render(viewEl);
    if (token !== navToken) {
      if (typeof result === 'function') result();
      return;
    }
    cleanup = typeof result === 'function' ? result : null;
  } catch (e) {
    if (token === navToken) viewEl.replaceChildren(h('div', { class: 'empty' }, h('h3', { text: 'Не удалось загрузить раздел' }), h('p', { text: e.message })));
  }
}

/* ───── колокольчик и счётчики ───── */

const bell = $('#bell');
const pop = $('#bell-pop');

function drawCounters() {
  $('#count-servers').textContent = store.servers.length || '';
  const urgent = dueServers(3).length;
  const countDue = $('#count-due');
  countDue.textContent = urgent || '';
  countDue.hidden = !urgent;
  const due = dueServers(7).length;
  const badge = $('#bell-count');
  const was = Number(badge.textContent) || 0;
  badge.textContent = due;
  badge.hidden = !due;
  if (due > was) {
    bell.classList.remove('ringing');
    void bell.offsetWidth;
    bell.classList.add('ringing');
  }
  if (!pop.hidden) drawPopover();
}

function drawPopover() {
  const list = dueServers(7);
  const items = list.map((s) => {
    const left = daysUntil(s.payDate);
    const btn = h('button', { class: 'pop-item', type: 'button' },
      serverIcon(s, 'mini-icon'),
      h('div', { class: 'txt' }, h('b', { text: s.name }), h('small', { class: toneOf(left), text: `${relDays(left)} · ${fmtDate(s.payDate)}` })));
    btn.addEventListener('click', () => { closePopover(); location.hash = '#/payments'; });
    return btn;
  });
  pop.replaceChildren(
    h('h4', { text: 'Оплата в ближайшие 7 дней' }),
    ...(items.length ? items : [h('div', { class: 'pop-empty' }, icon('checkCircle'), 'Всё оплачено — ближайшую неделю платить не нужно')]),
    h('div', { class: 'pop-foot' }, h('a', { class: 'btn btn-ghost btn-sm btn-block', href: '#/payments', onClick: closePopover }, 'Все оплаты', icon('chevRight', 'i-sm'))));
}

function closePopover() {
  pop.hidden = true;
}

bell.addEventListener('click', (e) => {
  e.stopPropagation();
  pop.hidden = !pop.hidden;
  if (!pop.hidden) drawPopover();
});
document.addEventListener('click', (e) => {
  if (!pop.hidden && !e.target.closest('.bell-wrap')) closePopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopover();
});

/* ───── уведомления браузера ───── */

function browserNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = new Date().toISOString().slice(0, 10);
  for (const s of dueServers(1)) {
    const key = `sv-notified:${s.id}:${s.payDate}:${today}`;
    try {
      if (localStorage.getItem(key)) continue;
      localStorage.setItem(key, '1');
    } catch { /* приватный режим — просто уведомляем */ }
    const n = new Notification(`Оплата: ${s.name}`, { body: `${relDays(daysUntil(s.payDate))} · ${fmtDate(s.payDate)}`, icon: '/assets/img/logo.svg', tag: `sv-${s.id}` });
    n.onclick = () => { window.focus(); location.hash = '#/payments'; n.close(); };
  }
}

/* ───── автоблокировка ───── */

let lastActivity = Date.now();
let lastPing = Date.now();
function trackIdle(minutes) {
  const total = minutes * 60_000;
  const bar = $('#idle-bar');
  const note = $('#lock-note');
  const bump = () => {
    lastActivity = Date.now();
    // Держим серверную сессию живой, пока человек реально пользуется панелью.
    if (Date.now() - lastPing > 4 * 60_000) {
      lastPing = Date.now();
      api('/api/auth/me').catch(() => {});
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, bump, { passive: true });
  setInterval(() => {
    const left = total - (Date.now() - lastActivity);
    if (left <= 0) {
      location.replace('/login?expired=1');
      return;
    }
    bar.style.transform = `scaleX(${left / total})`;
    note.textContent = `Автоблокировка через ${Math.ceil(left / 60_000)} мин без действий`;
  }, 1000);
}

/* ───── прочее ───── */

$('#add-btn').addEventListener('click', () => openServerForm());
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
$('#logout').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch { /* всё равно уходим */ }
  location.replace('/login');
});
addEventListener('resize', () => moveIndicator((location.hash.match(/^#\/(\w+)/) || [])[1] || 'servers'));
addEventListener('hashchange', navigate);
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input, textarea, select') && !$('.modal-backdrop')) {
    e.preventDefault();
    openServerForm();
  }
});

async function boot() {
  try {
    const me = await api('/api/auth/me');
    store.me = me;
    setCsrf(me.csrf);
    $('#me-name').textContent = me.username;
    $('#avatar').textContent = me.username.charAt(0);
    $('#me-role').textContent = isAdmin() ? 'Администратор' : 'Помощник';
    $('#avatar').classList.toggle('assistant', !isAdmin());
    for (const el of $$('[data-admin]')) el.hidden = !isAdmin();
    trackIdle(me.idleMinutes);
    await loadServers();
    loadStatus().catch(() => {});
  } catch (e) {
    $('#boot p').textContent = e.message;
    return;
  }

  subscribe((kind) => { if (kind === 'servers') drawCounters(); });
  drawCounters();
  await navigate();

  $('#boot').classList.add('done');
  $('#shell').classList.add('ready');
  setTimeout(() => moveIndicator((location.hash.match(/^#\/(\w+)/) || [])[1] || 'servers'), 50);

  const left = sessionStorage.getItem('sv-recovery-left');
  if (left !== null) {
    sessionStorage.removeItem('sv-recovery-left');
    toast(`Вход по резервному коду. Осталось кодов: ${left}`, 'warn', 7000);
  }
  if (isAdmin() && !store.me.totp) setTimeout(() => toast('Совет: включите 2FA в настройках для дополнительной защиты', 'info', 6000), 2500);

  browserNotify();
  setInterval(() => loadStatus().catch(() => {}), 20_000);
  setInterval(() => { drawCounters(); browserNotify(); }, 15 * 60_000);
}

boot();
