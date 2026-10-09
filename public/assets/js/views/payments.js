import { api, daysUntil, fmtDate, fmtDateTime, fmtMoney, h, icon, relDays, toISO } from '../lib.js';
import { store, subscribe } from '../state.js';
import { PERIOD_SHORT, markPaid, serverIcon, toneOf } from './common.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function section(title, iconName, ...children) {
  return h('section', { class: 'section panel anim-in' },
    h('div', { class: 'section-head' }, icon(iconName), h('h2', { text: title })),
    ...children);
}

export function render(root) {
  const now = new Date();
  let month = new Date(now.getFullYear(), now.getMonth(), 1);
  let selected = null;

  const calTitle = h('b');
  const calGrid = h('div', { class: 'cal-grid' });
  const money = h('div', { class: 'money-row' });
  const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Предыдущий месяц' }, icon('chevLeft'));
  const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Следующий месяц' }, icon('chevRight'));
  prev.addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); drawCalendar(); });
  next.addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); drawCalendar(); });
  const calendar = section('Календарь оплат', 'calendar', h('div', { class: 'cal-head' }, prev, calTitle, next), calGrid, money);

  const timeline = h('div', { class: 'timeline' });
  const upcoming = section('Ближайшие оплаты', 'bell', timeline);
  upcoming.style.setProperty('--i', 1);

  const histBody = h('tbody');
  const histEmpty = h('p', { class: 'muted', text: 'Пока нет отмеченных оплат. Нажмите «Оплачено» на карточке сервера.', hidden: true });
  const history = section('История оплат', 'clock',
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', { text: 'Оплачено' }), h('th', { text: 'Сервер' }), h('th', { text: 'За период до' }), h('th', { text: 'Сумма' }))),
      histBody)),
    histEmpty);
  history.style.setProperty('--i', 2);
  history.style.marginTop = '18px';

  root.append(h('div', { class: 'pay-layout' }, calendar, upcoming), history);

  function drawCalendar() {
    calTitle.textContent = `${MONTHS[month.getMonth()]} ${month.getFullYear()}`;
    const byDay = new Map();
    for (const s of store.servers) {
      const list = byDay.get(s.payDate) || [];
      list.push(s);
      byDay.set(s.payDate, list);
    }
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7));
    const today = toISO(new Date());
    const cells = DOW.map((d) => h('div', { class: 'dow', text: d }));
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = toISO(d);
      const items = byDay.get(iso) || [];
      const cls = ['cal-day'];
      if (d.getMonth() !== month.getMonth()) cls.push('out');
      if (iso === today) cls.push('today');
      if (items.length) cls.push('has');
      if (iso === selected) cls.push('sel');
      const cell = h('div', { class: cls.join(' '), style: { '--i': i }, title: items.map((s) => s.name).join(', ') || null }, String(d.getDate()));
      if (items.length) {
        cell.append(h('div', { class: 'dots' }, items.slice(0, 3).map((s) => h('i', { class: s.remind ? toneOf(daysUntil(s.payDate)) : '' }))));
        cell.tabIndex = 0;
        const pick = () => { selected = selected === iso ? null : iso; drawCalendar(); highlight(); };
        cell.addEventListener('click', pick);
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      }
      cells.push(cell);
    }
    calGrid.replaceChildren(...cells);

    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    const totals = {};
    for (const s of store.servers) {
      if (s.payDate.startsWith(prefix) && s.price != null) totals[s.currency] = (totals[s.currency] || 0) + s.price;
    }
    const chips = Object.entries(totals).map(([cur, sum]) => h('span', { class: 'chip', text: fmtMoney(sum, cur) }));
    money.replaceChildren(h('span', { class: 'muted', style: { width: '100%', fontSize: '12.5px' }, text: `К оплате в этом месяце${chips.length ? '' : ': нет платежей с указанной ценой'}` }), ...chips);
  }

  function item(s) {
    const left = daysUntil(s.payDate);
    const tone = s.remind ? toneOf(left) : '';
    const paid = h('button', { class: 'btn btn-ok btn-sm', type: 'button' }, icon('check', 'i-sm'), 'Оплачено');
    paid.addEventListener('click', () => markPaid(s, paid));
    return h('div', { class: 'tl-item', dataset: { date: s.payDate } },
      serverIcon(s, 'mini-icon'),
      h('div', { class: 'txt' }, h('b', { text: s.name }), h('span', { text: [s.hostingName, `${s.host}`].filter(Boolean).join(' · ') })),
      s.price != null && h('div', { class: 'price', text: `${fmtMoney(s.price, s.currency)} ${PERIOD_SHORT[s.period]}`.trim() }),
      h('div', { class: 'when' }, h('b', { text: fmtDate(s.payDate) }), h('span', { class: tone, text: s.remind ? relDays(left) : 'без напоминаний' })),
      paid);
  }

  function drawTimeline() {
    const groups = [
      ['Просрочено', 'danger', (s, d) => s.remind && d < 0],
      ['Ближайшие 7 дней', '', (s, d) => s.remind && d >= 0 && d <= 7],
      ['В течение месяца', '', (s, d) => s.remind && d > 7 && d <= 31],
      ['Позже', '', (s, d) => s.remind && d > 31],
      ['Без напоминаний', '', (s) => !s.remind],
    ];
    const blocks = groups.map(([title, tone, test]) => {
      const list = store.servers.filter((s) => test(s, daysUntil(s.payDate)));
      if (!list.length) return null;
      return h('div', { class: `tl-group ${tone}` },
        h('h3', null, title, h('span', { class: 'cnt', text: String(list.length) })),
        h('div', { class: 'tl-list' }, list.map(item)));
    }).filter(Boolean);
    timeline.replaceChildren(...(blocks.length ? blocks : [h('p', { class: 'muted', text: 'Серверов пока нет — добавьте первый, и здесь появится график оплат.' })]));
    highlight();
  }

  function highlight() {
    for (const el of timeline.querySelectorAll('.tl-item')) el.classList.toggle('hl', el.dataset.date === selected);
    if (selected) timeline.querySelector('.tl-item.hl')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function drawHistory() {
    try {
      const rows = await api('/api/payments');
      histEmpty.hidden = rows.length > 0;
      histBody.replaceChildren(...rows.map((p, i) => h('tr', { style: { '--i': Math.min(i, 20) } },
        h('td', { text: fmtDateTime(p.paidAt) }),
        h('td', null, h('b', { text: p.serverName }), p.serverId == null && h('span', { class: 'dim', text: ' (удалён)' })),
        h('td', { text: fmtDate(p.dueDate) }),
        h('td', { class: 'mono', text: p.amount != null ? fmtMoney(p.amount, p.currency) : '—' }))));
    } catch (e) {
      histEmpty.textContent = e.message;
      histEmpty.hidden = false;
    }
  }

  drawCalendar();
  drawTimeline();
  drawHistory();
  return subscribe((kind) => {
    if (kind !== 'servers') return;
    drawCalendar();
    drawTimeline();
    drawHistory();
  });
}
