/* =========================================================================
 * ui/views/common.js — Piezas de interfaz compartidas por las vistas.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, St = F.Store, ui = F.ui;
  const esc = U.escapeHTML;

  F.views = F.views || {};

  function card(title, body, opts) {
    opts = opts || {};
    return '<section class="card ' + (opts.cls || '') + '"' + (opts.id ? ' id="' + opts.id + '"' : '') + '>' +
      (title ? '<header class="card-head"><h2>' + (opts.icon ? ui.icon(opts.icon) : '') + esc(title) + '</h2>' + (opts.action || '') + '</header>' : '') +
      (opts.sub ? '<p class="card-sub">' + opts.sub + '</p>' : '') + body + '</section>';
  }
  function kpi(label, valueHTML, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + esc(label) + '</span><span class="kpi-value">' + valueHTML + '</span>' + (sub ? '<span class="kpi-sub">' + sub + '</span>' : '') + '</div>';
  }
  function pageHead(title, sub, actions) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (actions ? '<div class="page-actions">' + actions + '</div>' : '') + '</div>';
  }
  function monthPicker(key, route) {
    const cur = U.currentMonthKey();
    return '<div class="month-picker" data-route="' + esc(route) + '">' +
      '<button class="icon-btn" data-month-step="-1" aria-label="Mes anterior">' + ui.icon('left') + '</button>' +
      '<label class="mp-label"><span>' + esc(U.monthLabel(key)) + '</span><input type="month" value="' + esc(key) + '" data-month-input aria-label="Elegir mes"></label>' +
      '<button class="icon-btn" data-month-step="1" aria-label="Mes siguiente"' + (key >= cur ? ' disabled' : '') + '>' + ui.icon('chevright') + '</button></div>';
  }
  function yearPicker(year, route) {
    const cy = Number(U.today().slice(0, 4));
    return '<div class="month-picker" data-route="' + esc(route) + '">' +
      '<button class="icon-btn" data-year-step="-1" aria-label="Año anterior">' + ui.icon('left') + '</button>' +
      '<span class="mp-label"><span>' + esc(String(year)) + '</span></span>' +
      '<button class="icon-btn" data-year-step="1" aria-label="Año siguiente"' + (Number(year) >= cy ? ' disabled' : '') + '>' + ui.icon('chevright') + '</button></div>';
  }

  const TYPE_ICON = { income: 'income', expense: 'expense', transfer: 'swap', saving: 'coins', investment: 'trending', investment_withdrawal: 'trending', debt_payment: 'debt', loan_received: 'debt', loan_given: 'debt' };

  /** Signo de un movimiento visto desde el patrimonio/flujo. */
  function txSign(tx) {
    if (tx.type === 'income') return 1;
    if (tx.type === 'expense') return -1;
    if (tx.type === 'debt_payment') { const d = St.get('debts', tx.debtId); return d && d.direction === 'receivable' ? 1 : -1; }
    return 0;
  }
  function txTitle(tx) {
    if (tx.description) return tx.description;
    const c = St.get('categories', tx.categoryId);
    if (c) return tx.subcategory || c.name;
    if (tx.type === 'transfer' || tx.type === 'saving') return S.TX_TYPES[tx.type].label + ' a ' + ((St.get('accounts', tx.toAccountId) || {}).name || '—');
    if (tx.investmentId) return ((St.get('investments', tx.investmentId) || {}).name) || S.TX_TYPES[tx.type].label;
    if (tx.debtId) return ((St.get('debts', tx.debtId) || {}).name) || S.TX_TYPES[tx.type].label;
    return S.TX_TYPES[tx.type].label;
  }
  function txMeta(tx, opts) {
    const parts = [];
    const c = St.get('categories', tx.categoryId);
    const acc = St.get('accounts', tx.accountId), to = St.get('accounts', tx.toAccountId);
    if (tx.type === 'transfer' || tx.type === 'saving') parts.push((acc ? acc.name : '—') + ' → ' + (to ? to.name : '—'));
    else {
      if (c) parts.push(c.name + (tx.subcategory && tx.description ? ' · ' + tx.subcategory : ''));
      else parts.push(S.TX_TYPES[tx.type].label);
      if (acc) parts.push(acc.name);
    }
    if (opts && opts.date) parts.push(U.dateLabel(tx.date, { year: tx.date.slice(0, 4) !== U.today().slice(0, 4) }));
    return parts.join(' · ');
  }
  function txRow(tx, opts) {
    const t = S.TX_TYPES[tx.type];
    const sign = txSign(tx);
    const acc = St.get('accounts', tx.accountId);
    const cur = acc ? acc.currency : undefined;
    const c = St.get('categories', tx.categoryId);
    const color = c && (tx.type === 'expense' || tx.type === 'income') ? c.color : null;
    const amount = sign === 0 ? '<span class="amt neutral">' + esc(U.money(tx.amount, { currency: cur })) + '</span>' : ui.amt(sign * tx.amount, { sign: true, colored: true, currency: cur });
    const tags = (tx.tags || []).length ? '<span class="tags">' + tx.tags.map(x => '#' + esc(x)).join(' ') + '</span>' : '';
    const future = tx.date > U.today() ? '<span class="badge">Programado</span>' : '';
    const flags = (tx.recurringId ? ui.icon('repeat', 'tiny') : '') + (tx.isDemo ? '<span class="badge muted">demo</span>' : '');
    const interest = tx.type === 'debt_payment' && tx.interestAmount > 0 ? '<span class="tags">incluye ' + esc(U.money(tx.interestAmount)) + ' de intereses</span>' : '';
    return '<button class="tx-row" data-edit-tx="' + esc(tx.id) + '">' +
      '<span class="tx-ico t-' + t.color + '"' + (color ? ' style="--c:' + esc(color) + '"' : '') + '>' + ui.icon(TYPE_ICON[tx.type]) + '</span>' +
      '<span class="tx-main"><span class="tx-title">' + esc(txTitle(tx)) + flags + '</span><span class="tx-meta">' + esc(txMeta(tx, opts)) + '</span>' + tags + interest + '</span>' +
      '<span class="tx-amt">' + amount + future + '</span></button>';
  }
  /** Lista agrupada por día con total del día (solo ingresos − gastos). */
  function txList(list, opts) {
    opts = opts || {};
    if (!list.length) return opts.empty || ui.emptyState('list', 'Sin movimientos', 'Registra tu primer movimiento con el botón +.');
    let h = '<div class="tx-list">';
    let day = null;
    const limit = opts.limit || list.length;
    const byDay = new Map();
    for (const tx of list.slice(0, limit)) { if (!byDay.has(tx.date)) byDay.set(tx.date, []); byDay.get(tx.date).push(tx); }
    for (const [d, items] of byDay) {
      day = d;
      const net = items.reduce((a, t) => a + txSign(t) * t.amount + (t.type === 'debt_payment' ? 0 : 0), 0);
      h += '<div class="tx-day"><span>' + esc(U.relativeDayLabel(d)) + '</span>' + (net ? ui.amt(net, { sign: true }) : '') + '</div>';
      h += items.map(t => txRow(t)).join('');
    }
    void day;
    return h + '</div>';
  }

  function barRow(label, amount, pct, color, extra) {
    return '<div class="bar-row"><div class="bar-top"><span class="bar-label">' + (color ? '<i class="dot" style="background:' + esc(color) + '"></i>' : '') + esc(label) + '</span><span class="bar-val">' + ui.amt(amount) + (extra || '') + '</span></div>' +
      '<div class="bar-track"><span style="width:' + U.clamp(pct, 0, 100).toFixed(1) + '%;' + (color ? 'background:' + esc(color) : '') + '"></span></div></div>';
  }

  function quickActions() {
    const items = [['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia'], ['saving', 'Ahorro'], ['investment', 'Inversión'], ['debt_payment', 'Deuda']];
    return '<div class="quick">' + items.map(([k, l]) => '<button class="quick-btn t-' + S.TX_TYPES[k].color + '" data-add-tx="' + k + '">' + ui.icon('plus') + l + '</button>').join('') + '</div>';
  }

  function deltaLine(cur, prev, label, invert) {
    const p = U.pctChange(cur, prev);
    return ui.delta(p, { invert }) + ' <span class="muted">' + esc(label) + '</span>';
  }

  /** Comparación tabular: métrica | actual | referencia | variación */
  function compareTable(rows, curLabel, refLabel) {
    return '<div class="table-wrap"><table class="tbl"><thead><tr><th></th><th>' + esc(curLabel) + '</th><th>' + esc(refLabel) + '</th><th>Variación</th></tr></thead><tbody>' +
      rows.map(r => '<tr><th>' + esc(r[0]) + '</th><td>' + (r.pct ? U.pct(r[1]) : ui.amt(r[1])) + '</td><td>' + (r[2] === null || r[2] === undefined ? '—' : r.pct ? U.pct(r[2]) : ui.amt(r[2])) + '</td><td>' +
        (r.pct ? (r[1] !== null && r[2] !== null && r[1] !== undefined && r[2] !== undefined ? U.plainNumber(r[1] - r[2], 1) + ' pp' : '—') : ui.delta(U.pctChange(r[1], r[2]), { invert: r.invert })) + '</td></tr>').join('') + '</tbody></table></div>';
  }

  F.vh = { card, kpi, pageHead, monthPicker, yearPicker, txRow, txList, txSign, txTitle, barRow, quickActions, deltaLine, compareTable, TYPE_ICON };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
