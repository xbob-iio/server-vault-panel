import { api, fmtDateTime, h, icon, segmented, timeAgo } from '../lib.js';

const EVENTS = {
  setup: ['Создан администратор', 'user', 'ok', 'auth'],
  setup_fail: ['Неверный токен установки', 'alert', 'bad', 'auth'],
  login_ok: ['Успешный вход', 'shieldCheck', 'ok', 'auth'],
  login_fail: ['Неудачная попытка входа', 'alert', 'bad', 'auth'],
  login_locked: ['Вход заблокирован', 'lock', 'bad', 'auth'],
  '2fa_fail': ['Неверный код 2FA', 'alert', 'bad', 'auth'],
  recovery_used: ['Вход по резервному коду', 'hash', 'warn', 'auth'],
  logout: ['Выход из панели', 'logout', '', 'auth'],
  password_change: ['Пароль изменён', 'key', 'warn', 'auth'],
  confirm_fail: ['Неверный пароль при подтверждении', 'alert', 'bad', 'auth'],
  totp_enable: ['2FA включена', 'shieldCheck', 'ok', 'auth'],
  totp_disable: ['2FA отключена', 'shield', 'warn', 'auth'],
  recovery_regen: ['Новые резервные коды', 'hash', 'warn', 'auth'],
  session_revoke: ['Сессия завершена принудительно', 'power', 'warn', 'auth'],
  server_create: ['Добавлен сервер', 'plus', 'ok', 'data'],
  server_update: ['Изменён сервер', 'edit', '', 'data'],
  server_delete: ['Удалён сервер', 'trash', 'warn', 'data'],
  secret_view: ['Доступ к паролю', 'eye', '', 'data'],
  payment: ['Отмечена оплата', 'wallet', 'ok', 'data'],
  backup_export: ['Экспорт резервной копии', 'download', 'warn', 'data'],
  backup_import: ['Импорт резервной копии', 'upload', 'warn', 'data'],
  reminder_sent: ['Напоминание отправлено в Telegram', 'send', '', 'system'],
  server_down: ['Сервер недоступен', 'activity', 'bad', 'system'],
  server_up: ['Сервер снова доступен', 'activity', 'ok', 'system'],
  telegram_set: ['Подключён Telegram-бот', 'send', 'ok', 'system'],
  telegram_chat: ['Привязан чат Telegram', 'send', 'ok', 'system'],
  telegram_remove: ['Telegram отключён', 'send', 'warn', 'system'],
  settings_update: ['Изменены настройки', 'sliders', '', 'system'],
};

const REASONS = { view: 'просмотр', copy: 'копирование', edit: 'редактирование' };

export function shortUa(ua) {
  if (!ua) return '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? 'Яндекс' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|wget|python|node/i.test(ua) ? 'Скрипт' : 'Браузер';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ');
}

let filter = 'all';

export async function render(root) {
  const list = h('div', { class: 'audit-list' });
  const seg = segmented([['all', 'Все'], ['auth', 'Входы и защита'], ['data', 'Данные'], ['system', 'Система'], ['bad', 'Только тревоги']], filter, (v) => { filter = v; draw(); });
  const reload = h('button', { class: 'btn', type: 'button' }, icon('refresh'), 'Обновить');
  reload.addEventListener('click', load);
  root.append(h('div', { class: 'toolbar' }, seg, h('div', { class: 'spacer' }), reload), list);

  let rows = [];
  async function load() {
    list.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: { height: '62px' } })));
    rows = await api('/api/audit?limit=400');
    draw();
  }

  function draw() {
    const visible = rows.filter((r) => {
      const meta = EVENTS[r.event];
      if (filter === 'all') return true;
      if (filter === 'bad') return meta?.[2] === 'bad';
      return meta?.[3] === filter;
    });
    if (!visible.length) {
      list.replaceChildren(h('div', { class: 'empty' }, h('h3', { text: 'Событий нет' }), h('p', { text: 'Здесь появятся входы, изменения и уведомления.' })));
      return;
    }
    list.replaceChildren(...visible.map((r, i) => {
      const [label, iconName, tone] = EVENTS[r.event] || [r.event, 'info', ''];
      let detail = r.detail || '';
      if (r.event === 'secret_view') detail = detail.replace(/\((view|copy|edit)\)$/, (_, k) => `(${REASONS[k]})`);
      const sub = [detail, r.ip && `IP ${r.ip}`, shortUa(r.ua)].filter(Boolean).join(' · ');
      return h('div', { class: `ev ${tone}`, style: { '--i': i } },
        h('div', { class: 'e-icon' }, icon(iconName)),
        h('div', { class: 'e-main' }, h('b', { text: label }), sub && h('span', { text: sub, title: r.ua || '' })),
        h('div', { class: 'e-time' }, h('b', { text: timeAgo(r.ts) }), fmtDateTime(r.ts)));
    }));
  }

  await load();
}
