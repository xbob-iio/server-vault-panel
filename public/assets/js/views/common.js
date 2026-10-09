import {
  api, confirmDialog, daysUntil, fmtDate, fmtDateLong, fmtMoney, h, icon, plural, relDays, svgEl, toast,
} from '../lib.js';
import { removeServer, store, upsertServer } from '../state.js';

export const KIND_LABEL = { vds: 'VDS', vpn: 'VPN', dedicated: 'Dedicated', other: 'Другое' };
export const PERIOD_LABEL = { month: 'Ежемесячно', quarter: 'Раз в 3 месяца', half: 'Раз в полгода', year: 'Раз в год', once: 'Разовая оплата' };
export const PERIOD_SHORT = { month: '/ мес', quarter: '/ 3 мес', half: '/ 6 мес', year: '/ год', once: '' };
export const PERIOD_MONTHS = { month: 1, quarter: 3, half: 6, year: 12 };
const PERIOD_DAYS = { month: 30, quarter: 91, half: 182, year: 365, once: 30 };

export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function iconBtn(name, tip, onClick, extra = '') {
  return h('button', { class: `icon-btn sm ${extra}`.trim(), type: 'button', 'aria-label': tip, 'data-tip': tip, onClick }, icon(name));
}

export function flash(btn) {
  const original = [...btn.childNodes];
  btn.classList.add('copied');
  btn.replaceChildren(icon('check'));
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.replaceChildren(...original);
  }, 1400);
}

const letter = (s) => h('span', { class: 'letter', text: (s.hostingName || s.name || '?').trim().charAt(0).toUpperCase() || '?' });

export function serverIcon(s, extra = '') {
  const box = h('div', { class: `srv-icon ${extra}`.trim() });
  if (s.icon) {
    const img = h('img', { src: s.icon, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.replaceWith(letter(s)));
    box.append(img);
  } else {
    box.append(letter(s));
  }
  return box;
}

export function urgencyOf(s) {
  if (!s.remind) return 'none';
  const left = daysUntil(s.payDate);
  if (left < 0) return 'overdue';
  if (left <= 3) return 'soon';
  if (left <= 7) return 'week';
  return 'ok';
}

export const toneOf = (left) => (left < 0 ? 'danger' : left <= 3 ? 'warn' : '');

export function statusOf(s) {
  if (!s.monitor) return { cls: 'unk', text: 'Мониторинг выключен' };
  const st = store.status[s.id];
  if (!st) return { cls: 'unk', text: 'Проверка…' };
  return st.online ? { cls: 'on', text: `Онлайн · ${st.ms} мс` } : { cls: 'off', text: 'Недоступен' };
}

export function sparkline(history = [], animate = false) {
  const W = 120;
  const H = 24;
  const svg = svgEl('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (history.length < 2) return svg;
  const values = history.filter((v) => v != null);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, max);
  const step = W / (history.length - 1);
  const points = [];
  history.forEach((v, i) => {
    const x = (i * step).toFixed(1);
    if (v == null) {
      svg.append(svgEl('circle', { class: 'fail', cx: x, cy: H - 3, r: 1.8 }));
    } else {
      const y = (H - 3 - ((v - min) / (max - min || 1)) * (H - 6)).toFixed(1);
      points.push(`${x},${y}`);
    }
  });
  if (points.length > 1) svg.prepend(svgEl('polyline', { points: points.join(' '), class: animate ? 'draw' : '' }));
  return svg;
}

export function payRing(s) {
  const left = daysUntil(s.payDate);
  const total = PERIOD_DAYS[s.period] || 30;
  const frac = left < 0 ? 1 : Math.max(0.03, Math.min(1, left / total));
  const tone = !s.remind ? '' : left < 0 ? 'danger' : left <= 3 ? 'warn' : left <= 7 ? '' : 'ok';
  const r = 21;
  const c = 2 * Math.PI * r;
  const fg = svgEl('circle', { class: 'fg', cx: 25, cy: 25, r, 'stroke-dasharray': c.toFixed(2) });
  fg.style.strokeDashoffset = String(c);
  const svg = svgEl('svg', { viewBox: '0 0 50 50', 'aria-hidden': 'true' });
  svg.append(svgEl('circle', { class: 'bg', cx: 25, cy: 25, r }), fg);
  requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = String(c * (1 - frac)); }));
  const num = left < 0 ? `−${-left}` : left > 999 ? '999+' : String(left);
  const label = left < 0 ? 'долг' : plural(left, 'день', 'дня', 'дней');
  return h('div', { class: `ring ${tone}`, title: relDays(left) }, svg, h('div', { class: 'n' }, num, h('small', { text: label })));
}

export function payInfo(s) {
  const left = daysUntil(s.payDate);
  const price = s.price != null ? ` · ${fmtMoney(s.price, s.currency)} ${PERIOD_SHORT[s.period]}`.trimEnd() : '';
  return h('div', { class: 'pay-info' },
    h('b', { text: `Оплата ${fmtDateLong(s.payDate)}` }),
    h('span', { class: s.remind ? toneOf(left) : '', text: s.remind ? relDays(left) : 'напоминания выкл.' }),
    price && h('span', { text: price }));
}

/** Фейерверк из частиц вокруг элемента. */
export function burst(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const colors = ['#3ccbff', '#2f7bff', '#20d69c', '#ffffff'];
  for (let i = 0; i < 18; i++) {
    const p = h('i', { class: 'burst', style: { left: `${cx}px`, top: `${cy}px`, background: colors[i % colors.length] } });
    document.body.append(p);
    const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
    const dist = 38 + Math.random() * 48;
    p.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0)`, opacity: 0 },
    ], { duration: 650 + Math.random() * 350, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => p.remove();
  }
}

export async function markPaid(s, btn) {
  const months = PERIOD_MONTHS[s.period];
  const price = s.price != null ? ` (${fmtMoney(s.price, s.currency)})` : '';
  const ok = await confirmDialog({
    title: 'Отметить оплату',
    iconName: 'checkCircle',
    okText: 'Оплачено',
    text: months
      ? `«${s.name}» оплачен${price}? Следующая дата оплаты будет ${fmtDate(addMonths(s.payDate, months))}.`
      : `Отметить «${s.name}» как оплаченный${price}? Это разовая оплата — напоминания для него отключатся.`,
  });
  if (!ok) return;
  try {
    const updated = await api(`/api/servers/${s.id}/paid`, { method: 'POST' });
    if (btn?.isConnected) burst(btn);
    upsertServer(updated);
    toast(months ? `Оплата отмечена · следующая ${fmtDate(updated.payDate)}` : 'Оплата отмечена', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

export async function deleteServer(s, cardEl) {
  const ok = await confirmDialog({
    title: 'Удалить сервер?',
    text: `«${s.name}» и сохранённые для него доступы будут удалены безвозвратно. История оплат останется.`,
    okText: 'Удалить',
    danger: true,
    iconName: 'trash',
  });
  if (!ok) return;
  try {
    await api(`/api/servers/${s.id}`, { method: 'DELETE' });
    if (cardEl?.isConnected) {
      cardEl.classList.add('removing');
      await new Promise((r) => setTimeout(r, 380));
    }
    removeServer(s.id);
    toast('Сервер удалён', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

export function sshCommand(s) {
  const user = s.login ? `${s.login}@` : '';
  return `ssh ${s.port !== 22 ? `-p ${s.port} ` : ''}${user}${s.host}`;
}
