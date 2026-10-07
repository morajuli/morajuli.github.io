/* =========================================================================
 * ui/views/analysis.js — Análisis mensual, anual, ingresos, gastos,
 * ahorro y flujo de caja, proyección, salud financiera e informes.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, L = F.ledger, A = F.analytics, R = F.recurring, St = F.Store, ui = F.ui, vh = F.vh, C = F.charts;
  const esc = U.escapeHTML;
  const COL = { income: 'var(--income)', expense: 'var(--expense)', saving: 'var(--saving)', invest: 'var(--invest)', nw: 'var(--accent)', muted: 'var(--muted-line)', debt: 'var(--debt)' };

  function validMonth(m) { return /^\d{4}-\d{2}$/.test(m || '') && U.isValidDate(m + '-01') ? m : U.currentMonthKey(); }
  function lastMonths(key, n) { const first = L.firstDataMonth(St); const from = U.addMonthKey(key, -(n - 1)); return U.monthRange(from < first ? first : from, key); }
  function analysisTabs(active) {
    const tabs = [['mes', 'Mes'], ['anual', 'Año'], ['ingresos', 'Ingresos'], ['gastos', 'Gastos'], ['ahorro', 'Ahorro y flujo'], ['proyeccion', 'Proyección'], ['salud', 'Indicadores'], ['informes', 'Informes']];
    return '<nav class="subtabs" aria-label="Análisis">' + tabs.map(([k, l]) => '<a href="#/' + k + '"' + (k === active ? ' class="on" aria-current="page"' : '') + '>' + l + '</a>').join('') + '</nav>';
  }
  function noData() { return ui.emptyState('chart', 'Aún no hay datos para analizar', 'Registra movimientos o carga los datos de ejemplo desde Ajustes.', '<button class="btn primary" data-add-tx="expense">Registrar movimiento</button>'); }

  // ================================ MES ================================
  function mes(el, p) {
    const key = validMonth(p.m);
    const ma = A.monthAnalysis(St, key);
    const c = ma.cur;
    const body = [];
    body.push('<div class="kpis seven">' +
      vh.kpi('Ingresos', ui.amt(c.income), ui.delta(ma.vsPrev.income.pct)) +
      vh.kpi('Gastos', ui.amt(c.expense), ui.delta(ma.vsPrev.expense.pct, { invert: true })) +
      vh.kpi('Balance (flujo neto)', ui.amt(c.net, { colored: true }), 'Ingresos − Gastos') +
      vh.kpi('Ahorro', ui.amt(c.saving), ui.delta(ma.vsPrev.saving.pct)) +
      vh.kpi('Inversión', ui.amt(c.investment), ui.delta(ma.vsPrev.investment.pct)) +
      vh.kpi('Tasa de ahorro', U.pct(c.savingsRate, 1), 'Tasa de inversión ' + U.pct(c.investmentRate, 1)) +
      vh.kpi('Patrimonio al cierre', c.netWorth === null ? '—' : ui.amt(c.netWorth), c.isCurrent ? 'a hoy' : '') + '</div>' +
      '<p class="foot-note">Variaciones frente a ' + esc(ma.prevLabel) + '.' + (c.isCurrent ? ' Mes en curso: se compara contra los mismos días del mes anterior.' : '') + '</p>');
    const rows = (cmp) => [
      ['Ingresos', cmp.income.cur, cmp.income.prev], Object.assign(['Gastos', cmp.expense.cur, cmp.expense.prev], { invert: true }), ['Balance', cmp.net.cur, cmp.net.prev],
      ['Ahorro', cmp.saving.cur, cmp.saving.prev], ['Inversión', cmp.investment.cur, cmp.investment.prev],
      Object.assign(['Tasa de ahorro', cmp.savingsRate.cur, cmp.savingsRate.prev], { pct: true })];
    let cmpHTML = vh.compareTable(rows(ma.vsPrev), U.monthLabel(key, true), ma.prevLabel.replace(/^(\w+) (\d{4})/, (m, a, b) => a.slice(0, 3).toLowerCase() + ' ' + b.slice(2)));
    if (ma.vsYoy) cmpHTML += '<h3 class="h3">Mismo mes del año anterior</h3>' + vh.compareTable(rows(ma.vsYoy), U.monthLabel(key, true), U.monthLabel(U.addMonthKey(key, -12), true));
    else cmpHTML += '<p class="muted small">Sin datos del mismo mes del año anterior (' + esc(U.monthLabel(U.addMonthKey(key, -12))) + ').</p>';
    const cats = ma.catVsPrev.filter(x => x.cur > 0).sort((a, b) => b.cur - a.cur);
    const catHTML = cats.length ? '<div class="bars">' + cats.slice(0, 10).map(x => vh.barRow(x.name, x.cur, c.expense ? x.cur / c.expense * 100 : 0, x.color, ' ' + ui.delta(x.pct, { invert: true, title: 'vs período anterior' }))).join('') + '</div>' : ui.emptyState('pie', 'Sin gastos en este mes', '');
    const ins = A.insights(St, key);
    const fixedPct = c.expense ? c.fixed / c.expense * 100 : 0;
    el.innerHTML = '<div class="page">' + analysisTabs('mes') + vh.pageHead('Análisis mensual', '', vh.monthPicker(key, 'mes')) +
      (c.count === 0 && ma.prev.count === 0 ? noData() :
        body.join('') +
        '<div class="grid-2">' + vh.card('Comparación', cmpHTML) + vh.card('Categorías principales', catHTML, { action: '<a class="link" href="#/movimientos?period=month&month=' + key + '&type=expense">Ver gastos</a>' }) + '</div>' +
        '<div class="grid-2">' + vh.card('Patrones del mes', ins.length ? '<ul class="insights">' + ins.map(i => '<li class="ins ' + i.dir + '">' + esc(i.text) + '</li>').join('') + '</ul>' : '<p class="muted">Se necesitan más datos para detectar patrones.</p>', { icon: 'pulse' }) +
        vh.card('Gastos fijos y variables', '<div class="stack-bar"><span class="fixed" style="width:' + fixedPct.toFixed(1) + '%"></span><span class="variable" style="width:' + (c.expense ? 100 - fixedPct : 0).toFixed(1) + '%"></span></div>' +
          '<div class="kpis two">' + vh.kpi('Fijos', ui.amt(c.fixed), U.pct(fixedPct, 0) + ' del gasto') + vh.kpi('Variables', ui.amt(c.variable), U.pct(c.expense ? 100 - fixedPct : null, 0) + ' del gasto') + '</div>') + '</div>' +
        '<p class="center"><a class="btn ghost" href="#/movimientos?period=month&month=' + key + '">Ver los ' + c.count + ' movimientos de ' + esc(U.monthLabel(key).toLowerCase()) + '</a></p>') + '</div>';
  }

  // ================================ AÑO ================================
  function anual(el, p) {
    const year = /^\d{4}$/.test(p.y || '') ? p.y : U.today().slice(0, 4);
    const ys = A.yearSummary(St, year);
    const t = ys.totals;
    if (!t.count && !ys.endNW) { el.innerHTML = '<div class="page">' + analysisTabs('anual') + vh.pageHead('Análisis anual', '', vh.yearPicker(year, 'anual')) + noData() + '</div>'; return; }
    const firstM = L.firstDataMonth(St);
    const prevMonthsWithData = U.monthRange((year - 1) + '-01', (year - 1) + '-12').filter(k => k >= firstM).length;
    const prevNote = ys.vsPrev && prevMonthsWithData < 12 ? '<p class="foot-note">' + (year - 1) + ' tiene datos solo de ' + prevMonthsWithData + ' mes(es); la comparación anual está incompleta.</p>' : '';
    const kp = '<div class="kpis seven">' +
      vh.kpi('Ingresos totales', ui.amt(t.income), ys.vsPrev ? ui.delta(ys.vsPrev.income.pct) + ' vs ' + (year - 1) : '') +
      vh.kpi('Gastos totales', ui.amt(t.expense), ys.vsPrev ? ui.delta(ys.vsPrev.expense.pct, { invert: true }) + ' vs ' + (year - 1) : '') +
      vh.kpi('Ahorro (I − G)', ui.amt(t.net, { colored: true }), 'Tasa ' + U.pct(t.savingsRate, 1)) +
      vh.kpi('Apartado en ahorro', ui.amt(t.saving), 'movimientos de Ahorro') +
      vh.kpi('Inversión total', ui.amt(t.investment), 'Tasa ' + U.pct(t.investmentRate, 1)) +
      vh.kpi('Crecimiento patrimonial', ui.amt(ys.growth, { colored: true, sign: true }), ys.growthPct === null ? '' : U.signedPct(ys.growthPct, 1) + ' en el año') +
      vh.kpi('Promedio mensual', ui.amt(ys.avgExpense) + '<small class="muted"> gasto</small>', 'Ingreso ' + esc(U.money(ys.avgIncome)) + ' · ' + ys.activeMonths + ' mes(es)') + '</div>' +
      prevNote + (ys.topCategory ? '<p class="foot-note">Categoría con mayor gasto: <b>' + esc(ys.topCategory.name) + '</b> (' + esc(U.money(ys.topCategory.amount)) + ', ' + U.pct(ys.topCategory.share, 0) + ' del total).</p>' : '');
    const rows = ys.rows;
    const table = '<div class="table-wrap"><table class="tbl num"><thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Flujo neto</th><th>Ahorro</th><th>Inversión</th><th>Patrimonio</th></tr></thead><tbody>' +
      rows.filter(r => !r.future).map(r => '<tr><th><a href="#/mes?m=' + r.key + '">' + esc(U.monthLabel(r.key).split(' ')[0]) + '</a></th><td>' + ui.amt(r.income) + '</td><td>' + ui.amt(r.expense) + '</td><td>' + ui.amt(r.net, { colored: true }) + '</td><td>' + ui.amt(r.saving) + '</td><td>' + ui.amt(r.investment) + '</td><td>' + (r.netWorth === null ? '—' : ui.amt(r.netWorth)) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><th>Total</th><td>' + ui.amt(t.income) + '</td><td>' + ui.amt(t.expense) + '</td><td>' + ui.amt(t.net, { colored: true }) + '</td><td>' + ui.amt(t.saving) + '</td><td>' + ui.amt(t.investment) + '</td><td>' + ui.amt(ys.endNW) + '</td></tr></tfoot></table></div>';
    const cats = '<div class="bars">' + ys.categories.slice(0, 10).map(x => vh.barRow(x.name, x.amount, x.share, x.color, ' <small class="muted">' + U.pct(x.share, 0) + '</small>')).join('') + '</div>';
    el.innerHTML = '<div class="page">' + analysisTabs('anual') + vh.pageHead('Análisis anual', '', vh.yearPicker(year, 'anual')) + kp +
      vh.card('Evolución mensual', '<div data-c1></div><div data-c2></div>') + vh.card('Mes a mes', table) + vh.card('Gastos por categoría en ' + year, cats || '') + '</div>';
    const shown = rows.filter(r => !r.future);
    const labels = shown.map(r => U.monthLabel(r.key)), short = shown.map(r => U.MONTHS_SHORT[Number(r.key.slice(5)) - 1]);
    C.mount(el.querySelector('[data-c1]'), { type: 'bar', labels, shortLabels: short, series: [{ name: 'Ingresos', color: COL.income, values: shown.map(r => r.income) }, { name: 'Gastos', color: COL.expense, values: shown.map(r => r.expense) }] });
    C.mount(el.querySelector('[data-c2]'), { type: 'line', labels, shortLabels: short, zero: false, series: [{ name: 'Patrimonio neto', color: COL.nw, values: shown.map(r => r.netWorth), area: true }], height: 170 });
  }

  // ================================ INGRESOS ================================
  function ingresos(el, p) {
    const key = validMonth(p.m);
    const s = A.incomeStats(St, key);
    const kp = '<div class="kpis five">' +
      vh.kpi('Ingreso del mes', ui.amt(s.month), ui.delta(s.changePrev) + ' vs mes anterior') +
      vh.kpi('Ingreso del año ' + key.slice(0, 4), ui.amt(s.year), '') +
      vh.kpi('Ingreso promedio', ui.amt(s.avg12), s.avgMonths ? 'últimos ' + s.avgMonths + ' meses completos' : 'sin meses completos') +
      vh.kpi('Vs. promedio', ui.delta(s.changeAvg), s.avgMonths ? 'del mes frente al promedio' : '') +
      vh.kpi('Mes anterior', ui.amt(s.prev), '') + '</div>';
    const cats = s.categories.length ? '<div class="bars">' + s.categories.map(c => vh.barRow(c.name, c.amount, c.share, c.color, ' <small class="muted">' + U.pct(c.share, 0) + '</small>')).join('') + '</div>' : '<p class="muted">Sin ingresos en este mes.</p>';
    const list = A.filterTransactions(St, { from: U.monthStart(key), to: U.monthEnd(key), types: ['income'] });
    el.innerHTML = '<div class="page">' + analysisTabs('ingresos') + vh.pageHead('Ingresos', '', vh.monthPicker(key, 'ingresos') + '<button class="btn primary" data-add-tx="income">' + ui.icon('plus') + 'Ingreso</button>') + kp +
      vh.card('Evolución de ingresos (12 meses)', '<div data-c1></div>') +
      '<div class="grid-2">' + vh.card('Por fuente', cats) + vh.card('Ingresos de ' + U.monthLabel(key).toLowerCase(), vh.txList(list, { empty: '<p class="muted">Sin ingresos registrados.</p>' })) + '</div></div>';
    const ser = s.series;
    C.mount(el.querySelector('[data-c1]'), { type: 'bar', labels: ser.map(r => U.monthLabel(r.key)), shortLabels: ser.map(r => U.monthLabel(r.key, true)), series: [{ name: 'Ingresos', color: COL.income, values: ser.map(r => r.income) }] });
  }

  // ================================ GASTOS ================================
  function gastos(el, p) {
    const key = validMonth(p.m);
    const es = A.expenseStats(St, key);
    const s = es.summary;
    const av = A.averages(St, key, 6);
    const kp = '<div class="kpis five">' +
      vh.kpi('Total del mes', ui.amt(es.total), !av.months ? '' : s.isCurrent ? 'proyección ' + ui.delta(U.pctChange(es.projection, av.expense), { invert: true }) + ' vs promedio' : ui.delta(U.pctChange(es.total, av.expense), { invert: true }) + ' vs promedio') +
      vh.kpi('Promedio diario', ui.amt(es.dailyAvg), es.days + ' día(s) ' + (s.isCurrent ? 'transcurridos' : 'del mes')) +
      vh.kpi('Promedio semanal', ui.amt(es.weeklyAvg), 'diario × 7') +
      vh.kpi('Proyección mensual', ui.amt(es.projection), s.isCurrent ? 'estimación' : 'mes cerrado') +
      vh.kpi('Promedio 6 meses', ui.amt(av.expense), av.months ? av.months + ' mes(es) completos' : 'sin meses completos') + '</div>' +
      (s.isCurrent ? '<p class="foot-note">Proyección = gastado (' + esc(U.money(es.total)) + ') + gasto variable diario (' + esc(U.money(es.variableDaily)) + ') × días restantes (' + (es.daysInMonth - es.days) + ') + recurrentes pendientes del mes (' + esc(U.money(es.scheduledRemaining)) + ').</p>' : '');
    const budgets = new Map(St.all('budgets').map(b => [b.categoryId, b]));
    const cats = es.categories.length ? '<div class="bars">' + es.categories.map(c => {
      const b = budgets.get(c.id);
      return vh.barRow(c.name, c.amount, c.share, c.color, ' <small class="muted">' + U.pct(c.share, 0) + (b ? ' · ppto ' + esc(U.money(b.amount, { compact: true })) : '') + '</small>');
    }).join('') + '</div>' : '';
    // Subcategorías principales
    const subs = [...s.expenseBySub.entries()].map(([k, v]) => { const [cid, sub] = k.split('|'); const c = St.get('categories', cid); return { name: (c ? c.name : '—') + (sub ? ' · ' + sub : ''), amount: v }; }).sort((a, b) => b.amount - a.amount).slice(0, 8);
    const subsHTML = subs.length ? '<ul class="rank">' + subs.map(x => '<li><span>' + esc(x.name) + '</span>' + ui.amt(x.amount) + '</li>').join('') + '</ul>' : '';
    const persons = [...s.byPerson.entries()].sort((a, b) => b[1] - a[1]);
    const personHTML = persons.length ? '<ul class="rank">' + persons.map(([k, v]) => '<li><span>' + esc(S.PERSONS[k] || k) + '</span>' + ui.amt(v) + ' <small class="muted">' + U.pct(es.total ? v / es.total * 100 : null, 0) + '</small></li>').join('') + '</ul><p class="muted small">Clasificación informativa: no altera saldos ni patrimonio.</p>' : '';
    const fixedPct = es.total ? s.fixed / es.total * 100 : 0;
    const biggest = A.filterTransactions(St, { from: U.monthStart(key), to: U.monthEnd(key), types: ['expense'] }).sort((a, b) => b.amount - a.amount).slice(0, 5);
    el.innerHTML = '<div class="page">' + analysisTabs('gastos') + vh.pageHead('Gastos', '', vh.monthPicker(key, 'gastos') + '<button class="btn primary" data-add-tx="expense">' + ui.icon('plus') + 'Gasto</button>') +
      (es.total === 0 && !av.months ? noData() : kp +
        '<div class="grid-2">' + vh.card('Por categoría', '<div data-donut></div>' + cats) +
        '<div class="col">' + vh.card('Fijos y variables', '<div class="stack-bar"><span class="fixed" style="width:' + fixedPct.toFixed(1) + '%"></span><span class="variable" style="width:' + (es.total ? 100 - fixedPct : 0).toFixed(1) + '%"></span></div><div class="kpis two">' +
          vh.kpi('Fijos', ui.amt(s.fixed), U.pct(es.total ? fixedPct : null, 0)) + vh.kpi('Variables', ui.amt(s.variable), U.pct(es.total ? 100 - fixedPct : null, 0)) + '</div>') +
        vh.card('Subcategorías principales', subsHTML || '<p class="muted">—</p>') +
        vh.card('Por persona', personHTML || '<p class="muted">—</p>') + '</div></div>' +
        vh.card('Evolución del gasto (12 meses)', '<div data-c1></div>') +
        vh.card('Gastos más grandes del mes', vh.txList(biggest, { empty: '<p class="muted">—</p>' }))) + '</div>';
    const dEl = el.querySelector('[data-donut]');
    if (dEl) C.mount(dEl, { type: 'donut', items: es.categories.map(c => ({ name: c.name, value: c.amount, color: c.color })), center: { label: 'Total', value: U.money(es.total, { compact: es.total >= 1e7 }) }, legend: false });
    const ser = A.monthlySeries(St, lastMonths(key, 12)[0], key);
    const c1 = el.querySelector('[data-c1]');
    if (c1) C.mount(c1, { type: 'bar', labels: ser.map(r => U.monthLabel(r.key)), shortLabels: ser.map(r => U.monthLabel(r.key, true)), series: [{ name: 'Fijos', color: COL.debt, values: ser.map(r => r.fixed) }, { name: 'Variables', color: COL.expense, values: ser.map(r => r.variable) }] });
  }

  // ================================ AHORRO Y FLUJO ================================
  function ahorro(el, p) {
    const key = validMonth(p.m);
    const s = A.monthSummary(St, key);
    const year = key.slice(0, 4);
    const ys = A.summarize(St, year + '-01-01', year + '-12-31');
    const months = lastMonths(key, 12);
    const ser = A.monthlySeries(St, months[0], key);
    const allSer = A.monthlySeries(St, L.firstDataMonth(St), key);
    const cumSaving = U.sum(allSer, r => r.saving), cumNet = U.sum(allSer, r => r.net), cumInv = U.sum(allSer, r => r.investment);
    const nw = L.netWorthAt(St, U.today());
    const av12 = A.averages(St, key, 12);
    const avgRate = U.safeDiv(av12.income - av12.expense, av12.income);
    const kp = '<div class="kpis six">' +
      vh.kpi('Ahorro del mes', ui.amt(s.saving), 'dinero apartado (movimientos de Ahorro)') +
      vh.kpi('Ahorro del año', ui.amt(ys.saving), year) +
      vh.kpi('Tasa de ahorro', U.pct(s.savingsRate, 1), '(Ingresos − Gastos) ÷ Ingresos' + (avgRate !== null ? ' · prom. 12m ' + U.pct(avgRate * 100, 0) : '')) +
      vh.kpi('Tasa de inversión', U.pct(s.investmentRate, 1), 'Inversión ÷ Ingresos') +
      vh.kpi('Ahorro acumulado', ui.amt(nw.savings), 'saldo hoy en cuentas de ahorro') +
      vh.kpi('Flujo neto acumulado', ui.amt(cumNet, { colored: true }), 'suma histórica de Ingresos − Gastos') + '</div>' +
      '<p class="foot-note">Ahorro = dinero que apartas a cuentas de ahorro o metas. Inversión = dinero que entra a inversiones (' + esc(U.money(cumInv)) + ' históricamente). Ninguno de los dos es un gasto: tu patrimonio no baja al ahorrar o invertir. Apartado históricamente: ' + esc(U.money(cumSaving)) + '.</p>';
    const remaining = s.income - s.expense - s.saving - s.investment;
    el.innerHTML = '<div class="page">' + analysisTabs('ahorro') + vh.pageHead('Ahorro y flujo de caja', '', vh.monthPicker(key, 'ahorro')) + kp +
      vh.card('Flujo de caja de ' + U.monthLabel(key).toLowerCase(), '<div data-wf></div><p class="foot-note">Flujo neto = Ingresos − Gastos = ' + esc(U.money(s.net)) + '. Lo que queda tras ahorro e inversión: ' + esc(U.money(remaining)) + '. Las transferencias entre tus cuentas no aparecen aquí.</p>') +
      '<div class="grid-2">' + vh.card('Flujo neto mensual', '<div data-c1></div>') + vh.card('Tasa de ahorro mensual', '<div data-c2></div>') + '</div>' +
      vh.card('Evolución del dinero ahorrado e invertido', '<div data-c3></div>') + '</div>';
    C.mount(el.querySelector('[data-wf]'), { type: 'waterfall', steps: [
      { name: 'Ingresos', kind: 'start', value: s.income, color: COL.income },
      { name: 'Gastos', kind: 'delta', value: -s.expense, color: COL.expense },
      { name: 'Ahorro', kind: 'delta', value: -s.saving, color: COL.saving },
      { name: 'Inversión', kind: 'delta', value: -s.investment, color: COL.invest },
      { name: 'Queda', kind: 'total', value: 0, color: 'var(--ink-2)' }] });
    const labels = ser.map(r => U.monthLabel(r.key)), short = ser.map(r => U.monthLabel(r.key, true));
    C.mount(el.querySelector('[data-c1]'), { type: 'bar', labels, shortLabels: short, series: [{ name: 'Flujo neto', color: COL.income, negColor: COL.expense, values: ser.map(r => r.net) }] });
    C.mount(el.querySelector('[data-c2]'), { type: 'line', labels, shortLabels: short, percent: true, series: [{ name: 'Tasa de ahorro', color: COL.saving, values: ser.map(r => r.savingsRate) }] });
    const nws = months.map(k => L.netWorthAt(St, U.monthEnd(k) > U.today() ? U.today() : U.monthEnd(k)));
    C.mount(el.querySelector('[data-c3]'), { type: 'line', labels, shortLabels: short, series: [{ name: 'Ahorrado', color: COL.saving, values: nws.map(n => n.savings) }, { name: 'Invertido', color: COL.invest, values: nws.map(n => n.invested) }] });
  }

  // ================================ PROYECCIÓN ================================
  const projState = { basis: 6, horizon: 12, incomeAdj: 0, expenseAdj: 0, annualReturn: 0 };
  function proyeccion(el) {
    const draw = () => {
      const pr = A.projection(St, projState);
      const out = el.querySelector('[data-out]');
      if (!pr.months) { out.innerHTML = ui.emptyState('projection', 'Se necesita al menos un mes completo de datos', 'La proyección usa el promedio de tus meses completos anteriores al actual.'); return; }
      const milestones = [1, 3, 6, 12, 24, 36, 60].filter(m => m <= projState.horizon);
      const last = pr.series[pr.series.length - 1];
      out.innerHTML = '<div class="kpis four">' +
        vh.kpi('Ingreso mensual supuesto', ui.amt(pr.income), 'promedio ' + pr.months + ' mes(es)' + (projState.incomeAdj ? ' ' + U.signedPct(projState.incomeAdj, 0) : '')) +
        vh.kpi('Gasto mensual supuesto', ui.amt(pr.expense), projState.expenseAdj ? U.signedPct(projState.expenseAdj, 0) + ' sobre el promedio' : 'promedio') +
        vh.kpi('Flujo neto mensual', ui.amt(pr.net, { colored: true }), 'Ingresos − Gastos') +
        vh.kpi('Patrimonio en ' + projState.horizon + ' meses', ui.amt(last.netWorth), 'hoy ' + esc(U.money(pr.start.netWorth))) + '</div>' +
        '<p class="lead">Si mantienes estos hábitos, en ' + projState.horizon + ' meses acumularías ' + ui.amt(last.cumNet, { colored: true }) + ' de flujo neto' + (projState.annualReturn ? ' y ' + ui.amt(last.cumReturn) + ' de rendimiento supuesto' : '') + '.</p>' +
        '<div data-pc></div>' +
        '<div class="table-wrap"><table class="tbl num"><thead><tr><th>Plazo</th><th>Mes</th><th>Liquidez + ahorro</th><th>Invertido</th><th>Patrimonio</th></tr></thead><tbody>' +
        milestones.map(m => { const r = pr.series[m]; return '<tr><th>' + m + ' mes' + (m > 1 ? 'es' : '') + '</th><td>' + esc(U.monthLabel(r.key, true)) + '</td><td>' + ui.amt(r.liquid) + '</td><td>' + ui.amt(r.invested) + '</td><td>' + ui.amt(r.netWorth) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="disclaimer">' + ui.icon('info', 'tiny') + ' Proyección matemática lineal, no una garantía. Supone que ingresos, gastos, aportes a inversión y abonos a deudas se repiten igual al promedio de los meses elegidos' + (projState.annualReturn ? ', y que las inversiones rinden ' + U.pct(projState.annualReturn, 1) + ' efectivo anual' : ', sin rendimientos de inversión') + '. Los resultados reales variarán.</p>';
      C.mount(out.querySelector('[data-pc]'), { type: 'line', zero: false, labels: pr.series.map(r => U.monthLabel(r.key)), shortLabels: pr.series.map(r => U.monthLabel(r.key, true)), series: [
        { name: 'Patrimonio', color: COL.nw, values: pr.series.map(r => r.netWorth), area: true },
        { name: 'Liquidez + ahorro', color: COL.saving, values: pr.series.map(r => r.liquid), dashed: true },
        { name: 'Invertido', color: COL.invest, values: pr.series.map(r => r.invested), dashed: true }] });
    };
    el.innerHTML = '<div class="page">' + analysisTabs('proyeccion') + vh.pageHead('Proyección financiera', 'Escenarios basados en tu promedio histórico.') +
      vh.card('Supuestos', '<div class="proj-controls">' +
        '<label class="field"><span class="lbl">Basado en los últimos</span><select data-p="basis">' + ui.options({ 3: '3 meses', 6: '6 meses', 12: '12 meses' }, projState.basis) + '</select></label>' +
        '<label class="field"><span class="lbl">Horizonte</span><select data-p="horizon">' + ui.options({ 6: '6 meses', 12: '12 meses', 24: '2 años', 36: '3 años', 60: '5 años' }, projState.horizon) + '</select></label>' +
        '<label class="field"><span class="lbl">Cambio en ingresos <b data-v="incomeAdj">' + U.signedPct(projState.incomeAdj, 0) + '</b></span><input type="range" min="-50" max="50" step="5" value="' + projState.incomeAdj + '" data-p="incomeAdj"></label>' +
        '<label class="field"><span class="lbl">Cambio en gastos <b data-v="expenseAdj">' + U.signedPct(projState.expenseAdj, 0) + '</b></span><input type="range" min="-50" max="50" step="5" value="' + projState.expenseAdj + '" data-p="expenseAdj"></label>' +
        '<label class="field"><span class="lbl">Rendimiento anual supuesto de inversiones (%)</span><input type="number" min="-50" max="100" step="0.5" value="' + projState.annualReturn + '" data-p="annualReturn" inputmode="decimal"></label>' +
        '</div>') + '<div data-out></div></div>';
    el.querySelectorAll('[data-p]').forEach(inp => inp.addEventListener('input', () => {
      let v = Number(inp.value);
      if (!Number.isFinite(v)) v = 0;
      if (inp.dataset.p === 'annualReturn') v = U.clamp(v, -50, 100);
      projState[inp.dataset.p] = v;
      const lbl = el.querySelector('[data-v="' + inp.dataset.p + '"]'); if (lbl) lbl.textContent = U.signedPct(v, 0);
      draw();
    }));
    draw();
  }

  // ================================ INDICADORES / SALUD ================================
  function salud(el) {
    const h = A.health(St);
    const fmtVal = m => m.value === null || m.value === undefined || !Number.isFinite(m.value) ? '—' : m.unit === '%' ? U.pct(m.value, 1) : U.plainNumber(m.value, 1) + ' ' + m.unit;
    const cards = h.metrics.map(m => '<div class="metric"><span class="metric-label">' + esc(m.label) + '</span><span class="metric-value">' + fmtVal(m) + (m.money !== undefined ? ' <small>' + esc((m.money >= 0 ? '+' : '−') + U.money(Math.abs(m.money))) + '</small>' : '') + '</span>' +
      '<details><summary>Cálculo</summary><p class="formula">' + esc(m.formula) + '</p><ul>' + m.inputs.map(([l, v]) => '<li><span>' + esc(l) + '</span>' + ui.amt(v) + '</li>').join('') + '</ul></details></div>').join('');
    const st = St.settings();
    const ef = h.emergency;
    el.innerHTML = '<div class="page">' + analysisTabs('salud') + vh.pageHead('Indicadores financieros', 'Métricas descriptivas con su fórmula. No hay puntaje: tú decides qué significan para ti.') +
      '<p class="foot-note">Base: ' + esc(h.basisTxt) + '.</p><div class="metrics">' + cards + '</div>' +
      vh.card('Calculadora de fondo de emergencia', '<div class="ef-calc">' +
        '<label class="field"><span class="lbl">Gasto mensual promedio</span><input data-ef="exp" inputmode="decimal" value="' + esc(ui.amountValue(Math.round(h.avgExpense6))) + '"><span class="hint">Prellenado con tu promedio de los últimos 6 meses.</span></label>' +
        '<label class="field"><span class="lbl">Meses objetivo</span><select data-ef="months">' + ui.options({ 3: '3 meses', 4: '4 meses', 6: '6 meses', 9: '9 meses', 12: '12 meses' }, st.emergencyMonths || 6) + '</select></label>' +
        '<label class="field"><span class="lbl">Fondo actual</span><input data-ef="cur" inputmode="decimal" value="' + esc(ui.amountValue(Math.round(ef.amount))) + '"><span class="hint">Tomado de: ' + esc(ef.label) + '. Puedes ajustarlo.</span></label>' +
        '</div><div data-ef-out></div>', { icon: 'shield' }) + '</div>';
    const out = el.querySelector('[data-ef-out]');
    el.querySelectorAll('[data-ef="exp"],[data-ef="cur"]').forEach(i => ui.bindAmountInput(i));
    const calc = () => {
      const exp = U.parseAmount(el.querySelector('[data-ef="exp"]').value) || 0;
      const months = Number(el.querySelector('[data-ef="months"]').value) || 6;
      const cur = U.parseAmount(el.querySelector('[data-ef="cur"]').value) || 0;
      const target = exp * months, rem = Math.max(0, target - cur);
      const pct = target > 0 ? cur / target * 100 : 0;
      const cover = U.safeDiv(cur, exp);
      out.innerHTML = '<div class="kpis four">' + vh.kpi('Fondo según el supuesto', ui.amt(target), U.money(exp) + ' × ' + months) + vh.kpi('Tienes', ui.amt(cur), cover === null ? '' : U.plainNumber(cover, 1) + ' meses de gasto') +
        vh.kpi('Falta', ui.amt(rem), rem ? '' : 'meta alcanzada') + vh.kpi('Progreso', U.pct(Math.min(pct, 100), 0), '') + '</div>' + ui.progress(pct, pct >= 100 ? 'done' : '') +
        (St.all('goals').some(g => g.kind === 'emergency') ? '' : '<p class="center"><button class="btn small" data-ef-goal>Crear meta «Fondo de emergencia» por ' + esc(U.money(target)) + '</button></p>');
      const b = out.querySelector('[data-ef-goal]');
      if (b) b.addEventListener('click', () => F.forms.goal(null, null, { kind: 'emergency', name: 'Fondo de emergencia', targetAmount: target }));
    };
    el.querySelectorAll('[data-ef]').forEach(i => i.addEventListener('input', calc));
    el.querySelector('[data-ef="months"]').addEventListener('change', e => { St.saveSettings({ emergencyMonths: Number(e.target.value) }); });
    calc();
  }

  // ================================ INFORMES ================================
  const repState = { mode: 'month', ref: null, from: '', to: '' };
  function informes(el) {
    const cy = U.today().slice(0, 4);
    if (!repState.ref) repState.ref = U.currentMonthKey();
    const refInput = () => {
      if (repState.mode === 'month') return '<input type="month" data-r="ref" value="' + esc(/^\d{4}-\d{2}$/.test(repState.ref) ? repState.ref : U.currentMonthKey()) + '">';
      if (repState.mode === 'quarter') {
        const opts = []; const first = Number(L.firstDataMonth(St).slice(0, 4));
        for (let y = Number(cy); y >= first; y--) for (let q = 4; q >= 1; q--) opts.push({ value: y + '-Q' + q, label: 'T' + q + ' ' + y });
        return '<select data-r="ref">' + ui.options(opts, /Q/.test(repState.ref) ? repState.ref : cy + '-Q' + U.quarterOf(U.today())) + '</select>';
      }
      if (repState.mode === 'year') { const ys = []; for (let y = Number(cy); y >= Number(L.firstDataMonth(St).slice(0, 4)); y--) ys.push(String(y)); return '<select data-r="ref">' + ui.options(ys, /^\d{4}$/.test(repState.ref) ? repState.ref : cy) + '</select>'; }
      return '<input type="date" data-r="from" value="' + esc(repState.from || U.monthStart(U.currentMonthKey())) + '"><input type="date" data-r="to" value="' + esc(repState.to || U.today()) + '">';
    };
    el.innerHTML = '<div class="page">' + analysisTabs('informes') + vh.pageHead('Informes', 'Resumen de cualquier período, listo para imprimir o exportar.') +
      '<div class="report-controls no-print"><select data-r="mode">' + ui.options({ month: 'Mes', quarter: 'Trimestre', year: 'Año', custom: 'Rango personalizado' }, repState.mode) + '</select><span data-ref>' + refInput() + '</span>' +
      '<button class="btn ghost" data-print>' + ui.icon('file') + 'Imprimir / PDF</button><button class="btn ghost" data-rcsv>' + ui.icon('download') + 'CSV</button></div><div data-report></div></div>';
    const draw = () => {
      let from, to, label, prev;
      if (repState.mode === 'custom') {
        from = repState.from || U.monthStart(U.currentMonthKey()); to = repState.to || U.today();
        if (!U.isValidDate(from) || !U.isValidDate(to) || from > to) { el.querySelector('[data-report]').innerHTML = '<p class="field-error">Rango inválido: la fecha inicial debe ser anterior a la final.</p>'; return; }
        label = U.dateLabel(from) + ' – ' + U.dateLabel(to);
      } else {
        const rr = A.periodRange(repState.mode, repState.mode === 'month' ? (/^\d{4}-\d{2}$/.test(repState.ref) ? repState.ref : U.currentMonthKey()) : repState.mode === 'quarter' ? (/Q/.test(repState.ref) ? repState.ref : cy + '-Q' + U.quarterOf(U.today())) : (/^\d{4}$/.test(repState.ref) ? repState.ref : cy));
        from = rr.from; to = rr.to; label = rr.label;
      }
      prev = A.previousRange(repState.mode, from, to);
      const r = A.report(St, from, to, prev.from, prev.to);
      const s = r.summary;
      const line = (l, v, pctv, inv) => '<div class="rep-line"><span>' + esc(l) + '</span><b>' + ui.amt(v) + '</b>' + (pctv !== undefined ? ui.delta(pctv, { invert: inv }) : '') + '</div>';
      el.querySelector('[data-report]').innerHTML = '<article class="report card">' +
        '<header><h2>Informe · ' + esc(label) + '</h2><p class="muted">' + esc(U.dateLabel(from)) + ' al ' + esc(U.dateLabel(to)) + ' · Generado el ' + esc(U.dateLabel(U.today())) + '</p></header>' +
        '<div class="rep-grid"><div>' +
        line('Ingresos', s.income, r.vs.income.pct) + line('Gastos', s.expense, r.vs.expense.pct, true) + line('Flujo neto (I − G)', s.net, r.vs.net.pct) +
        line('Ahorro', s.saving, r.vs.saving.pct) + line('Inversión', s.investment, r.vs.investment.pct) +
        '<div class="rep-line"><span>Tasa de ahorro</span><b>' + U.pct(s.savingsRate, 1) + '</b><span class="muted small">antes ' + U.pct(r.prev.savingsRate, 1) + '</span></div>' +
        '<div class="rep-line"><span>Patrimonio al cierre</span><b>' + (r.netWorthEnd ? ui.amt(r.netWorthEnd.netWorth) : '—') + '</b>' + (r.nwChange !== null ? '<span class="small">' + ui.amt(r.nwChange, { sign: true, colored: true }) + ' en el período</span>' : '') + '</div>' +
        '</div><div><h3>Principales categorías de gasto</h3><ol class="rep-cats">' + (r.categories.slice(0, 5).map(c => '<li><span>' + esc(c.name) + '</span>' + ui.amt(c.amount) + '<small class="muted">' + U.pct(c.share, 0) + '</small></li>').join('') || '<li class="muted">Sin gastos</li>') + '</ol>' +
        (r.incomeCategories.length ? '<h3>Fuentes de ingreso</h3><ol class="rep-cats">' + r.incomeCategories.slice(0, 3).map(c => '<li><span>' + esc(c.name) + '</span>' + ui.amt(c.amount) + '</li>').join('') + '</ol>' : '') +
        (r.byTag.length ? '<h3>Gasto por etiqueta</h3><ul class="rep-cats">' + r.byTag.slice(0, 5).map(t => '<li><span>#' + esc(t.id) + '</span>' + ui.amt(t.amount) + '</li>').join('') + '</ul>' : '') +
        '</div></div><p class="foot-note">Variación respecto al período anterior (' + esc(U.dateLabel(prev.from)) + ' – ' + esc(U.dateLabel(prev.to)) + '): ingresos ' + U.signedPct(r.vs.income.pct, 1) + ', gastos ' + U.signedPct(r.vs.expense.pct, 1) + '. ' + s.count + ' movimientos en el período.</p></article>';
      el.__report = { r, label };
    };
    const ctrl = el.querySelector('.report-controls');
    ctrl.addEventListener('change', e => {
      const k = e.target.dataset.r;
      if (!k) return;
      repState[k] = e.target.value;
      if (k === 'mode') { repState.ref = repState.mode === 'month' ? U.currentMonthKey() : repState.mode === 'quarter' ? cy + '-Q' + U.quarterOf(U.today()) : cy; el.querySelector('[data-ref]').innerHTML = refInput(); }
      draw();
    });
    el.querySelector('[data-print]').addEventListener('click', () => window.print());
    el.querySelector('[data-rcsv]').addEventListener('click', () => {
      const { r, label } = el.__report || {};
      if (!r) return;
      const s = r.summary;
      const rows = [['Período', label], ['Desde', r.from], ['Hasta', r.to], ['Ingresos', s.income], ['Gastos', s.expense], ['Flujo neto', s.net], ['Ahorro', s.saving], ['Inversión', s.investment],
        ['Tasa de ahorro %', s.savingsRate === null ? '' : U.round2(s.savingsRate)], ['Patrimonio al cierre', r.netWorthEnd ? r.netWorthEnd.netWorth : ''], ['Variación ingresos %', r.vs.income.pct === null ? '' : U.round2(r.vs.income.pct)], ['Variación gastos %', r.vs.expense.pct === null ? '' : U.round2(r.vs.expense.pct)], []]
        .concat([['Categoría', 'Gasto', '% del total']]).concat(r.categories.map(c => [c.name, c.amount, U.round2(c.share)]));
      ui.download('informe-' + r.from + '_' + r.to + '.csv', F.io.toCSV(rows[0], rows.slice(1).map(x => x.map(v => typeof v === 'number' ? String(v).replace('.', ',') : v))), 'text/csv;charset=utf-8');
    });
    draw();
  }

  Object.assign(F.views, {
    mes: { title: 'Análisis mensual', render: mes },
    anual: { title: 'Análisis anual', render: anual },
    ingresos: { title: 'Ingresos', render: ingresos },
    gastos: { title: 'Gastos', render: gastos },
    ahorro: { title: 'Ahorro y flujo', render: ahorro },
    proyeccion: { title: 'Proyección', render: proyeccion },
    salud: { title: 'Indicadores', render: salud },
    informes: { title: 'Informes', render: informes }
  });
  F.views._analysisTabs = analysisTabs;
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
