/* Pruebas de la lógica financiera (sin navegador).  Uso:  node tests/run-tests.js */
'use strict';
const F = require('./harness.js');
const U = F.utils, S = F.schema, L = F.ledger, A = F.analytics, R = F.recurring, IO = F.io, St = F.Store;

let passed = 0, failed = 0;
const results = [];
function ok(cond, name, extra) {
  if (cond) passed++; else { failed++; results.push('✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, expected: b }); }
function near(a, b, name, eps) { ok(Math.abs(a - b) <= (eps || 0.01), name, { got: a, expected: b }); }
async function fresh() { U.setNow('2026-10-05T14:00:00'); await St.init(new F.storage.MemoryAdapter(S.STORES)); return St; }
async function throws(fn, name) { try { await fn(); ok(false, name + ' (no lanzó error)'); } catch (e) { ok(true, name); } }
function deepFinite(obj, path, bad) {
  if (typeof obj === 'number' && !Number.isFinite(obj)) bad.push(path);
  else if (obj && typeof obj === 'object' && !(obj instanceof Map)) for (const k of Object.keys(obj)) deepFinite(obj[k], path + '.' + k, bad);
  return bad;
}

(async () => {
  // ------------------------------------------------------------------ utils
  eq(U.parseAmount('25.000'), 25000, 'parse 25.000');
  eq(U.parseAmount('1.250.000'), 1250000, 'parse 1.250.000');
  eq(U.parseAmount('1.250.000,50'), 1250000.5, 'parse decimales con coma');
  eq(U.parseAmount('12,5'), 12.5, 'parse 12,5');
  eq(U.parseAmount('12.5'), 12.5, 'parse 12.5 decimal');
  eq(U.parseAmount('25k'), 25000, 'parse 25k');
  eq(U.parseAmount('$ 3.000'), 3000, 'parse con símbolo');
  ok(Number.isNaN(U.parseAmount('abc')), 'parse texto → NaN');
  ok(Number.isNaN(U.parseAmount('-500')), 'parse negativo rechazado');
  ok(Number.isNaN(U.parseAmount('')), 'parse vacío');
  eq(U.money(1000000), '$1.000.000', 'formato COP');
  eq(U.money(-25900), '−$25.900', 'formato negativo');
  eq(U.money(NaN), '$0', 'formato NaN → $0');
  eq(U.money(undefined), '$0', 'formato undefined → $0');
  eq(U.money(1234.5, { currency: 'USD' }), 'US$1.234,50', 'formato USD');
  eq(U.money(99.9, { currency: 'EUR' }), '€99,90', 'formato EUR');
  eq(U.pct(null), '—', 'pct null → —');
  eq(U.pct(Infinity), '—', 'pct Infinity → —');
  eq(U.pct(81.25, 2), '81,25%', 'pct 81,25%');
  eq(U.addMonths('2026-01-31', 1), '2026-02-28', 'addMonths 31 ene → 28 feb');
  eq(U.addMonths('2028-01-31', 1), '2028-02-29', 'addMonths bisiesto');
  eq(U.addMonths('2026-02-28', 1, 31), '2026-03-31', 'addMonths con día ancla');
  ok(!U.isValidDate('2026-02-30'), 'fecha 30 feb inválida');
  ok(!U.isValidDate('3026-01-01'), 'fecha año 3026 inválida');
  eq(U.normalizeDate('02/10/2026'), '2026-10-02', 'normaliza DD/MM/AAAA');
  eq(U.safeDiv(5, 0), null, 'safeDiv /0 → null');
  eq(U.pctChange(10, 0), null, 'pctChange base 0 → null');
  eq(U.parseTags('#Universidad, viaje  #Viaje'), ['universidad', 'viaje'], 'parseTags normaliza y deduplica');
  eq(U.sum([0.1, 0.2]), 0.3, 'suma sin error de coma flotante');

  // ------------------------------------------------------------------ validaciones
  await fresh();
  const bank = await St.save('accounts', { name: 'Bancolombia', type: 'bank', currency: 'COP', initialBalance: 1000000, openedAt: '2026-01-01' });
  const nequi = await St.save('accounts', { name: 'Nequi', type: 'wallet', currency: 'COP', initialBalance: 300000, openedAt: '2026-01-01' });
  const usd = await St.save('accounts', { name: 'Cuenta USD', type: 'bank', currency: 'USD', initialBalance: 500, openedAt: '2026-01-01' });
  const base = { date: '2026-10-02', type: 'expense', amount: 25000, accountId: nequi.id, categoryId: 'cat_alimentacion' };
  await throws(() => St.save('transactions', Object.assign({}, base, { amount: -5 })), 'rechaza valor negativo');
  await throws(() => St.save('transactions', Object.assign({}, base, { amount: 0 })), 'rechaza valor 0');
  await throws(() => St.save('transactions', Object.assign({}, base, { amount: NaN })), 'rechaza NaN');
  await throws(() => St.save('transactions', Object.assign({}, base, { amount: 5e13 })), 'rechaza valor extremo');
  await throws(() => St.save('transactions', Object.assign({}, base, { date: '2026-13-40' })), 'rechaza fecha inválida');
  await throws(() => St.save('transactions', Object.assign({}, base, { date: '' })), 'rechaza fecha vacía');
  await throws(() => St.save('transactions', Object.assign({}, base, { categoryId: 'cat_noexiste' })), 'rechaza categoría inexistente');
  await throws(() => St.save('transactions', Object.assign({}, base, { categoryId: 'cat_salario' })), 'rechaza categoría de ingreso en gasto');
  await throws(() => St.save('transactions', Object.assign({}, base, { accountId: 'acc_x' })), 'rechaza cuenta inexistente');
  await throws(() => St.save('transactions', Object.assign({}, base, { type: 'magia' })), 'rechaza tipo inválido');
  await throws(() => St.save('transactions', { date: '2026-10-02', type: 'transfer', amount: 1, accountId: bank.id, toAccountId: bank.id }), 'rechaza transferencia a la misma cuenta');
  await throws(() => St.save('transactions', { date: '2026-10-02', type: 'transfer', amount: 1, accountId: bank.id, toAccountId: usd.id }), 'rechaza transferencia entre monedas');
  await throws(() => St.save('accounts', { name: '', type: 'bank', currency: 'COP', initialBalance: 0, openedAt: '2026-01-01' }), 'rechaza cuenta sin nombre');
  await throws(() => St.save('categories', { name: 'Alimentación', kind: 'expense', subcategories: [] }), 'rechaza categoría duplicada');
  eq(St.all('transactions').length, 0, 'ningún movimiento inválido se guardó');

  // ------------------------------------------------------------------ saldos y flujos
  await St.save('transactions', base); // gasto 25.000 Nequi
  eq(L.accountBalance(St, nequi.id, '2026-10-05'), 275000, 'gasto reduce saldo de la cuenta');
  await St.save('transactions', { date: '2026-10-01', type: 'income', amount: 2000000, accountId: bank.id, categoryId: 'cat_salario' });
  eq(L.accountBalance(St, bank.id, '2026-10-05'), 3000000, 'ingreso aumenta saldo');
  const nwBefore = L.netWorthAt(St, '2026-10-05').netWorth;
  const sBefore = A.summarize(St, '2026-10-01', '2026-10-31');
  await St.save('transactions', { date: '2026-10-03', type: 'transfer', amount: 200000, accountId: bank.id, toAccountId: nequi.id });
  const sAfter = A.summarize(St, '2026-10-01', '2026-10-31');
  eq(L.accountBalance(St, bank.id, '2026-10-05'), 2800000, 'transferencia disminuye origen');
  eq(L.accountBalance(St, nequi.id, '2026-10-05'), 475000, 'transferencia aumenta destino');
  eq(L.netWorthAt(St, '2026-10-05').netWorth, nwBefore, 'transferencia no cambia patrimonio');
  eq([sAfter.income, sAfter.expense], [sBefore.income, sBefore.expense], 'transferencia no es ingreso ni gasto');
  eq(L.netWorthAt(St, '2026-10-05').netWorth, 1000000 + 300000 + 2000000 - 25000, 'patrimonio = saldos iniciales + ingresos − gastos');
  ok(!L.netWorthAt(St, '2026-10-05').foreign.length === false, 'cuenta USD reportada aparte (sin convertir)');

  // Ahorro
  const savings = await St.save('accounts', { name: 'Cajita', type: 'goal_savings', currency: 'COP', initialBalance: 0, openedAt: '2026-01-01' });
  const goal = await St.save('goals', { name: 'Fondo de emergencia', kind: 'emergency', targetAmount: 6000000, manualAmount: 0, accountId: savings.id, monthlyContribution: 400000, targetDate: '2027-10-05' });
  await St.save('transactions', { date: '2026-10-04', type: 'saving', amount: 400000, accountId: bank.id, toAccountId: savings.id, goalId: goal.id });
  const nw1 = L.netWorthAt(St, '2026-10-05');
  eq(nw1.savings, 400000, 'ahorro suma a "Ahorrado"');
  eq(nw1.netWorth, nwBefore, 'ahorrar no cambia patrimonio');
  const s1 = A.summarize(St, '2026-10-01', '2026-10-31');
  eq([s1.expense, s1.saving], [25000, 400000], 'ahorro no es gasto y se contabiliza aparte');
  near(s1.savingsRate, (2000000 - 25000) / 2000000 * 100, 'tasa de ahorro = (I − G) / I × 100');
  const gp = L.goalProgress(St, goal);
  eq([gp.current, gp.remaining], [400000, 5600000], 'meta vinculada a cuenta: actual y restante');
  near(gp.pct, 400000 / 6000000 * 100, 'meta: porcentaje');
  ok(gp.requiredMonthly > 0 && Number.isFinite(gp.requiredMonthly), 'meta: aporte mensual necesario finito');
  const g2 = await St.save('goals', { name: 'Fondo', kind: 'emergency', targetAmount: 6000000, manualAmount: 2000000, monthlyContribution: 0 });
  near(L.goalProgress(St, g2).pct, 33.333, 'ejemplo enunciado: 2.000.000 / 6.000.000 = 33,3%', 0.01);

  // Inversión
  const inv = await St.save('investments', { name: 'ETF', type: 'etf', openingContributed: 1000000, startDate: '2026-09-01', valuations: [{ date: '2026-09-01', value: 1000000, at: '2026-09-01T00:00:00Z' }] });
  await St.save('transactions', { date: '2026-10-02', type: 'investment', amount: 300000, accountId: bank.id, investmentId: inv.id, createdAt: '2026-10-02T12:00:00Z' });
  eq(L.investmentValueAt(St, St.get('investments', inv.id), '2026-10-05'), 1300000, 'aporte aumenta el valor de la inversión');
  eq(L.netWorthAt(St, '2026-10-05').netWorth, nwBefore + 1000000, 'invertir desde cuenta no cambia patrimonio (solo suma el capital previo)');
  await St.save('investments', Object.assign({}, St.get('investments', inv.id), { valuations: St.get('investments', inv.id).valuations.concat([{ date: '2026-10-04', value: 1450000, at: '2026-10-04T20:00:00Z' }]) }));
  let isum = L.investmentSummary(St, St.get('investments', inv.id), '2026-10-05');
  eq([isum.contributions, isum.value, isum.gain], [1300000, 1450000, 150000], 'inversión: aportado, valor, ganancia');
  near(isum.returnPct, 150000 / 1300000 * 100, 'inversión: rentabilidad %');
  await St.save('transactions', { date: '2026-10-05', type: 'investment_withdrawal', amount: 450000, accountId: nequi.id, investmentId: inv.id, createdAt: '2026-10-05T12:00:00Z' });
  isum = L.investmentSummary(St, St.get('investments', inv.id), '2026-10-05');
  eq([isum.value, isum.withdrawals, isum.gain], [1000000, 450000, 150000], 'retiro reduce valor y conserva ganancia');
  eq(A.summarize(St, '2026-10-01', '2026-10-31').income, 2000000, 'retiro de inversión no es ingreso');

  // Deuda con intereses
  const debt = await St.save('debts', { name: 'Crédito', counterparty: 'Banco', direction: 'payable', kind: 'consumer', principal: 5000000, openingBalance: 4000000, interestRate: 24, monthlyPayment: 300000, startDate: '2026-09-01' });
  const nwPre = L.netWorthAt(St, '2026-10-05').netWorth;
  await St.save('transactions', { date: '2026-10-05', type: 'debt_payment', amount: 300000, interestAmount: 72000, accountId: bank.id, debtId: debt.id });
  eq(L.debtBalanceAt(St, St.get('debts', debt.id), '2026-10-05'), 4000000 - 228000, 'pago de deuda reduce solo el capital');
  eq(L.netWorthAt(St, '2026-10-05').netWorth, nwPre - 72000, 'patrimonio baja solo por los intereses');
  const s2 = A.summarize(St, '2026-10-01', '2026-10-31');
  eq([s2.expense, s2.principalPaid, s2.interestPaid], [25000 + 72000, 228000, 72000], 'intereses = gasto; abono a capital no');
  await throws(() => St.save('transactions', { date: '2026-10-05', type: 'debt_payment', amount: 100, interestAmount: 200, accountId: bank.id, debtId: debt.id }), 'rechaza intereses mayores que el pago');
  const am = L.amortization(1000000, 24, 100000);
  ok(am.months > 10 && am.months < 13 && am.totalInterest > 0, 'amortización estimada razonable', am.months);
  eq(L.amortization(1000000, 24, 10000).coversInterest, false, 'detecta cuota que no cubre intereses');
  // Préstamo entregado (dinero que me deben)
  const rec = await St.save('debts', { name: 'Préstamo a Ana', direction: 'receivable', kind: 'personal', principal: 0, openingBalance: 0, startDate: '2026-10-01' });
  const nwP = L.netWorthAt(St, '2026-10-05').netWorth;
  await St.save('transactions', { date: '2026-10-05', type: 'loan_given', amount: 100000, accountId: nequi.id, debtId: rec.id });
  eq(L.netWorthAt(St, '2026-10-05').netWorth, nwP, 'prestar dinero no cambia patrimonio (se vuelve "me deben")');
  eq(L.netWorthAt(St, '2026-10-05').receivables, 100000, 'préstamo entregado aparece como dinero que me deben');
  await throws(() => St.save('transactions', { date: '2026-10-05', type: 'loan_given', amount: 1, accountId: nequi.id, debtId: debt.id }), 'préstamo entregado no puede ir a una deuda propia');

  // Tarjeta de crédito
  const card = await St.save('accounts', { name: 'Visa', type: 'credit_card', currency: 'COP', initialBalance: 0, openedAt: '2026-01-01' });
  await St.save('transactions', { date: '2026-10-05', type: 'expense', amount: 80000, accountId: card.id, categoryId: 'cat_restaurantes' });
  let nw2 = L.netWorthAt(St, '2026-10-05');
  eq(nw2.cardDebt, 80000, 'gasto con tarjeta crea pasivo');
  const nwc = nw2.netWorth;
  await St.save('transactions', { date: '2026-10-05', type: 'transfer', amount: 80000, accountId: bank.id, toAccountId: card.id });
  nw2 = L.netWorthAt(St, '2026-10-05');
  eq([nw2.cardDebt, nw2.netWorth], [0, nwc], 'pagar la tarjeta (transferencia) no cambia patrimonio');
  ok(nw2.netWorth === U.round2(nw2.assets - nw2.liabilities), 'patrimonio = activos − pasivos');

  // Presupuesto
  await St.save('budgets', { categoryId: 'cat_alimentacion', amount: 400000 });
  await St.save('transactions', { date: '2026-10-05', type: 'expense', amount: 300000, accountId: bank.id, categoryId: 'cat_alimentacion' });
  const spent = A.monthSummary(St, '2026-10').expenseByCategory.get('cat_alimentacion');
  eq(spent, 325000, 'presupuesto: gastado por categoría');
  near(spent / 400000 * 100, 81.25, 'presupuesto: porcentaje utilizado (ejemplo 81,25%)');
  await throws(() => St.save('budgets', { categoryId: 'cat_alimentacion', amount: 1 }), 'rechaza presupuesto duplicado');
  await throws(() => St.save('budgets', { categoryId: 'cat_salario', amount: 1 }), 'rechaza presupuesto en categoría de ingreso');

  // Fecha futura no afecta saldo de hoy
  await St.save('transactions', { date: '2026-12-01', type: 'expense', amount: 99999, accountId: bank.id, categoryId: 'cat_otros' });
  const bToday = L.accountBalance(St, bank.id, '2026-10-05');
  eq(L.accountBalance(St, bank.id, '2026-12-01'), U.round2(bToday - 99999), 'movimiento futuro aplica en su fecha');

  // Borrados protegidos
  await throws(() => St.remove('accounts', bank.id), 'no permite borrar cuenta con movimientos');
  await throws(() => St.remove('categories', 'cat_alimentacion'), 'categoría en uso exige reemplazo');
  await St.remove('categories', 'cat_alimentacion', { replacementCategoryId: 'cat_otros' });
  ok(!St.all('transactions').some(t => t.categoryId === 'cat_alimentacion'), 'movimientos reasignados al borrar categoría');
  ok(!St.all('budgets').some(b => b.categoryId === 'cat_alimentacion'), 'presupuesto de categoría eliminada se elimina');

  // ------------------------------------------------------------------ recurrentes
  await fresh();
  const acc = await St.save('accounts', { name: 'Banco', type: 'bank', currency: 'COP', initialBalance: 0, openedAt: '2026-01-01' });
  const rule = await St.save('recurring', { name: 'Netflix', type: 'expense', amount: 25900, accountId: acc.id, categoryId: 'cat_suscripciones', frequency: 'monthly', nextDate: '2026-08-31', startDate: '2026-08-31', anchorDay: 31, active: true, isSubscription: true });
  eq(R.occurrences(rule, '2026-08-01', '2026-12-31'), ['2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31'], 'mensual conserva día 31');
  eq(R.pending(St).length, 2, 'pendientes vencidos (31 ago, 30 sep)');
  await R.confirm(St, rule.id);
  eq(St.get('recurring', rule.id).nextDate, '2026-09-30', 'confirmar avanza la regla');
  eq(St.all('transactions').length, 1, 'confirmar crea el movimiento');
  await R.skip(St, rule.id);
  eq([St.get('recurring', rule.id).nextDate, St.all('transactions').length], ['2026-10-31', 1], 'omitir avanza sin crear');
  await St.save('recurring', { name: 'Internet', type: 'expense', amount: 80000, accountId: acc.id, categoryId: 'cat_servicios', frequency: 'monthly', nextDate: '2026-07-08', startDate: '2026-07-08', anchorDay: 8, active: true, autoConfirm: true });
  eq(await R.runAuto(St), 3, 'registro automático crea julio, agosto, septiembre');
  eq(R.subscriptionsSummary(St).monthly, 25900, 'costo mensual de suscripciones');
  eq(R.subscriptionsSummary(St).annual, 310800, 'costo anual de suscripciones');
  eq(R.monthlyEquivalent({ amount: 120000, frequency: 'annual' }), 10000, 'equivalente mensual de anual');
  near(R.monthlyEquivalent({ amount: 10000, frequency: 'weekly' }), 43333.33, 'equivalente mensual de semanal');

  // ------------------------------------------------------------------ datos vacíos
  await fresh();
  const bad = [];
  deepFinite(L.netWorthAt(St, U.today()), 'nw', bad);
  deepFinite(A.monthAnalysis(St, U.currentMonthKey()).vsPrev, 'cmp', bad);
  deepFinite(A.expenseStats(St, U.currentMonthKey()), 'exp', bad);
  deepFinite(A.incomeStats(St, U.currentMonthKey()), 'inc', bad);
  deepFinite(A.yearSummary(St, '2026'), 'year', bad);
  deepFinite(A.projection(St, {}), 'proj', bad);
  deepFinite(A.health(St), 'health', bad);
  deepFinite(A.monthMargin(St), 'margin', bad);
  deepFinite(L.portfolioSummary(St), 'pf', bad);
  eq(bad, [], 'sin datos: ningún NaN/Infinity en cálculos');
  eq(A.monthSummary(St, U.currentMonthKey()).savingsRate, null, 'sin ingresos: tasa de ahorro = null (se muestra —)');
  eq(A.insights(St).length, 0, 'sin datos: no se inventan patrones');

  // ------------------------------------------------------------------ demo, análisis y textos
  await fresh();
  const dr = await F.demo.load(St);
  ok(dr.transactions > 400 && dr.invalid === 0, 'datos demo válidos', dr);
  const months = A.monthlySeries(St, L.firstDataMonth(St), U.currentMonthKey());
  eq(months.length, 13, 'serie de 13 meses');
  const allText = JSON.stringify(A.insights(St)) + JSON.stringify(A.insights(St, '2026-09')) + JSON.stringify(A.health(St).metrics.map(m => m.value));
  ok(!/NaN|Infinity|undefined/.test(allText), 'patrones sin NaN/undefined');
  ok(A.insights(St, '2026-09').every(i => !/deberías|demasiado|debes /i.test(i.text)), 'patrones descriptivos, no prescriptivos');
  // Identidad contable: variación del patrimonio = flujo neto + revalorizaciones (+ otros activos)
  const m = '2026-09';
  const nwA = L.netWorthAt(St, '2026-08-31'), nwB = L.netWorthAt(St, '2026-09-30');
  const ms = A.monthSummary(St, m);
  const invGainA = L.portfolioSummary(St, '2026-08-31'), invGainB = L.portfolioSummary(St, '2026-09-30');
  const reval = (invGainB.gain - invGainA.gain);
  const assetChange = nwB.otherAssets - nwA.otherAssets;
  near(nwB.netWorth - nwA.netWorth, ms.net + reval + assetChange, 'identidad: Δ patrimonio = flujo neto + revalorizaciones', 1);
  // Comparación: análisis anual coincide con la suma de los meses
  const ys = A.yearSummary(St, '2026');
  near(U.sum(ys.rows, r => r.expense), ys.totals.expense, 'anual = suma de los meses');
  const rep = A.report(St, '2026-07-01', '2026-09-30', '2026-04-01', '2026-06-30');
  near(rep.summary.income, U.sum(['2026-07', '2026-08', '2026-09'].map(k => A.monthSummary(St, k).income)), 'informe trimestral = suma de meses');
  // Filtros
  const tagged = A.filterTransactions(St, { tag: 'universidad' });
  ok(tagged.length > 0 && tagged.every(t => t.tags.includes('universidad')), 'filtro por etiqueta');
  const q = A.filterTransactions(St, { q: 'restaurante' });
  ok(q.length > 0, 'búsqueda "restaurante" encuentra movimientos');
  const oct = A.filterTransactions(St, { from: '2026-10-01', to: '2026-10-31', types: ['expense'] });
  ok(oct.every(t => t.type === 'expense' && t.date >= '2026-10-01'), 'filtro por tipo y rango');
  const wk = A.filterTransactions(St, { from: U.weekStart('2026-09-16'), to: U.addDays(U.weekStart('2026-09-16'), 6) });
  ok(wk.every(t => t.date >= '2026-09-14' && t.date <= '2026-09-20'), 'filtro por semana (lunes a domingo)');

  // ------------------------------------------------------------------ respaldo JSON
  const backup = JSON.parse(JSON.stringify(IO.buildBackup(St)));
  const nwOrig = L.netWorthAt(St, U.today()).netWorth;
  const v = IO.validateBackup(backup);
  ok(v.ok && v.invalid.length === 0, 'respaldo propio es válido', v.invalid.slice(0, 3));
  ok(IO.backupFileName('2026-10-05') === 'financial-backup-2026-10-05.json', 'nombre de archivo de respaldo');
  await fresh();
  await St.replaceAll(v.data);
  eq(L.netWorthAt(St, U.today()).netWorth, nwOrig, 'restaurar respaldo reproduce el patrimonio exacto');
  const counts = await St.merge(v.data);
  eq(Object.values(counts).reduce((a, b) => a + b, 0), 0, 'combinar el mismo respaldo no duplica');
  ok(!IO.validateBackup({ foo: 1 }).ok, 'rechaza JSON que no es respaldo');
  ok(!IO.validateBackup(null).ok, 'rechaza null');
  ok(!IO.parseJSONText('{"app": ').ok, 'detecta JSON corrupto');
  ok(!IO.validateBackup(Object.assign({}, backup, { schemaVersion: 99 })).ok, 'rechaza versión futura');
  const corrupt = JSON.parse(JSON.stringify(backup));
  corrupt.data.transactions[0].amount = 'mucho';
  corrupt.data.transactions[1].accountId = 'no_existe';
  corrupt.data.transactions.push(Object.assign({}, corrupt.data.transactions[2]));
  const vc = IO.validateBackup(corrupt);
  eq(vc.invalid.length, 3, 'detecta registros corruptos, huérfanos y duplicados');
  ok(!IO.validateBackup(Object.assign({}, backup, { data: Object.assign({}, backup.data, { transactions: 'x' }) })).ok, 'rechaza colección que no es lista');

  // ------------------------------------------------------------------ CSV
  const csv = IO.transactionsCSV(St);
  const parsed = IO.parseCSV(csv);
  eq(parsed.rows.length - 1, St.all('transactions').length, 'CSV exporta todas las filas');
  eq(IO.parseCSV('a;b\n"x;1";"di ""hola"""\n').rows[1], ['x;1', 'di "hola"'], 'CSV con comillas y separador interno');
  await fresh();
  for (const a of v.data.accounts) await St.save('accounts', a);
  for (const i of v.data.investments) await St.save('investments', i);
  for (const d of v.data.debts) await St.save('debts', d);
  for (const g of v.data.goals) await St.save('goals', Object.assign({}, g));
  const prep = IO.prepareCSVImport(St, csv, {});
  eq(prep.invalid, 0, 'CSV exportado se reimporta sin errores', prep.rows.filter(r => !r.ok).slice(0, 2).map(r => r.errors));
  const p2 = IO.prepareCSVImport(St, 'fecha,valor,cuenta,descripcion\n2026-10-01,-15.000,Nequi,Café\n32/13/2026,1,Nequi,x\n2026-10-02,abc,Nequi,y\n2026-10-03,10,Inexistente,z\n', {});
  eq([p2.rows[0].ok, p2.rows[0].tx.type, p2.rows[0].tx.amount], [true, 'expense', 15000], 'CSV bancario: negativo → gasto');
  eq(p2.invalid, 3, 'CSV: detecta fecha, valor y cuenta inválidos');
  const p3 = IO.prepareCSVImport(St, 'fecha,valor,cuenta\n2026-10-03,10,Nueva\n', { createMissing: true });
  eq([p3.valid, p3.toCreate.accounts.length], [1, 1], 'CSV: crea cuentas faltantes si se permite');
  ok(!IO.prepareCSVImport(St, 'solo,una,linea', {}).ok, 'CSV sin datos rechazado');
  // ZIP
  eq(IO.crc32(new TextEncoder().encode('hello')).toString(16), '3610a686', 'CRC32 correcto');
  const zip = IO.makeZip([{ name: 'a.csv', text: 'x' }]);
  eq([zip[0], zip[1], zip[2], zip[3]], [0x50, 0x4b, 0x03, 0x04], 'ZIP con cabecera válida');

  // ------------------------------------------------------------------ eliminar demo sin afectar datos reales
  await fresh();
  await F.demo.load(St);
  const real = await St.save('transactions', { date: '2026-10-05', type: 'expense', amount: 5000, accountId: 'demo_acc_nequi', categoryId: 'cat_otros', description: 'Café real' });
  const realAcc = await St.save('accounts', { name: 'Mi cuenta real', type: 'bank', currency: 'COP', initialBalance: 777, openedAt: '2026-10-01' });
  const rd = await St.removeDemo();
  ok(St.get('transactions', real.id) && St.get('accounts', realAcc.id), 'datos reales se conservan');
  ok(St.get('accounts', 'demo_acc_nequi') && !St.get('accounts', 'demo_acc_nequi').isDemo, 'cuenta demo usada por dato real se conserva como real');
  eq(St.all('transactions').filter(t => t.isDemo).length, 0, 'no quedan movimientos demo');
  ok(rd.removed > 400, 'se eliminaron los registros demo');

  // ------------------------------------------------------------------ extremos y rendimiento
  await fresh();
  const big = await St.save('accounts', { name: 'Grande', type: 'bank', currency: 'COP', initialBalance: 9e12, openedAt: '2000-01-01' });
  await St.save('transactions', { date: '2026-10-01', type: 'income', amount: 9.9e12, accountId: big.id, categoryId: 'cat_salario' });
  ok(Number.isFinite(L.netWorthAt(St, U.today()).netWorth) && U.money(L.netWorthAt(St, U.today()).netWorth) === '$18.900.000.000.000', 'valores muy grandes sin pérdida', U.money(L.netWorthAt(St, U.today()).netWorth));
  const many = [];
  for (let i = 0; i < 20000; i++) many.push({ id: 'p' + i, date: U.addDays('2016-01-01', i % 3900), type: i % 5 ? 'expense' : 'income', amount: 1000 + (i % 97) * 100, accountId: big.id, categoryId: i % 5 ? 'cat_otros' : 'cat_salario', createdAt: '2020-01-01T00:00:00Z' });
  await St.saveMany('transactions', many);
  let t0 = Date.now();
  A.monthlySeries(St, L.firstDataMonth(St), U.currentMonthKey());
  const tSeries = Date.now() - t0;
  t0 = Date.now(); A.insights(St); A.health(St); A.filterTransactions(St, { q: 'otros' });
  const tAn = Date.now() - t0;
  ok(tSeries < 4000 && tAn < 3000, '20.000 movimientos / 10 años: series ' + tSeries + ' ms, análisis ' + tAn + ' ms');

  console.log(results.join('\n'));
  console.log('\n' + passed + ' pruebas correctas, ' + failed + ' fallidas');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
