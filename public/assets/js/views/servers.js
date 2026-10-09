import { api, copyText, countUp, daysUntil, h, icon, plural, relDays, segmented, toast } from '../lib.js';
import { dueServers, setStatus, store, subscribe } from '../state.js';
import {
  KIND_LABEL, deleteServer, flash, iconBtn, markPaid, payInfo, payRing, serverIcon, sparkline, sshCommand, statusOf, urgencyOf,
} from './common.js';
import { openServerForm } from './serverForm.js';

// Фильтры переживают переходы между разделами.
const ui = { search: '', kind: 'all', sort: 'pay' };
const seen = new Set();

const SORTS = {
  pay: (a, b) => a.payDate.localeCompare(b.payDate),
  name: (a, b) => a.name.localeCompare(b.name, 'ru'),
  status: (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru'),
};
function rank(s) {
  const st = store.status[s.id];
  if (!s.monitor || !st) return 1;
  return st.online ? 2 : 0;
}

function stat(iconName, label, tone = '') {
  const num = h('div', { class: 's-num', text: '0' });
  const lbl = h('div', { class: 's-label', text: label });
  const el = h('div', { class: `stat panel spot anim-in ${tone}` }, h('div', { class: 's-icon' }, icon(iconName)), h('div', null, num, lbl));
  return { el, num, lbl };
}

function field(iconName, label, value, actions) {
  return h('div', { class: 'fld' },
    h('span', { class: 'k' }, icon(iconName), label),
    value,
    h('div', { class: 'acts' }, actions));
}

const hidden = () => h('span', { class: 'v none' }, icon('lock', 'i-sm'), ' скрыто');

/** Чей сервер: администратору показываем помощника-владельца, помощнику — «мой» / «только просмотр». */
function ownerChip(s) {
  if (store.me?.role === 'admin') {
    return s.owner?.role === 'assistant' ? h('span', { class: 'own-chip', title: 'Добавил помощник' }, icon('user', 'i-sm'), s.owner.name) : null;
  }
  return s.mine
    ? h('span', { class: 'own-chip mine' }, icon('check', 'i-sm'), 'мой')
    : h('span', { class: 'own-chip ro', title: 'Сервер администратора: логин и пароль скрыты' }, icon('lock', 'i-sm'), 'только просмотр');
}

function passwordField(s) {
  const MASK = '••••••••••';
  if (s.restricted) return field('key', 'Пароль', hidden(), []);
  if (!s.hasPassword) return field('key', 'Пароль', h('span', { class: 'v none', text: 'не задан' }), []);
  const v = h('span', { class: 'v masked', text: MASK });
  let timer = null;
  const hide = () => {
    clearTimeout(timer);
    v.textContent = MASK;
    v.className = 'v masked';
    eye.replaceChildren(icon('eye'));
    eye.dataset.tip = 'Показать';
  };
  const eye = iconBtn('eye', 'Показать', async () => {
    if (v.classList.contains('revealed')) return hide();
    try {
      const { password } = await api(`/api/servers/${s.id}/secret?reason=view`);
      v.textContent = password;
      v.className = 'v revealed';
      eye.replaceChildren(icon('eyeOff'));
      eye.dataset.tip = 'Скрыть';
      clearTimeout(timer);
      timer = setTimeout(hide, 20_000);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  const copy = iconBtn('copy', 'Скопировать', async () => {
    try {
      const { password } = await api(`/api/servers/${s.id}/secret?reason=copy`);
      await copyText(password, 'Пароль скопирован');
      flash(copy);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  return field('key', 'Пароль', v, [eye, copy]);
}

function copyBtn(text, label, tip = 'Скопировать', iconName = 'copy') {
  const btn = iconBtn(iconName, tip, async () => {
    await copyText(text, label);
    flash(btn);
  });
  return btn;
}

function serverCard(s, index) {
  const isNew = !seen.has(s.id);
  seen.add(s.id);
  const el = h('article', {
    class: `srv panel spot${isNew ? ' anim-in' : ''}`,
    style: { '--i': Math.min(index, 12) },
    dataset: { id: s.id, urgency: urgencyOf(s) },
  });

  const iconBox = serverIcon(s);
  const dot = h('i', { class: 'st-dot' });
  iconBox.append(dot);

  const hosting = s.hostingUrl && /^https?:\/\//i.test(s.hostingUrl)
    ? h('a', { href: s.hostingUrl, target: '_blank', rel: 'noopener noreferrer' }, s.hostingName || s.hostingDomain, icon('external'))
    : h('span', { class: 'host-name', text: s.hostingName || 'Хостинг не указан' });

  const head = h('div', { class: 'srv-head' },
    iconBox,
    h('div', { class: 'srv-title' }, h('h3', { text: s.name, title: s.name }), h('div', { class: 'srv-sub' }, hosting, ownerChip(s))),
    h('div', { class: 'srv-actions' },
      h('span', { class: `badge ${s.kind}`, text: KIND_LABEL[s.kind] || s.kind }),
      s.canEdit && iconBtn('edit', 'Изменить', () => openServerForm(s)),
      s.canEdit && iconBtn('trash', 'Удалить', () => deleteServer(s, el), 'danger')));

  const stText = h('span', { class: 'st-text' });
  const sparkSlot = h('div', { class: 'spark-slot' });
  const checkBtn = iconBtn('refresh', 'Проверить сейчас', async () => {
    checkBtn.classList.add('spinning');
    try {
      setStatus(s.id, await api(`/api/servers/${s.id}/check`, { method: 'POST' }));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      checkBtn.classList.remove('spinning');
    }
  }, 'st-check');
  const statusRow = h('div', { class: 'srv-status' }, stText, sparkSlot, checkBtn);

  let firstSpark = true;
  function updateStatus() {
    const st = statusOf(s);
    dot.className = `st-dot ${st.cls}`;
    stText.className = `st-text ${st.cls}`;
    stText.replaceChildren(h('i', { class: 'd' }), st.text);
    const history = store.status[s.id]?.history || [];
    sparkSlot.replaceChildren(sparkline(history, firstSpark && history.length > 1));
    if (history.length > 1) firstSpark = false;
  }
  updateStatus();

  const address = `${s.host}:${s.port}`;
  const fields = h('div', { class: 'srv-fields' },
    field('globe', 'Адрес', h('span', { class: 'v', text: address, title: address }), [
      copyBtn(sshCommand(s), 'SSH-команда скопирована', 'Скопировать SSH-команду', 'terminal'),
      copyBtn(s.host, 'IP скопирован', 'Скопировать IP'),
    ]),
    s.restricted
      ? field('user', 'Логин', hidden(), [])
      : field('user', 'Логин', h('span', { class: s.login ? 'v' : 'v none', text: s.login || 'не задан' }), s.login ? [copyBtn(s.login, 'Логин скопирован')] : []),
    passwordField(s));

  let paidBtn = null;
  if (s.canEdit) {
    paidBtn = h('button', { class: 'btn btn-ok btn-sm', type: 'button' }, icon('check', 'i-sm'), 'Оплачено');
    paidBtn.addEventListener('click', () => markPaid(s, paidBtn));
  }
  const foot = h('div', { class: 'srv-foot' }, payRing(s), payInfo(s), paidBtn);

  el.append(head, statusRow, fields, foot);
  return { el, updateStatus };
}

function emptyState(filtered) {
  if (filtered) {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-art' }, h('div', { class: 'rack' }), h('div', { class: 'rack' }), h('div', { class: 'rack' })),
      h('h3', { text: 'Ничего не найдено' }),
      h('p', { text: 'Попробуйте изменить запрос или фильтр.' }));
  }
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-art' }, h('div', { class: 'rack' }), h('div', { class: 'rack' }), h('div', { class: 'rack' })),
    h('h3', { text: 'Добавьте первый сервер' }),
    h('p', { text: 'Сохраните IP, логин и пароль, укажите дату оплаты и сайт хостинга — иконку панель подтянет сама и напомнит, когда пора платить.' }),
    h('button', { class: 'btn btn-primary btn-lg', type: 'button', onClick: () => openServerForm() }, icon('plus'), 'Добавить сервер'));
}

export function render(root) {
  seen.clear();
  const sTotal = stat('server', 'серверов');
  const sOnline = stat('activity', 'онлайн', 'ok');
  const sSoon = stat('bell', 'оплата за 7 дней', 'warn');
  const sOverdue = stat('alert', 'просрочено', 'danger');
  [sTotal, sOnline, sSoon, sOverdue].forEach((s, i) => s.el.style.setProperty('--i', i));
  const stats = h('div', { class: 'stats' }, sTotal.el, sOnline.el, sSoon.el, sOverdue.el);

  const bannerSlot = h('div');

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск: имя, IP, хостинг…  ( / )', value: ui.search, 'aria-label': 'Поиск' });
  search.addEventListener('input', () => { ui.search = search.value; draw(); });
  const kindSeg = segmented([['all', 'Все'], ['vds', 'VDS'], ['vpn', 'VPN'], ['dedicated', 'Dedicated'], ['other', 'Другое']], ui.kind, (v) => { ui.kind = v; draw(); });
  const sort = h('select', { class: 'input', 'aria-label': 'Сортировка' },
    h('option', { value: 'pay', text: 'По дате оплаты' }),
    h('option', { value: 'name', text: 'По названию' }),
    h('option', { value: 'status', text: 'Сначала недоступные' }));
  sort.value = ui.sort;
  sort.addEventListener('change', () => { ui.sort = sort.value; draw(); });
  const refreshBtn = h('button', { class: 'btn', type: 'button', 'data-tip': 'Проверить все серверы' }, icon('refresh'), h('span', { text: 'Статус' }));
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.querySelector('.i').animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 700, iterations: 2 });
    try {
      store.status = await api('/api/status/refresh', { method: 'POST' });
      drawStatus();
      toast('Статус серверов обновлён', 'ok', 2000);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'input-group search' }, icon('search', 'lead'), search),
    kindSeg, h('div', { class: 'spacer' }), sort, refreshBtn);

  const grid = h('div', { class: 'srv-grid' });
  root.append(stats, bannerSlot, toolbar, grid);

  let refs = [];

  function drawStats() {
    const all = store.servers;
    const monitored = all.filter((s) => s.monitor);
    const online = monitored.filter((s) => store.status[s.id]?.online).length;
    const overdue = all.filter((s) => s.remind && daysUntil(s.payDate) < 0).length;
    const soon = all.filter((s) => s.remind && daysUntil(s.payDate) >= 0 && daysUntil(s.payDate) <= 7).length;
    countUp(sTotal.num, all.length);
    countUp(sOnline.num, online);
    sOnline.lbl.textContent = monitored.length ? `онлайн из ${monitored.length}` : 'онлайн';
    countUp(sSoon.num, soon);
    countUp(sOverdue.num, overdue);
    sOverdue.el.classList.toggle('hot', overdue > 0);
  }

  function drawBanner() {
    const due = dueServers(1);
    if (!due.length) return bannerSlot.replaceChildren();
    const overdue = due.filter((s) => daysUntil(s.payDate) < 0).length;
    const names = due.slice(0, 3).map((s) => `${s.name} — ${relDays(daysUntil(s.payDate))}`).join(' · ') + (due.length > 3 ? ` и ещё ${due.length - 3}` : '');
    bannerSlot.replaceChildren(h('div', { class: `banner anim-in${overdue ? '' : ' warn'}` },
      h('div', { class: 'b-icon' }, icon('bell')),
      h('div', { class: 'b-text' },
        h('b', { text: `${overdue ? 'Требуют оплаты' : 'Скоро оплата'}: ${due.length} ${plural(due.length, 'сервер', 'сервера', 'серверов')}` }),
        h('span', { text: names })),
      h('a', { class: 'btn btn-sm', href: '#/payments' }, 'К оплатам', icon('chevRight', 'i-sm'))));
  }

  function draw() {
    const q = ui.search.trim().toLowerCase();
    const list = store.servers
      .filter((s) => ui.kind === 'all' || s.kind === ui.kind)
      .filter((s) => !q || [s.name, s.host, s.hostingName, s.hostingDomain, s.login].some((v) => v && v.toLowerCase().includes(q)))
      .sort(SORTS[ui.sort]);
    refs = list.map(serverCard);
    grid.replaceChildren(...(refs.length ? refs.map((r) => r.el) : [emptyState(store.servers.length > 0)]));
    grid.style.display = refs.length ? '' : 'block';
    drawStats();
    drawBanner();
  }

  function drawStatus() {
    for (const r of refs) r.updateStatus();
    drawStats();
    if (ui.sort === 'status') draw();
  }

  draw();
  const unsubscribe = subscribe((kind) => (kind === 'status' ? drawStatus() : draw()));
  const onKey = (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select') && !document.querySelector('.modal-backdrop')) {
      e.preventDefault();
      search.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => {
    unsubscribe();
    document.removeEventListener('keydown', onKey);
  };
}
