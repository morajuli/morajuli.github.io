/* =========================================================================
 * core/schema.js — Modelo de datos: catálogos, valores por defecto y
 * validaciones de cada entidad. Es la "fuente de verdad" del formato que
 * se guarda en IndexedDB y en los respaldos JSON.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils;

  const SCHEMA_VERSION = 1;
  const MAX_AMOUNT = 1e13; // 10 billones: límite de cordura para "valores extremadamente grandes"

  // Colecciones (object stores) que forman la base de datos.
  const STORES = ['settings', 'accounts', 'categories', 'transactions', 'recurring', 'budgets', 'goals', 'investments', 'debts', 'assets'];

  // ---------- Tipos de movimiento ----------
  // flow: cómo afecta las estadísticas. 'income' y 'expense' son flujo real;
  // 'neutral' solo mueve dinero entre bolsillos propios (no cambia patrimonio).
  const TX_TYPES = {
    income:                { label: 'Ingreso',             short: 'Ingreso',     flow: 'income',  sign: +1, color: 'income' },
    expense:               { label: 'Gasto',               short: 'Gasto',       flow: 'expense', sign: -1, color: 'expense' },
    transfer:              { label: 'Transferencia',       short: 'Transferencia', flow: 'neutral', sign: 0, color: 'neutral' },
    saving:                { label: 'Ahorro',              short: 'Ahorro',      flow: 'neutral', sign: 0, color: 'saving' },
    investment:            { label: 'Inversión',           short: 'Inversión',   flow: 'neutral', sign: -1, color: 'invest' },
    investment_withdrawal: { label: 'Retiro de inversión', short: 'Retiro inv.', flow: 'neutral', sign: +1, color: 'invest' },
    debt_payment:          { label: 'Pago de deuda',       short: 'Pago deuda',  flow: 'neutral', sign: -1, color: 'debt' },
    loan_received:         { label: 'Préstamo recibido',   short: 'Préstamo rec.', flow: 'neutral', sign: +1, color: 'debt' },
    loan_given:            { label: 'Préstamo entregado',  short: 'Préstamo ent.', flow: 'neutral', sign: -1, color: 'debt' }
  };

  const ACCOUNT_TYPES = {
    bank:          { label: 'Cuenta bancaria',            purpose: 'spending' },
    savings:       { label: 'Cuenta de ahorro (reserva)', purpose: 'savings' },
    cash:          { label: 'Efectivo',                   purpose: 'spending' },
    wallet:        { label: 'Billetera digital',          purpose: 'spending' },
    investment:    { label: 'Cuenta de inversión',        purpose: 'investment' },
    goal_savings:  { label: 'Bolsillo / ahorro específico', purpose: 'savings' },
    other_liquid:  { label: 'Otro activo líquido',        purpose: 'spending' },
    credit_card:   { label: 'Tarjeta de crédito',         purpose: 'spending' }
  };
  const ACCOUNT_PURPOSES = {
    spending:   'Disponible (día a día)',
    savings:    'Ahorro',
    investment: 'Inversión'
  };

  const PAYMENT_METHODS = ['Débito', 'Tarjeta de crédito', 'Efectivo', 'Transferencia', 'PSE', 'Billetera digital', 'Débito automático', 'Otro'];
  const PERSONS = { personal: 'Personal', pareja: 'Pareja', familia: 'Familia', compartido: 'Compartido' };
  const NATURES = { fixed: 'Fijo', variable: 'Variable' };

  const FREQUENCIES = {
    weekly:     { label: 'Semanal',     perMonth: 52 / 12, step: { days: 7 } },
    biweekly:   { label: 'Quincenal',   perMonth: 26 / 12, step: { days: 14 } },
    monthly:    { label: 'Mensual',     perMonth: 1,       step: { months: 1 } },
    bimonthly:  { label: 'Bimestral',   perMonth: 1 / 2,   step: { months: 2 } },
    quarterly:  { label: 'Trimestral',  perMonth: 1 / 3,   step: { months: 3 } },
    semiannual: { label: 'Semestral',   perMonth: 1 / 6,   step: { months: 6 } },
    annual:     { label: 'Anual',       perMonth: 1 / 12,  step: { months: 12 } }
  };

  const INVESTMENT_TYPES = { etf: 'ETF', stock: 'Acción', fund: 'Fondo', yield_account: 'Cuenta remunerada', cdt: 'CDT', crypto: 'Criptomonedas', other: 'Otro' };
  const DEBT_KINDS = { credit_card: 'Tarjeta de crédito', consumer: 'Crédito de consumo', mortgage: 'Crédito hipotecario', vehicle: 'Crédito vehicular', student: 'Crédito educativo', personal: 'Préstamo personal', other: 'Otra' };
  const GOAL_KINDS = { emergency: 'Fondo de emergencia', computer: 'Comprar computador', travel: 'Viaje', vehicle: 'Comprar vehículo', investment: 'Inversión', housing: 'Vivienda', education: 'Educación', custom: 'Meta personalizada' };
  const ASSET_KINDS = { property: 'Inmueble', vehicle: 'Vehículo', receivable: 'Cuenta por cobrar', valuables: 'Bienes de valor', other_asset: 'Otro activo', other_liability: 'Otro pasivo' };

  // ---------- Categorías por defecto (ids estables) ----------
  const C = (id, name, group, kind, nature, subs, color) => ({ id: 'cat_' + id, name, group, kind, nature, subcategories: subs, color, system: true });
  const DEFAULT_CATEGORIES = [
    C('alimentacion', 'Alimentación', 'Necesidades', 'expense', 'variable', ['Mercado', 'Restaurante', 'Domicilios', 'Café y snacks'], '#2f7d5b'),
    C('vivienda', 'Vivienda', 'Necesidades', 'expense', 'fixed', ['Arriendo', 'Administración', 'Mantenimiento', 'Hipoteca'], '#35618f'),
    C('servicios', 'Servicios', 'Necesidades', 'expense', 'fixed', ['Energía', 'Agua', 'Gas', 'Internet'], '#4f86b8'),
    C('transporte', 'Transporte', 'Necesidades', 'expense', 'variable', ['Transporte público', 'Gasolina', 'Taxi / apps', 'Parqueadero', 'Mantenimiento vehículo'], '#c08a2b'),
    C('salud', 'Salud', 'Necesidades', 'expense', 'variable', ['Medicina prepagada', 'EPS', 'Medicamentos', 'Consultas'], '#c2554d'),
    C('educacion', 'Educación', 'Necesidades', 'expense', 'variable', ['Matrícula', 'Cursos', 'Libros', 'Materiales'], '#6b5bb5'),
    C('comunicaciones', 'Comunicaciones', 'Necesidades', 'expense', 'fixed', ['Celular', 'Plan de datos'], '#3d9aa5'),
    C('entretenimiento', 'Entretenimiento', 'Estilo de vida', 'expense', 'variable', ['Cine', 'Eventos', 'Salidas'], '#b5487a'),
    C('restaurantes', 'Restaurantes', 'Estilo de vida', 'expense', 'variable', ['Almuerzos', 'Cenas', 'Bares'], '#d0703a'),
    C('ropa', 'Ropa', 'Estilo de vida', 'expense', 'variable', ['Ropa', 'Calzado', 'Accesorios'], '#8a6d4b'),
    C('viajes', 'Viajes', 'Estilo de vida', 'expense', 'variable', ['Tiquetes', 'Alojamiento', 'Actividades'], '#2e8bb0'),
    C('suscripciones', 'Suscripciones', 'Estilo de vida', 'expense', 'fixed', ['Streaming', 'Música', 'Software', 'Gimnasio'], '#7a52a3'),
    C('compras', 'Compras', 'Estilo de vida', 'expense', 'variable', ['Hogar', 'Tecnología', 'Varios'], '#9a7b2f'),
    C('hobbies', 'Hobbies', 'Estilo de vida', 'expense', 'variable', ['Deporte', 'Juegos', 'Arte'], '#4d9a6a'),
    C('ahorro', 'Ahorro', 'Finanzas', 'expense', 'variable', [], '#3f7ec0'),
    C('inversiones', 'Inversiones', 'Finanzas', 'expense', 'variable', [], '#7454c2'),
    C('deudas', 'Deudas', 'Finanzas', 'expense', 'fixed', ['Intereses', 'Cuota de manejo', 'Seguros del crédito'], '#a8642a'),
    C('comisiones', 'Comisiones', 'Finanzas', 'expense', 'variable', ['Bancarias', '4x1000', 'Transferencias', 'Inversión'], '#7b8794'),
    C('impuestos', 'Impuestos', 'Finanzas', 'expense', 'variable', ['Renta', 'Predial', 'Vehicular'], '#5d6b7a'),
    C('regalos', 'Regalos', 'Otros', 'expense', 'variable', [], '#c25f8e'),
    C('emergencias', 'Emergencias', 'Otros', 'expense', 'variable', [], '#b23b3b'),
    C('otros', 'Otros', 'Otros', 'expense', 'variable', [], '#8b93a0'),
    // Ingresos
    C('salario', 'Salario', 'Ingresos', 'income', 'fixed', ['Nómina', 'Prima', 'Cesantías'], '#1f8a5b'),
    C('honorarios', 'Honorarios', 'Ingresos', 'income', 'variable', [], '#2a9d6f'),
    C('freelance', 'Freelance', 'Ingresos', 'income', 'variable', [], '#37a77c'),
    C('bonificaciones', 'Bonificaciones', 'Ingresos', 'income', 'variable', [], '#4bb08a'),
    C('intereses', 'Intereses', 'Ingresos', 'income', 'variable', [], '#5fb998'),
    C('dividendos', 'Dividendos', 'Ingresos', 'income', 'variable', [], '#73c2a6'),
    C('rendimientos', 'Rendimientos', 'Ingresos', 'income', 'variable', [], '#16704a'),
    C('regalos_ing', 'Regalos', 'Ingresos', 'income', 'variable', [], '#0f6040'),
    C('otros_ing', 'Otros ingresos', 'Ingresos', 'income', 'variable', [], '#6a8f7f')
  ];
  const EXPENSE_GROUPS = ['Necesidades', 'Estilo de vida', 'Finanzas', 'Otros'];
  const FALLBACK_EXPENSE_CATEGORY = 'cat_otros';
  const FALLBACK_INCOME_CATEGORY = 'cat_otros_ing';
  const INTEREST_CATEGORY = 'cat_deudas';

  const DEFAULT_SETTINGS = {
    id: 'main',
    currency: 'COP',
    emergencyMonths: 6,
    projectionMonths: 6,
    theme: 'auto',
    privacyNoticeSeen: false,
    lastBackupAt: null,
    schemaVersion: SCHEMA_VERSION
  };

  // ---------- Validación ----------
  function result(errors) { return { ok: Object.keys(errors).length === 0, errors }; }
  function checkAmount(errors, field, v, opts) {
    opts = opts || {};
    if (v === '' || v === null || v === undefined) { if (opts.required !== false) errors[field] = 'Este valor es obligatorio.'; return; }
    if (typeof v !== 'number' || !Number.isFinite(v)) { errors[field] = 'Escribe un número válido.'; return; }
    if (!opts.allowNegative && v < 0) { errors[field] = 'No puede ser negativo.'; return; }
    if (opts.positive && v <= 0) { errors[field] = 'Debe ser mayor que 0.'; return; }
    if (Math.abs(v) > MAX_AMOUNT) { errors[field] = 'El valor es demasiado grande (máximo ' + U.money(MAX_AMOUNT) + ').'; }
  }
  function checkText(errors, field, v, label, max, required) {
    if (required && (!v || !String(v).trim())) { errors[field] = label + ' es obligatorio.'; return; }
    if (v && String(v).length > (max || 200)) errors[field] = label + ' es demasiado largo (máx. ' + (max || 200) + ' caracteres).';
  }
  function checkDate(errors, field, v, required) {
    if (!v) { if (required) errors[field] = 'La fecha es obligatoria.'; return; }
    if (!U.isValidDate(v)) errors[field] = 'Fecha inválida.';
  }

  /**
   * Valida un movimiento. `ctx` permite comprobar integridad referencial:
   * { account(id), category(id), investment(id), debt(id), goal(id) } → registro o undefined.
   */
  function validateTransaction(tx, ctx) {
    const e = {};
    const t = TX_TYPES[tx.type];
    if (!t) e.type = 'Tipo de movimiento inválido.';
    checkDate(e, 'date', tx.date, true);
    checkAmount(e, 'amount', tx.amount, { positive: true });
    checkText(e, 'description', tx.description, 'La descripción', 200);
    checkText(e, 'notes', tx.notes, 'Las notas', 2000);
    if (tx.tags && (!Array.isArray(tx.tags) || tx.tags.length > 20)) e.tags = 'Etiquetas inválidas.';
    if (tx.person && !PERSONS[tx.person]) e.person = 'Valor inválido.';
    if (tx.nature && !NATURES[tx.nature]) e.nature = 'Valor inválido.';
    if (!t) return result(e);

    const acc = tx.accountId && ctx ? ctx.account(tx.accountId) : null;
    if (!tx.accountId) e.accountId = tx.type === 'investment_withdrawal' ? 'Elige la cuenta que recibe el dinero.' : 'Elige una cuenta.';
    else if (ctx && !acc) e.accountId = 'La cuenta no existe.';

    if (tx.type === 'income' || tx.type === 'expense') {
      if (!tx.categoryId) e.categoryId = 'Elige una categoría.';
      else if (ctx) {
        const c = ctx.category(tx.categoryId);
        if (!c) e.categoryId = 'La categoría no existe.';
        else if (c.kind !== tx.type) e.categoryId = tx.type === 'income' ? 'Elige una categoría de ingreso.' : 'Elige una categoría de gasto.';
      }
    } else if (tx.categoryId && ctx && !ctx.category(tx.categoryId)) {
      e.categoryId = 'La categoría no existe.';
    }

    if (tx.type === 'transfer' || tx.type === 'saving') {
      if (!tx.toAccountId) e.toAccountId = 'Elige la cuenta de destino.';
      else if (tx.toAccountId === tx.accountId) e.toAccountId = 'El origen y el destino deben ser distintos.';
      else if (ctx) {
        const to = ctx.account(tx.toAccountId);
        if (!to) e.toAccountId = 'La cuenta de destino no existe.';
        else if (acc && to.currency !== acc.currency) e.toAccountId = 'Las cuentas tienen monedas distintas; la app no convierte monedas.';
      }
      if (tx.goalId && ctx && !ctx.goal(tx.goalId)) e.goalId = 'La meta no existe.';
    }
    if (tx.type === 'investment' || tx.type === 'investment_withdrawal') {
      if (!tx.investmentId) e.investmentId = 'Elige una inversión.';
      else if (ctx && !ctx.investment(tx.investmentId)) e.investmentId = 'La inversión no existe.';
    }
    if (tx.type === 'debt_payment' || tx.type === 'loan_received' || tx.type === 'loan_given') {
      if (!tx.debtId) e.debtId = 'Elige una deuda o préstamo.';
      else if (ctx) {
        const d = ctx.debt(tx.debtId);
        if (!d) e.debtId = 'La deuda no existe.';
        else if (tx.type === 'loan_received' && d.direction !== 'payable') e.debtId = 'Un préstamo recibido debe asociarse a "Dinero que debo".';
        else if (tx.type === 'loan_given' && d.direction !== 'receivable') e.debtId = 'Un préstamo entregado debe asociarse a "Dinero que me deben".';
      }
      if (tx.type === 'debt_payment') {
        const i = tx.interestAmount === undefined || tx.interestAmount === null || tx.interestAmount === '' ? 0 : tx.interestAmount;
        checkAmount(e, 'interestAmount', i, { required: false });
        if (!e.interestAmount && !e.amount && i > tx.amount) e.interestAmount = 'Los intereses no pueden superar el valor del pago.';
      }
    }
    return result(e);
  }

  function validateAccount(a) {
    const e = {};
    checkText(e, 'name', a.name, 'El nombre', 60, true);
    if (!ACCOUNT_TYPES[a.type]) e.type = 'Tipo de cuenta inválido.';
    if (a.purpose && !ACCOUNT_PURPOSES[a.purpose]) e.purpose = 'Propósito inválido.';
    if (!U.CURRENCIES[a.currency]) e.currency = 'Moneda no soportada.';
    // Saldo inicial puede ser negativo (tarjeta de crédito o sobregiro).
    checkAmount(e, 'initialBalance', a.initialBalance, { allowNegative: true });
    checkDate(e, 'openedAt', a.openedAt, true);
    checkText(e, 'notes', a.notes, 'Las notas', 1000);
    return result(e);
  }

  function validateCategory(c, existing) {
    const e = {};
    checkText(e, 'name', c.name, 'El nombre', 40, true);
    if (c.kind !== 'income' && c.kind !== 'expense') e.kind = 'Tipo inválido.';
    if (c.nature && !NATURES[c.nature]) e.nature = 'Valor inválido.';
    if (!Array.isArray(c.subcategories)) e.subcategories = 'Subcategorías inválidas.';
    else if (c.subcategories.some(s => typeof s !== 'string' || !s.trim() || s.length > 40)) e.subcategories = 'Hay subcategorías vacías o demasiado largas.';
    if (!e.name && existing && existing.some(x => x.id !== c.id && x.kind === c.kind && U.normalizeText(x.name) === U.normalizeText(c.name))) e.name = 'Ya existe una categoría con ese nombre.';
    return result(e);
  }

  function validateRecurring(r, ctx) {
    const e = {};
    checkText(e, 'name', r.name, 'El nombre', 60, true);
    if (!FREQUENCIES[r.frequency]) e.frequency = 'Frecuencia inválida.';
    checkDate(e, 'nextDate', r.nextDate, true);
    checkDate(e, 'endDate', r.endDate, false);
    if (r.endDate && r.nextDate && U.isValidDate(r.endDate) && r.endDate < r.nextDate) e.endDate = 'La fecha final es anterior al próximo pago.';
    // Reutiliza la validación de movimientos para el "molde"
    const tv = validateTransaction(Object.assign({}, r, { date: r.nextDate }), ctx);
    for (const k of ['type', 'amount', 'accountId', 'toAccountId', 'categoryId', 'investmentId', 'debtId']) if (tv.errors[k]) e[k] = tv.errors[k];
    return result(e);
  }

  function validateBudget(b, ctx, existing) {
    const e = {};
    if (!b.categoryId) e.categoryId = 'Elige una categoría.';
    else if (ctx) {
      const c = ctx.category(b.categoryId);
      if (!c) e.categoryId = 'La categoría no existe.';
      else if (c.kind !== 'expense') e.categoryId = 'Los presupuestos aplican a categorías de gasto.';
    }
    if (!e.categoryId && existing && existing.some(x => x.id !== b.id && x.categoryId === b.categoryId)) e.categoryId = 'Ya hay un presupuesto para esa categoría.';
    checkAmount(e, 'amount', b.amount, { positive: true });
    return result(e);
  }

  function validateGoal(g, ctx) {
    const e = {};
    checkText(e, 'name', g.name, 'El nombre', 60, true);
    if (!GOAL_KINDS[g.kind]) e.kind = 'Tipo de meta inválido.';
    checkAmount(e, 'targetAmount', g.targetAmount, { positive: true });
    checkAmount(e, 'manualAmount', g.manualAmount || 0, {});
    checkAmount(e, 'monthlyContribution', g.monthlyContribution || 0, {});
    checkDate(e, 'targetDate', g.targetDate, false);
    if (g.accountId && ctx && !ctx.account(g.accountId)) e.accountId = 'La cuenta no existe.';
    checkText(e, 'notes', g.notes, 'Las notas', 1000);
    return result(e);
  }

  function validateInvestment(i) {
    const e = {};
    checkText(e, 'name', i.name, 'El nombre', 60, true);
    if (!INVESTMENT_TYPES[i.type]) e.type = 'Tipo inválido.';
    checkAmount(e, 'openingContributed', i.openingContributed, {});
    checkDate(e, 'startDate', i.startDate, true);
    if (!Array.isArray(i.valuations)) e.valuations = 'Valoraciones inválidas.';
    else for (const v of i.valuations) {
      if (!U.isValidDate(v.date) || typeof v.value !== 'number' || !Number.isFinite(v.value) || v.value < 0 || v.value > MAX_AMOUNT) { e.valuations = 'Hay una valoración inválida.'; break; }
    }
    checkText(e, 'notes', i.notes, 'Las notas', 1000);
    return result(e);
  }

  function validateDebt(d) {
    const e = {};
    checkText(e, 'name', d.name, 'El nombre', 60, true);
    checkText(e, 'counterparty', d.counterparty, d.direction === 'receivable' ? 'La persona' : 'El acreedor', 60, false);
    if (d.direction !== 'payable' && d.direction !== 'receivable') e.direction = 'Dirección inválida.';
    if (!DEBT_KINDS[d.kind]) e.kind = 'Tipo inválido.';
    checkAmount(e, 'principal', d.principal, {});
    checkAmount(e, 'openingBalance', d.openingBalance, {});
    checkAmount(e, 'monthlyPayment', d.monthlyPayment || 0, {});
    if (d.interestRate !== null && d.interestRate !== undefined && d.interestRate !== '') {
      if (typeof d.interestRate !== 'number' || !Number.isFinite(d.interestRate) || d.interestRate < 0 || d.interestRate > 1000) e.interestRate = 'Tasa inválida (0 a 1000% anual).';
    }
    checkDate(e, 'startDate', d.startDate, true);
    checkDate(e, 'endDate', d.endDate, false);
    if (d.dueDay !== null && d.dueDay !== undefined && d.dueDay !== '' && (!Number.isInteger(d.dueDay) || d.dueDay < 1 || d.dueDay > 31)) e.dueDay = 'Día entre 1 y 31.';
    return result(e);
  }

  function validateAsset(a) {
    const e = {};
    checkText(e, 'name', a.name, 'El nombre', 60, true);
    if (!ASSET_KINDS[a.kind]) e.kind = 'Tipo inválido.';
    if (!Array.isArray(a.valuations) || !a.valuations.length) e.valuations = 'Registra al menos un valor.';
    else for (const v of a.valuations) {
      if (!U.isValidDate(v.date) || typeof v.value !== 'number' || !Number.isFinite(v.value) || v.value < 0 || v.value > MAX_AMOUNT) { e.valuations = 'Hay un valor inválido.'; break; }
    }
    return result(e);
  }

  const VALIDATORS = {
    accounts: validateAccount, categories: validateCategory, transactions: validateTransaction,
    recurring: validateRecurring, budgets: validateBudget, goals: validateGoal,
    investments: validateInvestment, debts: validateDebt, assets: validateAsset
  };

  F.schema = {
    SCHEMA_VERSION, MAX_AMOUNT, STORES, TX_TYPES, ACCOUNT_TYPES, ACCOUNT_PURPOSES, PAYMENT_METHODS, PERSONS, NATURES,
    FREQUENCIES, INVESTMENT_TYPES, DEBT_KINDS, GOAL_KINDS, ASSET_KINDS, DEFAULT_CATEGORIES, EXPENSE_GROUPS,
    FALLBACK_EXPENSE_CATEGORY, FALLBACK_INCOME_CATEGORY, INTEREST_CATEGORY, DEFAULT_SETTINGS,
    validateTransaction, validateAccount, validateCategory, validateRecurring, validateBudget, validateGoal,
    validateInvestment, validateDebt, validateAsset, VALIDATORS
  };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
