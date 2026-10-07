/* =========================================================================
 * finance/analytics.js — Análisis: resúmenes por período, series mensuales,
 * comparaciones, patrones de comportamiento, proyecciones e indicadores.
 *
 * Todo es matemático y sale exclusivamente de los datos registrados.
 * Los textos son descriptivos ("aumentó 15%"), nunca prescriptivos.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, L = F.ledger, R = F.recurring;

  // ---------------- Filtros de movimientos ----------------
  /** Movimientos en moneda base entre dos fechas (inclusive). */
  function txInRange(db, from, to) {
    const all = L.sortedTx(db);
    // Búsqueda binaria del primer movimiento con fecha ≥ from
    let lo = 0, hi = all.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (all[mid].date < from) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let i = lo; i < all.length; i++) {
      const tx = all[i];
      if (tx.date > to) break;
      if (L.inBase(tx, db)) out.push(tx);
    }
    return out;
  }

  /**
   * Filtro del histórico. filters: { q, from, to, types[], categoryId, accountId, tag, person, nature, min, max }
   * Devuelve los movimientos (todas las monedas) ordenados del más reciente al más antiguo.
   */
  function filterTransactions(db, f) {
    f = f || {};
    const q = U.normalizeText(f.q || '').trim();
    const terms = q ? q.split(/\s+/) : [];
    const types = f.types && f.types.length ? new Set(f.types) : null;
    const out = [];
    const all = L.sortedTx(db);
    for (let i = all.length - 1; i >= 0; i--) {
      const tx = all[i];
      if (f.from && tx.date < f.from) continue;
      if (f.to && tx.date > f.to) continue;
      if (types && !types.has(tx.type)) continue;
      if (f.categoryId && tx.categoryId !== f.categoryId) continue;
      if (f.accountId && tx.accountId !== f.accountId && tx.toAccountId !== f.accountId) continue;
      if (f.tag && !(tx.tags || []).includes(f.tag)) continue;
      if (f.person && (tx.person || 'personal') !== f.person) continue;
      if (f.nature && tx.type === 'expense' && (tx.nature || (db.get('categories', tx.categoryId) || {}).nature) !== f.nature) continue;
      if (f.nature && tx.type !== 'expense') continue;
      if (f.min !== undefined && f.min !== null && tx.amount < f.min) continue;
      if (f.max !== undefined && f.max !== null && tx.amount > f.max) continue;
      if (terms.length) {
        const cat = db.get('categories', tx.categoryId), acc = db.get('accounts', tx.accountId), to = db.get('accounts', tx.toAccountId);
        const inv = db.get('investments', tx.investmentId), debt = db.get('debts', tx.debtId);
        const hay = U.normalizeText([tx.description, tx.notes, tx.subcategory, cat && cat.name, acc && acc.name, to && to.name,
          inv && inv.name, debt && debt.name, (tx.tags || []).map(t => '#' + t).join(' '), S.TX_TYPES[tx.type].label,
          tx.paymentMethod, String(tx.amount)].join(' '));
        if (!terms.every(t => hay.includes(t))) continue;
      }
      out.push(tx);
    }
    return out;
  }

  // ---------------- Resumen de un período ----------------
  function emptySummary(from, to) {
    return {
      from, to, income: 0, expense: 0, saving: 0, investment: 0, investmentWithdrawals: 0, principalPaid: 0, interestPaid: 0,
      loansReceived: 0, loansGiven: 0, transfers: 0, net: 0, savingsRate: null, investmentRate: null, fixed: 0, variable: 0,
      expenseByCategory: new Map(), incomeByCategory: new Map(), expenseBySub: new Map(), byPerson: new Map(), byTag: new Map(),
      count: 0, expenseCount: 0
    };
  }
  function addTo(map, k, v) { map.set(k, (map.get(k) || 0) + v); }

  /** Agrega los movimientos de un rango. */
  function summarize(db, from, to) {
    return L.cached('sum:' + from + ':' + to, () => summarizeRaw(db, from, to));
  }
  function summarizeRaw(db, from, to) {
    const s = emptySummary(from, to);
    for (const tx of txInRange(db, from, to)) {
      s.count++;
      for (const it of L.flowItems(tx, db)) {
        if (it.kind === 'income') { s.income += it.amount; addTo(s.incomeByCategory, it.categoryId, it.amount); }
        else {
          s.expense += it.amount; s.expenseCount++;
          addTo(s.expenseByCategory, it.categoryId, it.amount);
          addTo(s.expenseBySub, it.categoryId + '|' + (it.subcategory || ''), it.amount);
          if (it.nature === 'fixed') s.fixed += it.amount; else s.variable += it.amount;
          addTo(s.byPerson, tx.person || 'personal', it.amount);
          for (const t of tx.tags || []) addTo(s.byTag, t, it.amount);
        }
      }
      switch (tx.type) {
        case 'saving': s.saving += tx.amount; break;
        case 'investment': s.investment += tx.amount; break;
        case 'investment_withdrawal': s.investmentWithdrawals += tx.amount; break;
        case 'transfer': s.transfers += tx.amount; break;
        case 'loan_received': s.loansReceived += tx.amount; break;
        case 'loan_given': s.loansGiven += tx.amount; break;
        case 'debt_payment': {
          const d = db.get('debts', tx.debtId);
          if (!d || d.direction === 'payable') { s.principalPaid += tx.amount - L.interestOf(tx); s.interestPaid += L.interestOf(tx); }
          break;
        }
      }
    }
    for (const k of ['income', 'expense', 'saving', 'investment', 'investmentWithdrawals', 'principalPaid', 'interestPaid', 'loansReceived', 'loansGiven', 'transfers', 'fixed', 'variable']) s[k] = U.round2(s[k]);
    s.net = U.round2(s.income - s.expense);                               // Flujo neto = Ingresos − Gastos
    const sr = U.safeDiv(s.income - s.expense, s.income);                 // Tasa de ahorro = (I − G) / I
    s.savingsRate = sr === null ? null : sr * 100;
    const ir = U.safeDiv(s.investment, s.income);                         // Tasa de inversión = Inversión / I
    s.investmentRate = ir === null ? null : ir * 100;
    const er = U.safeDiv(s.saving, s.income);                             // % de ingresos movido a ahorro
    s.explicitSavingRate = er === null ? null : er * 100;
    return s;
  }

  function monthBounds(key) { return [U.monthStart(key), U.monthEnd(key)]; }
  /** Fin efectivo de un mes para saldos: si es el mes actual, hoy. */
  function effectiveEnd(key) { const t = U.today(); const e = U.monthEnd(key); return e > t ? t : e; }

  function monthSummary(db, key) {
    return L.cached('ms:' + key + ':' + U.today(), () => monthSummaryRaw(db, key));
  }
  function monthSummaryRaw(db, key) {
    const [a, b] = monthBounds(key);
    const s = Object.assign({}, summarize(db, a, b));
    s.key = key;
    s.isCurrent = key === U.currentMonthKey();
    s.isFuture = key > U.currentMonthKey();
    s.netWorth = s.isFuture ? null : L.netWorthAt(db, effectiveEnd(key)).netWorth;
    return s;
  }

  /** Serie mensual con flujos y patrimonio al cierre de cada mes. */
  function monthlySeries(db, fromKey, toKey) {
    return U.monthRange(fromKey, toKey).map(k => {
      const s = monthSummary(db, k);
      return { key: k, income: s.income, expense: s.expense, saving: s.saving, investment: s.investment, net: s.net,
        savingsRate: s.savingsRate, fixed: s.fixed, variable: s.variable, netWorth: s.netWorth, summary: s };
    });
  }

  /** Promedios de los últimos `n` meses COMPLETOS antes de `key` (solo meses con datos). */
  function averages(db, key, n) {
    const first = L.firstDataMonth(db);
    const months = [];
    for (let i = 1; i <= n; i++) { const k = U.addMonthKey(key, -i); if (k >= first) months.push(k); }
    const rows = months.map(k => monthSummary(db, k));
    const c = rows.length;
    const avgOf = f => c ? U.round2(U.sum(rows, f) / c) : 0;
    return {
      months: c, keys: months.reverse(), income: avgOf(r => r.income), expense: avgOf(r => r.expense), saving: avgOf(r => r.saving),
      investment: avgOf(r => r.investment), net: avgOf(r => r.net), fixed: avgOf(r => r.fixed), variable: avgOf(r => r.variable),
      principalPaid: avgOf(r => r.principalPaid), withdrawals: avgOf(r => r.investmentWithdrawals), rows
    };
  }

  /** Lista ordenada de categorías de gasto con porcentaje. */
  function categoryList(db, map, total) {
    return [...map.entries()].map(([id, amount]) => {
      const c = db.get('categories', id);
      return { id, name: c ? c.name : 'Sin categoría', color: c ? c.color : '#8b93a0', amount: U.round2(amount), share: total > 0 ? amount / total * 100 : 0 };
    }).sort((a, b) => b.amount - a.amount);
  }

  // ---------------- Gastos e ingresos del mes ----------------
  function elapsedDays(key) {
    const cur = U.currentMonthKey();
    if (key < cur) return U.daysInMonth(key);
    if (key > cur) return 0;
    return Number(U.today().slice(8, 10));
  }

  /**
   * Proyección de gasto del mes en curso:
   *   gastado hasta hoy + (gasto variable diario promedio × días restantes)
   *   + gastos recurrentes programados aún no registrados en el mes.
   */
  function expenseStats(db, key) {
    const s = monthSummary(db, key);
    const days = elapsedDays(key);
    const dim = U.daysInMonth(key);
    const daily = days > 0 ? s.expense / days : 0;
    let projection = s.expense, scheduled = 0, variableDaily = days > 0 ? s.variable / days : 0;
    if (s.isCurrent) {
      for (const o of R.scheduledBetween(db, U.monthStart(key), U.monthEnd(key))) if (o.rule.type === 'expense') scheduled += U.num(o.rule.amount);
      projection = s.expense + variableDaily * (dim - days) + scheduled;
    }
    return {
      summary: s, total: s.expense, days, daysInMonth: dim, dailyAvg: U.round2(daily), weeklyAvg: U.round2(daily * 7),
      projection: U.round2(projection), scheduledRemaining: U.round2(scheduled), variableDaily: U.round2(variableDaily),
      categories: categoryList(db, s.expenseByCategory, s.expense)
    };
  }

  function incomeStats(db, key) {
    const s = monthSummary(db, key);
    const year = key.slice(0, 4);
    const ys = summarize(db, year + '-01-01', year + '-12-31');
    const av = averages(db, key, 12);
    const prev = monthSummary(db, U.addMonthKey(key, -1));
    const series = monthlySeries(db, maxKey(L.firstDataMonth(db), U.addMonthKey(key, -11)), key);
    return {
      month: s.income, year: ys.income, avg12: av.income, avgMonths: av.months, prev: prev.income,
      changePrev: U.pctChange(s.income, prev.income), changeAvg: U.pctChange(s.income, av.income),
      categories: categoryList(db, s.incomeByCategory, s.income), series
    };
  }
  function maxKey(a, b) { return a > b ? a : b; }

  // ---------------- Comparaciones ----------------
  function compare(cur, prev) {
    const out = {};
    for (const k of ['income', 'expense', 'saving', 'investment', 'net']) out[k] = { cur: cur[k], prev: prev[k], diff: U.round2(cur[k] - prev[k]), pct: U.pctChange(cur[k], prev[k]) };
    out.savingsRate = { cur: cur.savingsRate, prev: prev.savingsRate, diff: cur.savingsRate !== null && prev.savingsRate !== null ? cur.savingsRate - prev.savingsRate : null };
    return out;
  }
  function categoryComparison(db, cur, prev) {
    const ids = new Set([...cur.expenseByCategory.keys(), ...prev.expenseByCategory.keys()]);
    return [...ids].map(id => {
      const c = db.get('categories', id);
      const a = U.round2(cur.expenseByCategory.get(id) || 0), b = U.round2(prev.expenseByCategory.get(id) || 0);
      return { id, name: c ? c.name : 'Sin categoría', color: c ? c.color : '#8b93a0', cur: a, prev: b, diff: U.round2(a - b), pct: U.pctChange(a, b) };
    }).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  }

  /**
   * Análisis de un mes con comparaciones. Si es el mes en curso, la comparación
   * con el mes anterior usa los mismos días transcurridos (comparación justa).
   */
  function monthAnalysis(db, key) {
    const cur = monthSummary(db, key);
    const prevKey = U.addMonthKey(key, -1);
    let prev, prevLabel;
    if (cur.isCurrent) {
      const d = elapsedDays(key);
      const end = U.monthStart(prevKey).slice(0, 8) + U.pad(Math.min(d, U.daysInMonth(prevKey)));
      prev = summarize(db, U.monthStart(prevKey), end);
      prevLabel = U.monthLabel(prevKey) + ' (días 1–' + Math.min(d, U.daysInMonth(prevKey)) + ')';
    } else {
      prev = monthSummary(db, prevKey);
      prevLabel = U.monthLabel(prevKey);
    }
    const yoyKey = U.addMonthKey(key, -12);
    const yoy = monthSummary(db, yoyKey);
    const hasYoy = yoyKey >= L.firstDataMonth(db) && (yoy.count > 0);
    return {
      key, cur, prev, prevLabel, prevFull: monthSummary(db, prevKey), vsPrev: compare(cur, prev), yoy: hasYoy ? yoy : null,
      vsYoy: hasYoy ? compare(cur, yoy) : null, categories: categoryList(db, cur.expenseByCategory, cur.expense),
      catVsPrev: categoryComparison(db, cur, prev)
    };
  }

  // ---------------- Patrones de comportamiento ----------------
  function insights(db, key) {
    key = key || U.currentMonthKey();
    const out = [];
    const ma = monthAnalysis(db, key);
    const cur = ma.cur, prev = ma.prev;
    const inProgress = cur.isCurrent;
    const periodTxt = inProgress ? 'en lo que va del mes' : 'en ' + U.monthLabel(key).toLowerCase();
    const vsTxt = inProgress ? 'frente al mismo período del mes anterior' : 'frente a ' + U.monthLabel(U.addMonthKey(key, -1)).toLowerCase();
    if (cur.count === 0 && prev.count === 0) return out;

    // 1. Gasto total vs mes anterior
    if (prev.expense > 0 && cur.expense > 0) {
      const p = U.pctChange(cur.expense, prev.expense);
      if (p !== null && Math.abs(p) >= 1) out.push({ dir: p > 0 ? 'up' : 'down', topic: 'expense', text: 'Tus gastos ' + (p > 0 ? 'aumentaron ' : 'disminuyeron ') + U.pct(Math.abs(p), 0) + ' ' + vsTxt + ' (' + U.money(cur.expense) + ' vs ' + U.money(prev.expense) + ').' });
      else out.push({ dir: 'flat', topic: 'expense', text: 'Tus gastos se mantuvieron prácticamente iguales ' + vsTxt + '.' });
    }
    // 2. Cambios por categoría (los más relevantes)
    const relevant = ma.catVsPrev.filter(c => c.prev > 0 && c.cur > 0 && c.pct !== null && Math.abs(c.pct) >= 10 && Math.max(c.cur, c.prev) >= 0.03 * Math.max(cur.expense, prev.expense));
    for (const c of relevant.slice(0, 3)) {
      out.push({ dir: c.pct > 0 ? 'up' : 'down', topic: 'category', text: 'Tus gastos de ' + c.name.toLowerCase() + (c.pct > 0 ? ' aumentaron ' : ' disminuyeron ') + U.pct(Math.abs(c.pct), 0) + ' ' + vsTxt + ' (' + U.money(c.prev) + ' → ' + U.money(c.cur) + ').' });
    }
    const fresh = ma.catVsPrev.filter(c => c.prev === 0 && c.cur > 0 && c.cur >= 0.05 * cur.expense).slice(0, 1);
    for (const c of fresh) out.push({ dir: 'up', topic: 'category', text: c.name + ': ' + U.money(c.cur) + ' ' + periodTxt + '; sin gastos en esa categoría en el período anterior.' });

    // 3. Participación de la categoría principal
    if (ma.categories.length && cur.expense > 0) {
      const top = ma.categories[0];
      out.push({ dir: 'info', topic: 'share', text: top.name + ' representa el ' + U.pct(top.share, 0) + ' de tus gastos ' + periodTxt + '.' });
      if (ma.categories[1]) out.push({ dir: 'info', topic: 'share', text: ma.categories[1].name + ' representa el ' + U.pct(ma.categories[1].share, 0) + ' de tus gastos.' });
    }

    // 4. Promedio de los últimos 6 meses y comparación
    const av = averages(db, key, 6);
    if (av.months >= 2) {
      out.push({ dir: 'info', topic: 'avg', text: 'Tu gasto promedio mensual durante los últimos ' + av.months + ' meses es ' + U.money(av.expense) + '.' });
      if (inProgress) {
        const es = expenseStats(db, key);
        const d = es.projection - av.expense;
        if (av.expense > 0 && Math.abs(d) > 0.01 * av.expense) out.push({ dir: d > 0 ? 'up' : 'down', topic: 'avg', text: 'Al ritmo actual, la proyección de gasto del mes es ' + U.money(es.projection) + ': ' + U.money(Math.abs(d)) + (d > 0 ? ' por encima' : ' por debajo') + ' de tu promedio (proyección, no dato final).' });
      } else if (av.expense > 0) {
        const d = cur.expense - av.expense;
        out.push({ dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat', topic: 'avg', text: 'Este mes gastaste ' + U.money(Math.abs(d)) + (d > 0 ? ' más' : ' menos') + ' que tu promedio (' + U.signedPct(U.pctChange(cur.expense, av.expense), 0) + ').' });
      }
      if (av.income > 0 && !inProgress && cur.income > 0) {
        const p = U.pctChange(cur.income, av.income);
        if (p !== null && Math.abs(p) >= 2) out.push({ dir: p > 0 ? 'up' : 'down', topic: 'income', text: 'Tus ingresos ' + (p > 0 ? 'aumentaron ' : 'disminuyeron ') + U.pct(Math.abs(p), 0) + ' respecto al promedio de los últimos ' + av.months + ' meses.' });
        else if (p !== null) out.push({ dir: 'flat', topic: 'income', text: 'Tus ingresos están en línea con el promedio de los últimos ' + av.months + ' meses.' });
      }
      const avgRate = U.safeDiv(av.income - av.expense, av.income);
      if (!inProgress && cur.savingsRate !== null && avgRate !== null) {
        const diff = cur.savingsRate - avgRate * 100;
        if (Math.abs(diff) >= 1) out.push({ dir: diff > 0 ? 'up' : 'down', topic: 'rate', text: 'Tu tasa de ahorro fue ' + U.pct(cur.savingsRate, 0) + ', ' + U.plainNumber(Math.abs(diff), 0) + (Math.round(Math.abs(diff)) === 1 ? ' punto porcentual ' : ' puntos porcentuales ') + (diff > 0 ? 'por encima' : 'por debajo') + ' de tu promedio (' + U.pct(avgRate * 100, 0) + ').' });
      }
    }
    // 5. Categorías con aumento sostenido (3 meses completos consecutivos)
    const lastKeys = [3, 2, 1].map(i => U.addMonthKey(key, inProgress ? -i : -i + 1)).filter(k => k >= L.firstDataMonth(db));
    if (lastKeys.length === 3) {
      const sums = lastKeys.map(k => monthSummary(db, k).expenseByCategory);
      const ids = new Set(sums.flatMap(m => [...m.keys()]));
      for (const id of ids) {
        const v = sums.map(m => m.get(id) || 0);
        if (v[0] > 0 && v[1] > v[0] * 1.05 && v[2] > v[1] * 1.05) {
          const c = db.get('categories', id);
          out.push({ dir: 'up', topic: 'trend', text: (c ? c.name : 'Una categoría') + ' aumentó tres meses seguidos (' + v.map(x => U.money(x, { compact: true })).join(' → ') + ').' });
          if (out.filter(o => o.topic === 'trend').length >= 2) break;
        }
      }
    }
    // 6. Gastos fijos
    if (cur.expense > 0 && cur.fixed > 0) out.push({ dir: 'info', topic: 'fixed', text: 'Los gastos fijos son el ' + U.pct(cur.fixed / cur.expense * 100, 0) + ' de tus gastos ' + periodTxt + ' (' + U.money(cur.fixed) + ').' });
    // 7. Suscripciones
    const subs = R.subscriptionsSummary(db);
    if (subs.count) out.push({ dir: 'info', topic: 'subs', text: 'Actualmente gastas ' + U.money(subs.monthly) + ' al mes en ' + subs.count + ' suscripción(es).' });
    return out;
  }

  // ---------------- Margen del mes ----------------
  /**
   * "¿Cuánto puedo gastar sin afectar mis objetivos?" — cálculo descriptivo:
   *  Ingresos del mes − Gastos − Ahorro − Inversión − Abonos a capital
   *  − Pagos programados pendientes del mes − Aportes pendientes a metas.
   */
  function monthMargin(db, key) {
    key = key || U.currentMonthKey();
    const s = monthSummary(db, key);
    // Ocurrencias recurrentes del mes aún no registradas (incluye las vencidas pendientes)
    const sched = R.scheduledBetween(db, U.monthStart(key), U.monthEnd(key));
    let scheduledOut = 0, scheduledIn = 0;
    const scheduledToGoals = new Map();
    for (const o of sched) {
      const r = o.rule, amt = U.num(r.amount);
      if (r.type === 'transfer') continue;
      if (r.type === 'income' || r.type === 'investment_withdrawal' || r.type === 'loan_received') { if (r.type === 'income') scheduledIn += amt; continue; }
      if (r.type === 'debt_payment') { const d = db.get('debts', r.debtId); if (d && d.direction === 'receivable') continue; }
      scheduledOut += amt;
      for (const g of db.all('goals')) if (r.goalId === g.id || (g.accountId && r.toAccountId === g.accountId)) addTo(scheduledToGoals, g.id, amt);
    }
    let goalsPending = 0;
    for (const g of db.all('goals')) {
      if (g.archived) continue;
      const p = L.goalProgress(db, g);
      if (p.completed || !(g.monthlyContribution > 0)) continue;
      goalsPending += Math.max(0, g.monthlyContribution - p.contributedThisMonth - (scheduledToGoals.get(g.id) || 0));
    }
    const committed = s.saving + s.investment + s.principalPaid;
    const margin = U.round2(s.income + scheduledIn - s.expense - committed - scheduledOut - goalsPending);
    return { key, income: s.income, scheduledIn: U.round2(scheduledIn), expense: s.expense, committed: U.round2(committed), saving: s.saving,
      investment: s.investment, principalPaid: s.principalPaid, scheduled: U.round2(scheduledOut), goalsPending: U.round2(goalsPending), margin };
  }

  // ---------------- Vista anual ----------------
  function yearSummary(db, year) {
    year = String(year);
    const keys = U.monthRange(year + '-01', year + '-12');
    const curKey = U.currentMonthKey();
    const rows = keys.map(k => {
      const s = monthSummary(db, k);
      return { key: k, income: s.income, expense: s.expense, saving: s.saving, investment: s.investment, net: s.net, netWorth: s.netWorth, savingsRate: s.savingsRate, future: k > curKey };
    });
    const tot = summarize(db, year + '-01-01', year + '-12-31');
    const first = L.firstDataMonth(db);
    const activeMonths = keys.filter(k => k >= first && k <= curKey).length;
    const startNW = L.netWorthAt(db, (Number(year) - 1) + '-12-31').netWorth;
    const endDate = year + '-12-31' > U.today() ? U.today() : year + '-12-31';
    const endNW = L.netWorthAt(db, endDate).netWorth;
    const cats = categoryList(db, tot.expenseByCategory, tot.expense);
    const prevTot = summarize(db, (Number(year) - 1) + '-01-01', (Number(year) - 1) + '-12-31');
    return {
      year, rows, totals: tot, activeMonths, startNW, endNW, growth: U.round2(endNW - startNW), growthPct: U.pctChange(endNW, startNW),
      avgIncome: activeMonths ? U.round2(tot.income / activeMonths) : 0, avgExpense: activeMonths ? U.round2(tot.expense / activeMonths) : 0,
      avgSaving: activeMonths ? U.round2(tot.net / activeMonths) : 0, topCategory: cats[0] || null, categories: cats,
      prev: prevTot.count ? prevTot : null, vsPrev: prevTot.count ? compare(tot, prevTot) : null
    };
  }

  // ---------------- Proyección ----------------
  /**
   * Proyección lineal basada en promedios de los últimos `basis` meses completos.
   * opts: { basis, horizon (meses), incomeAdj (%), expenseAdj (%), annualReturn (%) }
   * Patrimonio_m = Patrimonio_0 + m × flujo neto mensual + rendimiento supuesto sobre inversiones.
   */
  function projection(db, opts) {
    opts = Object.assign({ basis: 6, horizon: 12, incomeAdj: 0, expenseAdj: 0, annualReturn: 0 }, opts || {});
    const key = U.currentMonthKey();
    const av = averages(db, key, opts.basis);
    const nw = L.netWorthAt(db, U.today());
    const income = av.income * (1 + opts.incomeAdj / 100);
    const expense = av.expense * (1 + opts.expenseAdj / 100);
    const net = income - expense;
    const r = opts.annualReturn ? Math.pow(1 + opts.annualReturn / 100, 1 / 12) - 1 : 0;
    const contrib = Math.max(0, av.investment - av.withdrawals);
    let liquid = nw.liquid + nw.savings - nw.cardDebt, inv = nw.invested, cumNet = 0, cumReturn = 0;
    const fixedRest = nw.receivables + nw.otherAssets - nw.debts - nw.otherLiabilities;
    let debts = nw.debts;
    const series = [{ m: 0, key, liquid: U.round2(liquid), invested: U.round2(inv), netWorth: nw.netWorth, cumNet: 0 }];
    for (let m = 1; m <= opts.horizon; m++) {
      const ret = inv * r;
      inv = inv + ret + contrib;
      cumReturn += ret;
      const principal = Math.min(debts, av.principalPaid);
      debts -= principal;
      liquid = liquid + net - contrib - principal;
      cumNet += net;
      series.push({ m, key: U.addMonthKey(key, m), liquid: U.round2(liquid), invested: U.round2(inv), netWorth: U.round2(nw.netWorth + cumNet + cumReturn), cumNet: U.round2(cumNet), cumReturn: U.round2(cumReturn) });
    }
    void fixedRest;
    return { basis: av, months: av.months, income: U.round2(income), expense: U.round2(expense), net: U.round2(net), start: nw, series, opts };
  }

  // ---------------- Salud financiera (indicadores descriptivos) ----------------
  function emergencyFund(db) {
    const goal = db.all('goals').find(g => g.kind === 'emergency' && !g.archived);
    if (goal) return { source: 'goal', label: 'Meta "' + goal.name + '"', amount: L.goalProgress(db, goal).current };
    const nw = L.netWorthAt(db, U.today());
    return { source: 'savings', label: 'Cuentas de ahorro', amount: nw.savings };
  }

  function health(db) {
    const key = U.currentMonthKey();
    const av3 = averages(db, key, 3);
    const av6 = averages(db, key, 6);
    const basis = av3.months ? av3 : null;
    const curM = monthSummary(db, key);
    const b = basis || { income: curM.income, expense: curM.expense, investment: curM.investment, fixed: curM.fixed, variable: curM.variable, months: 0 };
    const nw = L.netWorthAt(db, U.today());
    const debtsList = db.all('debts').filter(d => d.direction === 'payable');
    const monthlyDebtPayments = U.sum(debtsList, d => L.debtBalanceAt(db, d, U.today()) > 0 ? U.num(d.monthlyPayment) : 0);
    const ef = emergencyFund(db);
    const avgExp = av6.months ? av6.expense : b.expense;
    const nw12 = L.netWorthAt(db, U.addMonths(U.today(), -12)).netWorth;
    const nw1 = L.netWorthAt(db, U.addMonths(U.today(), -1)).netWorth;
    const prevMonth = monthSummary(db, U.addMonthKey(key, -1));
    const prevAv = averages(db, U.addMonthKey(key, -1), 3);
    const r = (a, c) => { const x = U.safeDiv(a, c); return x === null ? null : x * 100; };
    const basisTxt = basis ? 'promedio de los últimos ' + b.months + ' meses completos' : 'mes en curso';
    return {
      basisTxt,
      metrics: [
        { id: 'savingsRate', label: 'Tasa de ahorro', value: r(b.income - b.expense, b.income), unit: '%', formula: '(Ingresos − Gastos) ÷ Ingresos × 100', inputs: [['Ingresos', b.income], ['Gastos', b.expense]] },
        { id: 'investmentRate', label: 'Tasa de inversión', value: r(b.investment, b.income), unit: '%', formula: 'Inversión ÷ Ingresos × 100', inputs: [['Inversión', b.investment], ['Ingresos', b.income]] },
        { id: 'fixedIncome', label: 'Gastos fijos / ingresos', value: r(b.fixed, b.income), unit: '%', formula: 'Gastos fijos ÷ Ingresos × 100', inputs: [['Gastos fijos', b.fixed], ['Ingresos', b.income]] },
        { id: 'variableIncome', label: 'Gastos variables / ingresos', value: r(b.variable, b.income), unit: '%', formula: 'Gastos variables ÷ Ingresos × 100', inputs: [['Gastos variables', b.variable], ['Ingresos', b.income]] },
        { id: 'dti', label: 'Cuotas de deuda / ingresos', value: r(monthlyDebtPayments, b.income), unit: '%', formula: 'Suma de cuotas mensuales de deudas activas ÷ Ingresos mensuales × 100', inputs: [['Cuotas mensuales', monthlyDebtPayments], ['Ingresos', b.income]] },
        { id: 'debtIncome', label: 'Deuda total / ingreso anual', value: r(nw.debts + nw.cardDebt, b.income * 12), unit: '%', formula: 'Deudas totales ÷ (Ingreso mensual × 12) × 100', inputs: [['Deudas totales', nw.debts + nw.cardDebt], ['Ingreso anual estimado', b.income * 12]] },
        { id: 'emergency', label: 'Meses cubiertos por el fondo de emergencia', value: U.safeDiv(ef.amount, avgExp), unit: 'meses', formula: 'Fondo de emergencia ÷ Gasto mensual promedio (6 meses)', inputs: [[ef.label, ef.amount], ['Gasto mensual promedio', avgExp]] },
        { id: 'nwGrowth12', label: 'Crecimiento patrimonial (12 meses)', value: U.pctChange(nw.netWorth, nw12), unit: '%', money: nw.netWorth - nw12, formula: '(Patrimonio hoy − Patrimonio hace 12 meses) ÷ |Patrimonio hace 12 meses| × 100', inputs: [['Patrimonio hoy', nw.netWorth], ['Hace 12 meses', nw12]] },
        { id: 'nwGrowth1', label: 'Crecimiento patrimonial (1 mes)', value: U.pctChange(nw.netWorth, nw1), unit: '%', money: nw.netWorth - nw1, formula: '(Patrimonio hoy − Patrimonio hace 1 mes) ÷ |Patrimonio hace 1 mes| × 100', inputs: [['Patrimonio hoy', nw.netWorth], ['Hace 1 mes', nw1]] },
        { id: 'incomeVar', label: 'Variación de ingresos', value: U.pctChange(prevMonth.income, prevAv.income), unit: '%', formula: 'Último mes completo vs. promedio de los 3 meses anteriores', inputs: [[U.monthLabel(prevMonth.key), prevMonth.income], ['Promedio previo', prevAv.income]] },
        { id: 'expenseVar', label: 'Variación de gastos', value: U.pctChange(prevMonth.expense, prevAv.expense), unit: '%', formula: 'Último mes completo vs. promedio de los 3 meses anteriores', inputs: [[U.monthLabel(prevMonth.key), prevMonth.expense], ['Promedio previo', prevAv.expense]] }
      ],
      emergency: ef, avgExpense6: avgExp
    };
  }

  // ---------------- Informes ----------------
  function periodRange(mode, ref) {
    // mode: month | quarter | year ; ref: 'YYYY-MM' | 'YYYY-Qn' | 'YYYY'
    if (mode === 'month') return { from: U.monthStart(ref), to: U.monthEnd(ref), label: U.monthLabel(ref) };
    if (mode === 'quarter') {
      const [y, q] = ref.split('-Q').map(Number);
      const startM = (q - 1) * 3 + 1;
      const fk = y + '-' + U.pad(startM), tk = y + '-' + U.pad(startM + 2);
      return { from: U.monthStart(fk), to: U.monthEnd(tk), label: 'Trimestre ' + q + ' de ' + y };
    }
    return { from: ref + '-01-01', to: ref + '-12-31', label: 'Año ' + ref };
  }
  function previousRange(mode, from, to) {
    if (mode === 'month') { const k = U.addMonthKey(U.monthKey(from), -1); return { from: U.monthStart(k), to: U.monthEnd(k) }; }
    if (mode === 'quarter') { const k = U.addMonthKey(U.monthKey(from), -3); return { from: U.monthStart(k), to: U.monthEnd(U.addMonthKey(k, 2)) }; }
    if (mode === 'year') { const y = Number(from.slice(0, 4)) - 1; return { from: y + '-01-01', to: y + '-12-31' }; }
    const len = U.daysBetween(from, to) + 1;
    return { from: U.addDays(from, -len), to: U.addDays(from, -1) };
  }
  function report(db, from, to, prevFrom, prevTo) {
    const s = summarize(db, from, to);
    const p = summarize(db, prevFrom, prevTo);
    const endDate = to > U.today() ? U.today() : to;
    const nwEnd = from > U.today() ? null : L.netWorthAt(db, endDate);
    const nwStart = L.netWorthAt(db, U.addDays(from, -1));
    return {
      from, to, prevFrom, prevTo, summary: s, prev: p, vs: compare(s, p), netWorthEnd: nwEnd, netWorthStart: nwStart,
      nwChange: nwEnd ? U.round2(nwEnd.netWorth - nwStart.netWorth) : null,
      categories: categoryList(db, s.expenseByCategory, s.expense), incomeCategories: categoryList(db, s.incomeByCategory, s.income),
      byPerson: [...s.byPerson.entries()].map(([k, v]) => ({ id: k, name: S.PERSONS[k] || k, amount: U.round2(v) })).sort((a, b) => b.amount - a.amount),
      byTag: [...s.byTag.entries()].map(([k, v]) => ({ id: k, amount: U.round2(v) })).sort((a, b) => b.amount - a.amount)
    };
  }

  /** Lista de etiquetas usadas, con número de movimientos. */
  function allTags(db) {
    const m = new Map();
    for (const tx of db.all('transactions')) for (const t of tx.tags || []) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  }

  /** Total de gasto por etiqueta en un rango (p. ej. "#universidad este año"). */
  function tagTotals(db, tag, from, to) {
    const s = summarize(db, from, to);
    let income = 0;
    for (const tx of txInRange(db, from, to)) if ((tx.tags || []).includes(tag) && tx.type === 'income') income += tx.amount;
    return { expense: U.round2(s.byTag.get(tag) || 0), income: U.round2(income) };
  }

  F.analytics = {
    txInRange, filterTransactions, summarize, monthSummary, monthlySeries, averages, categoryList, expenseStats, incomeStats,
    compare, categoryComparison, monthAnalysis, insights, monthMargin, yearSummary, projection, emergencyFund, health,
    periodRange, previousRange, report, allTags, tagTotals, elapsedDays
  };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
