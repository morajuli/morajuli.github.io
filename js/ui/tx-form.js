/* =========================================================================
 * ui/tx-form.js — Registro rápido de movimientos.
 * Flujo pensado para el celular: Valor → Categoría → Cuenta → Guardar.
 * Todo lo demás (fecha, etiquetas, notas, recurrencia…) es opcional.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, L = F.ledger, St = F.Store, ui = F.ui;
  const esc = U.escapeHTML;

  const PRIMARY = ['expense', 'income', 'transfer', 'saving', 'investment'];
  const SECONDARY = ['debt_payment', 'loan_received', 'loan_given', 'investment_withdrawal'];

  function activeAccounts(currentIds) {
    return L.accountsWithBalance(St).filter(a => !a.archived || (currentIds || []).includes(a.id));
  }
  /** Cuentas ordenadas por uso reciente para un tipo de movimiento. */
  function accountsByUsage(type, currentIds) {
    const since = U.addDays(U.today(), -120);
    const count = new Map();
    for (const t of St.all('transactions')) if (t.date >= since && t.type === type) count.set(t.accountId, (count.get(t.accountId) || 0) + 1);
    return activeAccounts(currentIds).sort((a, b) => (count.get(b.id) || 0) - (count.get(a.id) || 0));
  }
  function categoriesByUsage(kind) {
    const since = U.addDays(U.today(), -180);
    const count = new Map();
    for (const t of St.all('transactions')) if (t.date >= since && t.type === kind && t.categoryId) count.set(t.categoryId, (count.get(t.categoryId) || 0) + 1);
    // Sin historial: orden por uso típico; Ahorro/Inversiones al final (tienen tipo propio)
    const PRIORITY = ['cat_alimentacion', 'cat_transporte', 'cat_restaurantes', 'cat_vivienda', 'cat_servicios', 'cat_compras', 'cat_entretenimiento', 'cat_salud', 'cat_suscripciones',
      'cat_salario', 'cat_freelance', 'cat_honorarios', 'cat_bonificaciones', 'cat_rendimientos', 'cat_intereses'];
    const rank = c => { const i = PRIORITY.indexOf(c.id); return i < 0 ? (c.id === 'cat_ahorro' || c.id === 'cat_inversiones' ? 999 : 100) : i; };
    return St.all('categories').filter(c => c.kind === kind && !c.archived)
      .sort((a, b) => (count.get(b.id) || 0) - (count.get(a.id) || 0) || rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  function chip(name, value, label, selected, extra) {
    return '<button type="button" class="chip' + (selected ? ' on' : '') + '" data-chip="' + name + '" data-value="' + esc(value) + '"' + (extra || '') + '>' + label + '</button>';
  }

  /**
   * Abre el formulario. opts: { type, tx (para editar), preset (valores iniciales) }
   */
  function open(opts) {
    opts = opts || {};
    const editing = !!(opts.tx && opts.tx.id && St.get('transactions', opts.tx.id));
    const st = St.settings();
    const last = st.lastUsed || {};
    const base = Object.assign({
      type: opts.type || 'expense', date: U.today(), amount: '', accountId: '', toAccountId: '', categoryId: '', subcategory: '',
      description: '', paymentMethod: '', tags: [], notes: '', nature: '', person: 'personal', recurring: false,
      investmentId: '', debtId: '', goalId: '', interestAmount: ''
    }, opts.preset || {}, opts.tx || {});
    const state = U.deepClone(base);
    state.showMore = !!(editing && (state.notes || (state.tags || []).length || state.paymentMethod || state.person !== 'personal'));
    if (!state.accountId) state.accountId = last[state.type] || last.expense || '';
    if (state.accountId && !St.get('accounts', state.accountId)) state.accountId = '';
    if (!state.accountId) { const first = accountsByUsage(state.type).find(a => a.type !== 'credit_card' || state.type === 'expense'); if (first) state.accountId = first.id; }

    const m = ui.modal({
      title: editing ? 'Editar movimiento' : 'Registrar movimiento', size: 'sheet tx-sheet', body: '<form class="txf" novalidate></form>',
      footer: (editing ? '<button type="button" class="btn ghost danger-text" data-del>' + ui.icon('trash') + 'Eliminar</button>' : '<button type="button" class="btn ghost" data-again>Guardar y registrar otro</button>') +
        '<button type="button" class="btn primary" data-save>' + (editing ? 'Guardar cambios' : 'Guardar') + '</button>',
      noAutofocus: true
    });
    const form = m.el.querySelector('form');

    function render(focusAmount) {
      const t = state.type;
      const cur = (St.get('accounts', state.accountId) || {}).currency || U.getBaseCurrency();
      const curSym = U.CURRENCIES[cur].symbol;
      let h = '';
      // Tipo
      h += '<div class="type-tabs" role="tablist">' + PRIMARY.map(k => '<button type="button" role="tab" class="type-tab t-' + S.TX_TYPES[k].color + (t === k ? ' on' : '') + '" data-type="' + k + '">' + S.TX_TYPES[k].short + '</button>').join('') +
        '<select class="type-more' + (SECONDARY.includes(t) ? ' on' : '') + '" data-type-select aria-label="Otros tipos">' + '<option value="">Más…</option>' + SECONDARY.map(k => '<option value="' + k + '"' + (t === k ? ' selected' : '') + '>' + S.TX_TYPES[k].label + '</option>').join('') + '</select></div>';
      // Valor
      h += '<label class="amount-field t-' + S.TX_TYPES[t].color + '" data-field="amount"><span class="sym">' + esc(curSym) + '</span>' +
        '<input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="' + esc(state.amount === '' ? '' : ui.amountValue(state.amount)) + '" aria-label="Valor"></label>';

      // Categoría (ingreso / gasto)
      if (t === 'income' || t === 'expense') {
        const cats = categoriesByUsage(t);
        const top = cats.slice(0, 8);
        if (state.categoryId && !top.find(c => c.id === state.categoryId)) { const c = St.get('categories', state.categoryId); if (c) top.unshift(c); }
        h += '<div class="field" data-field="categoryId"><span class="lbl">Categoría</span><div class="chips">' +
          top.map(c => chip('categoryId', c.id, '<i class="dot" style="background:' + esc(c.color || '#888') + '"></i>' + esc(c.name), c.id === state.categoryId)).join('') +
          '<select class="chip-select" data-cat-all aria-label="Todas las categorías">' + '<option value="">Todas…</option>' + groupedCategoryOptions(t, state.categoryId) + '</select></div></div>';
        const cat = St.get('categories', state.categoryId);
        if (cat && cat.subcategories && cat.subcategories.length) {
          h += '<div class="field sub"><span class="lbl">Subcategoría <em>opcional</em></span><div class="chips small">' + cat.subcategories.map(s => chip('subcategory', s, esc(s), s === state.subcategory)).join('') + '</div></div>';
        }
      }
      // Cuentas
      const accLabel = { income: 'Cuenta que recibe', expense: 'Pagado con', transfer: 'Desde', saving: 'Desde', investment: 'Desde la cuenta', investment_withdrawal: 'Cuenta que recibe', debt_payment: 'Cuenta', loan_received: 'Cuenta que recibe', loan_given: 'Desde la cuenta' }[t];
      h += accountChips('accountId', accLabel, state.accountId, t);
      if (t === 'transfer' || t === 'saving') {
        let list = accountsByUsage('transfer', [state.toAccountId]).filter(a => a.id !== state.accountId);
        if (t === 'saving') list.sort((a, b) => (b.purposeResolved === 'savings') - (a.purposeResolved === 'savings'));
        h += accountChips('toAccountId', t === 'saving' ? 'Hacia (cuenta de ahorro)' : 'Hacia', state.toAccountId, t, list);
        if (t === 'saving') {
          const goals = St.all('goals').filter(g => !g.archived);
          if (goals.length) h += '<label class="field" data-field="goalId"><span class="lbl">Meta <em>opcional</em></span><select name="goalId">' + ui.options(goals.map(g => ({ value: g.id, label: g.name })), state.goalId, 'Sin meta') + '</select></label>';
        }
      }
      if (t === 'investment' || t === 'investment_withdrawal') {
        const invs = St.all('investments').filter(i => !i.closed || i.id === state.investmentId);
        h += '<label class="field" data-field="investmentId"><span class="lbl">Inversión</span><select name="investmentId">' + ui.options(invs.map(i => ({ value: i.id, label: i.name + ' · ' + S.INVESTMENT_TYPES[i.type] })), state.investmentId, invs.length ? 'Elige…' : 'Primero crea una inversión') + '</select>' +
          '<button type="button" class="link-btn" data-new-inv>+ Nueva inversión</button></label>';
      }
      if (t === 'debt_payment' || t === 'loan_received' || t === 'loan_given') {
        const dir = t === 'loan_received' ? 'payable' : t === 'loan_given' ? 'receivable' : null;
        const debts = St.all('debts').filter(d => (!dir || d.direction === dir) && (!d.archived || d.id === state.debtId));
        const opt = debts.map(d => ({ value: d.id, label: (d.direction === 'payable' ? 'Debo · ' : 'Me deben · ') + d.name + ' (' + U.money(L.debtBalanceAt(St, d, U.today())) + ')' }));
        if (t !== 'debt_payment') opt.push({ value: '__new', label: '+ Nuevo: ' + (t === 'loan_received' ? 'deuda / préstamo que recibo' : 'préstamo que hago') });
        h += '<label class="field" data-field="debtId"><span class="lbl">' + (t === 'debt_payment' ? 'Deuda o préstamo' : 'Asociar a') + '</span><select name="debtId">' + ui.options(opt, state.debtId, 'Elige…') + '</select></label>';
        if (state.debtId === '__new') {
          h += '<div class="grid2"><label class="field" data-field="newDebtName"><span class="lbl">Nombre</span><input name="newDebtName" value="' + esc(state.newDebtName || '') + '" placeholder="' + (t === 'loan_given' ? 'Préstamo a Ana' : 'Préstamo de mamá') + '"></label>' +
            '<label class="field"><span class="lbl">' + (t === 'loan_given' ? 'Persona' : 'Acreedor') + '</span><input name="newDebtWho" value="' + esc(state.newDebtWho || '') + '"></label></div>';
        }
        if (t === 'debt_payment') {
          const d = St.get('debts', state.debtId);
          h += '<label class="field" data-field="interestAmount"><span class="lbl">De ese pago, intereses <em>(se cuentan como ' + (d && d.direction === 'receivable' ? 'ingreso' : 'gasto') + ')</em></span>' +
            '<input name="interestAmount" inputmode="decimal" value="' + esc(state.interestAmount === '' || state.interestAmount === undefined ? '' : ui.amountValue(state.interestAmount)) + '" placeholder="0">' +
            '<span class="hint" data-principal-hint></span></label>';
        }
      }
      // Fecha rápida
      const t0 = U.today(), y0 = U.addDays(t0, -1);
      const isOther = state.date !== t0 && state.date !== y0;
      h += '<div class="field" data-field="date"><span class="lbl">Fecha</span><div class="chips">' + chip('date', t0, 'Hoy', state.date === t0) + chip('date', y0, 'Ayer', state.date === y0) +
        '<input type="date" name="date" class="date-chip' + (isOther ? ' on' : '') + '" value="' + esc(state.date) + '" max="2100-12-31" min="1900-01-01" aria-label="Otra fecha"></div><span class="hint" data-date-hint></span></div>';
      h += '<label class="field" data-field="description"><span class="lbl">Descripción <em>opcional</em></span><input name="description" maxlength="200" value="' + esc(state.description) + '" placeholder="' + esc(placeholderFor(t)) + '" autocomplete="off" list="desc-suggestions"></label>';
      h += '<datalist id="desc-suggestions">' + recentDescriptions(t).map(d => '<option value="' + esc(d) + '">').join('') + '</datalist>';

      // Más detalles
      h += '<details class="more"' + (state.showMore ? ' open' : '') + '><summary>Más detalles</summary><div class="more-body">';
      if (t === 'expense') {
        const cat = St.get('categories', state.categoryId);
        const nat = state.nature || (cat ? cat.nature : 'variable');
        h += '<div class="field"><span class="lbl">Tipo de gasto</span><div class="chips">' + chip('nature', 'fixed', 'Fijo', nat === 'fixed') + chip('nature', 'variable', 'Variable', nat !== 'fixed') + '</div></div>';
        h += '<div class="field"><span class="lbl">¿De quién es el gasto?</span><div class="chips">' + Object.entries(S.PERSONS).map(([k, v]) => chip('person', k, v, (state.person || 'personal') === k)).join('') + '</div></div>';
      }
      if (t === 'income' || t === 'expense') {
        const cat = St.get('categories', state.categoryId);
        if (cat && cat.subcategories && cat.subcategories.length === 0) {} // nada
        h += '<label class="field"><span class="lbl">Método de pago</span><select name="paymentMethod">' + ui.options(S.PAYMENT_METHODS, state.paymentMethod, '—') + '</select></label>';
      }
      h += '<label class="field" data-field="tags"><span class="lbl">Etiquetas <em>separadas por espacio, ej. #universidad #viaje</em></span><input name="tags" value="' + esc((state.tags || []).map(x => '#' + x).join(' ')) + '" autocomplete="off" list="tag-suggestions"></label>';
      h += '<datalist id="tag-suggestions">' + F.analytics.allTags(St).slice(0, 30).map(x => '<option value="#' + esc(x.tag) + '">').join('') + '</datalist>';
      h += '<label class="field" data-field="notes"><span class="lbl">Notas</span><textarea name="notes" rows="2" maxlength="2000">' + esc(state.notes) + '</textarea></label>';
      if (!editing) {
        h += '<label class="switch"><input type="checkbox" name="makeRecurring"' + (state.makeRecurring ? ' checked' : '') + '><span>Es un movimiento recurrente</span></label>';
        if (state.makeRecurring) {
          h += '<div class="grid2"><label class="field"><span class="lbl">Frecuencia</span><select name="frequency">' + ui.options(Object.fromEntries(Object.entries(S.FREQUENCIES).map(([k, v]) => [k, v.label])), state.frequency || 'monthly') + '</select></label>' +
            '<label class="switch compact"><input type="checkbox" name="autoConfirm"' + (state.autoConfirm ? ' checked' : '') + '><span>Registrar automáticamente</span></label></div>';
          if (t === 'expense') h += '<label class="switch"><input type="checkbox" name="isSubscription"' + (state.isSubscription || (St.get('categories', state.categoryId) || {}).id === 'cat_suscripciones' ? ' checked' : '') + '><span>Es una suscripción</span></label>';
        }
      } else if (state.recurringId) {
        h += '<p class="hint">' + ui.icon('repeat') + ' Generado por el recurrente «' + esc((St.get('recurring', state.recurringId) || {}).name || '—') + '».</p>';
      }
      h += '</div></details><div class="form-errors"></div>';
      form.innerHTML = h;
      bind();
      updateHints();
      if (focusAmount) { const a = form.querySelector('[name=amount]'); if (a) try { a.focus({ preventScroll: true }); } catch (_) {} }
    }

    function accountChips(name, label, selected, type, list) {
      list = list || accountsByUsage(type, [selected]);
      if (!list.length) return '<div class="field" data-field="' + name + '"><span class="lbl">' + label + '</span><p class="hint">No tienes cuentas. <button type="button" class="link-btn" data-new-acc>Crear una cuenta</button></p></div>';
      return '<div class="field" data-field="' + name + '"><span class="lbl">' + label + '</span><div class="chips acc">' +
        list.map(a => chip(name, a.id, esc(a.name) + '<small>' + esc(U.money(a.balance, { currency: a.currency, compact: Math.abs(a.balance) >= 1e7 })) + '</small>', a.id === selected)).join('') + '</div></div>';
    }

    function readInputs() {
      const fd = new FormData(form);
      const amt = form.querySelector('[name=amount]');
      if (amt) state.amount = amt.value.trim() === '' ? '' : U.parseAmount(amt.value);
      for (const k of ['description', 'notes', 'paymentMethod', 'goalId', 'investmentId', 'debtId', 'frequency', 'newDebtName', 'newDebtWho']) if (fd.has(k)) state[k] = fd.get(k);
      if (fd.has('date')) { const d = fd.get('date'); if (d) state.date = d; }
      if (fd.has('tags')) state.tags = U.parseTags(fd.get('tags'));
      const ia = form.querySelector('[name=interestAmount]');
      if (ia) state.interestAmount = ia.value.trim() === '' ? 0 : U.parseAmount(ia.value);
      const det = form.querySelector('details.more'); if (det) state.showMore = det.open;
      for (const k of ['makeRecurring', 'autoConfirm', 'isSubscription']) { const c = form.querySelector('[name=' + k + ']'); if (c) state[k] = c.checked; }
    }

    function updateHints() {
      const dh = form.querySelector('[data-date-hint]');
      if (dh) dh.textContent = state.date > U.today() ? 'Fecha futura: el saldo cambiará cuando llegue esa fecha.' : (state.date < U.today() ? U.relativeDayLabel(state.date) : '');
      const ph = form.querySelector('[data-principal-hint]');
      if (ph) {
        const d = St.get('debts', state.debtId);
        const a = U.num(state.amount), i = U.num(state.interestAmount);
        if (d && a > 0) {
          const bal = L.debtBalanceAt(St, d, U.today());
          let txt = 'Abono a capital: ' + U.money(Math.max(0, a - i)) + ' · Saldo actual: ' + U.money(bal);
          if (editing) txt = 'Abono a capital: ' + U.money(Math.max(0, a - i));
          if (!editing && a - i > bal + 0.5) txt += ' · El abono supera el saldo registrado.';
          if (!editing && d.direction === 'payable' && d.interestRate > 0 && !i) {
            const est = Math.round(bal * (Math.pow(1 + d.interestRate / 100, 1 / 12) - 1));
            txt += ' · Interés estimado del mes: ' + U.money(est);
          }
          ph.textContent = txt;
        } else ph.textContent = '';
      }
    }

    function bind() {
      const amt = form.querySelector('[name=amount]');
      ui.bindAmountInput(amt, () => (St.get('accounts', state.accountId) || {}).currency);
      ui.bindAmountInput(form.querySelector('[name=interestAmount]'));
      form.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => switchType(b.dataset.type)));
      const tsel = form.querySelector('[data-type-select]');
      tsel.addEventListener('change', () => { if (tsel.value) switchType(tsel.value); });
      form.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
        readInputs();
        const k = b.dataset.chip, v = b.dataset.value;
        if (k === 'subcategory' && state.subcategory === v) state.subcategory = '';
        else state[k] = v;
        if (k === 'categoryId') { state.subcategory = ''; state.nature = ''; }
        if (k === 'toAccountId' && state.type === 'saving') {
          const g = St.all('goals').find(g => g.accountId === v && !g.archived);
          if (g && !state.goalId) state.goalId = g.id;
        }
        if (k === 'accountId' && state.toAccountId === v) state.toAccountId = '';
        render();
      }));
      const all = form.querySelector('[data-cat-all]');
      if (all) all.addEventListener('change', () => { readInputs(); if (all.value) { state.categoryId = all.value; state.subcategory = ''; render(); } });
      const dateInp = form.querySelector('[name=date]');
      dateInp.addEventListener('change', () => { readInputs(); render(); });
      form.querySelectorAll('[name=makeRecurring],[name=debtId],[name=investmentId]').forEach(el => el.addEventListener('change', () => { readInputs(); render(); }));
      form.querySelectorAll('[name=amount],[name=interestAmount]').forEach(el => el.addEventListener('input', () => { readInputs(); updateHints(); }));
      const ni = form.querySelector('[data-new-inv]');
      if (ni) ni.addEventListener('click', () => { readInputs(); F.forms.investment(null, inv => { state.investmentId = inv.id; render(); }); });
      const na = form.querySelector('[data-new-acc]');
      if (na) na.addEventListener('click', () => { readInputs(); F.forms.account(null, acc => { state.accountId = acc.id; render(); }); });
      form.addEventListener('submit', e => { e.preventDefault(); save(false); });
      amt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(false); } });
    }

    function switchType(t) {
      readInputs();
      if (t === state.type) return;
      const prevCat = St.get('categories', state.categoryId);
      state.type = t;
      if (!prevCat || prevCat.kind !== t) { state.categoryId = ''; state.subcategory = ''; }
      if (!editing) state.accountId = last[t] || state.accountId;
      if (t !== 'transfer' && t !== 'saving') state.toAccountId = '';
      state.debtId = ''; state.investmentId = '';
      render(true);
    }

    function buildTx() {
      readInputs();
      const t = state.type;
      const tx = {
        id: editing ? opts.tx.id : undefined, date: state.date, type: t, amount: state.amount === '' ? '' : state.amount,
        accountId: state.accountId || null, toAccountId: (t === 'transfer' || t === 'saving') ? (state.toAccountId || null) : null,
        categoryId: (t === 'income' || t === 'expense') ? (state.categoryId || null) : null,
        subcategory: (t === 'income' || t === 'expense') ? (state.subcategory || '') : '',
        description: (state.description || '').trim(), paymentMethod: state.paymentMethod || '', tags: state.tags || [],
        notes: (state.notes || '').trim(), recurring: !!(state.recurring || state.makeRecurring), recurringId: state.recurringId || null,
        nature: t === 'expense' ? (state.nature || ((St.get('categories', state.categoryId) || {}).nature) || 'variable') : undefined,
        person: t === 'expense' ? (state.person || 'personal') : 'personal',
        investmentId: (t === 'investment' || t === 'investment_withdrawal' || (t === 'expense' && state.investmentId)) ? (state.investmentId || null) : null,
        debtId: (t === 'debt_payment' || t === 'loan_received' || t === 'loan_given') ? (state.debtId || null) : null,
        goalId: t === 'saving' || t === 'transfer' ? (state.goalId || null) : null,
        interestAmount: t === 'debt_payment' ? U.num(state.interestAmount) : undefined,
        isDemo: editing ? !!opts.tx.isDemo : false
      };
      if (editing) { tx.createdAt = opts.tx.createdAt; }
      return tx;
    }

    let saving = false;
    async function save(again) {
      if (saving) return;
      const tx = buildTx();
      // Préstamo nuevo creado en línea
      if (tx.debtId === '__new') {
        const nm = (state.newDebtName || '').trim();
        if (!nm) { ui.showErrors(form, { newDebtName: 'Ponle un nombre al préstamo.' }); return; }
        const pre = S.validateTransaction(Object.assign({}, tx, { debtId: 'x' }), Object.assign(St.ctx(), { debt: () => ({ direction: tx.type === 'loan_given' ? 'receivable' : 'payable' }) }));
        if (!pre.ok) { ui.showErrors(form, pre.errors); return; }
        saving = true;
        try {
          const d = await St.save('debts', { name: nm, counterparty: (state.newDebtWho || '').trim(), direction: tx.type === 'loan_given' ? 'receivable' : 'payable', kind: 'personal', principal: tx.amount, openingBalance: 0, interestRate: 0, monthlyPayment: 0, startDate: tx.date, endDate: null, dueDay: null, notes: '' });
          tx.debtId = d.id;
        } catch (e) { saving = false; ui.showErrors(form, e.errors || {}); return; }
      }
      const v = St.validate('transactions', tx);
      if (!v.ok) { saving = false; ui.showErrors(form, v.errors); return; }
      saving = true;
      try {
        let rule = null;
        if (!editing && state.makeRecurring) {
          rule = await St.save('recurring', {
            name: tx.description || ((St.get('categories', tx.categoryId) || {}).name) || S.TX_TYPES[tx.type].label,
            type: tx.type, amount: tx.amount, accountId: tx.accountId, toAccountId: tx.toAccountId, categoryId: tx.categoryId, subcategory: tx.subcategory,
            nature: tx.nature, paymentMethod: tx.paymentMethod, tags: tx.tags, person: tx.person, investmentId: tx.investmentId, debtId: tx.debtId,
            goalId: tx.goalId, interestAmount: tx.interestAmount || 0, description: tx.description, frequency: state.frequency || 'monthly',
            startDate: tx.date, anchorDay: Number(tx.date.slice(8, 10)),
            nextDate: F.recurring.step({ frequency: state.frequency || 'monthly', anchorDay: Number(tx.date.slice(8, 10)), startDate: tx.date }, tx.date),
            endDate: null, autoConfirm: !!state.autoConfirm, isSubscription: !!state.isSubscription, active: true
          });
          tx.recurringId = rule.id;
        }
        const saved = await St.save('transactions', tx);
        if (opts.onSaved) await opts.onSaved(saved);
        if (!editing) {
          const lu = Object.assign({}, St.settings().lastUsed || {}); lu[tx.type] = tx.accountId;
          St.saveSettings({ lastUsed: lu });
        }
        const label = S.TX_TYPES[saved.type].label + (editing ? ' actualizado' : ' guardado') + ' · ' + U.money(saved.amount);
        ui.toast(label, editing ? {} : { action: { label: 'Deshacer', fn: async () => { await St.remove('transactions', saved.id); if (rule) await St.remove('recurring', rule.id); ui.toast('Movimiento eliminado'); } } });
        if (again) {
          saving = false;
          Object.assign(state, { amount: '', description: '', notes: '', tags: [], subcategory: '', makeRecurring: false, interestAmount: '' });
          render(true);
        } else m.close();
      } catch (e) {
        saving = false;
        if (e.errors) ui.showErrors(form, e.errors); else ui.toast('No se pudo guardar: ' + e.message, { type: 'error' });
      }
    }

    m.el.querySelector('[data-save]').addEventListener('click', () => save(false));
    const again = m.el.querySelector('[data-again]');
    if (again) again.addEventListener('click', () => save(true));
    const del = m.el.querySelector('[data-del]');
    if (del) del.addEventListener('click', async () => {
      if (!(await ui.confirmDialog({ title: 'Eliminar movimiento', message: 'Se eliminará este movimiento y se recalcularán los saldos. ¿Continuar?', confirmText: 'Eliminar', danger: true }))) return;
      const copy = U.deepClone(opts.tx);
      await St.remove('transactions', opts.tx.id);
      m.close();
      ui.toast('Movimiento eliminado', { action: { label: 'Deshacer', fn: () => St.save('transactions', copy) } });
    });
    render(!editing);
    return m;
  }

  function groupedCategoryOptions(kind, selected) {
    const cats = St.all('categories').filter(c => c.kind === kind && (!c.archived || c.id === selected));
    const groups = U.groupBy(cats, c => c.group || 'Otros');
    let h = '';
    for (const [g, list] of groups) h += '<optgroup label="' + esc(g) + '">' + list.sort((a, b) => a.name.localeCompare(b.name)).map(c => '<option value="' + esc(c.id) + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</optgroup>';
    return h;
  }
  function placeholderFor(t) {
    return { expense: 'Ej. Almuerzo', income: 'Ej. Salario octubre', transfer: 'Ej. Paso a Nu', saving: 'Ej. Ahorro del mes', investment: 'Ej. Aporte mensual', investment_withdrawal: 'Ej. Retiro parcial', debt_payment: 'Ej. Cuota 5 de 24', loan_received: 'Ej. Préstamo', loan_given: 'Ej. Préstamo a Ana' }[t] || '';
  }
  function recentDescriptions(type) {
    const seen = new Set(), out = [];
    const all = L.sortedTx(St);
    for (let i = all.length - 1; i >= 0 && out.length < 25; i--) {
      const d = all[i].description;
      if (all[i].type === type && d && !seen.has(d)) { seen.add(d); out.push(d); }
    }
    return out;
  }

  F.txForm = { open, groupedCategoryOptions };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
