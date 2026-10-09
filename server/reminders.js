import { audit } from './audit.js';
import { daysBetween, fmtDate, plural, todayISO } from './dates.js';
import { getSetting, q, tx } from './db.js';
import { esc, notify, telegramReady } from './telegram.js';

export const DEFAULT_DAYS = [7, 3, 1, 0];
const OVERDUE_DAYS = 7;
const SYMBOLS = { RUB: '₽', USD: '$', EUR: '€', USDT: 'USDT' };

export function remindDays() {
  const raw = getSetting('remind_days');
  if (!raw) return DEFAULT_DAYS;
  const days = raw.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 60);
  return days.length ? [...new Set(days)].sort((a, b) => b - a) : DEFAULT_DAYS;
}

export const remindHour = () => Number(getSetting('remind_hour', '10'));

function line(s, left) {
  const where = s.hosting_name ? ` (${esc(s.hosting_name)})` : '';
  const price = s.price != null ? ` · ${s.price} ${SYMBOLS[s.currency] || s.currency || ''}` : '';
  let when;
  let dot;
  if (left < 0) {
    dot = '🔴';
    when = `<b>просрочено на ${-left} ${plural(-left, 'день', 'дня', 'дней')}</b>`;
  } else if (left === 0) {
    dot = '🟠';
    when = '<b>оплата сегодня!</b>';
  } else if (left === 1) {
    dot = '🟡';
    when = 'завтра';
  } else {
    dot = '🔵';
    when = `через ${left} ${plural(left, 'день', 'дня', 'дней')}`;
  }
  return `${dot} <b>${esc(s.name)}</b>${where} — ${when} (${fmtDate(s.pay_date)})${price}`;
}

/** Отправляет одно сводное сообщение со всеми серверами, по которым пора напомнить. */
export async function runReminders({ force = false } = {}) {
  if (!telegramReady() || (!force && new Date().getHours() < remindHour())) return 0;
  const today = todayISO();
  const days = remindDays();
  const servers = q('SELECT id, name, hosting_name, pay_date, price, currency FROM servers WHERE remind = 1').all();
  const items = [];
  for (const s of servers) {
    const left = daysBetween(today, s.pay_date);
    let mark = null;
    if (left < 0) {
      if (left >= -OVERDUE_DAYS) mark = left;
    } else {
      const due = days.filter((d) => d >= left);
      if (due.length) mark = Math.min(...due);
    }
    if (mark == null) continue;
    if (q('SELECT 1 FROM reminders_sent WHERE server_id = ? AND due_date = ? AND mark = ?').get(s.id, s.pay_date, mark)) continue;
    items.push({ s, left, mark });
  }
  if (!items.length) return 0;

  items.sort((a, b) => a.left - b.left);
  const text = `🔔 <b>Напоминание об оплате</b>\n\n${items.map((i) => line(i.s, i.left)).join('\n')}`;
  await notify(text);
  tx(() => {
    for (const { s, mark } of items) {
      q('INSERT OR IGNORE INTO reminders_sent (server_id, due_date, mark, sent_at) VALUES (?, ?, ?, ?)').run(s.id, s.pay_date, mark, Date.now());
    }
  });
  audit('reminder_sent', null, items.map((i) => i.s.name).join(', '));
  return items.length;
}

export function startReminders() {
  const tick = () => runReminders().catch((e) => console.warn('[reminders]', e.message));
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 5 * 60_000).unref();
}
