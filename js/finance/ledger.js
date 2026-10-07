/* =========================================================================
 * finance/ledger.js — Contabilidad: cómo afecta cada movimiento a cuentas,
 * inversiones y deudas; saldos a cualquier fecha; patrimonio neto.
 *
 * Principio: los saldos NO se guardan, se CALCULAN a partir del saldo
 * inicial + todos los movimientos. Así el histórico siempre es coherente,
 * editar un movimiento antiguo corrige todo hacia adelante y se puede
 * reconstruir el patrimonio de cualquier mes pasado.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema;

  // ---------- Memoización (se limpia cuando cambian los datos) ----------
  const memo = new Map();
  function cached(key, fn) {
    if (memo.has(key)) return memo.get(key);
    const v = fn();
    memo.set(key, v);
    return v;
  }
  function invalidate() { memo.clear(); }

  /** Efecto de un movimiento sobre los saldos de cuentas: [{accountId, delta}] */
  function accountEffects(tx, db) {
    const a = tx.amount;
    switch (tx.type) {
      case 'income': return [{ accountId: tx.accountId, delta: a }];
      case 'expense': return [{ accountId: tx.accountId, delta: -a }];
      case 'transfer':
      case 'saving': return [{ accountId: tx.accountId, delta: -a }, { accountId: tx.toAccountId, delta: a }];
      case 'investment': return [{ accountId: tx.accountId, delta: -a }];
      case 'investment_withdrawal': return [{ accountId: tx.accountId, delta: a }];
      case 'loan_received': return [{ accountId: tx.accountId, delta: a }];
      case 'loan_given': return [{ accountId: tx.accountId, delta: -a }];
      case 'debt_payment': {
        const d = db.get('debts', tx.debtId);
        const incoming = d && d.direction === 'receivable'; // me pagan un préstamo que hice
        return [{ accountId: tx.accountId, delta: incoming ? a : -a }];
      }
      default: return [];
    }
  }

  function interestOf(tx) { return tx.type === 'debt_payment' ? Math.min(U.num(tx.interestAmount), tx.amount) : 0; }

  /** Efecto sobre el saldo de una deuda/préstamo (positivo = aumenta lo adeudado). */
  function debtEffect(tx) {
    if (tx.type === 'loan_received' || tx.type === 'loan_given') return tx.amount;
    if (tx.type === 'debt_payment') return -(tx.amount - interestOf(tx));
    return 0;
  }
  /** Efecto sobre el valor de una inversión. */
  function investmentEffect(tx) {
    if (tx.type === 'investment') return tx.amount;
    if (tx.type === 'investment_withdrawal') return -tx.amount;
    return 0;
  }

  /**
   * Convierte un movimiento en partidas de flujo para estadísticas.
   * Solo ingresos y gastos reales (incluye intereses de deudas).
   * Transferencias, ahorro, inversión y abonos a capital NO son gasto.
   */
  function flowItems(tx, db) {
    const out = [];
    if (tx.type === 'income' || tx.type === 'expense') {
      const cat = db.get('categories', tx.categoryId);
      out.push({
        kind: tx.type, amount: tx.amount, categoryId: tx.categoryId, subcategory: tx.subcategory || '',
        nature: tx.nature || (cat && cat.nature) || 'variable'
      });
    } else if (tx.type === 'debt_payment') {
      const i = interestOf(tx);
      if (i > 0) {
        const d = db.get('debts', tx.debtId);
        if (d && d.direction === 'receivable') out.push({ kind: 'income', amount: i, categoryId: 'cat_intereses', subcategory: '', nature: 'variable' });
        else out.push({ kind: 'expense', amount: i, categoryId: tx.categoryId && db.get('categories', tx.categoryId) && db.get('categories', tx.categoryId).kind === 'expense' ? tx.categoryId : S.INTEREST_CATEGORY, subcategory: 'Intereses', nature: 'fixed' });
      }
    }
    return out;
  }

  /** ¿El movimiento está en la moneda base? (no se mezclan monedas en totales) */
  function inBase(tx, db) {
    const acc = db.get('accounts', tx.accountId);
    return !acc || acc.currency === U.getBaseCurrency();
  }

  /** Movimientos ordenados por fecha (y hora de creación) ascendente. */
  function sortedTx(db) {
    return cached('sortedTx', () => db.all('transactions').slice().sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || '') < (b.createdAt || '') ? -1 : 1));
  }

  // ---------- Cuentas ----------
  /** Saldo de cada cuenta a una fecha (inclusive). Devuelve Map(accountId → saldo). */
  function accountBalancesAt(db, date) {
    return cached('accBal:' + date, () => {
      const m = new Map();
      for (const a of db.all('accounts')) m.set(a.id, a.openedAt && a.openedAt <= date ? U.num(a.initialBalance) : 0);
      for (const tx of sortedTx(db)) {
        if (tx.date > date) break;
        for (const e of accountEffects(tx, db)) if (m.has(e.accountId)) m.set(e.accountId, m.get(e.accountId) + e.delta);
      }
      for (const [k, v] of m) m.set(k, U.round2(v));
      return m;
    });
  }
  function accountBalance(db, accountId, date) { return accountBalancesAt(db, date || U.today()).get(accountId) || 0; }
  function accountPurpose(acc) { return acc.purpose || (S.ACCOUNT_TYPES[acc.type] || {}).purpose || 'spending'; }

  // ---------- Inversiones ----------
  function sortedValuations(inv) {
    return (inv.valuations || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at || '') < (b.at || '') ? -1 : 1);
  }
  /**
   * Valor de una inversión a una fecha = última valoración manual ≤ fecha
   * + aportes − retiros registrados DESPUÉS de esa valoración.
   */
  function investmentValueAt(db, inv, date) {
    const vals = sortedValuations(inv).filter(v => v.date <= date);
    const last = vals[vals.length - 1];
    let value = last ? last.value : 0;
    for (const tx of sortedTx(db)) {
      if (tx.date > date) break;
      if (tx.investmentId !== inv.id) continue;
      const after = !last || tx.date > last.date || (tx.date === last.date && (tx.createdAt || '') > (last.at || ''));
      if (after) value += investmentEffect(tx);
    }
    return Math.max(0, U.round2(value));
  }
  /** Resumen completo de una inversión. */
  function investmentSummary(db, inv, date) {
    date = date || U.today();
    let contributions = U.num(inv.openingContributed), withdrawals = 0, fees = 0, contribCount = 0, withdrawCount = 0;
    for (const tx of db.all('transactions')) {
      if (tx.investmentId !== inv.id || tx.date > date) continue;
      if (tx.type === 'investment') { contributions += tx.amount; contribCount++; }
      else if (tx.type === 'investment_withdrawal') { withdrawals += tx.amount; withdrawCount++; }
      else if (tx.type === 'expense') fees += tx.amount;
    }
    const value = investmentValueAt(db, inv, date);
    const netInvested = contributions - withdrawals;
    const gain = value - netInvested;              // ganancia/pérdida (incluye lo ya retirado)
    const returnPct = U.safeDiv(gain, contributions); // sobre capital aportado
    const vals = sortedValuations(inv);
    const lastVal = vals[vals.length - 1];
    return {
      id: inv.id, name: inv.name, type: inv.type,
      contributions: U.round2(contributions), withdrawals: U.round2(withdrawals), netInvested: U.round2(netInvested),
      value, gain: U.round2(gain), returnPct: returnPct === null ? null : returnPct * 100,
      gainNetOfFees: U.round2(gain - fees), fees: U.round2(fees),
      contribCount, withdrawCount, lastValuationDate: lastVal ? lastVal.date : null,
      staleDays: lastVal ? U.daysBetween(lastVal.date, date) : null, closed: !!inv.closed
    };
  }
  function portfolioSummary(db, date) {
    return cached('portfolio:' + (date || U.today()), () => {
      const items = db.all('investments').map(i => investmentSummary(db, i, date));
      const contributions = U.sum(items, i => i.contributions), withdrawals = U.sum(items, i => i.withdrawals);
      const value = U.sum(items, i => i.value), gain = U.sum(items, i => i.gain), fees = U.sum(items, i => i.fees);
      const rp = U.safeDiv(gain, contributions);
      return { items, contributions, withdrawals, netInvested: U.round2(contributions - withdrawals), value, gain, fees, returnPct: rp === null ? null : rp * 100 };
    });
  }

  // ---------- Deudas ----------
  function debtBalanceAt(db, debt, date) {
    let b = debt.startDate && debt.startDate <= date ? U.num(debt.openingBalance) : 0;
    for (const tx of sortedTx(db)) {
      if (tx.date > date) break;
      if (tx.debtId === debt.id) b += debtEffect(tx);
    }
    return Math.max(0, U.round2(b));
  }
  /**
   * Amortización estimada (sistema de cuota fija) desde el saldo actual.
   * Tasa: efectiva anual (EA), convención colombiana → tasa mensual = (1+EA)^(1/12) − 1.
   */
  function amortization(balance, annualRatePct, payment, maxMonths) {
    balance = U.num(balance); payment = U.num(payment);
    const r = annualRatePct > 0 ? Math.pow(1 + annualRatePct / 100, 1 / 12) - 1 : 0;
    const res = { monthlyRate: r * 100, months: null, totalInterest: null, payoffDate: null, coversInterest: true, schedule: [] };
    if (balance <= 0) return Object.assign(res, { months: 0, totalInterest: 0 });
    if (payment <= 0) return res;
    if (payment <= balance * r) { res.coversInterest = false; return res; }
    let b = balance, months = 0, interest = 0;
    const cap = maxMonths || 1200;
    while (b > 0.005 && months < cap) {
      const i = b * r;
      const principal = Math.min(payment - i, b);
      interest += i; b -= principal; months++;
      if (res.schedule.length < 600) res.schedule.push({ month: months, interest: U.round2(i), principal: U.round2(principal), balance: U.round2(Math.max(b, 0)) });
    }
    res.months = months;
    res.totalInterest = U.round2(interest);
    res.payoffDate = U.addMonths(U.today(), months);
    return res;
  }
  function debtSummary(db, debt, date) {
    date = date || U.today();
    let paid = 0, interestPaid = 0, payments = 0, disbursed = 0;
    for (const tx of db.all('transactions')) {
      if (tx.debtId !== debt.id || tx.date > date) continue;
      if (tx.type === 'debt_payment') { paid += tx.amount; interestPaid += interestOf(tx); payments++; }
      else disbursed += tx.amount;
    }
    const balance = debtBalanceAt(db, debt, date);
    const reference = Math.max(U.num(debt.principal), U.num(debt.openingBalance) + disbursed);
    const progress = reference > 0 ? U.clamp((1 - balance / reference) * 100, 0, 100) : (balance === 0 ? 100 : 0);
    const am = debt.direction === 'payable' ? amortization(balance, U.num(debt.interestRate), U.num(debt.monthlyPayment)) : null;
    return {
      id: debt.id, name: debt.name, direction: debt.direction, balance, paid: U.round2(paid), interestPaid: U.round2(interestPaid),
      principalPaid: U.round2(paid - interestPaid), payments, disbursed: U.round2(disbursed), reference: U.round2(reference), progress, amortization: am
    };
  }

  // ---------- Activos/pasivos manuales ----------
  function assetValueAt(asset, date) {
    const vals = sortedValuations(asset).filter(v => v.date <= date);
    return vals.length ? U.num(vals[vals.length - 1].value) : 0;
  }

  /**
   * PATRIMONIO NETO a una fecha:
   *   Activos  = saldos positivos de cuentas + inversiones + dinero que me deben + otros activos
   *   Pasivos  = saldos negativos de cuentas (tarjetas/sobregiros) + deudas + otros pasivos
   *   Neto     = Activos − Pasivos
   * Solo moneda base; cuentas en otras monedas se informan aparte (sin convertir).
   */
  function netWorthAt(db, date) {
    return cached('nw:' + date, () => {
      const base = U.getBaseCurrency();
      const bal = accountBalancesAt(db, date);
      const r = {
        date, spending: 0, cash: 0, savings: 0, investmentCash: 0, investments: 0, receivables: 0, otherAssets: 0,
        cardDebt: 0, debts: 0, otherLiabilities: 0, foreign: []
      };
      for (const a of db.all('accounts')) {
        const b = bal.get(a.id) || 0;
        if (a.currency !== base) { if (b !== 0) r.foreign.push({ id: a.id, name: a.name, currency: a.currency, balance: b }); continue; }
        if (b < 0) { r.cardDebt += -b; continue; }
        const p = accountPurpose(a);
        if (a.type === 'cash') r.cash += b;
        else if (p === 'savings') r.savings += b;
        else if (p === 'investment') r.investmentCash += b;
        else r.spending += b;
      }
      for (const inv of db.all('investments')) r.investments += investmentValueAt(db, inv, date);
      for (const d of db.all('debts')) {
        const b = debtBalanceAt(db, d, date);
        if (d.direction === 'receivable') r.receivables += b; else r.debts += b;
      }
      for (const as of db.all('assets')) {
        const v = assetValueAt(as, date);
        if (as.kind === 'other_liability') r.otherLiabilities += v; else r.otherAssets += v;
      }
      for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] = U.round2(r[k]);
      r.invested = U.round2(r.investments + r.investmentCash);
      r.liquid = U.round2(r.spending + r.cash);                    // cuentas + efectivo
      r.available = U.round2(r.spending + r.cash - r.cardDebt);     // disponible real (descuenta tarjetas)
      r.assets = U.round2(r.spending + r.cash + r.savings + r.invested + r.receivables + r.otherAssets);
      r.liabilities = U.round2(r.cardDebt + r.debts + r.otherLiabilities);
      r.netWorth = U.round2(r.assets - r.liabilities);
      return r;
    });
  }

  /** Primer mes con datos (para series históricas). */
  function firstDataMonth(db) {
    return cached('firstMonth', () => {
      let min = null;
      const consider = d => { if (d && U.isValidDate(d) && (!min || d < min)) min = d; };
      const tx = sortedTx(db);
      if (tx.length) consider(tx[0].date);
      for (const a of db.all('accounts')) consider(a.openedAt);
      for (const i of db.all('investments')) consider(i.startDate);
      for (const d of db.all('debts')) consider(d.startDate);
      return min ? U.monthKey(min) : U.currentMonthKey();
    });
  }

  /** Lista de cuentas con saldo actual, ordenadas por propósito. */
  function accountsWithBalance(db, date) {
    const bal = accountBalancesAt(db, date || U.today());
    return db.all('accounts').map(a => Object.assign({}, a, { balance: bal.get(a.id) || 0, purposeResolved: accountPurpose(a) }))
      .sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || a.name.localeCompare(b.name));
  }

  /** Contribuciones a una meta + valor actual. */
  function goalProgress(db, goal, date) {
    date = date || U.today();
    let current, contributed = 0;
    for (const tx of db.all('transactions')) {
      if (tx.date > date) continue;
      if (tx.goalId === goal.id && (tx.type === 'saving' || tx.type === 'transfer')) contributed += tx.amount;
    }
    if (goal.accountId && db.get('accounts', goal.accountId)) current = accountBalance(db, goal.accountId, date);
    else current = U.num(goal.manualAmount) + contributed;
    current = U.round2(Math.max(0, current));
    const target = U.num(goal.targetAmount);
    const remaining = Math.max(0, U.round2(target - current));
    const pct = target > 0 ? U.clamp(current / target * 100, 0, 100) : 0;
    let monthsLeft = null, requiredMonthly = null;
    if (goal.targetDate && U.isValidDate(goal.targetDate)) {
      monthsLeft = U.monthsBetween(date, goal.targetDate);
      if (remaining <= 0) requiredMonthly = 0;
      else if (monthsLeft > 0) requiredMonthly = U.round2(remaining / Math.max(monthsLeft, 1));
      else requiredMonthly = null; // fecha vencida
    }
    const monthly = U.num(goal.monthlyContribution);
    const monthsAtDesired = remaining <= 0 ? 0 : (monthly > 0 ? Math.ceil(remaining / monthly) : null);
    // Aportes del mes actual (para calcular cuánto falta aportar este mes)
    const mk = U.monthKey(date);
    let thisMonth = 0;
    for (const tx of db.all('transactions')) {
      if (U.monthKey(tx.date) !== mk || tx.date > date) continue;
      const toGoal = tx.goalId === goal.id || (goal.accountId && tx.toAccountId === goal.accountId && (tx.type === 'saving' || tx.type === 'transfer'));
      if (toGoal && (tx.type === 'saving' || tx.type === 'transfer')) thisMonth += tx.amount;
    }
    return {
      current, target, remaining, pct, monthsLeft, requiredMonthly, monthsAtDesired,
      projectedDate: monthsAtDesired !== null ? U.addMonths(date, monthsAtDesired) : null,
      contributedThisMonth: U.round2(thisMonth), completed: remaining <= 0
    };
  }

  // Cualquier cambio en los datos invalida los cálculos memorizados.
  if (F.Store && F.Store.on) F.Store.on(invalidate);

  F.ledger = {
    cached, invalidate, accountEffects, debtEffect, investmentEffect, interestOf, flowItems, inBase, sortedTx,
    accountBalancesAt, accountBalance, accountPurpose, accountsWithBalance,
    investmentValueAt, investmentSummary, portfolioSummary, sortedValuations,
    debtBalanceAt, debtSummary, amortization, assetValueAt, netWorthAt, firstDataMonth, goalProgress
  };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
