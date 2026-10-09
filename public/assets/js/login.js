import { startNetwork } from './bg.js';
import { $, $$, api, h, icon, installEffects, setLoading, strengthMeter, toast } from './lib.js';

installEffects();
startNetwork($('#net'));

for (const el of $$('[data-icon]')) el.replaceWith(icon(el.dataset.icon, el.className));
$$('.features li').forEach((li, i) => li.style.setProperty('--i', i));

const card = $('#card');
const alertBox = $('#alert');
const forms = { login: $('#login-form'), totp: $('#totp-form'), setup: $('#setup-form') };

function showError(message) {
  alertBox.replaceChildren(icon('alert', 'i-sm'), h('span', { text: message }));
  alertBox.hidden = false;
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
}
const clearError = () => { alertBox.hidden = true; };

function show(name, title, sub) {
  clearError();
  for (const [key, form] of Object.entries(forms)) {
    form.hidden = key !== name;
    form.classList.toggle('swap-in', key === name);
  }
  $('#card-title').textContent = title;
  $('#card-sub').textContent = sub;
  setTimeout(() => forms[name].querySelector('input:not([hidden])')?.focus(), 60);
}

function success() {
  card.classList.add('success');
  setTimeout(() => card.classList.add('leave'), 450);
  setTimeout(() => location.replace('/'), 850);
}

/* ───── показать пароль / Caps Lock ───── */

for (const btn of $$('[data-toggle]')) {
  btn.addEventListener('click', () => {
    const input = $(`#${btn.dataset.toggle}`);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
    btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    input.focus();
  });
}

for (const input of $$('input[type=password]')) {
  const handler = (e) => {
    const caps = e.getModifierState?.('CapsLock');
    for (const el of $$('.caps', input.closest('form'))) el.hidden = !caps;
  };
  input.addEventListener('keydown', handler);
  input.addEventListener('keyup', handler);
}

/* ───── вход ───── */

forms.login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#l-user').value.trim();
  const password = $('#l-pass').value;
  if (!username || !password) return showError('Введите логин и пароль');
  const btn = forms.login.querySelector('[type=submit]');
  setLoading(btn, true);
  clearError();
  try {
    const res = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    if (res.need2fa) showTotp();
    else success();
  } catch (err) {
    showError(err.message);
    $('#l-pass').select();
  } finally {
    setLoading(btn, false);
  }
});

/* ───── 2FA ───── */

const otp = $('#otp');
const cells = Array.from({ length: 6 }, (_, i) => {
  const input = h('input', { inputmode: 'numeric', maxlength: '1', autocomplete: i === 0 ? 'one-time-code' : 'off', 'aria-label': `Цифра ${i + 1}`, style: { '--i': i } });
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    if (digits.length > 1) return fillOtp(digits, i);
    input.value = digits;
    input.classList.toggle('filled', Boolean(digits));
    if (digits && i < 5) cells[i + 1].focus();
    maybeSubmit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && i > 0) {
      cells[i - 1].value = '';
      cells[i - 1].classList.remove('filled');
      cells[i - 1].focus();
    }
    if (e.key === 'ArrowLeft' && i > 0) cells[i - 1].focus();
    if (e.key === 'ArrowRight' && i < 5) cells[i + 1].focus();
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    fillOtp((e.clipboardData?.getData('text') || '').replace(/\D/g, ''), i);
  });
  input.addEventListener('focus', () => input.select());
  return input;
});
otp.append(...cells);

function fillOtp(digits, from) {
  for (let k = 0; k < digits.length && from + k < 6; k++) {
    cells[from + k].value = digits[k];
    cells[from + k].classList.add('filled');
  }
  cells[Math.min(5, from + digits.length)].focus();
  maybeSubmit();
}

function resetOtp() {
  for (const c of cells) { c.value = ''; c.classList.remove('filled'); }
  cells[0].focus();
}

let submitting = false;
function maybeSubmit() {
  if (cells.every((c) => c.value) && !submitting) forms.totp.requestSubmit();
}

let recoveryMode = false;
function showTotp() {
  recoveryMode = false;
  $('#recovery-wrap').hidden = true;
  otp.hidden = false;
  $('#recovery-btn').textContent = 'Использовать резервный код';
  show('totp', 'Двухфакторная защита', 'Введите 6-значный код из приложения-аутентификатора');
  resetOtp();
}

$('#recovery-btn').addEventListener('click', () => {
  recoveryMode = !recoveryMode;
  $('#recovery-wrap').hidden = !recoveryMode;
  otp.hidden = recoveryMode;
  $('#recovery-btn').textContent = recoveryMode ? 'Ввести код из приложения' : 'Использовать резервный код';
  $('#card-sub').textContent = recoveryMode ? 'Каждый резервный код работает только один раз' : 'Введите 6-значный код из приложения-аутентификатора';
  clearError();
  (recoveryMode ? $('#recovery') : cells[0]).focus();
});

$('#back-btn').addEventListener('click', () => showLogin());

forms.totp.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = recoveryMode ? $('#recovery').value.trim() : cells.map((c) => c.value).join('');
  if (recoveryMode ? code.replace(/[^a-z0-9]/gi, '').length !== 10 : code.length !== 6) return showError('Введите код полностью');
  const btn = forms.totp.querySelector('[type=submit]');
  submitting = true;
  setLoading(btn, true);
  clearError();
  try {
    const res = await api('/api/auth/2fa', { method: 'POST', body: { code } });
    if (res.recoveryLeft !== undefined) sessionStorage.setItem('sv-recovery-left', String(res.recoveryLeft));
    success();
  } catch (err) {
    if (err.code === 'PENDING') {
      showLogin();
      showError(err.message);
    } else {
      showError(err.message);
      if (recoveryMode) $('#recovery').select(); else resetOtp();
    }
  } finally {
    submitting = false;
    setLoading(btn, false);
  }
});

/* ───── первый запуск ───── */

$('#s-strength').replaceWith(strengthMeter($('#s-pass')));

forms.setup.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('#s-token').value.trim();
  const username = $('#s-user').value.trim();
  const password = $('#s-pass').value;
  if (!token || !username || !password) return showError('Заполните все поля');
  if (password.length < 10) return showError('Пароль должен быть не короче 10 символов');
  if (password !== $('#s-pass2').value) return showError('Пароли не совпадают');
  const btn = forms.setup.querySelector('[type=submit]');
  setLoading(btn, true);
  clearError();
  try {
    await api('/api/auth/setup', { method: 'POST', body: { token, username, password } });
    success();
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(btn, false);
  }
});

function showLogin() {
  show('login', 'Вход в панель', 'Введите данные администратора');
}

/* ───── «терминал» в левой части ───── */

const TERM = [
  ['p', '$ '], ['', 'ssh root@vault.local\n'],
  ['ok', '✓ '], ['', 'ключ расшифрован · AES-256-GCM\n'],
  ['p', '$ '], ['', 'vault status --all\n'],
  ['ok', '● '], ['', 'серверы онлайн · ближайшая оплата через 3 дня\n'],
  ['p', '$ '],
];

async function typeTerm() {
  const pre = $('#term');
  if (!pre || matchMedia('(max-width: 960px)').matches) return;
  const cursor = h('span', { class: 'cur' });
  pre.append(cursor);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const [cls, text] of TERM) {
    const span = h('span', { class: cls });
    cursor.before(span);
    const typed = cls === '' && !text.startsWith('ключ') && !text.startsWith('серверы');
    for (const ch of text) {
      span.textContent += ch;
      if (!reduce) await new Promise((r) => setTimeout(r, typed ? 45 + Math.random() * 60 : 8));
    }
    if (!reduce && text.endsWith('\n')) await new Promise((r) => setTimeout(r, 380));
  }
}

/* ───── старт ───── */

async function init() {
  const params = new URLSearchParams(location.search);
  if (params.has('expired')) {
    toast('Сессия завершена — войдите снова', 'warn');
    history.replaceState(null, '', '/login');
  }
  setTimeout(typeTerm, 900);
  let state;
  try {
    state = await api('/api/auth/state');
  } catch (err) {
    showLogin();
    return showError(err.message);
  }
  if (state.authenticated) return location.replace('/');
  if (state.setup) show('setup', 'Первый запуск', 'Создайте учётную запись администратора');
  else if (state.pending2fa) showTotp();
  else showLogin();
}

init();
