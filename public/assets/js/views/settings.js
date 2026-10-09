import {
  api, confirmDialog, copyText, fmtDateTime, h, icon, openModal, passwordPrompt, segmented, setLoading,
  strengthMeter, timeAgo, toISO, toast, toggle,
} from '../lib.js';
import { loadServers, store } from '../state.js';
import { shortUa } from './audit.js';

const pwInput = (placeholder, autocomplete = 'current-password') => h('input', { class: 'input', type: 'password', placeholder, autocomplete, maxlength: 256 });
const field = (label, control, hint) => h('div', { class: 'field' }, h('label', { text: label }), control, hint);

function section(title, iconName, desc, i) {
  const body = h('div', { class: 'stack' });
  const el = h('section', { class: 'section panel', style: { '--i': i } },
    h('div', { class: 'section-head' }, icon(iconName), h('h2', { text: title })),
    desc && h('p', { class: 'desc', text: desc }),
    body);
  return { el, body };
}

function errorBox() {
  const el = h('div', { class: 'form-error', hidden: true });
  el.show = (msg) => { el.replaceChildren(icon('alert', 'i-sm'), msg); el.hidden = false; };
  el.clear = () => { el.hidden = true; };
  return el;
}

function download(name, text, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ───── смена пароля ───── */

function passwordSection(i) {
  const s = section('Пароль администратора', 'key', 'Пароль — это и ключ шифрования. При смене данные перешифровываются, а остальные сессии завершаются.', i);
  const current = pwInput('Текущий пароль');
  const next = pwInput('Новый пароль (от 10 символов)', 'new-password');
  const repeat = pwInput('Повторите новый пароль', 'new-password');
  const err = errorBox();
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), 'Сменить пароль');
  const form = h('form', { class: 'stack', novalidate: true }, current, next, strengthMeter(next), repeat, err, h('div', null, btn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.clear();
    if (next.value.length < 10) return err.show('Новый пароль должен быть не короче 10 символов');
    if (next.value !== repeat.value) return err.show('Новые пароли не совпадают');
    setLoading(btn, true);
    try {
      await api('/api/auth/password', { method: 'POST', body: { current: current.value, next: next.value } });
      form.reset();
      next.dispatchEvent(new Event('input'));
      toast('Пароль изменён. Остальные сессии завершены.', 'ok');
    } catch (ex) {
      err.show(ex.message);
    } finally {
      setLoading(btn, false);
    }
  });
  s.body.append(form);
  return s.el;
}

/* ───── 2FA ───── */

function showRecoveryCodes(codes) {
  const text = `ServerVault — резервные коды 2FA\nСоздано: ${fmtDateTime(Date.now())}\nКаждый код можно использовать один раз.\n\n${codes.join('\n')}\n`;
  const m = openModal({
    title: 'Резервные коды',
    iconName: 'hash',
    content: h('div', { class: 'stack' },
      h('p', { text: 'Сохраните коды в надёжном месте. Они понадобятся, если телефон будет потерян. Повторно показать их нельзя.' }),
      h('div', { class: 'codes' }, codes.map((c, i) => h('code', { text: c, style: { '--i': i } })))),
    footer: [
      h('button', { class: 'btn', type: 'button', onClick: () => copyText(codes.join('\n'), 'Коды скопированы') }, icon('copy'), 'Копировать'),
      h('button', { class: 'btn', type: 'button', onClick: () => download(`servervault-recovery-${toISO(new Date())}.txt`, text, 'text/plain') }, icon('download'), 'Скачать .txt'),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => m.close() }, 'Я сохранил'),
    ],
  });
}

async function enable2fa(onDone) {
  let setup;
  try {
    setup = await api('/api/auth/totp/setup', { method: 'POST' });
  } catch (e) {
    return toast(e.message, 'error');
  }
  const code = h('input', { class: 'input mono', inputmode: 'numeric', maxlength: 6, placeholder: '123456', autocomplete: 'one-time-code', autofocus: true, style: { fontSize: '20px', letterSpacing: '0.3em', textAlign: 'center' } });
  const err = errorBox();
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('shieldCheck'), 'Включить 2FA');
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'qr-box' },
      h('img', { src: setup.qr, alt: 'QR-код для приложения-аутентификатора', width: 180, height: 180 }),
      h('div', { class: 'stack' },
        h('p', { class: 'muted', text: '1. Отсканируйте QR-код в Google Authenticator, Aegis, 2FAS или другом приложении.' }),
        h('p', { class: 'muted', text: 'Или введите ключ вручную:' }),
        h('div', { class: 'secret-code', text: setup.secret }))),
    field('2. Введите 6-значный код из приложения', code),
    err);
  const m = openModal({
    title: 'Включение 2FA',
    iconName: 'phone',
    content: form,
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Отмена'), btn],
  });
  btn.addEventListener('click', (e) => { e.preventDefault(); form.requestSubmit(); });
  code.addEventListener('input', () => {
    code.value = code.value.replace(/\D/g, '').slice(0, 6);
    if (code.value.length === 6) form.requestSubmit();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.clear();
    if (code.value.length !== 6) return err.show('Введите 6 цифр');
    setLoading(btn, true);
    try {
      const res = await api('/api/auth/totp/enable', { method: 'POST', body: { code: code.value } });
      m.close();
      toast('Двухфакторная защита включена', 'ok');
      showRecoveryCodes(res.recoveryCodes);
      onDone();
    } catch (ex) {
      err.show(ex.message);
      code.select();
    } finally {
      setLoading(btn, false);
    }
  });
}

function twoFaSection(i) {
  const s = section('Двухфакторная аутентификация', 'phone', 'Код из приложения на телефоне при каждом входе. Даже украденный пароль не даст войти.', i);
  async function draw() {
    const me = await api('/api/auth/me');
    store.me = me;
    if (!me.totp) {
      s.body.replaceChildren(
        h('div', { class: 'status-line' }, h('span', { class: 'badge warn', text: 'Выключена' }), h('div', { class: 'txt' }, h('b', { text: 'Рекомендуем включить' }), h('span', { text: 'Защита от входа по украденному паролю' }))),
        h('div', null, h('button', { class: 'btn btn-primary', type: 'button', onClick: () => enable2fa(draw) }, icon('shieldCheck'), 'Включить 2FA')));
      return;
    }
    const regen = h('button', { class: 'btn', type: 'button' }, icon('hash'), 'Новые резервные коды');
    regen.addEventListener('click', async () => {
      const res = await passwordPrompt({
        title: 'Новые резервные коды',
        text: 'Старые коды перестанут работать.',
        okText: 'Создать',
        onSubmit: (password) => api('/api/auth/recovery', { method: 'POST', body: { password } }),
      });
      if (res?.recoveryCodes) { showRecoveryCodes(res.recoveryCodes); draw(); }
    });
    const disable = h('button', { class: 'btn btn-danger', type: 'button' }, icon('power'), 'Отключить');
    disable.addEventListener('click', async () => {
      const ok = await passwordPrompt({
        title: 'Отключить 2FA?',
        text: 'Вход будет защищён только паролем.',
        okText: 'Отключить',
        danger: true,
        onSubmit: (password) => api('/api/auth/totp/disable', { method: 'POST', body: { password } }),
      });
      if (ok) { toast('2FA отключена', 'warn'); draw(); }
    });
    s.body.replaceChildren(
      h('div', { class: 'status-line' }, h('span', { class: 'badge ok', text: 'Включена' }),
        h('div', { class: 'txt' }, h('b', { text: 'Аккаунт защищён' }), h('span', { text: `Резервных кодов осталось: ${me.recoveryLeft}` }))),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, regen, disable));
  }
  draw().catch((e) => s.body.replaceChildren(h('p', { class: 'muted', text: e.message })));
  return s.el;
}

/* ───── Telegram ───── */

function telegramSection(i) {
  const s = section('Telegram-напоминания', 'send', 'Бот пришлёт напоминание об оплате и сообщит, если сервер перестал отвечать.', i);

  async function draw() {
    const st = await api('/api/settings');
    const tg = st.telegram;

    const token = h('input', { class: 'input mono', placeholder: tg.hasToken ? 'Токен сохранён — введите новый, чтобы заменить' : '123456789:AAH…', autocomplete: 'off', spellcheck: 'false' });
    const saveToken = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сохранить');
    const err = errorBox();
    saveToken.addEventListener('click', async () => {
      err.clear();
      if (!token.value.trim()) return err.show('Вставьте токен от @BotFather');
      setLoading(saveToken, true);
      try {
        const r = await api('/api/telegram/token', { method: 'POST', body: { token: token.value.trim() } });
        toast(`Бот @${r.botName} подключён`, 'ok');
        draw();
      } catch (ex) {
        err.show(ex.message);
      } finally {
        setLoading(saveToken, false);
      }
    });

    const detect = h('button', { class: 'btn btn-primary', type: 'button', disabled: !tg.hasToken }, icon('search'), 'Найти мой чат');
    detect.addEventListener('click', async () => {
      err.clear();
      setLoading(detect, true);
      try {
        const r = await api('/api/telegram/detect', { method: 'POST' });
        toast(`Чат найден: ${r.chatTitle}`, 'ok');
        draw();
      } catch (ex) {
        err.show(ex.message);
      } finally {
        setLoading(detect, false);
      }
    });

    const steps = h('div', { class: 'steps' },
      h('div', { class: `step${tg.hasToken ? ' done' : ''}` },
        h('b', { text: tg.hasToken ? `Бот подключён: @${tg.botName}` : 'Создайте бота в @BotFather и вставьте токен' }),
        h('div', { class: 'row' }, token, saveToken)),
      h('div', { class: `step${tg.ready ? ' done' : ''}` },
        h('b', { text: tg.ready ? `Чат привязан: ${tg.chatTitle}` : 'Отправьте боту /start и нажмите кнопку' }),
        h('div', { class: 'row', style: { flexWrap: 'wrap' } },
          tg.hasToken && h('a', { class: 'btn', href: `https://t.me/${encodeURIComponent(tg.botName || '')}`, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Открыть бота'),
          detect)));

    const actions = [];
    if (tg.ready) {
      const test = h('button', { class: 'btn', type: 'button' }, icon('send'), 'Тестовое сообщение');
      test.addEventListener('click', async () => {
        setLoading(test, true);
        try {
          await api('/api/telegram/test', { method: 'POST' });
          toast('Сообщение отправлено — проверьте Telegram', 'ok');
        } catch (ex) {
          toast(ex.message, 'error');
        } finally {
          setLoading(test, false);
        }
      });
      const now = h('button', { class: 'btn', type: 'button' }, icon('bell'), 'Проверить напоминания');
      now.addEventListener('click', async () => {
        setLoading(now, true);
        try {
          const r = await api('/api/telegram/remind-now', { method: 'POST' });
          toast(r.sent ? `Отправлено напоминаний: ${r.sent}` : 'Сейчас напоминать не о чем (или уже напомнили)', r.sent ? 'ok' : 'info');
        } catch (ex) {
          toast(ex.message, 'error');
        } finally {
          setLoading(now, false);
        }
      });
      actions.push(test, now);
    }
    if (tg.hasToken) {
      const remove = h('button', { class: 'btn btn-danger', type: 'button' }, icon('trash'), 'Отключить');
      remove.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Отключить Telegram?', text: 'Токен бота будет удалён, напоминания перестанут приходить.', okText: 'Отключить', danger: true }))) return;
        await api('/api/telegram', { method: 'DELETE' }).catch((ex) => toast(ex.message, 'error'));
        toast('Telegram отключён', 'warn');
        draw();
      });
      actions.push(remove);
    }

    s.body.replaceChildren(
      h('div', { class: 'status-line' },
        h('span', { class: `badge ${tg.ready ? 'ok' : 'warn'}`, text: tg.ready ? 'Работает' : 'Не настроен' }),
        h('div', { class: 'txt' }, h('b', { text: tg.ready ? 'Напоминания приходят в Telegram' : 'Напоминания только в панели' }),
          h('span', { text: tg.ready ? `Получатель: ${tg.chatTitle}` : 'Подключите бота за пару шагов' }))),
      steps, err,
      ...(actions.length ? [h('div', { class: 'row', style: { flexWrap: 'wrap' } }, actions)] : []));
  }
  draw().catch((e) => s.body.replaceChildren(h('p', { class: 'muted', text: e.message })));
  return s.el;
}

/* ───── параметры напоминаний ───── */

function remindersSection(i) {
  const s = section('Параметры напоминаний', 'bell', null, i);
  async function draw() {
    const st = await api('/api/settings');
    let days = new Set(st.remindDays);
    const save = async (patch, message = 'Сохранено') => {
      try {
        await api('/api/settings', { method: 'PUT', body: patch });
        toast(message, 'ok', 1800);
      } catch (e) {
        toast(e.message, 'error');
        draw();
      }
    };
    const chips = h('div', { class: 'chips' }, [30, 14, 7, 5, 3, 2, 1, 0].map((d) => {
      const b = h('button', { type: 'button', class: `chip-toggle${days.has(d) ? ' on' : ''}`, text: d === 0 ? 'В день оплаты' : `За ${d} дн.` });
      b.addEventListener('click', () => {
        if (days.has(d) && days.size === 1) return toast('Нужен хотя бы один день', 'warn');
        days.has(d) ? days.delete(d) : days.add(d);
        b.classList.toggle('on', days.has(d));
        save({ remindDays: [...days] });
      });
      return b;
    }));
    const hour = h('select', { class: 'input', style: { maxWidth: '160px' } }, Array.from({ length: 24 }, (_, hh) => h('option', { value: hh, text: `${String(hh).padStart(2, '0')}:00` })));
    hour.value = String(st.remindHour);
    hour.addEventListener('change', () => save({ remindHour: Number(hour.value) }));
    const down = toggle('Сообщать о недоступности сервера', st.downAlerts, 'После 3 неудачных проверок подряд и при восстановлении');
    down.input.addEventListener('change', () => save({ downAlerts: down.input.checked }));

    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const notifyBtn = h('button', { class: 'btn', type: 'button', disabled: perm !== 'default' }, icon('bell'),
      perm === 'granted' ? 'Уведомления браузера включены' : perm === 'denied' ? 'Уведомления запрещены в браузере' : perm === 'unsupported' ? 'Браузер не поддерживает' : 'Включить уведомления браузера');
    notifyBtn.addEventListener('click', async () => {
      const r = await Notification.requestPermission();
      if (r === 'granted') new Notification('ServerVault', { body: 'Уведомления включены — напомним об оплате серверов.', icon: '/assets/img/logo.svg' });
      draw();
    });

    s.body.replaceChildren(
      field('Когда напоминать в Telegram', chips, h('span', { class: 'hint', text: 'Просроченные — ежедневно в течение недели' })),
      field('Время отправки (не раньше)', hour),
      down,
      field('Пока панель открыта', h('div', null, notifyBtn)));
  }
  draw().catch((e) => s.body.replaceChildren(h('p', { class: 'muted', text: e.message })));
  return s.el;
}

/* ───── сессии ───── */

function sessionsSection(i) {
  const s = section('Активные сессии', 'monitor', 'Где сейчас открыта панель. Сессии хранятся только в памяти сервера.', i);
  async function draw() {
    const list = await api('/api/auth/sessions');
    s.body.replaceChildren(h('div', null, list.map((x) => {
      const end = !x.current && h('button', { class: 'btn btn-danger btn-sm', type: 'button' }, 'Завершить');
      end?.addEventListener('click', async () => {
        try {
          await api(`/api/auth/sessions/${encodeURIComponent(x.id)}`, { method: 'DELETE' });
          toast('Сессия завершена', 'ok');
          draw();
        } catch (e) {
          toast(e.message, 'error');
        }
      });
      return h('div', { class: 'sess' },
        h('div', { class: 'e-icon' }, icon(/Android|iPhone|iPad/.test(x.ua) ? 'phone' : 'monitor')),
        h('div', { class: 'txt' },
          h('b', { text: `${shortUa(x.ua) || 'Неизвестно'}${x.current ? ' — это устройство' : ''}` }),
          h('span', { text: `IP ${x.ip} · вход ${fmtDateTime(x.createdAt)} · активность ${timeAgo(x.lastSeen)}` })),
        x.current ? h('span', { class: 'badge ok', text: 'Текущая' }) : end);
    })));
  }
  draw().catch((e) => s.body.replaceChildren(h('p', { class: 'muted', text: e.message })));
  return s.el;
}

/* ───── бэкап ───── */

function exportBackup() {
  const p1 = pwInput('Пароль для файла (от 8 символов)', 'new-password');
  const p2 = pwInput('Повторите пароль', 'new-password');
  const err = errorBox();
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('download'), 'Скачать бэкап');
  const form = h('form', { class: 'stack', novalidate: true },
    h('p', { class: 'muted', text: 'Файл будет зашифрован AES-256-GCM с этим паролем. Без него восстановить данные невозможно.' }),
    p1, strengthMeter(p1), p2, err);
  const m = openModal({ title: 'Экспорт резервной копии', iconName: 'download', content: form, footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Отмена'), btn] });
  btn.addEventListener('click', (e) => { e.preventDefault(); form.requestSubmit(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.clear();
    if (p1.value.length < 8) return err.show('Пароль должен быть не короче 8 символов');
    if (p1.value !== p2.value) return err.show('Пароли не совпадают');
    setLoading(btn, true);
    try {
      const file = await api('/api/backup/export', { method: 'POST', body: { password: p1.value } });
      download(`servervault-${toISO(new Date())}.svbak`, JSON.stringify(file));
      m.close();
      toast('Резервная копия скачана', 'ok');
    } catch (ex) {
      err.show(ex.message);
    } finally {
      setLoading(btn, false);
    }
  });
}

function importBackup() {
  let mode = 'merge';
  const file = h('input', { class: 'input', type: 'file', accept: '.svbak,application/json' });
  const pass = pwInput('Пароль от файла бэкапа');
  const account = pwInput('Пароль от панели (для подтверждения)');
  const accountField = field('Подтверждение', account, h('span', { class: 'hint', text: 'Все текущие серверы будут удалены и заменены данными из файла' }));
  accountField.hidden = true;
  const seg = segmented([['merge', 'Добавить к текущим'], ['replace', 'Заменить всё']], mode, (v) => { mode = v; accountField.hidden = v !== 'replace'; });
  const err = errorBox();
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('upload'), 'Восстановить');
  const form = h('form', { class: 'stack', novalidate: true }, field('Файл .svbak', file), pass, field('Режим', seg), accountField, err);
  const m = openModal({ title: 'Импорт резервной копии', iconName: 'upload', content: form, footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Отмена'), btn] });
  btn.addEventListener('click', (e) => { e.preventDefault(); form.requestSubmit(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.clear();
    const f = file.files?.[0];
    if (!f) return err.show('Выберите файл');
    if (f.size > 15 * 1024 * 1024) return err.show('Файл слишком большой');
    if (!pass.value) return err.show('Введите пароль от файла');
    if (mode === 'replace' && !account.value) return err.show('Подтвердите паролем от панели');
    setLoading(btn, true);
    try {
      const r = await api('/api/backup/import', { method: 'POST', body: { file: await f.text(), password: pass.value, mode, accountPassword: account.value } });
      m.close();
      await loadServers();
      toast(`Восстановлено серверов: ${r.count}`, 'ok');
    } catch (ex) {
      err.show(ex.message);
    } finally {
      setLoading(btn, false);
    }
  });
}

function backupSection(i) {
  const s = section('Резервная копия', 'database', 'Все серверы, пароли, иконки и история оплат в одном зашифрованном файле.', i);
  s.body.append(h('div', { class: 'row', style: { flexWrap: 'wrap' } },
    h('button', { class: 'btn btn-primary', type: 'button', onClick: exportBackup }, icon('download'), 'Экспорт'),
    h('button', { class: 'btn', type: 'button', onClick: importBackup }, icon('upload'), 'Импорт')));
  return s.el;
}

export function render(root) {
  root.append(h('div', { class: 'settings' },
    twoFaSection(0),
    telegramSection(1),
    remindersSection(2),
    passwordSection(3),
    sessionsSection(4),
    backupSection(5)));
}
