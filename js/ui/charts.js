/* =========================================================================
 * ui/charts.js — Gráficos SVG propios (sin librerías ni red).
 * Uso: <div data-chart="id"></div> y Charts.mount(el, spec).
 * Se redibujan al cambiar el tamaño de la ventana. Tooltips táctiles.
 * Tipos: line · bar · donut · waterfall · spark
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils;
  const esc = U.escapeHTML;
  const registry = new WeakMap();
  const mounted = new Set();

  function niceStep(range, count) {
    const raw = range / Math.max(count, 1);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  function niceScale(min, max, count) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
    if (min === max) { if (max === 0) max = 1; else if (min > 0) min = 0; else max = 0; }
    const step = niceStep(max - min, count || 4);
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { lo, hi, ticks };
  }
  function fmtAxis(v, spec) {
    if (spec.percent) return U.pct(v, 0);
    return U.money(v, { compact: true });
  }
  function fmtVal(v, spec) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return spec.percent ? U.pct(v, 1) : U.money(v);
  }
  const fill = c => 'style="fill:' + c + '"';
  const stroke = c => 'style="stroke:' + c + '"';

  // ----------------------------- LINE / BAR -----------------------------
  function cartesian(el, spec) {
    const W = Math.max(260, el.clientWidth || 320);
    const H = spec.height || (W < 480 ? 190 : 230);
    let padL = W < 480 ? 40 : 50; const padR = 10, padT = 12, padB = 26;
    const labels = spec.labels || [];
    const n = labels.length;
    const all = [];
    for (const s of spec.series) for (const v of s.values) if (v !== null && Number.isFinite(v)) all.push(v);
    if (!n || !all.length) { el.innerHTML = '<div class="chart-empty">Sin datos suficientes para graficar.</div>'; return; }
    let min = Math.min(...all), max = Math.max(...all);
    if (spec.type === 'bar' || spec.zero !== false) { min = Math.min(0, min); max = Math.max(0, max); }
    const sc = niceScale(min, max, H < 200 ? 3 : 4);
    padL = Math.max(padL, 10 + 6.2 * Math.max(...sc.ticks.map(t => fmtAxis(t, spec).length)));
    const iw = W - padL - padR, ih = H - padT - padB;
    const y = v => padT + ih - (v - sc.lo) / (sc.hi - sc.lo || 1) * ih;
    const band = iw / n;
    const x = i => spec.type === 'bar' ? padL + band * i + band / 2 : padL + (n === 1 ? iw / 2 : iw * i / (n - 1));
    let svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(spec.title || 'Gráfico') + '">';
    for (const t of sc.ticks) {
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '" class="grid' + (t === 0 ? ' zero' : '') + '"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (y(t) + 3.5) + '" class="axis" text-anchor="end">' + esc(fmtAxis(t, spec)) + '</text>';
    }
    const every = Math.ceil(n / Math.max(1, Math.floor(iw / (W < 480 ? 46 : 60))));
    labels.forEach((l, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      if (i === n - 1 && i % every !== 0 && (n - 1) % every < every / 2) return;
      const lx = x(i), lbl = spec.shortLabels ? spec.shortLabels[i] : l;
      const half = String(lbl).length * 3;
      const anchor = lx + half > W - 2 ? 'end' : lx - half < 2 ? 'start' : 'middle';
      svg += '<text x="' + (anchor === 'end' ? W - 2 : anchor === 'start' ? 2 : lx) + '" y="' + (H - 8) + '" class="axis" text-anchor="' + anchor + '">' + esc(spec.shortLabels ? spec.shortLabels[i] : l) + '</text>';
    });
    if (spec.type === 'bar') {
      const k = spec.series.length;
      const gw = Math.min(band * 0.78, k * 22);
      const bw = gw / k;
      spec.series.forEach((s, si) => {
        s.values.forEach((v, i) => {
          if (v === null || !Number.isFinite(v)) return;
          const x0 = x(i) - gw / 2 + si * bw;
          const y0 = y(Math.max(v, 0)), y1 = y(Math.min(v, 0));
          const c = s.negColor && v < 0 ? s.negColor : s.color;
          svg += '<rect x="' + (x0 + 0.5) + '" y="' + y0 + '" width="' + Math.max(1, bw - 1.5) + '" height="' + Math.max(0.5, y1 - y0) + '" rx="2" ' + fill(c) + '/>';
        });
      });
    } else {
      spec.series.forEach(s => {
        let d = '', started = false, first = null, last = null;
        s.values.forEach((v, i) => {
          if (v === null || !Number.isFinite(v)) { started = false; return; }
          d += (started ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
          if (first === null) first = i;
          last = i; started = true;
        });
        if (s.area && first !== null) {
          svg += '<path d="' + d + 'L' + x(last) + ' ' + y(Math.max(sc.lo, 0)) + 'L' + x(first) + ' ' + y(Math.max(sc.lo, 0)) + 'Z" class="area" ' + fill(s.color) + '/>';
        }
        svg += '<path d="' + d + '" class="line' + (s.dashed ? ' dashed' : '') + '" ' + stroke(s.color) + '/>';
        if (n <= 24) s.values.forEach((v, i) => { if (v !== null && Number.isFinite(v)) svg += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (n <= 13 ? 2.6 : 1.8) + '" class="dot" ' + stroke(s.color) + '/>'; });
      });
    }
    svg += '<line class="cursor" x1="0" x2="0" y1="' + padT + '" y2="' + (padT + ih) + '" style="opacity:0"/>';
    svg += '</svg>';
    el.innerHTML = svg + '<div class="chart-tip" hidden></div>' + legend(spec.series);
    attachTip(el, spec, i => x(i), n, (i) => {
      let html = '<strong>' + esc(labels[i]) + '</strong>';
      for (const s of spec.series) html += '<span><i ' + 'style="background:' + s.color + '"></i>' + esc(s.name) + ': ' + esc(fmtVal(s.values[i], spec)) + '</span>';
      return html;
    });
  }

  function legend(series) {
    if (!series || series.length < 2) return '';
    return '<div class="chart-legend">' + series.map(s => '<span><i class="' + (s.dashed ? 'dashed' : '') + '" style="background:' + s.color + '"></i>' + esc(s.name) + '</span>').join('') + '</div>';
  }

  function attachTip(el, spec, xOf, n, html) {
    const svg = el.querySelector('svg');
    const tip = el.querySelector('.chart-tip');
    const cursor = el.querySelector('.cursor');
    if (!svg || !tip) return;
    const show = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.abs(xOf(i) - px); if (d < bd) { bd = d; best = i; } }
      tip.innerHTML = html(best);
      tip.hidden = false;
      const tx = xOf(best);
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(4, tx - tw / 2), rect.width - tw - 4) + 'px';
      if (cursor) { cursor.setAttribute('x1', tx); cursor.setAttribute('x2', tx); cursor.style.opacity = 1; }
    };
    const hide = () => { tip.hidden = true; if (cursor) cursor.style.opacity = 0; };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }

  // ----------------------------- DONUT -----------------------------
  function donut(el, spec) {
    const items = (spec.items || []).filter(i => i.value > 0);
    const total = items.reduce((a, i) => a + i.value, 0);
    if (!items.length || total <= 0) { el.innerHTML = '<div class="chart-empty">Sin gastos en este período.</div>'; return; }
    const S = spec.size || 168, r = S / 2 - 4, ir = r * 0.64, cx = S / 2, cy = S / 2;
    let a0 = -Math.PI / 2, paths = '';
    items.forEach((it, idx) => {
      const frac = it.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      if (frac >= 0.9999) {
        paths += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + ir) / 2 + '" ' + 'style="fill:none;stroke:' + it.color + ';stroke-width:' + (r - ir) + '" data-i="' + idx + '"/>';
      } else {
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, a) => (cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2);
        paths += '<path data-i="' + idx + '" d="M' + p(r, a0) + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p(r, a1) + 'L' + p(ir, a1) + 'A' + ir + ' ' + ir + ' 0 ' + large + ' 0 ' + p(ir, a0) + 'Z" ' + fill(it.color) + ' class="slice"/>';
      }
      a0 = a1;
    });
    const center = spec.center ? '<div class="donut-center"><span>' + esc(spec.center.label) + '</span><strong>' + esc(spec.center.value) + '</strong></div>' : '';
    el.innerHTML = '<div class="donut-wrap"><div class="donut-svg" style="width:' + S + 'px;height:' + S + 'px"><svg width="' + S + '" height="' + S + '" viewBox="0 0 ' + S + ' ' + S + '">' + paths + '</svg>' + center + '</div>' +
      (spec.legend === false ? '' : '<ul class="donut-legend">' + items.slice(0, spec.max || 7).map(it => '<li><i style="background:' + it.color + '"></i><span>' + esc(it.name) + '</span><b>' + U.pct(it.value / total * 100, 0) + '</b></li>').join('') +
      (items.length > (spec.max || 7) ? '<li class="muted"><i></i><span>' + (items.length - (spec.max || 7)) + ' más</span></li>' : '') + '</ul>') + '</div>';
    const centerEl = el.querySelector('.donut-center');
    el.querySelectorAll('[data-i]').forEach(p => {
      const it = items[Number(p.getAttribute('data-i'))];
      const on = () => { if (centerEl) centerEl.innerHTML = '<span>' + esc(it.name) + '</span><strong>' + esc(U.money(it.value, { compact: it.value >= 1e7 })) + '</strong>'; };
      p.addEventListener('pointerenter', on); p.addEventListener('pointerdown', on);
      p.addEventListener('pointerleave', () => { if (centerEl && spec.center) centerEl.innerHTML = '<span>' + esc(spec.center.label) + '</span><strong>' + esc(spec.center.value) + '</strong>'; });
    });
  }

  // ----------------------------- WATERFALL (flujo de caja) -----------------------------
  function waterfall(el, spec) {
    const steps = spec.steps || [];
    const W = Math.max(260, el.clientWidth || 320);
    const H = spec.height || 210;
    let padL = 40; const padR = 8, padT = 14, padB = 34;
    let run = 0;
    const bars = steps.map(s => {
      let a, b;
      if (s.kind === 'start' || s.kind === 'total') { a = 0; b = s.kind === 'total' ? run : s.value; run = b; }
      else { a = run; b = run + s.value; run = b; }
      return Object.assign({}, s, { a, b });
    });
    const vals = bars.flatMap(b => [b.a, b.b]);
    const sc = niceScale(Math.min(0, ...vals), Math.max(0, ...vals), 4);
    padL = Math.max(padL, 10 + 6.2 * Math.max(...sc.ticks.map(t => fmtAxis(t, spec).length)));
    const iw = W - padL - padR, ih = H - padT - padB;
    const y = v => padT + ih - (v - sc.lo) / (sc.hi - sc.lo || 1) * ih;
    const band = iw / bars.length, bw = Math.min(band * 0.62, 64);
    let svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
    for (const t of sc.ticks) svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '" class="grid' + (t === 0 ? ' zero' : '') + '"/><text x="' + (padL - 6) + '" y="' + (y(t) + 3.5) + '" class="axis" text-anchor="end">' + esc(fmtAxis(t, spec)) + '</text>';
    bars.forEach((b, i) => {
      const cx = padL + band * i + band / 2;
      const top = y(Math.max(b.a, b.b)), bot = y(Math.min(b.a, b.b));
      svg += '<rect x="' + (cx - bw / 2) + '" y="' + top + '" width="' + bw + '" height="' + Math.max(1, bot - top) + '" rx="3" ' + fill(b.color) + '/>';
      if (i < bars.length - 1) svg += '<line x1="' + (cx + bw / 2) + '" x2="' + (cx + band - bw / 2) + '" y1="' + y(b.b) + '" y2="' + y(b.b) + '" class="connector"/>';
      svg += '<text x="' + cx + '" y="' + (H - 18) + '" class="axis strong" text-anchor="middle">' + esc(b.name) + '</text>';
      svg += '<text x="' + cx + '" y="' + (H - 5) + '" class="axis" text-anchor="middle">' + esc((b.kind === 'delta' && b.value > 0 ? '+' : '') + U.money(b.kind === 'total' ? b.b : b.value, { compact: true })) + '</text>';
    });
    el.innerHTML = svg + '</svg>';
  }

  // ----------------------------- SPARKLINE -----------------------------
  function spark(el, spec) {
    const vals = (spec.values || []).filter(v => v !== null && Number.isFinite(v));
    const W = Math.max(80, el.clientWidth || 120), H = spec.height || 40;
    if (vals.length < 2) { el.innerHTML = ''; return; }
    const min = Math.min(...vals), max = Math.max(...vals);
    const x = i => 2 + (W - 4) * i / (vals.length - 1);
    const y = v => 3 + (H - 6) * (1 - (v - min) / ((max - min) || 1));
    const d = vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
    el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><path d="' + d + 'L' + x(vals.length - 1) + ' ' + H + 'L2 ' + H + 'Z" class="area" ' + fill(spec.color) + '/><path d="' + d + '" class="line" ' + stroke(spec.color) + '/><circle cx="' + x(vals.length - 1) + '" cy="' + y(vals[vals.length - 1]) + '" r="3" ' + fill(spec.color) + '/></svg>';
  }

  const RENDERERS = { line: cartesian, bar: cartesian, donut, waterfall, spark };

  function mount(el, spec) {
    if (!el) return;
    registry.set(el, spec);
    mounted.add(el);
    try { (RENDERERS[spec.type] || cartesian)(el, spec); }
    catch (e) { console.error(e); el.innerHTML = '<div class="chart-empty">No se pudo dibujar el gráfico.</div>'; }
  }
  function redrawAll() {
    for (const el of [...mounted]) {
      if (!el.isConnected) { mounted.delete(el); continue; }
      const spec = registry.get(el);
      if (spec && spec.type !== 'donut') mount(el, spec);
    }
  }
  let t = null;
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(redrawAll, 150); });

  F.charts = { mount, redrawAll, niceScale };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
