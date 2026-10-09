import {
  api, confirmDialog, copyText, fmtDateTime, generatePassword, h, icon, openModal, plural, setLoading, strengthMeter, timeAgo, toast,
} from '../lib.js';
import { loadServers } from '../state.js';

const CAN = [
  ['eye', 'Видит все серверы: название, IP, статус, даты и стоимость оплаты'],
  ['plus', 'Добавляет свои серверы'],
  ['edit', 'Редактирует, удаляет и отмечает оплату — только у своих'],
  ['key', 'Видит логин и пароль — только у своих серверов'],
];
const CANNOT = [
  ['lock', 'Логины и пароли ваших серверов'],
  ['sliders', 'Настройки, Telegram, бэкап, 2FA'],
  ['list', 'Журнал действий и раздел «Помощники»'],
];

const pwInput = (placeholder, autocomplete = 'new-password') => h('input', { class: 'input', type: 'password', placeholder, autocomplete, maxlength: 256 });

function errorBox() {
  const el = h('div', { class: 'form-error', hidden: true });
  el.show = (msg) => { el.replaceChildren(icon('alert', 'i-sm'), msg); el.hidden = false; };
  el.clear = () => { el.hidden = true; };
  return el;
}

/** Поле пароля с кнопками «сгенерировать» и «показать». */
function passwordWithTools(placeholder) {
  const input = pwInput(placeholder);
  const eye = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Показать', 'data-tip': 'Показать' }, icon('eye'));
  eye.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
  });
  const gen = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Сгенерировать', 'data-tip': 'Сгенерировать' }, icon('wand'));
  gen.addEventListener('click', () => {
    input.value = generatePassword({ length: 16, symbols: false, noAmbiguous: true });
    input.type = 'text';
    eye.replaceChildren(icon('eyeOff'));
    input.dispatchEvent(new Event('input'));
  });
  return { input, group: h('div', { class: 'input-group' }, input, h('div', { class: 'trail' }, gen, eye)) };
}

function showCredentials(username, password) {
  const text = `Панель: ${location.origin}\nЛогин: ${username}\nПароль: ${password}`;
  const m = openModal({
    title: 'Данные для входа помощника',
    iconName: 'checkCircle',
    content: h('div', { class: 'stack' },
      h('p', { text: 'Передайте их помощнику надёжным способом. Пароль больше нигде не показывается.' }),
      h('pre', { class: 'secret-code', text })),
    footer: [
      h('button', { class: 'btn', type: 'button', onClick: () => copyText(text, 'Данные скопированы') }, icon('copy'), 'Копировать'),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => m.close() }, 'Готово'),
    ],
  });
}

/** Модалка с паролем помощника + подтверждением паролем администратора. */
function passwordModal({ title, iconName, withUsername, okText, submit }) {
  const username = h('input', { class: 'input', placeholder: 'Логин помощника (латиница, цифры, _ . -)', maxlength: 32, autocomplete: 'off', spellcheck: 'false', autofocus: true });
  const pass = passwordWithTools('Пароль помощника (от 10 символов)');
  const admin = pwInput('Ваш пароль администратора', 'current-password');
  const err = errorBox();
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), okText);
  const form = h('form', { class: 'stack', novalidate: true },
    withUsername && h('div', { class: 'field' }, h('label', { text: 'Логин' }), username),
    h('div', { class: 'field' }, h('label', { text: 'Пароль' }), pass.group, strengthMeter(pass.input)),
    h('div', { class: 'field' }, h('label', { text: 'Подтверждение' }), admin,
      h('span', { class: 'hint', text: 'Для выдачи доступа к хранилищу нужен ваш пароль' })),
    err);
  const m = openModal({ title, iconName, content: form, footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Отмена'), btn] });
  btn.addEventListener('click', (e) => { e.preventDefault(); form.requestSubmit(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.clear();
    if (withUsername && !username.value.trim()) return err.show('Введите логин');
    if (pass.input.value.length < 10) return err.show('Пароль помощника — не короче 10 символов');
    if (!admin.value) return err.show('Введите ваш пароль для подтверждения');
    setLoading(btn, true);
    try {
      await submit({ username: username.value.trim(), password: pass.input.value, adminPassword: admin.value });
      m.close();
    } catch (ex) {
      err.show(ex.message);
    } finally {
      setLoading(btn, false);
    }
  });
}

export function render(root) {
  const list = h('div', { class: 'team-list' });
  const addBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('userPlus'), 'Новый помощник');

  const rights = h('section', { class: 'section panel anim-in team-rights' },
    h('div', { class: 'section-head' }, icon('shieldCheck'), h('h2', { text: 'Что может помощник' })),
    h('div', { class: 'rights' },
      h('ul', { class: 'can' }, CAN.map(([i, t]) => h('li', null, icon(i, 'i-sm'), t))),
      h('ul', { class: 'cannot' }, CANNOT.map(([i, t]) => h('li', null, icon(i, 'i-sm'), t)))));

  const people = h('section', { class: 'section panel anim-in', style: { '--i': 1 } },
    h('div', { class: 'section-head' }, icon('users'), h('h2', { text: 'Профили' }), addBtn),
    list);

  root.append(h('div', { class: 'team' }, people, rights));

  addBtn.addEventListener('click', () => passwordModal({
    title: 'Новый помощник',
    iconName: 'userPlus',
    withUsername: true,
    okText: 'Создать',
    submit: async (body) => {
      await api('/api/users', { method: 'POST', body });
      toast(`Помощник «${body.username}» создан`, 'ok');
      showCredentials(body.username, body.password);
      draw();
    },
  }));

  function card(u, i) {
    const reset = h('button', { class: 'btn btn-sm', type: 'button' }, icon('key', 'i-sm'), 'Сменить пароль');
    reset.addEventListener('click', () => passwordModal({
      title: `Новый пароль для «${u.username}»`,
      iconName: 'key',
      okText: 'Сохранить',
      submit: async (body) => {
        await api(`/api/users/${u.id}/password`, { method: 'POST', body: { password: body.password, adminPassword: body.adminPassword } });
        toast('Пароль изменён, сессии помощника завершены', 'ok');
        showCredentials(u.username, body.password);
        draw();
      },
    }));

    const block = h('button', { class: `btn btn-sm ${u.disabled ? 'btn-ok' : ''}`, type: 'button' }, icon(u.disabled ? 'checkCircle' : 'ban', 'i-sm'), u.disabled ? 'Разблокировать' : 'Заблокировать');
    block.addEventListener('click', async () => {
      if (!u.disabled && !(await confirmDialog({ title: 'Заблокировать помощника?', text: `«${u.username}» сразу выйдет из панели и не сможет войти, пока вы не разблокируете профиль.`, okText: 'Заблокировать', danger: true, iconName: 'ban' }))) return;
      try {
        await api(`/api/users/${u.id}/disabled`, { method: 'POST', body: { disabled: !u.disabled } });
        toast(u.disabled ? 'Профиль разблокирован' : 'Профиль заблокирован', u.disabled ? 'ok' : 'warn');
        draw();
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    const del = h('button', { class: 'icon-btn sm danger', type: 'button', 'aria-label': 'Удалить', 'data-tip': 'Удалить' }, icon('trash'));
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Удалить помощника?',
        text: `Профиль «${u.username}» будет удалён.${u.servers ? ` Его серверы (${u.servers}) перейдут вам.` : ''}`,
        okText: 'Удалить',
        danger: true,
        iconName: 'trash',
      });
      if (!ok) return;
      try {
        await api(`/api/users/${u.id}`, { method: 'DELETE' });
        toast('Помощник удалён', 'ok');
        draw();
        loadServers().catch(() => {});
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    return h('div', { class: `member${u.disabled ? ' off' : ''}`, style: { '--i': i } },
      h('div', { class: 'avatar assistant' }, u.username.charAt(0), u.online && h('i', { class: 'st-dot on' })),
      h('div', { class: 'txt' },
        h('b', null, u.username,
          u.disabled ? h('span', { class: 'badge danger', text: 'заблокирован' }) : u.online ? h('span', { class: 'badge ok', text: 'в сети' }) : null),
        h('span', { text: `${u.servers} ${plural(u.servers, 'сервер', 'сервера', 'серверов')} · создан ${fmtDateTime(u.createdAt)} · ${u.lastLoginAt ? `вход ${timeAgo(u.lastLoginAt)}` : 'ещё не входил'}` })),
      h('div', { class: 'member-acts' }, reset, block, del));
  }

  async function draw() {
    try {
      const users = await api('/api/users');
      list.replaceChildren(...(users.length ? users.map(card) : [h('div', { class: 'empty small' },
        h('div', { class: 'empty-icon' }, icon('users', 'i-lg')),
        h('h3', { text: 'Помощников пока нет' }),
        h('p', { text: 'Создайте профиль — помощник войдёт со своим логином и паролем и сможет добавлять серверы, не видя ваших паролей.' }))]));
    } catch (e) {
      list.replaceChildren(h('p', { class: 'muted', text: e.message }));
    }
  }
  draw();
}
