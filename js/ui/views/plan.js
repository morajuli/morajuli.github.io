/* =========================================================================
 * ui/views/plan.js — Presupuestos, Metas, Recurrentes/Suscripciones y Calendario.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, L = F.ledger, A = F.analytics, R = F.recurring, St = F.Store, ui = F.ui, vh = F.vh;
  const esc = U.escapeHTML;
  const validMonth = m => /^\d{4}-\d{2}$/.test(m || '') && U.isValidDate(m + '-01') ? m : U.currentMonthKey();

  // ================================ PRESUPUESTOS ================================
  function presupuestos(el, p) {
    const key = validMonth(p.m);
    const s = A.monthSummary(St, key);
    const isCur = key === U.currentMonthKey();
    const days = A.elapsedDays(key), dim = U.daysInMonth(key);
    const budgets = St.all('budgets').map(b => {
      const c = St.get('categories', b.categoryId);
      const spent = U.round2(s.expenseByCategory.get(b.categoryId) || 0);
      const pct = b.amount > 0 ? spent / b.amount * 100 : 0;
      const pace = isCur && days > 0 ? spent / days * dim : null;
      return { b, c, spent, pct, available: U.round2(b.amount - spent), pace };
    }).sort((a, b) => b.pct - a.pct);
    const totalB = U.sum(budgets, x => x.b.amount), totalS = U.sum(budgets, x => x.spent);
    const state = pct => pct > 100 ? 'over' : pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : '';
    const label = pct => pct > 100 ? 'Superado' : pct >= 90 ? 'Casi al límite' : pct >= 75 ? 'Cerca del límite' : 'Dentro del límite';
    const card = x => '<article class="bud-card ' + state(x.pct) + '"><header><h3><i class="dot" style="background:' + esc(x.c ? x.c.color : '#888') + '"></i>' + esc(x.c ? x.c.name : 'Categoría eliminada') + '</h3><span class="badge ' + state(x.pct) + '">' + label(x.pct) + '</span></header>' +
      ui.progress(x.pct, state(x.pct)) +
      '<dl class="bud-nums"><div><dt>Presupuesto</dt><dd>' + ui.amt(x.b.amount) + '</dd></div><div><dt>Gastado</dt><dd>' + ui.amt(x.spent) + '</dd></div><div><dt>' + (x.available >= 0 ? 'Disponible' : 'Excedido') + '</dt><dd>' + ui.amt(Math.abs(x.available)) + '</dd></div><div><dt>Utilizado</dt><dd>' + U.pct(x.pct, 2) + '</dd></div></dl>' +
      (x.pace !== null && x.spent > 0 ? '<p class="muted small">Al ritmo actual el mes cerraría en ' + esc(U.money(x.pace)) + ' (' + U.pct(x.b.amount ? x.pace / x.b.amount * 100 : null, 0) + ' del presupuesto).</p>' : '') +
      '<div class="acc-actions"><a class="btn small ghost" href="#/movimientos?period=month&month=' + key + '&categoryId=' + esc(x.b.categoryId) + '">Ver gastos</a><button class="btn small ghost" data-edit-bud="' + esc(x.b.id) + '">' + ui.icon('edit') + 'Editar</button></div></article>';
    const withB = new Set(budgets.map(x => x.b.categoryId));
    const unb = A.categoryList(St, s.expenseByCategory, s.expense).filter(c => !withB.has(c.id));
    el.innerHTML = '<div class="page">' + vh.pageHead('Presupuestos', 'Límites mensuales por categoría. Los indicadores cambian de color al 75%, 90% y 100%.', vh.monthPicker(key, 'presupuestos') + '<button class="btn primary" data-new-bud>' + ui.icon('plus') + 'Presupuesto</button>') +
      (budgets.length ? '<div class="kpis four">' + vh.kpi('Presupuestado', ui.amt(totalB)) + vh.kpi('Gastado', ui.amt(totalS), U.pct(totalB ? totalS / totalB * 100 : null, 1) + ' utilizado') + vh.kpi('Disponible', ui.amt(totalB - totalS, { colored: true })) + vh.kpi('Días restantes', isCur ? String(dim - days) : '—', isCur ? 'de ' + dim : 'mes cerrado') + '</div>' +
        '<div class="acc-grid">' + budgets.map(card).join('') + '</div>' +
        (unb.length ? vh.card('Gastos sin presupuesto este mes', '<ul class="rank">' + unb.map(c => '<li><span>' + esc(c.name) + '</span>' + ui.amt(c.amount) + '</li>').join('') + '</ul>') : '')
        : ui.emptyState('target', 'Sin presupuestos', 'Define un límite mensual para las categorías que quieras vigilar, por ejemplo Alimentación $400.000.', '<button class="btn primary" data-new-bud>Crear presupuesto</button>')) + '</div>';
    el.querySelectorAll('[data-new-bud]').forEach(b => b.addEventListener('click', () => F.forms.budget(null)));
    el.querySelectorAll('[data-edit-bud]').forEach(b => b.addEventListener('click', () => F.forms.budget(St.get('budgets', b.dataset.editBud))));
  }

  // ================================ METAS ================================
  function timeLeft(months) {
    if (months === null) return '—';
    if (months < 0) return 'Fecha vencida';
    if (months < 1) return Math.max(0, Math.round(months * 30.4)) + ' días';
    const y = Math.floor(months / 12), m = Math.round(months % 12);
    return (y ? y + ' año' + (y > 1 ? 's' : '') + (m ? ' y ' : '') : '') + (m ? m + ' mes' + (m > 1 ? 'es' : '') : '');
  }
  function metas(el) {
    const goals = St.all('goals');
    const card = g => {
      const p = L.goalProgress(St, g);
      const acc = St.get('accounts', g.accountId);
      return '<article class="goal-card' + (p.completed ? ' done' : '') + '"><header><div><h3>' + esc(g.name) + '</h3><span class="muted small">' + esc(S.GOAL_KINDS[g.kind]) + (acc ? ' · saldo de ' + esc(acc.name) : ' · valor manual') + '</span></div><div class="goal-pct">' + U.pct(p.pct, 1) + '</div></header>' +
        ui.progress(p.pct, p.completed ? 'done' : '') +
        '<div class="goal-amounts">' + ui.amt(p.current) + '<span class="muted"> de ' + esc(U.money(p.target)) + '</span></div>' +
        '<dl class="acc-meta"><div><dt>Dinero restante</dt><dd>' + esc(U.money(p.remaining)) + '</dd></div><div><dt>Tiempo restante</dt><dd>' + esc(g.targetDate ? timeLeft(p.monthsLeft) : 'Sin fecha') + '</dd></div>' +
        '<div><dt>Aporte mensual necesario</dt><dd>' + (p.requiredMonthly === null ? (g.targetDate ? 'Fecha vencida' : '—') : esc(U.money(p.requiredMonthly))) + '</dd></div><div><dt>Aporte mensual deseado</dt><dd>' + (g.monthlyContribution ? esc(U.money(g.monthlyContribution)) : '—') + '</dd></div></dl>' +
        (p.monthsAtDesired && !p.completed ? '<p class="small">Con ' + esc(U.money(g.monthlyContribution)) + ' al mes completarías la meta en ' + timeLeft(p.monthsAtDesired) + ' (≈ ' + esc(U.monthLabel(U.monthKey(p.projectedDate)).toLowerCase()) + ')' + (g.targetDate && p.projectedDate > g.targetDate ? ', después de la fecha objetivo' : '') + '.</p>' : '') +
        (p.contributedThisMonth ? '<p class="muted small">Aportado este mes: ' + esc(U.money(p.contributedThisMonth)) + '</p>' : '') +
        '<div class="acc-actions">' + (!p.completed ? '<button class="btn small primary" data-goal-add="' + esc(g.id) + '">Aportar</button>' : '') + '<button class="btn small ghost" data-goal-edit="' + esc(g.id) + '">' + ui.icon('edit') + 'Editar</button></div></article>';
    };
    const active = goals.filter(g => !g.archived);
    const totals = active.map(g => L.goalProgress(St, g));
    el.innerHTML = '<div class="page">' + vh.pageHead('Metas financieras', 'El avance se toma del saldo de la cuenta vinculada o de los aportes registrados.', '<button class="btn primary" data-new-goal>' + ui.icon('plus') + 'Nueva meta</button>') +
      (active.length ? '<div class="kpis three">' + vh.kpi('Total objetivo', ui.amt(U.sum(totals, t => t.target))) + vh.kpi('Acumulado', ui.amt(U.sum(totals, t => t.current))) + vh.kpi('Aportes mensuales deseados', ui.amt(U.sum(active, g => g.monthlyContribution || 0))) + '</div>' +
        '<div class="acc-grid">' + active.map(card).join('') + '</div>' : ui.emptyState('target', 'Sin metas todavía', 'Fondo de emergencia, computador, viaje, vivienda… Define cuánto y para cuándo.', '<button class="btn primary" data-new-goal>Crear meta</button>')) +
      (goals.length > active.length ? '<details class="archived"><summary>Archivadas</summary><div class="acc-grid">' + goals.filter(g => g.archived).map(card).join('') + '</div></details>' : '') + '</div>';
    el.querySelectorAll('[data-new-goal]').forEach(b => b.addEventListener('click', () => F.forms.goal(null)));
    el.querySelectorAll('[data-goal-edit]').forEach(b => b.addEventListener('click', () => F.forms.goal(St.get('goals', b.dataset.goalEdit))));
    el.querySelectorAll('[data-goal-add]').forEach(b => b.addEventListener('click', () => {
      const g = St.get('goals', b.dataset.goalAdd);
      F.txForm.open({ type: 'saving', preset: { goalId: g.id, toAccountId: g.accountId || '', amount: g.monthlyContribution || '', description: 'Aporte ' + g.name } });
    }));
  }

  // ================================ RECURRENTES / SUSCRIPCIONES ================================
  function recurrentes(el) {
    const rules = St.all('recurring');
    const subs = R.subscriptionsSummary(St);
    const pend = R.pending(St);
    const row = r => {
      const cat = St.get('categories', r.categoryId);
      const acc = St.get('accounts', r.accountId);
      const sign = r.type === 'income' ? 1 : r.type === 'expense' ? -1 : 0;
      return '<li class="rec-row' + (r.active ? '' : ' inactive') + '"><div class="rec-main"><strong>' + esc(r.name) + '</strong><span class="muted small">' + esc(S.FREQUENCIES[r.frequency].label) + ' · ' + esc(S.TX_TYPES[r.type].label) + (cat ? ' · ' + esc(cat.name) : '') + (acc ? ' · ' + esc(acc.name) : '') + (r.autoConfirm ? ' · automático' : '') + '</span></div>' +
        '<div class="rec-next"><span class="muted small">' + (r.active ? 'Próximo' : 'Pausado') + '</span><span>' + esc(r.active ? U.dateLabel(r.nextDate) : '—') + '</span></div>' +
        '<div class="rec-amt">' + (sign ? ui.amt(sign * r.amount, { sign: true, colored: sign > 0 }) : ui.amt(r.amount)) + (r.frequency !== 'monthly' ? '<span class="muted small">≈ ' + esc(U.money(R.monthlyEquivalent(r))) + '/mes</span>' : '') + '</div>' +
        '<button class="icon-btn" data-edit-rule="' + esc(r.id) + '" aria-label="Editar">' + ui.icon('edit') + '</button></li>';
    };
    const others = rules.filter(r => !(r.isSubscription && r.type === 'expense'));
    const subRules = rules.filter(r => r.isSubscription && r.type === 'expense');
    el.innerHTML = '<div class="page">' + vh.pageHead('Recurrentes y suscripciones', 'Pagos e ingresos que se repiten. Sin servidor, la app los revisa cada vez que la abres.', '<button class="btn primary" data-new-sub>' + ui.icon('plus') + 'Suscripción</button><button class="btn" data-new-rule>' + ui.icon('plus') + 'Recurrente</button>') +
      (pend.length ? vh.card('Pendientes por confirmar (' + pend.length + ')', '<ul class="rec-list">' + pend.map(p => '<li class="rec-row"><div class="rec-main"><strong>' + esc(p.rule.name) + '</strong><span class="muted small">' + esc(U.relativeDayLabel(p.date)) + '</span></div><div class="rec-amt">' + ui.amt(p.rule.amount) + '</div><div class="pending-actions"><button class="btn small primary" data-confirm-rec="' + esc(p.rule.id) + '">Registrar</button><button class="btn small ghost" data-edit-rec-tx="' + esc(p.rule.id) + '">Editar</button><button class="btn small ghost" data-skip-rec="' + esc(p.rule.id) + '">Omitir</button></div></li>').join('') + '</ul>', { cls: 'pending-card' }) : '') +
      '<section class="subs-hero"><p>Actualmente gastas <b>' + ui.amt(subs.monthly) + '</b> al mes en suscripciones.</p><p>Tu costo anual estimado en suscripciones es <b>' + ui.amt(subs.annual) + '</b>.</p><span class="muted small">' + subs.count + ' suscripción(es) activa(s). Las no mensuales se convierten a su equivalente mensual.</span></section>' +
      vh.card('Suscripciones', subRules.length ? '<ul class="rec-list">' + subRules.map(row).join('') + '</ul>' : '<p class="muted">Netflix, Spotify, gimnasio, software… Regístralas para ver cuánto suman.</p>') +
      vh.card('Otros recurrentes', others.length ? '<ul class="rec-list">' + others.map(row).join('') + '</ul>' : '<p class="muted">Arriendo, internet, salario, ahorro automático, cuotas de crédito…</p>') + '</div>';
    el.querySelector('[data-new-sub]').addEventListener('click', () => F.forms.recurring(null, null, { isSubscription: true, categoryId: 'cat_suscripciones', nature: 'fixed' }));
    el.querySelector('[data-new-rule]').addEventListener('click', () => F.forms.recurring(null));
    el.querySelectorAll('[data-edit-rule]').forEach(b => b.addEventListener('click', () => F.forms.recurring(St.get('recurring', b.dataset.editRule))));
  }

  // ================================ CALENDARIO ================================
  let calSelected = null;
  function calendario(el, p) {
    const key = validMonth(p.m);
    const from = U.monthStart(key), to = U.monthEnd(key);
    const txs = A.filterTransactions(St, { from, to });
    const sched = R.scheduledBetween(St, from, to);
    const byDay = new Map();
    const push = (d, item) => { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(item); };
    for (const t of txs) push(t.date, { kind: 'tx', tx: t });
    for (const o of sched) push(o.date, { kind: 'sched', rule: o.rule, date: o.date });
    for (const d of St.all('debts')) {
      if (!d.dueDay || d.archived || L.debtBalanceAt(St, d, to) <= 0) continue;
      const day = key + '-' + U.pad(Math.min(d.dueDay, U.daysInMonth(key)));
      push(day, { kind: 'due', debt: d, date: day });
    }
    for (const g of St.all('goals')) if (g.targetDate && U.monthKey(g.targetDate) === key && !g.archived) push(g.targetDate, { kind: 'goal', goal: g });
    let inc = 0, exp = 0, schedOut = 0, schedIn = 0;
    for (const t of txs) for (const it of L.flowItems(t, St)) { if (it.kind === 'income') inc += it.amount; else exp += it.amount; }
    for (const o of sched) { if (o.rule.type === 'income') schedIn += o.rule.amount; else if (o.rule.type !== 'transfer') schedOut += o.rule.amount; }

    const firstWd = (U.parseISO(from).getDay() + 6) % 7;
    let grid = '<div class="cal-grid">' + U.WEEKDAYS_SHORT.map(d => '<div class="cal-wd">' + d + '</div>').join('');
    for (let i = 0; i < firstWd; i++) grid += '<div class="cal-cell empty"></div>';
    const dim = U.daysInMonth(key);
    if (!calSelected || U.monthKey(calSelected) !== key) calSelected = key === U.currentMonthKey() ? U.today() : from;
    for (let d = 1; d <= dim; d++) {
      const iso = key + '-' + U.pad(d);
      const items = byDay.get(iso) || [];
      let net = 0;
      for (const it of items) if (it.kind === 'tx') for (const f of L.flowItems(it.tx, St)) net += f.kind === 'income' ? f.amount : -f.amount;
      const kinds = new Set(items.map(it => it.kind === 'tx' ? (it.tx.type === 'income' ? 'in' : it.tx.type === 'expense' ? 'out' : 'move') : it.kind));
      grid += '<button class="cal-cell' + (iso === U.today() ? ' today' : '') + (iso === calSelected ? ' sel' : '') + (items.length ? ' has' : '') + '" data-day="' + iso + '"><span class="cal-d">' + d + '</span>' +
        (net ? '<span class="cal-net ' + (net > 0 ? 'pos' : 'neg') + '">' + esc(U.money(Math.abs(net), { compact: true })) + '</span>' : '') +
        '<span class="cal-dots">' + [...kinds].map(k => '<i class="k-' + k + '"></i>').join('') + '</span></button>';
    }
    grid += '</div>';
    const dayPanel = () => {
      const items = byDay.get(calSelected) || [];
      if (!items.length) return '<p class="muted">Sin movimientos ni pagos programados el ' + esc(U.dateLabel(calSelected)) + '.</p>';
      return '<ul class="cal-items">' + items.map(it => {
        if (it.kind === 'tx') return '<li>' + vh.txRow(it.tx) + '</li>';
        if (it.kind === 'sched') return '<li class="cal-sched"><span class="badge">' + (it.date <= U.today() ? 'Pendiente' : 'Programado') + '</span><span>' + esc(it.rule.name) + ' · ' + esc(S.TX_TYPES[it.rule.type].label) + '</span>' + ui.amt(it.rule.amount) + (it.date <= U.today() && it.date === it.rule.nextDate ? '<button class="btn small" data-confirm-rec="' + esc(it.rule.id) + '">Registrar</button>' : '') + '</li>';
        if (it.kind === 'due') return '<li class="cal-sched"><span class="badge warn">Vence cuota</span><span>' + esc(it.debt.name) + '</span>' + ui.amt(it.debt.monthlyPayment || 0) + '</li>';
        return '<li class="cal-sched"><span class="badge">Meta</span><span>Fecha objetivo: ' + esc(it.goal.name) + '</span></li>';
      }).join('') + '</ul>';
    };
    el.innerHTML = '<div class="page">' + vh.pageHead('Calendario financiero', 'Cómo se distribuye tu dinero durante el mes.', vh.monthPicker(key, 'calendario')) +
      '<div class="kpis four">' + vh.kpi('Ingresos registrados', ui.amt(inc)) + vh.kpi('Gastos registrados', ui.amt(exp)) + vh.kpi('Ingresos programados', ui.amt(schedIn), 'recurrentes aún no registrados') + vh.kpi('Salidas programadas', ui.amt(schedOut), 'gastos, ahorros, cuotas…') + '</div>' +
      '<div class="cal-layout"><div class="card cal-card">' + grid + '<div class="cal-legend"><span><i class="k-in"></i>Ingreso</span><span><i class="k-out"></i>Gasto</span><span><i class="k-move"></i>Otro movimiento</span><span><i class="k-sched"></i>Programado</span><span><i class="k-due"></i>Vencimiento</span></div></div>' +
      '<div class="card cal-day"><h2 data-day-title>' + esc(U.relativeDayLabel(calSelected)) + '</h2><div data-day-panel>' + dayPanel() + '</div></div></div></div>';
    el.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
      calSelected = b.dataset.day;
      el.querySelectorAll('.cal-cell.sel').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      el.querySelector('[data-day-title]').textContent = U.relativeDayLabel(calSelected);
      el.querySelector('[data-day-panel]').innerHTML = dayPanel();
      if (window.innerWidth < 900) el.querySelector('.cal-day').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  Object.assign(F.views, {
    presupuestos: { title: 'Presupuestos', render: presupuestos },
    metas: { title: 'Metas', render: metas },
    recurrentes: { title: 'Recurrentes', render: recurrentes },
    calendario: { title: 'Calendario', render: calendario }
  });
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
