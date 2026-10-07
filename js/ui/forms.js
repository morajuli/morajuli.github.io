/* =========================================================================
 * ui/forms.js — Formularios de entidades (cuentas, categorías, metas,
 * presupuestos, inversiones, deudas, recurrentes, otros activos).
 * Un constructor genérico + definiciones por entidad.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, L = F.ledger, St = F.Store, ui = F.ui;
  const esc = U.escapeHTML;

  /**
   * fields: [{ name, label, type: text|amount|date|select|number|textarea|checkbox|color|tags, options, hint, required, show(values) }]
   */
  function entityForm(o) {
    const values = Object.assign({}, o.values || {});
    const m = ui.modal({
      title: o.title, size: o.size || 'sheet', body: '<form class="ef" novalidate></form>',
      footer: (o.onDelete ? '<button type="button" class="btn ghost danger-text" data-del>' + ui.icon('trash') + (o.deleteLabel || 'Eliminar') + '</button>' : '<span></span>') +
        '<button type="button" class="btn primary" data-save>' + esc(o.saveLabel || 'Guardar') + '</button>'
    });
    const form = m.el.querySelector('form');
    function fieldHTML(f) {
      if (f.show && !f.show(values)) return '';
      const v = values[f.name];
      const hint = f.hint ? '<span class="hint">' + (typeof f.hint === 'function' ? f.hint(values) : esc(f.hint)) + '</span>' : '';
      const lbl = '<span class="lbl">' + esc(f.label) + (f.optional ? ' <em>opcional</em>' : '') + '</span>';
      let input;
      switch (f.type) {
        case 'amount': input = '<input name="' + f.name + '" inputmode="decimal" autocomplete="off" value="' + esc(v === undefined || v === null || v === '' ? '' : ui.amountValue(v)) + '" placeholder="0" data-amount>'; break;
        case 'date': input = '<input type="date" name="' + f.name + '" value="' + esc(v || '') + '" min="1900-01-01" max="2100-12-31">'; break;
        case 'select': input = '<select name="' + f.name + '">' + ui.options(typeof f.options === 'function' ? f.options(values) : f.options, v, f.placeholder) + '</select>'; break;
        case 'number': input = '<input type="number" name="' + f.name + '" value="' + esc(v === undefined || v === null ? '' : v) + '" step="' + (f.step || 'any') + '" min="' + (f.min !== undefined ? f.min : '') + '" max="' + (f.max !== undefined ? f.max : '') + '" inputmode="decimal">'; break;
        case 'textarea': input = '<textarea name="' + f.name + '" rows="2" maxlength="' + (f.max || 1000) + '">' + esc(v || '') + '</textarea>'; break;
        case 'color': input = '<input type="color" name="' + f.name + '" value="' + esc(v || '#5b7083') + '">'; break;
        case 'checkbox': return '<label class="switch" data-field="' + f.name + '"><input type="checkbox" name="' + f.name + '"' + (v ? ' checked' : '') + '><span>' + esc(f.label) + '</span></label>' + hint;
        default: input = '<input name="' + f.name + '" value="' + esc(v === undefined || v === null ? '' : v) + '" maxlength="' + (f.max || 60) + '" autocomplete="off"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>';
      }
      return '<label class="field' + (f.wide ? ' wide' : '') + '" data-field="' + f.name + '">' + lbl + input + hint + '</label>';
    }
    function render() {
      form.innerHTML = (o.intro ? '<p class="form-intro">' + o.intro + '</p>' : '') + '<div class="ef-grid">' + o.fields.map(fieldHTML).join('') + '</div><div class="form-errors"></div>';
      form.querySelectorAll('[data-amount]').forEach(i => ui.bindAmountInput(i));
      form.querySelectorAll('select, input[type=checkbox]').forEach(el => el.addEventListener('change', () => { read(); render(); }));
      form.addEventListener('submit', e => { e.preventDefault(); save(); });
    }
    function read() {
      for (const f of o.fields) {
        const el = form.querySelector('[name="' + f.name + '"]');
        if (!el) continue;
        if (f.type === 'checkbox') values[f.name] = el.checked;
        else if (f.type === 'amount') values[f.name] = el.value.trim() === '' ? (f.emptyAs !== undefined ? f.emptyAs : '') : U.parseAmount(el.value);
        else if (f.type === 'number') values[f.name] = el.value.trim() === '' ? (f.emptyAs !== undefined ? f.emptyAs : null) : Number(el.value);
        else values[f.name] = el.value;
      }
      return values;
    }
    let busy = false;
    async function save() {
      if (busy) return;
      read();
      busy = true;
      try {
        const res = await o.onSave(Object.assign({}, values));
        m.close();
        if (o.onDone) o.onDone(res);
      } catch (e) {
        if (e && e.errors && Object.keys(e.errors).length) ui.showErrors(form, e.errors);
        else ui.showErrors(form, { _: (e && e.message) || 'No se pudo guardar.' }) || ui.toast((e && e.message) || 'No se pudo guardar.', { type: 'error' });
        const fe = form.querySelector('.form-errors');
        if (e && e.message && fe && (!e.errors || !Object.keys(e.errors).length)) fe.innerHTML = '<p class="field-error">' + esc(e.message) + '</p>';
      } finally { busy = false; }
    }
    render();
    m.el.querySelector('[data-save]').addEventListener('click', save);
    const del = m.el.querySelector('[data-del]');
    if (del) del.addEventListener('click', async () => { if (await o.onDelete()) m.close(); });
    return m;
  }

  async function confirmDelete(what, extra) {
    return ui.confirmDialog({ title: 'Eliminar ' + what, html: '<p>¿Eliminar ' + esc(what) + '? Esta acción no se puede deshacer.</p>' + (extra || ''), confirmText: 'Eliminar', danger: true });
  }
  async function tryRemove(store, id, opts) {
    try { await St.remove(store, id, opts); ui.toast('Eliminado'); return true; }
    catch (e) { ui.toast(e.message, { type: 'error', timeout: 6000 }); return false; }
  }

  // ------------------------- Cuenta -------------------------
  function account(acc, onDone) {
    const isNew = !acc;
    const v = acc ? Object.assign({}, acc) : { type: 'bank', currency: U.getBaseCurrency(), initialBalance: 0, openedAt: U.today(), purpose: '' };
    if (v.type === 'credit_card') v.initialBalance = Math.abs(v.initialBalance || 0);
    return entityForm({
      title: isNew ? 'Nueva cuenta' : 'Editar cuenta', values: v,
      intro: isNew ? 'El saldo actual se calcula solo: saldo inicial + movimientos registrados.' : '',
      fields: [
        { name: 'name', label: 'Nombre', placeholder: 'Ej. Bancolombia, Nequi, Efectivo', required: true },
        { name: 'type', label: 'Tipo', type: 'select', options: Object.fromEntries(Object.entries(S.ACCOUNT_TYPES).map(([k, x]) => [k, x.label])) },
        { name: 'purpose', label: 'Se cuenta como', type: 'select', options: vals => Object.assign({ '': 'Automático (' + S.ACCOUNT_PURPOSES[(S.ACCOUNT_TYPES[vals.type] || {}).purpose || 'spending'] + ')' }, S.ACCOUNT_PURPOSES), hint: 'Define si el saldo suma a disponible, ahorro o inversión en el dashboard.', show: vals => vals.type !== 'credit_card' && vals.type !== 'cash' },
        { name: 'initialBalance', label: 'Saldo inicial', type: 'amount', emptyAs: 0, hint: vals => vals.type === 'credit_card' ? 'Lo que debías en la tarjeta en la fecha de apertura.' : 'Saldo en la fecha de apertura (antes de los movimientos que registres).', show: vals => true },
        { name: 'currency', label: 'Moneda', type: 'select', options: Object.fromEntries(Object.entries(U.CURRENCIES).map(([k, c]) => [k, k + ' · ' + c.name])), hint: 'Sin conversión automática: las cuentas en otra moneda no se suman al patrimonio.' },
        { name: 'openedAt', label: 'Fecha de apertura', type: 'date' },
        { name: 'notes', label: 'Notas', type: 'textarea', optional: true },
        { name: 'archived', label: 'Archivada (oculta en formularios, conserva el histórico)', type: 'checkbox', show: () => !isNew }
      ],
      onSave: vals => {
        const rec = Object.assign({}, acc || {}, vals);
        rec.name = String(rec.name || '').trim();
        if (rec.type === 'credit_card') { rec.initialBalance = -Math.abs(U.num(rec.initialBalance)); rec.purpose = 'spending'; }
        else if (typeof rec.initialBalance === 'number' && rec.initialBalance < 0) throw new F.ValidationError({ initialBalance: 'El saldo inicial no puede ser negativo (usa el tipo Tarjeta de crédito para deudas).' });
        if (!rec.purpose) delete rec.purpose;
        return St.save('accounts', rec);
      },
      onDone: onDone,
      onDelete: isNew ? null : async () => {
        const u = St.usages('accounts', acc.id);
        if (u.transactions || u.recurring) { ui.toast('La cuenta tiene ' + u.transactions + ' movimiento(s). Puedes archivarla para ocultarla sin perder el histórico.', { type: 'error', timeout: 7000 }); return false; }
        return (await confirmDelete('la cuenta «' + acc.name + '»')) && tryRemove('accounts', acc.id);
      }
    });
  }

  // ------------------------- Categoría -------------------------
  function category(cat, kind, onDone) {
    const isNew = !cat;
    const v = cat ? Object.assign({}, cat, { subs: (cat.subcategories || []).join(', ') }) : { kind: kind || 'expense', group: kind === 'income' ? 'Ingresos' : 'Otros', nature: 'variable', color: '#5b7083', subs: '' };
    return entityForm({
      title: isNew ? 'Nueva categoría' : 'Editar categoría', values: v,
      fields: [
        { name: 'name', label: 'Nombre' },
        { name: 'kind', label: 'Tipo', type: 'select', options: { expense: 'Gasto', income: 'Ingreso' }, show: () => isNew },
        { name: 'group', label: 'Grupo', type: 'select', options: vals => vals.kind === 'income' ? ['Ingresos'] : S.EXPENSE_GROUPS },
        { name: 'nature', label: 'Normalmente es', type: 'select', options: S.NATURES, show: vals => vals.kind === 'expense', hint: 'Valor por defecto al registrar; se puede cambiar en cada gasto.' },
        { name: 'subs', label: 'Subcategorías', type: 'textarea', optional: true, hint: 'Separadas por coma. Ej: Mercado, Restaurante, Domicilios' },
        { name: 'color', label: 'Color', type: 'color' }
      ],
      onSave: vals => {
        const subs = [...new Set(String(vals.subs || '').split(',').map(s => s.trim()).filter(Boolean))];
        const rec = Object.assign({}, cat || {}, { name: String(vals.name || '').trim(), kind: vals.kind, group: vals.kind === 'income' ? 'Ingresos' : vals.group, nature: vals.nature || 'variable', subcategories: subs, color: vals.color });
        return St.save('categories', rec);
      },
      onDone,
      onDelete: isNew ? null : async () => deleteCategory(cat)
    });
  }
  async function deleteCategory(cat) {
    const u = St.usages('categories', cat.id);
    if (!u.transactions && !u.recurring) return (await confirmDelete('la categoría «' + cat.name + '»', u.budgets ? '<p>También se eliminará su presupuesto.</p>' : '')) && tryRemove('categories', cat.id);
    const others = St.all('categories').filter(c => c.kind === cat.kind && c.id !== cat.id);
    return new Promise(resolve => {
      const m = ui.modal({
        title: 'Eliminar «' + cat.name + '»', size: 'small',
        body: '<p>Esta categoría tiene ' + u.transactions + ' movimiento(s)' + (u.recurring ? ' y ' + u.recurring + ' recurrente(s)' : '') + '. Para no perder el histórico, se moverán a otra categoría.</p>' +
          '<label class="field"><span class="lbl">Mover a</span><select data-rep>' + ui.options(others.map(c => ({ value: c.id, label: c.name })), cat.kind === 'income' ? S.FALLBACK_INCOME_CATEGORY : S.FALLBACK_EXPENSE_CATEGORY) + '</select></label>',
        footer: '<button class="btn ghost" data-close>Cancelar</button><button class="btn danger" data-go>Mover y eliminar</button>',
        onClose: () => resolve(false)
      });
      m.el.querySelector('[data-go]').addEventListener('click', async () => {
        const ok = await tryRemove('categories', cat.id, { replacementCategoryId: m.el.querySelector('[data-rep]').value });
        resolve(ok); m.close();
      });
    });
  }

  // ------------------------- Presupuesto -------------------------
  function budget(b, onDone) {
    const isNew = !b;
    const used = new Set(St.all('budgets').map(x => x.categoryId));
    const cats = St.all('categories').filter(c => c.kind === 'expense' && (!used.has(c.id) || (b && b.categoryId === c.id)));
    return entityForm({
      title: isNew ? 'Nuevo presupuesto' : 'Editar presupuesto', size: 'small', values: b ? Object.assign({}, b) : {},
      fields: [
        { name: 'categoryId', label: 'Categoría', type: 'select', options: cats.map(c => ({ value: c.id, label: c.name })), placeholder: 'Elige…' },
        { name: 'amount', label: 'Límite mensual', type: 'amount' }
      ],
      onSave: vals => St.save('budgets', Object.assign({}, b || {}, vals)), onDone,
      onDelete: isNew ? null : async () => (await confirmDelete('este presupuesto')) && tryRemove('budgets', b.id)
    });
  }

  // ------------------------- Meta -------------------------
  function goal(g, onDone, preset) {
    const isNew = !g;
    const accs = St.all('accounts').filter(a => !a.archived || (g && g.accountId === a.id));
    const v = g ? Object.assign({}, g) : Object.assign({ kind: 'custom', manualAmount: 0, monthlyContribution: 0, accountId: '' }, preset || {});
    return entityForm({
      title: isNew ? 'Nueva meta' : 'Editar meta', values: v,
      fields: [
        { name: 'kind', label: 'Tipo de meta', type: 'select', options: S.GOAL_KINDS },
        { name: 'name', label: 'Nombre', placeholder: 'Ej. Fondo de emergencia' },
        { name: 'targetAmount', label: 'Valor objetivo', type: 'amount' },
        { name: 'accountId', label: '¿Dónde está el dinero?', type: 'select', options: [{ value: '', label: 'Lo registro manualmente' }].concat(accs.map(a => ({ value: a.id, label: 'Saldo de ' + a.name }))), hint: 'Si eliges una cuenta, el avance es su saldo actual.' },
        { name: 'manualAmount', label: 'Valor actual ahorrado', type: 'amount', emptyAs: 0, show: vals => !vals.accountId, hint: 'Los movimientos de Ahorro asociados a esta meta se suman automáticamente.' },
        { name: 'targetDate', label: 'Fecha objetivo', type: 'date', optional: true },
        { name: 'monthlyContribution', label: 'Aporte mensual deseado', type: 'amount', emptyAs: 0, optional: true },
        { name: 'notes', label: 'Notas', type: 'textarea', optional: true },
        { name: 'archived', label: 'Archivada', type: 'checkbox', show: () => !isNew }
      ],
      onSave: vals => {
        const rec = Object.assign({}, g || {}, vals);
        rec.name = String(rec.name || '').trim() || S.GOAL_KINDS[rec.kind];
        rec.accountId = rec.accountId || null; rec.targetDate = rec.targetDate || null;
        return St.save('goals', rec);
      },
      onDone,
      onDelete: isNew ? null : async () => (await confirmDelete('la meta «' + g.name + '»', '<p>Los movimientos asociados se conservan.</p>')) && tryRemove('goals', g.id)
    });
  }

  // ------------------------- Inversión -------------------------
  function investment(inv, onDone) {
    const isNew = !inv;
    const v = inv ? Object.assign({}, inv) : { type: 'etf', startDate: U.today(), openingContributed: 0, openingValue: '' };
    return entityForm({
      title: isNew ? 'Nueva inversión' : 'Editar inversión', values: v,
      intro: isNew ? 'Si ya tenías esta inversión, registra el capital aportado hasta hoy y su valor actual. Los aportes futuros regístralos como movimientos de tipo Inversión (salen de una cuenta).' : '',
      fields: [
        { name: 'name', label: 'Nombre', placeholder: 'Ej. ETF S&P 500, CDT 90 días' },
        { name: 'type', label: 'Tipo', type: 'select', options: S.INVESTMENT_TYPES },
        { name: 'startDate', label: 'Fecha de inicio', type: 'date' },
        { name: 'openingContributed', label: 'Capital aportado antes de usar la app', type: 'amount', emptyAs: 0, show: () => isNew, hint: 'Deja 0 si vas a registrar el primer aporte como movimiento.' },
        { name: 'openingValue', label: 'Valor actual', type: 'amount', show: vals => isNew && U.num(vals.openingContributed) > 0, hint: 'Si lo dejas vacío, se usa el capital aportado.' },
        { name: 'notes', label: 'Notas', type: 'textarea', optional: true, hint: 'Ej. tasa, plataforma, fecha de vencimiento.' },
        { name: 'closed', label: 'Inversión cerrada (liquidada)', type: 'checkbox', show: () => !isNew }
      ],
      onSave: vals => {
        const rec = Object.assign({}, inv || {}, { name: String(vals.name || '').trim(), type: vals.type, startDate: vals.startDate, notes: vals.notes || '', closed: !!vals.closed });
        if (isNew) {
          rec.openingContributed = U.num(vals.openingContributed);
          const val = vals.openingValue === '' || vals.openingValue === undefined ? rec.openingContributed : vals.openingValue;
          rec.valuations = rec.openingContributed > 0 || U.num(val) > 0 ? [{ date: vals.startDate && vals.startDate < U.today() ? U.today() : vals.startDate, value: U.num(val), at: new Date().toISOString() }] : [];
          if (rec.openingContributed > 0 && vals.startDate && vals.startDate < U.today()) rec.valuations.unshift({ date: vals.startDate, value: rec.openingContributed, at: new Date(0).toISOString() });
          if (typeof val === 'number' && !Number.isFinite(val)) throw new F.ValidationError({ openingValue: 'Escribe un número válido.' });
        }
        return St.save('investments', rec);
      },
      onDone,
      onDelete: isNew ? null : async () => {
        const u = St.usages('investments', inv.id);
        if (!u.transactions) return (await confirmDelete('la inversión «' + inv.name + '»')) && tryRemove('investments', inv.id);
        const ok = await ui.confirmDialog({ title: 'Eliminar inversión', html: '<p>«' + esc(inv.name) + '» tiene ' + u.transactions + ' movimiento(s) asociados (aportes/retiros). Se eliminarán también y los saldos de tus cuentas se recalcularán.</p><p>Si ya la liquidaste, márcala como cerrada para conservar el histórico.</p>', confirmText: 'Eliminar todo', danger: true, typeToConfirm: 'ELIMINAR' });
        return ok && tryRemove('investments', inv.id, { cascade: true });
      }
    });
  }

  /** Actualizar valor de mercado (valoración manual). */
  function valuation(inv, onDone) {
    const cur = L.investmentValueAt(St, inv, U.today());
    return entityForm({
      title: 'Actualizar valor · ' + inv.name, size: 'small', values: { date: U.today(), value: cur },
      intro: 'Escribe el valor que muestra hoy tu plataforma o extracto. La diferencia con lo aportado es tu ganancia o pérdida.',
      fields: [{ name: 'value', label: 'Valor actual', type: 'amount' }, { name: 'date', label: 'Fecha del valor', type: 'date' }],
      onSave: vals => {
        if (typeof vals.value !== 'number' || !Number.isFinite(vals.value) || vals.value < 0) throw new F.ValidationError({ value: 'Escribe un valor válido (0 o más).' });
        if (!U.isValidDate(vals.date)) throw new F.ValidationError({ date: 'Fecha inválida.' });
        if (vals.date > U.today()) throw new F.ValidationError({ date: 'La fecha no puede ser futura.' });
        const rec = Object.assign({}, inv, { valuations: (inv.valuations || []).filter(x => x.date !== vals.date).concat([{ date: vals.date, value: vals.value, at: new Date().toISOString() }]) });
        return St.save('investments', rec);
      }, onDone
    });
  }

  // ------------------------- Deuda / préstamo -------------------------
  function debt(d, direction, onDone) {
    const isNew = !d;
    const dir = d ? d.direction : (direction || 'payable');
    const v = d ? Object.assign({}, d) : { direction: dir, kind: dir === 'receivable' ? 'personal' : 'consumer', startDate: U.today(), openingBalance: '', principal: '', interestRate: '', monthlyPayment: '' };
    const receivable = dir === 'receivable';
    return entityForm({
      title: isNew ? (receivable ? 'Dinero que me deben' : 'Nueva deuda') : 'Editar ' + (receivable ? 'préstamo' : 'deuda'), values: v,
      intro: isNew ? (receivable ? 'Registra un préstamo que hiciste. Si el dinero sale hoy de una de tus cuentas, mejor usa el movimiento «Préstamo entregado».' : 'Registra una deuda existente con su saldo de hoy. Los pagos futuros regístralos como «Pago de deuda» para que el saldo baje solo.') : '',
      fields: [
        { name: 'name', label: 'Nombre', placeholder: receivable ? 'Ej. Préstamo a Andrés' : 'Ej. Tarjeta Visa, Crédito vehículo' },
        { name: 'counterparty', label: receivable ? 'Persona' : 'Acreedor', optional: true },
        { name: 'kind', label: 'Tipo', type: 'select', options: S.DEBT_KINDS },
        { name: 'principal', label: receivable ? 'Valor prestado' : 'Capital inicial (monto original)', type: 'amount', emptyAs: 0 },
        { name: 'openingBalance', label: 'Saldo pendiente a la fecha de registro', type: 'amount', emptyAs: 0, hint: 'Lo que falta por pagar hoy (o en la fecha de abajo).' },
        { name: 'startDate', label: 'Fecha del saldo', type: 'date' },
        { name: 'interestRate', label: 'Tasa de interés (% efectivo anual)', type: 'number', step: '0.01', min: 0, max: 1000, optional: true, show: () => !receivable, hint: 'Ej. 24 para 24% EA. Se usa para estimar intereses.' },
        { name: 'monthlyPayment', label: 'Cuota mensual', type: 'amount', emptyAs: 0, optional: true },
        { name: 'dueDay', label: 'Día de pago', type: 'number', min: 1, max: 31, step: 1, optional: true },
        { name: 'endDate', label: 'Fecha estimada de finalización', type: 'date', optional: true },
        { name: 'notes', label: 'Notas', type: 'textarea', optional: true },
        { name: 'archived', label: 'Archivada', type: 'checkbox', show: () => !isNew }
      ],
      onSave: vals => {
        const rec = Object.assign({}, d || {}, vals, { direction: dir });
        rec.name = String(rec.name || '').trim();
        rec.interestRate = vals.interestRate === null || vals.interestRate === '' || vals.interestRate === undefined ? 0 : vals.interestRate;
        rec.dueDay = vals.dueDay === null || vals.dueDay === '' ? null : vals.dueDay;
        rec.endDate = vals.endDate || null;
        if (!rec.principal && rec.openingBalance) rec.principal = rec.openingBalance;
        return St.save('debts', rec);
      },
      onDone,
      onDelete: isNew ? null : async () => {
        const u = St.usages('debts', d.id);
        if (!u.transactions) return (await confirmDelete('«' + d.name + '»')) && tryRemove('debts', d.id);
        const ok = await ui.confirmDialog({ title: 'Eliminar', html: '<p>«' + esc(d.name) + '» tiene ' + u.transactions + ' movimiento(s) asociados. Se eliminarán también y los saldos se recalcularán. Si ya está pagada, puedes archivarla.</p>', confirmText: 'Eliminar todo', danger: true, typeToConfirm: 'ELIMINAR' });
        return ok && tryRemove('debts', d.id, { cascade: true });
      }
    });
  }

  // ------------------------- Recurrente -------------------------
  function recurring(r, onDone, preset) {
    const isNew = !r;
    const accs = St.all('accounts').filter(a => !a.archived || (r && (r.accountId === a.id || r.toAccountId === a.id)));
    const accOpts = accs.map(a => ({ value: a.id, label: a.name }));
    const v = r ? Object.assign({}, r) : Object.assign({ type: 'expense', frequency: 'monthly', nextDate: U.today(), active: true, autoConfirm: false, isSubscription: false }, preset || {});
    return entityForm({
      title: isNew ? (v.isSubscription ? 'Nueva suscripción' : 'Nuevo recurrente') : 'Editar recurrente', values: v,
      intro: 'Al abrir la app, los pagos vencidos aparecen como pendientes para confirmar, o se registran solos si activas el registro automático.',
      fields: [
        { name: 'name', label: 'Nombre', placeholder: 'Ej. Netflix, Arriendo, Salario' },
        { name: 'type', label: 'Tipo', type: 'select', options: { expense: 'Gasto', income: 'Ingreso', saving: 'Ahorro', investment: 'Inversión', transfer: 'Transferencia', debt_payment: 'Pago de deuda' } },
        { name: 'amount', label: 'Valor', type: 'amount' },
        { name: 'frequency', label: 'Frecuencia', type: 'select', options: Object.fromEntries(Object.entries(S.FREQUENCIES).map(([k, x]) => [k, x.label])) },
        { name: 'nextDate', label: 'Próximo pago', type: 'date' },
        { name: 'accountId', label: vals => 'Cuenta', type: 'select', options: accOpts, placeholder: 'Elige…' },
        { name: 'toAccountId', label: 'Hacia la cuenta', type: 'select', options: accOpts, placeholder: 'Elige…', show: vals => vals.type === 'saving' || vals.type === 'transfer' },
        { name: 'categoryId', label: 'Categoría', type: 'select', options: vals => St.all('categories').filter(c => c.kind === vals.type).map(c => ({ value: c.id, label: c.name })), placeholder: 'Elige…', show: vals => vals.type === 'expense' || vals.type === 'income' },
        { name: 'nature', label: 'Tipo de gasto', type: 'select', options: S.NATURES, show: vals => vals.type === 'expense' },
        { name: 'investmentId', label: 'Inversión', type: 'select', options: () => St.all('investments').map(i => ({ value: i.id, label: i.name })), placeholder: 'Elige…', show: vals => vals.type === 'investment' },
        { name: 'debtId', label: 'Deuda', type: 'select', options: () => St.all('debts').map(d => ({ value: d.id, label: d.name })), placeholder: 'Elige…', show: vals => vals.type === 'debt_payment' },
        { name: 'goalId', label: 'Meta', type: 'select', options: () => St.all('goals').map(g => ({ value: g.id, label: g.name })), placeholder: 'Sin meta', optional: true, show: vals => vals.type === 'saving' },
        { name: 'endDate', label: 'Termina el', type: 'date', optional: true },
        { name: 'isSubscription', label: 'Es una suscripción', type: 'checkbox', show: vals => vals.type === 'expense' },
        { name: 'autoConfirm', label: 'Registrar automáticamente al abrir la app', type: 'checkbox' },
        { name: 'active', label: 'Activo', type: 'checkbox' }
      ].map(f => typeof f.label === 'function' ? Object.assign(f, { label: 'Cuenta' }) : f),
      onSave: vals => {
        const rec = Object.assign({}, r || {}, vals);
        rec.name = String(rec.name || '').trim();
        for (const k of ['toAccountId', 'categoryId', 'investmentId', 'debtId', 'goalId', 'endDate']) rec[k] = rec[k] || null;
        if (rec.type !== 'saving' && rec.type !== 'transfer') rec.toAccountId = null;
        if (rec.type !== 'expense') { rec.isSubscription = false; rec.nature = undefined; }
        if (!rec.description) rec.description = rec.name;
        if (isNew || !r.anchorDay || (r && r.nextDate !== rec.nextDate)) rec.anchorDay = Number(String(rec.nextDate || '').slice(8, 10)) || 1;
        if (isNew) rec.startDate = rec.nextDate;
        return St.save('recurring', rec);
      },
      onDone,
      onDelete: isNew ? null : async () => (await confirmDelete('«' + r.name + '»', '<p>Los movimientos ya registrados se conservan.</p>')) && tryRemove('recurring', r.id)
    });
  }

  // ------------------------- Otro activo / pasivo -------------------------
  function asset(a, onDone) {
    const isNew = !a;
    const last = a ? L.sortedValuations(a).slice(-1)[0] : null;
    const v = a ? Object.assign({}, a, { value: last ? last.value : 0, date: U.today() }) : { kind: 'property', date: U.today() };
    return entityForm({
      title: isNew ? 'Nuevo activo o pasivo' : 'Actualizar «' + a.name + '»', values: v,
      intro: 'Bienes y obligaciones que no son cuentas: vivienda, vehículo, objetos de valor, otros pasivos. El valor lo actualizas tú.',
      fields: [
        { name: 'name', label: 'Nombre', placeholder: 'Ej. Apartamento, Moto' },
        { name: 'kind', label: 'Tipo', type: 'select', options: S.ASSET_KINDS },
        { name: 'value', label: 'Valor estimado', type: 'amount' },
        { name: 'date', label: 'Fecha del valor', type: 'date' },
        { name: 'notes', label: 'Notas', type: 'textarea', optional: true }
      ],
      onSave: vals => {
        if (typeof vals.value !== 'number' || !Number.isFinite(vals.value)) throw new F.ValidationError({ value: 'Escribe un valor válido.' });
        if (!U.isValidDate(vals.date)) throw new F.ValidationError({ date: 'Fecha inválida.' });
        const vals0 = (a && a.valuations) || [];
        const rec = Object.assign({}, a || {}, { name: String(vals.name || '').trim(), kind: vals.kind, notes: vals.notes || '', valuations: vals0.filter(x => x.date !== vals.date).concat([{ date: vals.date, value: vals.value }]) });
        return St.save('assets', rec);
      },
      onDone,
      onDelete: isNew ? null : async () => (await confirmDelete('«' + a.name + '»')) && tryRemove('assets', a.id)
    });
  }

  F.forms = { entityForm, account, category, deleteCategory, budget, goal, investment, valuation, debt, recurring, asset };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
