import {
  api, generatePassword, h, icon, openModal, segmented, setLoading, strengthMeter, toISO, toast, toggle,
} from '../lib.js';
import { upsertServer } from '../state.js';
import { addMonths } from './common.js';

const PERIODS = [['month', 'Ежемесячно'], ['quarter', 'Раз в 3 месяца'], ['half', 'Раз в полгода'], ['year', 'Раз в год'], ['once', 'Разово']];
const CURRENCIES = [['RUB', '₽ RUB'], ['USD', '$ USD'], ['EUR', '€ EUR'], ['USDT', 'USDT']];

const input = (attrs = {}) => h('input', { class: 'input', autocomplete: 'off', spellcheck: 'false', ...attrs });
const select = (options, value) => {
  const el = h('select', { class: 'input' }, options.map(([v, label]) => h('option', { value: v, text: label })));
  el.value = value;
  return el;
};
const fieldBox = (label, control, extra = '', hint = null) => h('div', { class: `field ${extra}`.trim() }, h('label', { text: label }), control, hint);

export function openServerForm(server = null) {
  const isEdit = Boolean(server);
  const today = toISO(new Date());

  const name = input({ placeholder: 'Например: Germany VPN', maxlength: 60, value: server?.name ?? '', autofocus: true });
  let kind = server?.kind || 'vds';
  const kindSeg = segmented([['vds', 'VDS'], ['vpn', 'VPN'], ['dedicated', 'Dedicated'], ['other', 'Другое']], kind, (v) => { kind = v; });

  const host = input({ class: 'input mono', placeholder: '185.10.20.30 или host.example.com', maxlength: 253, value: server?.host ?? '' });
  const port = input({ type: 'number', min: 1, max: 65535, value: server?.port ?? 22, inputmode: 'numeric' });

  const login = input({ class: 'input mono', placeholder: 'root', maxlength: 128, value: server?.login ?? '' });
  const password = input({ class: 'input mono', type: 'password', placeholder: isEdit ? 'Загрузка…' : 'Пароль от сервера', maxlength: 1024, autocomplete: 'new-password' });
  const eyeBtn = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Показать пароль', 'data-tip': 'Показать' }, icon('eye'));
  eyeBtn.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    eyeBtn.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
  });
  const genBtn = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Сгенерировать', 'data-tip': 'Сгенерировать' }, icon('wand'));
  genBtn.addEventListener('click', () => {
    password.value = generatePassword({ length: 20 });
    password.type = 'text';
    eyeBtn.replaceChildren(icon('eyeOff'));
    password.dispatchEvent(new Event('input'));
    genBtn.animate([{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(-25deg) scale(1.2)' }, { transform: 'rotate(0) scale(1)' }], { duration: 450 });
  });
  const passGroup = h('div', { class: 'input-group' }, password, h('div', { class: 'trail' }, genBtn, eyeBtn));

  // сайт хостинга + живая подгрузка иконки
  const preview = h('div', { class: 'host-preview' });
  const setPreview = (src) => preview.replaceChildren(src ? h('img', { src, alt: '' }) : icon('globe', 'i-sm'));
  setPreview(server?.icon);
  const hostingUrl = input({ placeholder: 'aeza.net', maxlength: 300, value: server?.hostingUrl ?? '', inputmode: 'url' });
  const hostingName = input({ placeholder: 'Определится автоматически', maxlength: 60, value: server?.hostingName ?? '' });
  let autoName = !server?.hostingName;
  hostingName.addEventListener('input', () => { autoName = !hostingName.value; });

  let iconTimer = null;
  let iconReq = 0;
  async function fetchIcon(url) {
    const my = ++iconReq;
    preview.replaceChildren(h('i', { class: 'spinner blue' }));
    try {
      const res = await api('/api/icons/fetch', { method: 'POST', body: { url } });
      if (my !== iconReq) return;
      setPreview(res.icon);
      if (res.siteName && (autoName || !hostingName.value)) {
        hostingName.value = res.siteName;
        autoName = true;
        hostingName.animate([{ boxShadow: '0 0 0 4px rgba(60,203,255,.35)' }, { boxShadow: '0 0 0 0 rgba(60,203,255,0)' }], { duration: 900 });
      }
    } catch {
      if (my === iconReq) setPreview(null);
    }
  }
  hostingUrl.addEventListener('input', () => {
    clearTimeout(iconTimer);
    const v = hostingUrl.value.trim();
    if (!/[a-z0-9-]\.[a-z]{2,}/i.test(v)) return setPreview(null);
    iconTimer = setTimeout(() => fetchIcon(v), 650);
  });

  const payDate = input({ type: 'date', value: server?.payDate ?? addMonths(today, 1), min: '2000-01-01', max: '2100-12-31' });
  const chips = h('div', { class: 'date-chips' }, [['+1 мес', 1], ['+3 мес', 3], ['+6 мес', 6], ['+1 год', 12]].map(([label, m]) =>
    h('button', { type: 'button', text: label, onClick: () => { payDate.value = addMonths(today, m); payDate.animate([{ transform: 'scale(1.03)' }, { transform: 'none' }], { duration: 250 }); } })));
  const period = select(PERIODS, server?.period ?? 'month');
  const price = input({ type: 'number', min: 0, step: '0.01', placeholder: '0', value: server?.price ?? '', inputmode: 'decimal' });
  const currency = select(CURRENCIES, server?.currency ?? 'RUB');
  const notes = h('textarea', { class: 'input', rows: 3, maxlength: 4000, placeholder: isEdit ? 'Загрузка…' : 'Панель хостинга, тариф, ключи доступа…', spellcheck: 'false' });

  const remind = toggle('Напоминать об оплате', server?.remind ?? true, 'В панели и в Telegram');
  const monitor = toggle('Мониторить доступность', server?.monitor ?? true, 'TCP-проверка порта');

  const error = h('div', { class: 'form-error', hidden: true });
  const form = h('form', { class: 'srv-form', novalidate: true },
    h('div', { class: 'form-section-title' }, icon('server', 'i-sm'), 'Сервер'),
    h('div', { class: 'form-grid' },
      fieldBox('Название *', name),
      fieldBox('Тип', kindSeg),
      h('div', { class: 'field full' }, h('div', { class: 'third' },
        fieldBox('IP-адрес или домен *', host),
        fieldBox('Порт SSH', port)))),
    h('div', { class: 'form-section-title' }, icon('key', 'i-sm'), 'Доступ'),
    h('div', { class: 'form-grid' },
      fieldBox('Логин', login),
      fieldBox('Пароль', passGroup, '', strengthMeter(password))),
    h('div', { class: 'form-section-title' }, icon('card', 'i-sm'), 'Хостинг и оплата'),
    h('div', { class: 'form-grid' },
      fieldBox('Сайт хостинга', h('div', { class: 'input-group' }, preview, hostingUrl), '', h('span', { class: 'hint', text: 'Иконка подтянется автоматически' })),
      fieldBox('Название хостинга', hostingName),
      fieldBox('Дата оплаты *', payDate, '', chips),
      fieldBox('Периодичность', period),
      h('div', { class: 'field full' }, h('div', { class: 'third' }, fieldBox('Стоимость', price), fieldBox('Валюта', currency)))),
    fieldBox('Заметки', notes),
    h('div', { class: 'toggles' }, remind, monitor),
    error);

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), isEdit ? 'Сохранить' : 'Добавить сервер');
  const modal = openModal({
    title: isEdit ? 'Редактирование сервера' : 'Новый сервер',
    iconName: isEdit ? 'edit' : 'server',
    wide: true,
    content: form,
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => modal.close() }, 'Отмена'), saveBtn],
  });
  saveBtn.addEventListener('click', (e) => { e.preventDefault(); form.requestSubmit(); });

  if (isEdit) {
    password.disabled = true;
    notes.disabled = true;
    api(`/api/servers/${server.id}/secret?reason=edit`).then((secret) => {
      password.value = secret.password;
      notes.value = secret.notes;
      password.dispatchEvent(new Event('input'));
    }).catch((e) => toast(e.message, 'error')).finally(() => {
      password.disabled = false;
      notes.disabled = false;
      password.placeholder = 'Пароль от сервера';
      notes.placeholder = 'Панель хостинга, тариф, ключи доступа…';
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    for (const el of [name, host, payDate]) el.classList.toggle('invalid', !el.value.trim());
    if (!name.value.trim() || !host.value.trim() || !payDate.value) {
      error.replaceChildren(icon('alert', 'i-sm'), 'Заполните обязательные поля: название, адрес и дату оплаты');
      error.hidden = false;
      return;
    }
    if (isEdit && password.disabled) return;
    const body = {
      name: name.value,
      kind,
      host: host.value,
      port: port.value,
      login: login.value,
      password: password.value,
      notes: notes.value,
      hostingUrl: hostingUrl.value,
      hostingName: hostingName.value,
      payDate: payDate.value,
      period: period.value,
      price: price.value,
      currency: currency.value,
      remind: remind.input.checked,
      monitor: monitor.input.checked,
    };
    setLoading(saveBtn, true);
    try {
      const saved = await api(isEdit ? `/api/servers/${server.id}` : '/api/servers', { method: isEdit ? 'PUT' : 'POST', body });
      upsertServer(saved);
      modal.close();
      toast(isEdit ? 'Изменения сохранены' : `Сервер «${saved.name}» добавлен`, 'ok');
      if (!saved.icon && saved.hostingUrl) setTimeout(() => api('/api/servers').then((list) => {
        const fresh = list.find((s) => s.id === saved.id);
        if (fresh?.icon) upsertServer(fresh);
      }).catch(() => {}), 6000);
    } catch (err) {
      error.replaceChildren(icon('alert', 'i-sm'), err.message);
      error.hidden = false;
      modal.box.classList.remove('shake');
      void modal.box.offsetWidth;
      modal.box.classList.add('shake');
    } finally {
      setLoading(saveBtn, false);
    }
  });
}
