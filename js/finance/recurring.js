/* =========================================================================
 * finance/recurring.js — Movimientos recurrentes y suscripciones.
 *
 * Una regla recurrente es un "molde" de movimiento + frecuencia + próxima
 * fecha. Como no hay servidor, al abrir la app se calculan las ocurrencias
 * vencidas: las reglas con "registro automático" crean el movimiento; las
 * demás aparecen como pendientes para confirmar u omitir.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema;
  const MAX_CATCHUP = 36; // máximo de ocurrencias atrasadas que se calculan por regla

  function step(rule, date) {
    const f = S.FREQUENCIES[rule.frequency];
    if (!f) return null;
    if (f.step.days) return U.addDays(date, f.step.days);
    return U.addMonths(date, f.step.months, rule.anchorDay || Number((rule.startDate || date).slice(8, 10)));
  }

  /** Fechas de ocurrencia de una regla entre `from` y `to` (inclusive), empezando en nextDate. */
  function occurrences(rule, from, to, limit) {
    const out = [];
    if (!rule.active || !U.isValidDate(rule.nextDate)) return out;
    let d = rule.nextDate, guard = 0;
    limit = limit || 400;
    while (d && d <= to && guard++ < 2000) {
      if (rule.endDate && d > rule.endDate) break;
      if (d >= from) out.push(d);
      if (out.length >= limit) break;
      d = step(rule, d);
    }
    return out;
  }

  /** Ocurrencias vencidas (≤ fecha) pendientes de confirmar. */
  function pending(db, date) {
    date = date || U.today();
    const out = [];
    for (const r of db.all('recurring')) {
      if (!r.active) continue;
      for (const d of occurrences(r, '1900-01-01', date, MAX_CATCHUP)) out.push({ rule: r, date: d });
    }
    return out.sort((a, b) => a.date < b.date ? -1 : 1);
  }

  /** Próximos pagos dentro de `days` días (excluye los ya vencidos). */
  function upcoming(db, days, date) {
    date = date || U.today();
    const to = U.addDays(date, days || 30);
    const out = [];
    for (const r of db.all('recurring')) for (const d of occurrences(r, U.addDays(date, 1), to, 60)) out.push({ rule: r, date: d });
    return out.sort((a, b) => a.date < b.date ? -1 : 1);
  }

  /** Construye el movimiento que genera una regla en una fecha. */
  function buildTx(rule, date, overrides) {
    const tx = {
      date, type: rule.type, amount: rule.amount, accountId: rule.accountId,
      toAccountId: rule.toAccountId || null, categoryId: rule.categoryId || null, subcategory: rule.subcategory || '',
      description: rule.description || rule.name, paymentMethod: rule.paymentMethod || '', tags: (rule.tags || []).slice(),
      notes: '', recurring: true, recurringId: rule.id, nature: rule.nature || (rule.type === 'expense' ? 'fixed' : undefined),
      person: rule.person || 'personal', investmentId: rule.investmentId || null, debtId: rule.debtId || null,
      goalId: rule.goalId || null, interestAmount: rule.interestAmount || 0, isDemo: !!rule.isDemo
    };
    return Object.assign(tx, overrides || {});
  }

  /** Confirma la ocurrencia más antigua: crea el movimiento y avanza la regla. */
  async function confirm(store, ruleId, overrides) {
    const rule = store.get('recurring', ruleId);
    if (!rule) throw new Error('La regla no existe.');
    const date = (overrides && overrides.date) || rule.nextDate;
    const tx = await store.save('transactions', buildTx(rule, date, overrides));
    await advance(store, rule);
    return tx;
  }
  /** Omite la ocurrencia actual (no crea movimiento). */
  async function skip(store, ruleId) {
    const rule = store.get('recurring', ruleId);
    if (rule) await advance(store, rule);
  }
  async function advance(store, rule) {
    const next = step(rule, rule.nextDate);
    const patch = { nextDate: next };
    if (rule.endDate && next > rule.endDate) patch.active = false;
    await store.save('recurring', Object.assign({}, rule, patch));
  }

  /** Registra automáticamente las ocurrencias vencidas de reglas con autoConfirm. */
  async function runAuto(store, date) {
    date = date || U.today();
    let created = 0;
    for (const r of store.all('recurring').slice()) {
      if (!r.active || !r.autoConfirm) continue;
      let guard = 0;
      while (guard++ < MAX_CATCHUP) {
        const cur = store.get('recurring', r.id);
        if (!cur.active || cur.nextDate > date || (cur.endDate && cur.nextDate > cur.endDate)) break;
        try { await confirm(store, cur.id); created++; } catch (e) { console.warn('Recurrente no registrado', cur.name, e); break; }
      }
    }
    return created;
  }

  /** Costo mensual equivalente de una regla (semanal → ×52/12, anual → ÷12, etc.). */
  function monthlyEquivalent(rule) {
    const f = S.FREQUENCIES[rule.frequency];
    return f ? U.round2(U.num(rule.amount) * f.perMonth) : 0;
  }

  function subscriptionsSummary(db) {
    const subs = db.all('recurring').filter(r => r.isSubscription && r.active && r.type === 'expense');
    const monthly = U.sum(subs, monthlyEquivalent);
    return { items: subs, monthly, annual: U.round2(monthly * 12), count: subs.length };
  }

  /** Salidas programadas (no confirmadas) entre dos fechas: para margen y calendario. */
  function scheduledBetween(db, from, to) {
    const out = [];
    for (const r of db.all('recurring')) for (const d of occurrences(r, from, to, 400)) out.push({ rule: r, date: d });
    return out;
  }

  F.recurring = { step, occurrences, pending, upcoming, buildTx, confirm, skip, runAuto, monthlyEquivalent, subscriptionsSummary, scheduledBetween };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
