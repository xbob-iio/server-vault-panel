// Анимированная «сеть» из частиц на canvas: точки дрейфуют, соединяются линиями и тянутся к курсору.

export function startNetwork(canvas, { density = 0.00011, maxPoints = 150, link = 150, hue = '86, 150, 255' } = {}) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mouse = { x: -1e4, y: -1e4 };
  let w = 0;
  let h = 0;
  let points = [];
  let raf = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(maxPoints, Math.round(w * h * density));
    points = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.32,
      vy: (Math.random() - 0.5) * 0.32,
      r: Math.random() * 1.5 + 0.6,
      tw: Math.random() * Math.PI * 2,
    }));
  }

  function frame(t = 0) {
    ctx.clearRect(0, 0, w, h);
    for (const p of points) {
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 200 * 200) {
        p.vx += dx * 0.000025;
        p.vy += dy * 0.000025;
      }
      p.vx *= 0.995;
      p.vy *= 0.995;
      const speed = Math.hypot(p.vx, p.vy);
      if (speed < 0.08) {
        p.vx += (Math.random() - 0.5) * 0.04;
        p.vy += (Math.random() - 0.5) * 0.04;
      }
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10;
      if (p.y > h + 10) p.y = -10;
    }

    ctx.lineWidth = 0.7;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < link * link) {
          const alpha = (1 - Math.sqrt(d2) / link) * 0.32;
          ctx.strokeStyle = `rgba(${hue}, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      const mx = a.x - mouse.x;
      const my = a.y - mouse.y;
      const md = Math.hypot(mx, my);
      if (md < 180) {
        ctx.strokeStyle = `rgba(80, 210, 255, ${(1 - md / 180) * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }
    }

    for (const p of points) {
      const glow = 0.55 + Math.sin(t / 900 + p.tw) * 0.35;
      ctx.fillStyle = `rgba(140, 200, 255, ${glow})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reduce) raf = requestAnimationFrame(frame);
  }

  resize();
  frame();
  addEventListener('resize', () => { resize(); if (reduce) frame(); });
  addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  document.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4; });
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden && !reduce) raf = requestAnimationFrame(frame);
  });
}
