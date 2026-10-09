import { $, $$, h, icon, installEffects } from './lib.js';

installEffects();
for (const el of $$('[data-icon]')) el.replaceWith(icon(el.dataset.icon, el.className));
$('#back').addEventListener('click', () => (history.length > 1 ? history.back() : location.assign('/')));

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───── звёздное небо с падающими звёздами ───── */

function stars(canvas) {
  const ctx = canvas.getContext('2d');
  let w;
  let hgt;
  let list = [];
  let shooting = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    hgt = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    list = Array.from({ length: Math.round((w * hgt) / 4500) }, () => ({
      x: Math.random() * w,
      y: Math.random() * hgt,
      r: Math.random() * 1.3 + 0.2,
      s: Math.random() * 0.25 + 0.03,
      t: Math.random() * Math.PI * 2,
    }));
  }

  function frame(time = 0) {
    ctx.clearRect(0, 0, w, hgt);
    for (const st of list) {
      st.y += st.s;
      if (st.y > hgt) { st.y = 0; st.x = Math.random() * w; }
      const a = 0.35 + Math.sin(time / 700 + st.t) * 0.35;
      ctx.fillStyle = `rgba(170, 210, 255, ${Math.max(0.05, a)})`;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!shooting && Math.random() < 0.006) {
      shooting = { x: Math.random() * w * 0.7, y: Math.random() * hgt * 0.4, life: 1 };
    }
    if (shooting) {
      const { x, y } = shooting;
      const grad = ctx.createLinearGradient(x, y, x - 120, y - 50);
      grad.addColorStop(0, `rgba(120, 220, 255, ${shooting.life})`);
      grad.addColorStop(1, 'rgba(120, 220, 255, 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 120, y - 50);
      ctx.stroke();
      shooting.x += 9;
      shooting.y += 3.75;
      shooting.life -= 0.02;
      if (shooting.life <= 0) shooting = null;
    }
    if (!reduce) requestAnimationFrame(frame);
  }

  resize();
  frame();
  addEventListener('resize', () => { resize(); if (reduce) frame(); });
}

stars($('#stars'));

/* ───── терминал ───── */

let path = location.pathname;
try { path = decodeURI(path); } catch { /* битая кодировка — показываем как есть */ }
path = path.slice(0, 48);
const LINES = [
  [['p', '$ '], ['', `curl -I https://${location.host}${path}`, true]],
  [['err', 'HTTP/1.1 404 Not Found']],
  [['p', '$ '], ['', `traceroute ${path}`, true]],
  [['', ' 1  gateway  0.4 ms\n 2  * * *\n 3  '], ['err', 'destination unreachable']],
  [['p', '$ ']],
];

async function type() {
  const pre = $('#nf-term');
  const cursor = h('span', { class: 'cur' });
  pre.append(cursor);
  await new Promise((r) => setTimeout(r, 700));
  for (const [i, line] of LINES.entries()) {
    for (const [cls, text, typed] of line) {
      const span = h('span', { class: cls });
      cursor.before(span);
      if (reduce || !typed) {
        span.textContent = text;
      } else {
        for (const ch of text) {
          span.textContent += ch;
          await new Promise((r) => setTimeout(r, 28 + Math.random() * 45));
        }
      }
    }
    if (i < LINES.length - 1) {
      cursor.before('\n');
      if (!reduce) await new Promise((r) => setTimeout(r, 420));
    }
  }
}

type();
