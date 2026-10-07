/* =========================================================================
 * ui/views/dashboard.js — Pantalla de inicio: lo más importante primero.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, L = F.ledger, A = F.analytics, R = F.recurring, St = F.Store, ui = F.ui, vh = F.vh;
  const esc = U.escapeHTML;

  function welcome() {
    return '<section class="welcome">' +
      '<h1>Tu sistema financiero personal</h1>' +
      '<p>Registra ingresos, gastos, ahorro, inversiones y deudas. Con el tiempo verás cómo evolucionan tu flujo de caja y tu patrimonio.</p>' +
      '<div class="privacy-note">' + ui.icon('lock') + '<div><strong>Tus datos se quedan en este dispositivo.</strong> Se guardan en el almacenamiento local del navegador (IndexedDB). No se envían a ningún servidor, no hay analítica ni publicidad. Exporta respaldos con frecuencia.</div></div>' +
      '<ol class="steps"><li><strong>Crea tus cuentas</strong> con su saldo de hoy (banco, Nequi, efectivo, tarjeta…).</li><li><strong>Registra movimientos</strong> con el botón <b>+</b>: valor, categoría, cuenta y listo.</li><li><strong>Añade</strong> metas, presupuestos, inversiones y deudas cuando quieras.</li></ol>' +
      '<div class="welcome-actions"><button class="btn primary" data-act="new-account">' + ui.icon('wallet') + 'Crear mi primera cuenta</button>' +
      '<button class="btn" data-act="load-demo">Cargar datos de ejemplo</button>' +
      '<button class="btn ghost" data-act="import-backup">' + ui.icon('upload') + 'Importar respaldo</button></div></section>';
  }

  function pendingBlock() {
    const pend = R.pending(St);
    if (!pend.length) return '';
    const shown = pend.slice(0, 5);
    return vh.card('Pendientes por confirmar', '<div class="pending-list">' + shown.map(p => {
      const r = p.rule;
      const sign = r.type === 'income' ? 1 : r.type === 'expense' || r.type === 'debt_payment' ? -1 : 0;
      return '<div class="pending"><div><strong>' + esc(r.name) + '</strong><span class="muted">' + esc(U.relativeDayLabel(p.date)) + ' · ' + esc(F.schema.TX_TYPES[r.type].label) + '</span></div>' +
        '<span>' + (sign ? ui.amt(sign * r.amount, { sign: true, colored: true }) : ui.amt(r.amount)) + '</span>' +
        '<div class="pending-actions"><button class="btn small primary" data-confirm-rec="' + esc(r.id) + '">Registrar</button><button class="btn small ghost" data-edit-rec-tx="' + esc(r.id) + '">Editar</button><button class="btn small ghost" data-skip-rec="' + esc(r.id) + '">Omitir</button></div></div>';
    }).join('') + (pend.length > shown.length ? '<p class="muted small">Y ' + (pend.length - shown.length) + ' más.</p>' : '') + '</div>', { cls: 'pending-card', icon: 'clock', sub: 'Pagos recurrentes cuya fecha ya llegó. Confirma para registrarlos con el valor real.' });
  }

  function hero() {
    const nw = L.netWorthAt(St, U.today());
    const first = L.firstDataMonth(St);
    const keys = U.monthRange(U.addMonthKey(U.currentMonthKey(), -11) > first ? U.addMonthKey(U.currentMonthKey(), -11) : first, U.currentMonthKey());
    const series = keys.map(k => L.netWorthAt(St, U.monthEnd(k) > U.today() ? U.today() : U.monthEnd(k)).netWorth);
    const prev = L.netWorthAt(St, U.addDays(U.monthStart(U.currentMonthKey()), -1)).netWorth;
    const diff = nw.netWorth - prev;
    window.__heroSpark = series;
    return '<section class="hero">' +
      '<div class="hero-top"><div><span class="hero-label">Patrimonio neto</span><div class="hero-value">' + ui.amt(nw.netWorth) + '</div>' +
      '<span class="hero-sub">' + (prev !== 0 || diff !== 0 ? (diff >= 0 ? '+' : '−') + esc(U.money(Math.abs(diff))) + ' en ' + esc(U.MONTHS[Number(U.today().slice(5, 7)) - 1]) + '<br>' : '') + 'Activos ' + esc(U.money(nw.assets, { compact: true })) + ' − Pasivos ' + esc(U.money(nw.liabilities, { compact: true })) + '</span></div>' +
      '<div class="hero-spark" data-chart-spark></div></div>' +
      '<div class="hero-grid">' +
      '<a href="#/cuentas" class="hero-stat"><span>Disponible</span>' + ui.amt(nw.available) + '</a>' +
      '<a href="#/metas" class="hero-stat"><span>Ahorrado</span>' + ui.amt(nw.savings) + '</a>' +
      '<a href="#/inversiones" class="hero-stat"><span>Invertido</span>' + ui.amt(nw.invested) + '</a>' +
      '<a href="#/deudas" class="hero-stat"><span>Deudas</span>' + ui.amt(nw.debts + nw.cardDebt) + '</a>' +
      '</div>' + (nw.foreign.length ? '<p class="hero-foot">' + ui.icon('info', 'tiny') + ' ' + nw.foreign.length + ' cuenta(s) en otra moneda no se suman (sin conversión).</p>' : '') + '</section>';
  }

  function monthBlock() {
    const key = U.currentMonthKey();
    const ma = A.monthAnalysis(St, key);
    const c = ma.cur, v = ma.vsPrev;
    const d = (m, inv) => ui.delta(v[m].pct, { invert: inv, title: 'vs ' + ma.prevLabel });
    const body = '<div class="kpis six">' +
      vh.kpi('Ingresos', ui.amt(c.income), d('income')) +
      vh.kpi('Gastos', ui.amt(c.expense), d('expense', true)) +
      vh.kpi('Flujo de caja', ui.amt(c.net, { colored: true }), 'Ingresos − Gastos') +
      vh.kpi('Ahorro', ui.amt(c.saving), d('saving')) +
      vh.kpi('Inversión', ui.amt(c.investment), d('investment')) +
      vh.kpi('Tasa de ahorro', U.pct(c.savingsRate, 0), c.income ? '(I − G) ÷ I' : 'sin ingresos aún') +
      '</div><p class="foot-note">Variación frente a ' + esc(ma.prevLabel) + '. Las transferencias entre tus cuentas no cuentan como ingreso ni gasto.</p>';
    return vh.card('Resumen de ' + U.monthLabel(key).toLowerCase(), body, { action: '<a class="link" href="#/mes">Análisis del mes</a>' });
  }

  function marginBlock() {
    const m = A.monthMargin(St);
    const row = (l, v, cls) => '<div class="calc-row ' + (cls || '') + '"><span>' + esc(l) + '</span>' + ui.amt(v) + '</div>';
    const body = '<div class="margin-value ' + (m.margin < 0 ? 'neg' : '') + '">' + ui.amt(m.margin) + '</div>' +
      '<details class="calc"><summary>Cómo se calcula</summary>' +
      row('Ingresos registrados', m.income) + (m.scheduledIn ? row('+ Ingresos programados pendientes', m.scheduledIn) : '') +
      row('− Gastos del mes', m.expense) + row('− Ahorro, inversión y abonos a capital', m.committed) +
      row('− Pagos programados pendientes', m.scheduled) + row('− Aportes a metas pendientes', m.goalsPending) + row('= Margen', m.margin, 'total') + '</details>';
    return vh.card('Margen del mes', '<p class="card-sub">Lo que queda del mes después de tus gastos, compromisos programados y aportes a metas. Es un cálculo, no una recomendación.</p>' + body, { icon: 'target' });
  }

  function categoriesBlock() {
    const key = U.currentMonthKey();
    const es = A.expenseStats(St, key);
    if (!es.total) return vh.card('Gastos por categoría', ui.emptyState('pie', 'Sin gastos este mes', 'Cuando registres gastos verás aquí en qué se va tu dinero.'));
    const budgets = St.all('budgets');
    const bmap = new Map(budgets.map(b => [b.categoryId, b]));
    const list = es.categories.slice(0, 6).map(c => {
      const b = bmap.get(c.id);
      const extra = b ? ' <small class="muted">de ' + esc(U.money(b.amount, { compact: true })) + '</small>' : '';
      return vh.barRow(c.name, c.amount, b ? c.amount / b.amount * 100 : c.share, c.color, extra);
    }).join('');
    return vh.card('Gastos por categoría', '<div class="split"><div data-chart-donut></div><div class="bars">' + list + '</div></div>', { action: '<a class="link" href="#/gastos">Ver gastos</a>' });
  }

  function insightsBlock() {
    const ins = A.insights(St).slice(0, 5);
    if (!ins.length) return '';
    return vh.card('Patrones', '<ul class="insights">' + ins.map(i => '<li class="ins ' + i.dir + '">' + esc(i.text) + '</li>').join('') + '</ul>', { action: '<a class="link" href="#/mes">Más</a>', icon: 'pulse' });
  }

  function balanceSheet() {
    const nw = L.netWorthAt(St, U.today());
    const row = (l, v, href) => '<a class="bs-row" href="' + href + '"><span>' + esc(l) + '</span>' + ui.amt(v) + '</a>';
    return vh.card('Resumen actual', '<div class="bs">' +
      '<div class="bs-col"><h3>Activos</h3>' + row('Dinero en cuentas', nw.spending, '#/cuentas') + row('Efectivo', nw.cash, '#/cuentas') + row('Ahorros', nw.savings, '#/cuentas') +
      row('Inversiones', nw.invested, '#/inversiones') + (nw.receivables ? row('Dinero que me deben', nw.receivables, '#/deudas') : '') + (nw.otherAssets ? row('Otros activos', nw.otherAssets, '#/patrimonio') : '') +
      '<div class="bs-total"><span>Total activos</span>' + ui.amt(nw.assets) + '</div></div>' +
      '<div class="bs-col"><h3>Pasivos</h3>' + row('Tarjetas de crédito', nw.cardDebt, '#/cuentas') + row('Deudas y préstamos', nw.debts, '#/deudas') + (nw.otherLiabilities ? row('Otros pasivos', nw.otherLiabilities, '#/patrimonio') : '') +
      '<div class="bs-total"><span>Total pasivos</span>' + ui.amt(nw.liabilities) + '</div></div></div>' +
      '<div class="bs-net"><span>Patrimonio neto = Activos − Pasivos</span>' + ui.amt(nw.netWorth) + '</div>', { action: '<a class="link" href="#/patrimonio">Evolución</a>' });
  }

  function goalsBlock() {
    const goals = St.all('goals').filter(g => !g.archived);
    if (!goals.length) return '';
    return vh.card('Metas', '<div class="goal-mini">' + goals.slice(0, 4).map(g => {
      const p = L.goalProgress(St, g);
      return '<a href="#/metas" class="gm"><div class="gm-top"><span>' + esc(g.name) + '</span><b>' + U.pct(p.pct, 0) + '</b></div>' + ui.progress(p.pct, p.completed ? 'done' : '') + '<span class="muted small">' + esc(U.money(p.current)) + ' de ' + esc(U.money(p.target)) + '</span></a>';
    }).join('') + '</div>', { action: '<a class="link" href="#/metas">Ver metas</a>' });
  }

  function upcomingBlock() {
    const up = R.upcoming(St, 14);
    const debts = St.all('debts').filter(d => d.direction === 'payable' && d.dueDay && !d.archived && L.debtBalanceAt(St, d, U.today()) > 0 && !St.all('recurring').some(r => r.debtId === d.id && r.active));
    const items = up.map(o => ({ date: o.date, name: o.rule.name, amount: o.rule.amount, type: o.rule.type }));
    for (const d of debts) {
      let due = U.today().slice(0, 8) + U.pad(Math.min(d.dueDay, U.daysInMonth(U.currentMonthKey())));
      if (due <= U.today()) { const nk = U.addMonthKey(U.currentMonthKey(), 1); due = nk + '-' + U.pad(Math.min(d.dueDay, U.daysInMonth(nk))); }
      if (U.daysBetween(U.today(), due) <= 14) items.push({ date: due, name: 'Cuota ' + d.name, amount: d.monthlyPayment, type: 'debt_payment' });
    }
    if (!items.length) return '';
    items.sort((a, b) => a.date < b.date ? -1 : 1);
    return vh.card('Próximos 14 días', '<ul class="upcoming">' + items.slice(0, 8).map(i => '<li><span class="up-date">' + esc(U.dateLabel(i.date, { year: false })) + '</span><span class="up-name">' + esc(i.name) + '</span>' + ui.amt((i.type === 'income' ? 1 : -1) * i.amount, { sign: true, colored: i.type === 'income' }) + '</li>').join('') + '</ul>', { action: '<a class="link" href="#/calendario">Calendario</a>', icon: 'calendar' });
  }

  function backupNudge() {
    const st = St.settings();
    if (St.isEmpty()) return '';
    const last = st.lastBackupAt ? U.daysBetween(st.lastBackupAt.slice(0, 10), U.today()) : null;
    if (last !== null && last < 30) return '';
    return '<div class="nudge">' + ui.icon('shield') + '<span>' + (last === null ? 'Aún no has exportado un respaldo.' : 'Tu último respaldo fue hace ' + last + ' días.') + ' Los datos viven solo en este navegador.</span><button class="btn small" data-act="export-backup">Exportar respaldo</button></div>';
  }

  function render(el) {
    if (St.isEmpty()) {
      el.innerHTML = '<div class="page dash">' + welcome() + '</div>';
      return;
    }
    const recent = F.analytics.filterTransactions(St, {}).filter(t => t.date <= U.today()).slice(0, 8);
    el.innerHTML = '<div class="page dash">' +
      pendingBlock() + hero() + vh.quickActions() + backupNudge() +
      '<div class="dash-grid">' +
      '<div class="col">' + monthBlock() + categoriesBlock() + insightsBlock() + '</div>' +
      '<div class="col">' + marginBlock() + upcomingBlock() + goalsBlock() +
      vh.card('Últimos movimientos', vh.txList(recent), { action: '<a class="link" href="#/movimientos">Ver todos</a>' }) + '</div>' +
      '</div>' + balanceSheet() + '</div>';
    F.charts.mount(el.querySelector('[data-chart-spark]'), { type: 'spark', values: window.__heroSpark || [], color: 'var(--hero-accent)', height: 54 });
    const es = A.expenseStats(St, U.currentMonthKey());
    const donutEl = el.querySelector('[data-chart-donut]');
    if (donutEl) F.charts.mount(donutEl, { type: 'donut', items: es.categories.map(c => ({ name: c.name, value: c.amount, color: c.color })), center: { label: 'Gastado', value: U.money(es.total, { compact: es.total >= 1e7 }) }, size: 150, legend: false });
  }

  F.views.inicio = { title: 'Inicio', render };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
