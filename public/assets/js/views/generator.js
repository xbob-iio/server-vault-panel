import { copyText, generatePassword, h, icon, passwordStrength, plural, toggle } from '../lib.js';
import { flash } from './common.js';

const opts = { length: 24, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: false };
const recent = [];
const NOISE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*?';

function paint(el, text) {
  el.replaceChildren(...[...text].map((ch) => {
    if (/\d/.test(ch)) return h('span', { class: 'd', text: ch });
    if (/[^a-zA-Z0-9]/.test(ch)) return h('span', { class: 's', text: ch });
    return ch;
  }));
}

function scramble(el, final) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return paint(el, final);
  const start = performance.now();
  const duration = 420;
  const frame = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const fixed = Math.floor(final.length * t);
    let text = final.slice(0, fixed);
    for (let i = fixed; i < final.length; i++) text += NOISE[(Math.random() * NOISE.length) | 0];
    paint(el, text);
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function crackTime(bits) {
  const seconds = 2 ** bits / 1e11; // 100 млрд попыток в секунду — мощная GPU-ферма
  const units = [['секунд', 60], ['минут', 60], ['часов', 24], ['дней', 365], ['лет', 1000], ['тысяч лет', 1000], ['миллионов лет', 1000]];
  let v = seconds;
  for (const [unit, size] of units) {
    if (v < size) return v < 1 ? 'мгновенно' : `≈ ${Math.round(v)} ${unit}`;
    v /= size;
  }
  return 'дольше возраста Вселенной';
}

export function render(root) {
  let current = '';
  const out = h('div', { class: 'gen-pass', 'aria-live': 'polite' });
  const regen = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Сгенерировать заново', 'data-tip': 'Ещё (пробел)' }, icon('refresh'));
  const copy = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Скопировать', 'data-tip': 'Скопировать' }, icon('copy'));
  const meterFill = h('i');
  const meterLabel = h('span');
  const meter = h('div', { class: 'strength' }, h('div', { class: 'strength-bar' }, meterFill), meterLabel);
  const meta = h('div', { class: 'gen-meta' });
  const histList = h('div', { class: 'srv-fields' });
  const hist = h('section', { class: 'gen-hist panel anim-in', style: { '--i': 2 }, hidden: true },
    h('div', { class: 'section-head' }, icon('clock'), h('h2', { text: 'Недавние (только в этой вкладке)' })), histList);

  const lengthOut = h('output', { text: String(opts.length) });
  const range = h('input', { type: 'range', min: 8, max: 64, value: opts.length, 'aria-label': 'Длина пароля' });
  const syncRange = () => range.style.setProperty('--p', `${((range.value - 8) / 56) * 100}%`);
  range.addEventListener('input', () => {
    opts.length = Number(range.value);
    lengthOut.textContent = range.value;
    syncRange();
    generate();
  });
  syncRange();

  const toggles = [
    ['lower', 'Строчные буквы', 'a–z'],
    ['upper', 'Заглавные буквы', 'A–Z'],
    ['digits', 'Цифры', '0–9'],
    ['symbols', 'Спецсимволы', '!@#$%…'],
    ['noAmbiguous', 'Без похожих символов', 'исключить l, 1, O, 0'],
  ].map(([key, label, hint]) => {
    const t = toggle(label, opts[key], hint);
    t.input.addEventListener('change', () => {
      opts[key] = t.input.checked;
      if (!opts.lower && !opts.upper && !opts.digits && !opts.symbols) {
        opts.lower = true;
        toggles[0].input.checked = true;
      }
      generate();
    });
    return t;
  });

  function remember(pw) {
    if (!pw) return;
    recent.unshift(pw);
    recent.splice(8);
  }

  function drawHistory() {
    hist.hidden = recent.length < 2;
    histList.replaceChildren(...recent.slice(1).map((pw) => {
      const btn = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Скопировать', 'data-tip': 'Скопировать' }, icon('copy'));
      btn.addEventListener('click', async () => { await copyText(pw, 'Пароль скопирован'); flash(btn); });
      return h('div', { class: 'fld' }, h('span', { class: 'v', text: pw }), h('div', { class: 'acts' }, btn));
    }));
  }

  function generate() {
    current = generatePassword(opts);
    remember(current);
    scramble(out, current);
    const s = passwordStrength(current);
    meter.dataset.score = s.score;
    meterFill.style.width = `${(s.score / 4) * 100}%`;
    meterLabel.textContent = s.label;
    meta.replaceChildren(
      h('span', null, 'Длина: ', h('b', { text: `${current.length} ${plural(current.length, 'символ', 'символа', 'символов')}` })),
      h('span', null, 'Энтропия: ', h('b', { text: `≈ ${s.bits} бит` })),
      h('span', null, 'Время перебора: ', h('b', { text: crackTime(s.bits) })));
    drawHistory();
  }

  regen.addEventListener('click', () => {
    regen.classList.remove('spin');
    void regen.offsetWidth;
    regen.classList.add('spin');
    generate();
  });
  copy.addEventListener('click', async () => {
    await copyText(current, 'Пароль скопирован');
    flash(copy);
  });

  root.append(h('div', { class: 'gen' },
    h('div', { class: 'gen-out panel anim-in' }, out, regen, copy),
    h('div', { class: 'gen-opts panel anim-in', style: { '--i': 1 } },
      h('div', { class: 'range-row' }, h('div', { class: 'row' }, h('span', { class: 'label', text: 'Длина пароля' }), lengthOut), range),
      h('div', { class: 'opt-grid' }, toggles),
      meter,
      meta,
      h('p', { class: 'dim', style: { fontSize: '12.5px' } }, icon('lock', 'i-sm'), ' Пароли генерируются в браузере через crypto.getRandomValues и никуда не отправляются.')),
    hist));

  generate();
  const onKey = (e) => {
    if (e.code === 'Space' && !e.target.closest('input, textarea, select, button') && !document.querySelector('.modal-backdrop')) {
      e.preventDefault();
      regen.click();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
