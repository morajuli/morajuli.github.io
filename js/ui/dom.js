/* =========================================================================
 * ui/dom.js — Utilidades de interfaz: iconos, montos, modales, diálogos,
 * avisos (toasts), descargas y lectura de archivos.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils;
  const esc = U.escapeHTML;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ---------- Iconos (trazos 24×24) ----------
  const P = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
    plus: 'M12 5v14M5 12h14',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01',
    target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
    trending: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    debt: 'M2 7h20v12H2zM2 11h20M6 15h4',
    pie: 'M21 12A9 9 0 1 1 12 3v9zM15 3.5A9 9 0 0 1 20.5 9H15z',
    calendar: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4',
    repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5.9z',
    tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    filter: 'M3 5h18l-7 8v6l-4 2v-8z',
    close: 'M18 6 6 18M6 6l12 12',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
    up: 'M12 19V5M5 12l7-7 7 7',
    down: 'M12 5v14M19 12l-7 7-7-7',
    right: 'M5 12h14M12 5l7 7-7 7',
    swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    upload: 'M12 21V9M7 14l5-5 5 5M4 3h16',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
    check: 'M20 6 9 17l-5-5',
    alert: 'M12 3 2 21h20zM12 10v5M12 18h.01',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    left: 'M15 18l-6-6 6-6',
    chevright: 'M9 18l6-6-6-6',
    layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
    pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
    coins: 'M8 8a6 3 0 1 0 12 0 6 3 0 1 0-12 0M8 8v4c0 1.7 2.7 3 6 3s6-1.3 6-3V8M4 14a6 3 0 0 0 6 3M4 14v4c0 1.7 2.7 3 6 3M4 14c0-1 .9-1.9 2.4-2.5',
    income: 'M12 20V8M6 14l6-6 6 6M4 4h16',
    expense: 'M12 4v12M6 10l6 6 6-6M4 20h16',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
    projection: 'M3 20h18M5 16l4-5 4 3 6-8M19 6v4M19 6h-4'
  };
  function icon(name, cls) {
    const d = P[name] || P.info;
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  // ---------- Montos tipográficos ----------
  /** Monto con símbolo de moneda en tamaño menor. opts: {sign, compact, currency, colored, cls} */
  function amt(value, opts) {
    opts = opts || {};
    const n = U.num(value);
    const cur = U.CURRENCIES[opts.currency] || U.CURRENCIES[U.getBaseCurrency()];
    const full = U.money(n, opts);
    const neg = full.startsWith('−'), pos = full.startsWith('+');
    const body = full.replace(/^[−+]/, '').slice(cur.symbol.length);
    let cls = 'amt';
    if (opts.colored) cls += n > 0 ? ' pos' : n < 0 ? ' neg' : '';
    if (opts.cls) cls += ' ' + opts.cls;
    return '<span class="' + cls + '">' + (neg ? '−' : pos ? '+' : '') + '<span class="cur">' + esc(cur.symbol) + '</span>' + esc(body) + '</span>';
  }
  /** Indicador de variación porcentual. invert: true cuando subir es "costo" (solo cambia el matiz, no juzga). */
  function delta(pctValue, opts) {
    opts = opts || {};
    if (pctValue === null || pctValue === undefined || !Number.isFinite(pctValue)) return '<span class="delta flat">—</span>';
    const dir = Math.abs(pctValue) < 0.5 ? 'flat' : pctValue > 0 ? 'up' : 'down';
    const ic = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
    return '<span class="delta ' + dir + (opts.invert ? ' inv' : '') + '" title="' + esc(opts.title || '') + '">' + ic + ' ' + U.pct(Math.abs(pctValue), opts.decimals === undefined ? 0 : opts.decimals) + '</span>';
  }
  function progress(pct, state) {
    const p = U.clamp(pct, 0, 100);
    return '<div class="progress ' + (state || '') + '" role="progressbar" aria-valuenow="' + Math.round(p) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + p.toFixed(1) + '%"></span></div>';
  }
  function emptyState(ic, title, text, actionHTML) {
    return '<div class="empty">' + icon(ic) + '<h3>' + esc(title) + '</h3>' + (text ? '<p>' + esc(text) + '</p>' : '') + (actionHTML || '') + '</div>';
  }

  // ---------- Modales (hoja inferior en móvil, diálogo en escritorio) ----------
  const stack = [];
  function modal(opts) {
    const root = document.createElement('div');
    root.className = 'modal-root';
    root.innerHTML = '<div class="modal-backdrop"></div><div class="modal ' + (opts.size || '') + '" role="dialog" aria-modal="true" aria-label="' + esc(opts.title || '') + '">' +
      '<header class="modal-head">' + (opts.titleHTML || '<h2>' + esc(opts.title || '') + '</h2>') + '<button class="icon-btn" data-close aria-label="Cerrar">' + icon('close') + '</button></header>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' + (opts.footer ? '<footer class="modal-foot">' + opts.footer + '</footer>' : '') + '</div>';
    document.body.appendChild(root);
    document.body.classList.add('no-scroll');
    const prevFocus = document.activeElement;
    let closed = false;
    const api = {
      el: root, body: root.querySelector('.modal-body'),
      close(result) {
        if (closed) return; closed = true;
        root.classList.add('closing');
        const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
        setTimeout(() => { root.remove(); if (!stack.length) document.body.classList.remove('no-scroll'); }, 160);
        if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (_) {}
        if (opts.onClose) opts.onClose(result);
      }
    };
    stack.push(api);
    root.querySelector('.modal-backdrop').addEventListener('click', () => { if (!opts.persistent) api.close(); });
    root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => api.close()));
    requestAnimationFrame(() => root.classList.add('open'));
    if (opts.onOpen) opts.onOpen(api);
    setTimeout(() => {
      const f = root.querySelector('[autofocus]') || root.querySelector('.modal-body input:not([type=hidden]), .modal-body select, .modal-body button');
      if (f && !opts.noAutofocus) try { f.focus({ preventScroll: true }); } catch (_) {}
    }, 60);
    return api;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(); }
  });

  /** Confirmación. Devuelve Promise<boolean>. */
  function confirmDialog(opts) {
    return new Promise(resolve => {
      let answered = false;
      const m = modal({
        title: opts.title || 'Confirmar', size: 'small',
        body: '<div class="confirm-text">' + (opts.html || '<p>' + esc(opts.message || '') + '</p>') + '</div>' +
          (opts.typeToConfirm ? '<label class="field"><span>Escribe <b>' + esc(opts.typeToConfirm) + '</b> para continuar</span><input type="text" data-ttc autocomplete="off"></label>' : ''),
        footer: '<button class="btn ghost" data-no>' + esc(opts.cancelText || 'Cancelar') + '</button><button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-yes ' + (opts.typeToConfirm ? 'disabled' : '') + '>' + esc(opts.confirmText || 'Confirmar') + '</button>',
        onClose: () => { if (!answered) resolve(false); }
      });
      const yes = m.el.querySelector('[data-yes]');
      if (opts.typeToConfirm) m.el.querySelector('[data-ttc]').addEventListener('input', e => { yes.disabled = e.target.value.trim() !== opts.typeToConfirm; });
      yes.addEventListener('click', () => { answered = true; resolve(true); m.close(); });
      m.el.querySelector('[data-no]').addEventListener('click', () => { answered = true; resolve(false); m.close(); });
    });
  }

  // ---------- Avisos ----------
  function toast(message, opts) {
    opts = opts || {};
    let host = $('#toasts');
    if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'toast ' + (opts.type || '');
    t.innerHTML = '<span>' + esc(message) + '</span>' + (opts.action ? '<button class="toast-btn">' + esc(opts.action.label) + '</button>' : '');
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    const kill = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 200); };
    if (opts.action) t.querySelector('.toast-btn').addEventListener('click', () => { opts.action.fn(); kill(); });
    setTimeout(kill, opts.timeout || (opts.action ? 6000 : 2800));
  }

  // ---------- Archivos ----------
  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function pickFile(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept || '';
      inp.style.display = 'none';
      inp.addEventListener('change', () => { resolve(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function readText(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 50 * 1024 * 1024) return reject(new Error('El archivo supera 50 MB.'));
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error || new Error('No se pudo leer el archivo.'));
      r.readAsText(file, 'utf-8');
    });
  }

  // ---------- Formularios ----------
  /** Marca errores de validación en un formulario (por atributo name). */
  function showErrors(form, errors) {
    $$('.field-error', form).forEach(e => e.remove());
    $$('.invalid', form).forEach(e => e.classList.remove('invalid'));
    let first = null;
    for (const [k, msg] of Object.entries(errors || {})) {
      const inp = form.querySelector('[name="' + k + '"]') || form.querySelector('[data-field="' + k + '"]');
      const host = inp ? (inp.closest('.field') || inp.parentElement) : form.querySelector('.form-errors');
      if (!host) continue;
      host.classList.add('invalid');
      const p = document.createElement('p');
      p.className = 'field-error'; p.textContent = msg;
      host.appendChild(p);
      if (!first) first = inp || host;
    }
    if (first && first.focus) try { first.focus({ preventScroll: false }); } catch (_) {}
    return !first;
  }
  /** Conecta un input de monto: formatea miles mientras se escribe. */
  function bindAmountInput(inp, currencyFn) {
    if (!inp || inp._bound) return;
    inp._bound = true;
    inp.addEventListener('input', () => {
      const pos = inp.selectionStart, before = inp.value.length;
      const raw = inp.value.toLowerCase().includes('k') ? inp.value : inp.value;
      if (/k$/i.test(raw.trim())) return; // permite "25k" sin formatear
      inp.value = U.formatAmountInput(raw, currencyFn ? currencyFn() : undefined);
      const diff = inp.value.length - before;
      try { inp.setSelectionRange(Math.max(0, pos + diff), Math.max(0, pos + diff)); } catch (_) {}
    });
  }
  function options(map, selected, placeholder) {
    let out = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '';
    const entries = Array.isArray(map) ? map.map(v => typeof v === 'object' ? [v.value, v.label] : [v, v]) : Object.entries(map);
    for (const [v, l] of entries) out += '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(l) + '</option>';
    return out;
  }
  function amountValue(v) { return v === null || v === undefined || v === '' ? '' : U.formatAmountInput(String(U.round2(v)).replace('.', ','), undefined); }

  F.ui = { $, $$, icon, amt, delta, progress, emptyState, modal, confirmDialog, toast, download, pickFile, readText, showErrors, bindAmountInput, options, amountValue, esc };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
