/* =========================================================================
 * ui/views/money.js — Mis cuentas, Patrimonio, Inversiones y Deudas.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, L = F.ledger, A = F.analytics, St = F.Store, ui = F.ui, vh = F.vh, C = F.charts;
  const esc = U.escapeHTML;

  // ================================ CUENTAS ================================
  function cuentas(el) {
    const list = L.accountsWithBalance(St);
    const base = U.getBaseCurrency();
    const active = list.filter(a => !a.archived), archived = list.filter(a => a.archived);
    const groups = [
      ['spending', 'Disponible', a => a.purposeResolved === 'spending' && a.type !== 'credit_card'],
      ['savings', 'Ahorro', a => a.purposeResolved === 'savings'],
      ['investment', 'Inversión', a => a.purposeResolved === 'investment'],
      ['card', 'Tarjetas de crédito', a => a.type === 'credit_card']
    ];
    const accCard = a => {
      const u = St.usages('accounts', a.id);
      return '<article class="acc-card' + (a.balance < 0 ? ' negative' : '') + '">' +
        '<div class="acc-top"><div><h3>' + esc(a.name) + '</h3><span class="muted small">' + esc(S.ACCOUNT_TYPES[a.type].label) + (a.currency !== base ? ' · ' + a.currency : '') + '</span></div>' +
        '<div class="acc-bal">' + (a.type === 'credit_card' ? '<span class="muted small">' + (a.balance < 0 ? 'Debes' : 'Saldo a favor') + '</span>' : '') + ui.amt(a.type === 'credit_card' ? Math.abs(a.balance) : a.balance, { currency: a.currency }) + '</div></div>' +
        '<dl class="acc-meta"><div><dt>Saldo inicial</dt><dd>' + esc(U.money(a.initialBalance, { currency: a.currency })) + '</dd></div><div><dt>Desde</dt><dd>' + esc(U.dateLabel(a.openedAt)) + '</dd></div><div><dt>Movimientos</dt><dd>' + u.transactions + '</dd></div></dl>' +
        (a.notes ? '<p class="muted small">' + esc(a.notes) + '</p>' : '') +
        '<div class="acc-actions"><a class="btn small ghost" href="#/movimientos?accountId=' + esc(a.id) + '">Movimientos</a><button class="btn small ghost" data-reconcile="' + esc(a.id) + '">Ajustar saldo</button><button class="btn small ghost" data-edit-acc="' + esc(a.id) + '">' + ui.icon('edit') + 'Editar</button></div></article>';
    };
    let h = '';
    for (const [k, title, fn] of groups) {
      const items = active.filter(fn);
      if (!items.length) continue;
      const total = U.sum(items.filter(a => a.currency === base), a => a.balance);
      h += '<section class="acc-group"><header><h2>' + esc(title) + '</h2>' + ui.amt(k === 'card' ? Math.abs(Math.min(0, total)) : total) + '</header><div class="acc-grid">' + items.map(accCard).join('') + '</div></section>';
    }
    if (archived.length) h += '<details class="archived"><summary>Archivadas (' + archived.length + ')</summary><div class="acc-grid">' + archived.map(accCard).join('') + '</div></details>';
    const nw = L.netWorthAt(St, U.today());
    el.innerHTML = '<div class="page">' + vh.pageHead('Mis cuentas', 'Los saldos se calculan: saldo inicial + todos los movimientos hasta hoy.', '<button class="btn primary" data-act="new-account">' + ui.icon('plus') + 'Nueva cuenta</button>') +
      (list.length ? '<div class="kpis four">' + vh.kpi('Dinero en cuentas', ui.amt(nw.spending)) + vh.kpi('Efectivo', ui.amt(nw.cash)) + vh.kpi('Ahorros', ui.amt(nw.savings)) + vh.kpi('Disponible real', ui.amt(nw.available), 'cuentas + efectivo − tarjetas') + '</div>' + h
        : ui.emptyState('wallet', 'Aún no tienes cuentas', 'Crea tus cuentas (banco, billetera digital, efectivo, tarjeta) con el saldo que tienen hoy.', '<button class="btn primary" data-act="new-account">Crear cuenta</button>')) + '</div>';
    el.querySelectorAll('[data-edit-acc]').forEach(b => b.addEventListener('click', () => F.forms.account(St.get('accounts', b.dataset.editAcc))));
    el.querySelectorAll('[data-reconcile]').forEach(b => b.addEventListener('click', () => reconcile(St.get('accounts', b.dataset.reconcile))));
  }

  /** Ajuste de saldo: corrige el saldo inicial para que el saldo actual coincida con el real (sin afectar estadísticas). */
  function reconcile(acc) {
    const cur = L.accountBalance(St, acc.id, U.today());
    const card = acc.type === 'credit_card';
    F.forms.entityForm({
      title: 'Ajustar saldo · ' + acc.name, size: 'small', values: { real: card ? Math.abs(cur) : cur },
      intro: 'Escribe el saldo real que ves hoy en tu banco o billetera. La diferencia se aplica al saldo inicial, así no aparece como ingreso ni gasto. Saldo calculado actual: <b>' + esc(U.money(card ? Math.abs(cur) : cur, { currency: acc.currency })) + '</b>' + (card ? ' (deuda)' : '') + '.',
      fields: [{ name: 'real', label: card ? 'Deuda real de la tarjeta' : 'Saldo real hoy', type: 'amount' }],
      onSave: vals => {
        if (typeof vals.real !== 'number' || !Number.isFinite(vals.real)) throw new F.ValidationError({ real: 'Escribe un valor válido.' });
        const target = card ? -Math.abs(vals.real) : vals.real;
        const diff = U.round2(target - cur);
        return St.save('accounts', Object.assign({}, acc, { initialBalance: U.round2(U.num(acc.initialBalance) + diff), notes: acc.notes })).then(r => { ui.toast(diff === 0 ? 'El saldo ya coincidía' : 'Saldo ajustado en ' + U.money(diff, { sign: true })); return r; });
      }
    });
  }

  // ================================ PATRIMONIO ================================
  function patrimonio(el) {
    const nw = L.netWorthAt(St, U.today());
    const first = L.firstDataMonth(St);
    const months = U.monthRange(first, U.currentMonthKey());
    const hist = months.map(k => ({ key: k, nw: L.netWorthAt(St, U.monthEnd(k) > U.today() ? U.today() : U.monthEnd(k)) }));
    const row = (l, v) => '<div class="bs-row static"><span>' + esc(l) + '</span>' + ui.amt(v) + '</div>';
    const assets = St.all('assets');
    const table = '<div class="table-wrap"><table class="tbl num"><thead><tr><th>Mes</th><th>Activos</th><th>Pasivos</th><th>Patrimonio</th><th>Cambio</th></tr></thead><tbody>' +
      hist.slice().reverse().map((h, i, arr) => { const prev = arr[i + 1]; const d = prev ? h.nw.netWorth - prev.nw.netWorth : null;
        return '<tr><th>' + esc(U.monthLabel(h.key)) + '</th><td>' + ui.amt(h.nw.assets) + '</td><td>' + ui.amt(h.nw.liabilities) + '</td><td><b>' + ui.amt(h.nw.netWorth) + '</b></td><td>' + (d === null ? '—' : ui.amt(d, { sign: true, colored: true }) + ' ' + ui.delta(U.pctChange(h.nw.netWorth, prev.nw.netWorth))) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    el.innerHTML = '<div class="page">' + vh.pageHead('Patrimonio neto', 'Patrimonio neto = Activos − Pasivos. Reconstruido mes a mes desde tus registros.', '<button class="btn" data-new-asset>' + ui.icon('plus') + 'Otro activo o pasivo</button>') +
      '<div class="nw-hero"><span>Hoy</span>' + ui.amt(nw.netWorth) + '</div>' +
      '<div class="grid-2">' + vh.card('Activos', row('Dinero en cuentas', nw.spending) + row('Efectivo', nw.cash) + row('Ahorros', nw.savings) + row('Inversiones (valor actual)', nw.investments) + (nw.investmentCash ? row('Saldo en cuentas de inversión', nw.investmentCash) : '') + row('Dinero que me deben', nw.receivables) + row('Otros activos', nw.otherAssets) + '<div class="bs-total"><span>Total activos</span>' + ui.amt(nw.assets) + '</div>') +
      vh.card('Pasivos', row('Tarjetas de crédito', nw.cardDebt) + row('Deudas y préstamos', nw.debts) + row('Otros pasivos', nw.otherLiabilities) + '<div class="bs-total"><span>Total pasivos</span>' + ui.amt(nw.liabilities) + '</div>') + '</div>' +
      (nw.foreign.length ? '<p class="foot-note">No incluidas (otra moneda, sin conversión): ' + nw.foreign.map(f => esc(f.name) + ' ' + esc(U.money(f.balance, { currency: f.currency }))).join(', ') + '.</p>' : '') +
      vh.card('Evolución del patrimonio', '<div data-c1></div>') +
      vh.card('Otros activos y pasivos', assets.length ? '<ul class="rank">' + assets.map(a => { const v = L.assetValueAt(a, U.today()); const last = L.sortedValuations(a).slice(-1)[0];
        return '<li><span>' + esc(a.name) + ' <small class="muted">' + esc(S.ASSET_KINDS[a.kind]) + ' · valor del ' + esc(last ? U.dateLabel(last.date) : '—') + '</small></span>' + ui.amt(a.kind === 'other_liability' ? -v : v, { colored: a.kind === 'other_liability' }) + '<button class="btn small ghost" data-edit-asset="' + esc(a.id) + '">Actualizar</button></li>'; }).join('') + '</ul>'
        : '<p class="muted">Vivienda, vehículo u otros bienes que quieras incluir en tu patrimonio. Su valor lo actualizas tú cuando quieras.</p>') +
      vh.card('Mes a mes', table) + '</div>';
    C.mount(el.querySelector('[data-c1]'), { type: 'line', zero: false, labels: hist.map(h => U.monthLabel(h.key)), shortLabels: hist.map(h => U.monthLabel(h.key, true)), series: [
      { name: 'Patrimonio neto', color: 'var(--accent)', values: hist.map(h => h.nw.netWorth), area: true },
      { name: 'Activos', color: 'var(--income)', values: hist.map(h => h.nw.assets), dashed: true },
      { name: 'Pasivos', color: 'var(--expense)', values: hist.map(h => h.nw.liabilities), dashed: true }] });
    el.querySelector('[data-new-asset]').addEventListener('click', () => F.forms.asset(null));
    el.querySelectorAll('[data-edit-asset]').forEach(b => b.addEventListener('click', () => F.forms.asset(St.get('assets', b.dataset.editAsset))));
  }

  // ================================ INVERSIONES ================================
  function inversiones(el) {
    const pf = L.portfolioSummary(St);
    const invs = St.all('investments');
    const card = s => {
      const inv = St.get('investments', s.id);
      const stale = s.staleDays !== null && s.staleDays > 45;
      const vals = L.sortedValuations(inv);
      return '<article class="inv-card' + (s.closed ? ' closed' : '') + '"><header><div><h3>' + esc(s.name) + '</h3><span class="muted small">' + esc(S.INVESTMENT_TYPES[s.type]) + (s.closed ? ' · cerrada' : '') + '</span></div>' +
        '<div class="right">' + ui.amt(s.value) + '<span class="' + (s.gain >= 0 ? 'pos' : 'neg') + ' small">' + esc(U.money(s.gain, { sign: true })) + ' · ' + U.signedPct(s.returnPct, 1) + '</span></div></header>' +
        '<dl class="acc-meta"><div><dt>Aportado</dt><dd>' + esc(U.money(s.contributions)) + '</dd></div><div><dt>Retirado</dt><dd>' + esc(U.money(s.withdrawals)) + '</dd></div><div><dt>Comisiones</dt><dd>' + esc(U.money(s.fees)) + '</dd></div><div><dt>Valor actualizado</dt><dd>' + esc(s.lastValuationDate ? U.dateLabel(s.lastValuationDate) : '—') + '</dd></div></dl>' +
        (stale ? '<p class="warn-note">' + ui.icon('clock', 'tiny') + ' El valor se actualizó hace ' + s.staleDays + ' días.</p>' : '') +
        (vals.length > 1 ? '<div class="inv-spark" data-spark="' + esc(s.id) + '"></div>' : '') +
        (inv.notes ? '<p class="muted small">' + esc(inv.notes) + '</p>' : '') +
        '<div class="acc-actions"><button class="btn small primary" data-inv-val="' + esc(s.id) + '">Actualizar valor</button><button class="btn small ghost" data-inv-add="' + esc(s.id) + '">Aportar</button><button class="btn small ghost" data-inv-wd="' + esc(s.id) + '">Retirar</button><button class="btn small ghost" data-inv-fee="' + esc(s.id) + '">Comisión</button><a class="btn small ghost" href="#/movimientos?q=' + encodeURIComponent(s.name) + '">Movimientos</a><button class="btn small ghost" data-inv-edit="' + esc(s.id) + '">' + ui.icon('edit') + '</button></div></article>';
    };
    const byType = new Map();
    for (const s of pf.items) if (s.value > 0) byType.set(s.type, (byType.get(s.type) || 0) + s.value);
    const palette = ['var(--invest)', 'var(--saving)', 'var(--income)', 'var(--debt)', 'var(--accent)', 'var(--expense)', 'var(--muted)'];
    el.innerHTML = '<div class="page">' + vh.pageHead('Inversiones', 'Valor actual = última valoración manual + aportes − retiros posteriores. Sin conexión a brokers.', '<button class="btn primary" data-new-inv>' + ui.icon('plus') + 'Nueva inversión</button>') +
      (invs.length ? '<div class="kpis five">' + vh.kpi('Capital aportado', ui.amt(pf.contributions), 'retirado ' + esc(U.money(pf.withdrawals))) + vh.kpi('Valor actual', ui.amt(pf.value)) +
        vh.kpi('Ganancia / pérdida', ui.amt(pf.gain, { colored: true, sign: true }), 'Valor − (Aportado − Retirado)') + vh.kpi('Rentabilidad acumulada', U.signedPct(pf.returnPct, 2), 'Ganancia ÷ Capital aportado') + vh.kpi('Comisiones', ui.amt(pf.fees), 'neto: ' + esc(U.money(pf.gain - pf.fees, { sign: true }))) + '</div>' +
        '<div class="grid-2"><div class="col">' + pf.items.filter(i => !i.closed).map(card).join('') + '</div><div class="col">' + vh.card('Distribución por tipo', '<div data-donut></div>') +
        (pf.items.some(i => i.closed) ? vh.card('Cerradas', pf.items.filter(i => i.closed).map(card).join('')) : '') + '</div></div>'
        : ui.emptyState('trending', 'Aún no registras inversiones', 'Crea una inversión (ETF, acciones, CDT, fondo, cripto…) y luego registra aportes como movimientos de tipo Inversión.', '<button class="btn primary" data-new-inv>Crear inversión</button>')) + '</div>';
    const d = el.querySelector('[data-donut]');
    if (d) C.mount(d, { type: 'donut', items: [...byType.entries()].map(([k, v], i) => ({ name: S.INVESTMENT_TYPES[k], value: v, color: palette[i % palette.length] })), center: { label: 'Valor', value: U.money(pf.value, { compact: true }) } });
    el.querySelectorAll('[data-spark]').forEach(sp => { const inv = St.get('investments', sp.dataset.spark); C.mount(sp, { type: 'spark', values: L.sortedValuations(inv).map(v => v.value), color: 'var(--invest)', height: 36 }); });
    el.querySelectorAll('[data-new-inv]').forEach(b => b.addEventListener('click', () => F.forms.investment(null)));
    const on = (attr, fn) => el.querySelectorAll('[' + attr + ']').forEach(b => b.addEventListener('click', () => fn(St.get('investments', b.getAttribute(attr)))));
    on('data-inv-val', inv => F.forms.valuation(inv));
    on('data-inv-edit', inv => F.forms.investment(inv));
    on('data-inv-add', inv => F.txForm.open({ type: 'investment', preset: { investmentId: inv.id } }));
    on('data-inv-wd', inv => F.txForm.open({ type: 'investment_withdrawal', preset: { investmentId: inv.id } }));
    on('data-inv-fee', inv => F.txForm.open({ type: 'expense', preset: { investmentId: inv.id, categoryId: 'cat_comisiones', subcategory: 'Inversión', description: 'Comisión ' + inv.name } }));
  }

  // ================================ DEUDAS ================================
  function deudas(el) {
    const debts = St.all('debts');
    const sums = debts.map(d => Object.assign(L.debtSummary(St, d), { debt: d }));
    const owe = sums.filter(s => s.direction === 'payable' && !s.debt.archived), owed = sums.filter(s => s.direction === 'receivable' && !s.debt.archived);
    const archived = sums.filter(s => s.debt.archived);
    const nw = L.netWorthAt(St, U.today());
    const card = s => {
      const d = s.debt, am = s.amortization;
      let amHTML = '';
      if (s.direction === 'payable' && s.balance > 0) {
        if (!d.monthlyPayment) amHTML = '<p class="muted small">Agrega la cuota mensual para estimar plazo e intereses.</p>';
        else if (am && !am.coversInterest) amHTML = '<p class="warn-note">La cuota registrada (' + esc(U.money(d.monthlyPayment)) + ') no alcanza a cubrir los intereses estimados del mes.</p>';
        else if (am && am.months !== null) amHTML = '<p class="small">Con la cuota de ' + esc(U.money(d.monthlyPayment)) + (d.interestRate ? ' y ' + U.pct(d.interestRate, 2) + ' EA' : '') + ': <b>' + am.months + ' cuota(s)</b> restantes (≈ ' + esc(U.monthLabel(U.monthKey(am.payoffDate)).toLowerCase()) + '), intereses estimados <b>' + esc(U.money(am.totalInterest)) + '</b>.</p>';
      }
      return '<article class="debt-card"><header><div><h3>' + esc(d.name) + '</h3><span class="muted small">' + esc(S.DEBT_KINDS[d.kind]) + (d.counterparty ? ' · ' + esc(d.counterparty) : '') + (d.dueDay ? ' · paga el ' + d.dueDay : '') + '</span></div><div class="right">' + ui.amt(s.balance) + '<span class="muted small">saldo</span></div></header>' +
        ui.progress(s.progress, s.balance === 0 ? 'done' : '') + '<div class="debt-prog"><span>' + U.pct(s.progress, 0) + (s.direction === 'payable' ? ' pagado' : ' recuperado') + '</span><span class="muted">de ' + esc(U.money(s.reference)) + '</span></div>' +
        '<dl class="acc-meta"><div><dt>' + (s.direction === 'payable' ? 'Pagos realizados' : 'Abonos recibidos') + '</dt><dd>' + s.payments + ' · ' + esc(U.money(s.paid)) + '</dd></div><div><dt>Intereses ' + (s.direction === 'payable' ? 'pagados' : 'recibidos') + '</dt><dd>' + esc(U.money(s.interestPaid)) + '</dd></div>' +
        (s.direction === 'payable' ? '<div><dt>Tasa</dt><dd>' + (d.interestRate ? U.pct(d.interestRate, 2) + ' EA' : '—') + '</dd></div><div><dt>Cuota</dt><dd>' + (d.monthlyPayment ? esc(U.money(d.monthlyPayment)) : '—') + '</dd></div>' : '') +
        '<div><dt>Inicio</dt><dd>' + esc(U.dateLabel(d.startDate)) + '</dd></div><div><dt>Fin estimado</dt><dd>' + (d.endDate ? esc(U.dateLabel(d.endDate)) : '—') + '</dd></div></dl>' + amHTML +
        '<div class="acc-actions"><button class="btn small primary" data-debt-pay="' + esc(d.id) + '">' + (s.direction === 'payable' ? 'Registrar pago' : 'Registrar abono') + '</button><button class="btn small ghost" data-debt-more="' + esc(d.id) + '">' + (s.direction === 'payable' ? 'Nuevo desembolso' : 'Prestar más') + '</button><a class="btn small ghost" href="#/movimientos?q=' + encodeURIComponent(d.name) + '">Movimientos</a><button class="btn small ghost" data-debt-edit="' + esc(d.id) + '">' + ui.icon('edit') + '</button></div></article>';
    };
    const totalInterest = U.sum(owe, s => s.amortization && s.amortization.totalInterest ? s.amortization.totalInterest : 0);
    el.innerHTML = '<div class="page">' + vh.pageHead('Deudas y préstamos', 'Los saldos bajan solos con cada «Pago de deuda». Los intereses del pago se cuentan como gasto; el abono a capital no.', '<button class="btn primary" data-new-debt="payable">' + ui.icon('plus') + 'Deuda</button><button class="btn" data-new-debt="receivable">' + ui.icon('plus') + 'Me deben</button>') +
      '<div class="kpis four">' + vh.kpi('Dinero que debo', ui.amt(U.sum(owe, s => s.balance)), owe.length + ' deuda(s)') + vh.kpi('Tarjetas de crédito', ui.amt(nw.cardDebt), 'saldo usado en cuentas tipo tarjeta') +
      vh.kpi('Intereses estimados por pagar', ui.amt(totalInterest), 'según tasa y cuota registradas') + vh.kpi('Dinero que me deben', ui.amt(U.sum(owed, s => s.balance)), owed.length + ' préstamo(s)') + '</div>' +
      '<section class="debt-sec"><h2>Dinero que debo</h2>' + (owe.length ? '<div class="acc-grid">' + owe.map(card).join('') + '</div>' : '<p class="muted">No tienes deudas registradas.</p>') + '</section>' +
      '<section class="debt-sec"><h2>Dinero que me deben</h2>' + (owed.length ? '<div class="acc-grid">' + owed.map(card).join('') + '</div>' : '<p class="muted">Usa el movimiento «Préstamo entregado» cuando le prestes dinero a alguien.</p>') + '</section>' +
      (archived.length ? '<details class="archived"><summary>Archivadas (' + archived.length + ')</summary><div class="acc-grid">' + archived.map(card).join('') + '</div></details>' : '') + '</div>';
    el.querySelectorAll('[data-new-debt]').forEach(b => b.addEventListener('click', () => F.forms.debt(null, b.dataset.newDebt)));
    el.querySelectorAll('[data-debt-edit]').forEach(b => b.addEventListener('click', () => F.forms.debt(St.get('debts', b.dataset.debtEdit))));
    el.querySelectorAll('[data-debt-pay]').forEach(b => b.addEventListener('click', () => {
      const d = St.get('debts', b.dataset.debtPay);
      const bal = L.debtBalanceAt(St, d, U.today());
      const est = d.direction === 'payable' && d.interestRate ? Math.round(bal * (Math.pow(1 + d.interestRate / 100, 1 / 12) - 1)) : 0;
      F.txForm.open({ type: 'debt_payment', preset: { debtId: d.id, amount: d.monthlyPayment ? Math.min(d.monthlyPayment, U.round2(bal + est)) : '', interestAmount: est || '', description: (d.direction === 'payable' ? 'Pago ' : 'Abono ') + d.name } });
    }));
    el.querySelectorAll('[data-debt-more]').forEach(b => b.addEventListener('click', () => {
      const d = St.get('debts', b.dataset.debtMore);
      F.txForm.open({ type: d.direction === 'payable' ? 'loan_received' : 'loan_given', preset: { debtId: d.id } });
    }));
  }

  Object.assign(F.views, {
    cuentas: { title: 'Mis cuentas', render: cuentas },
    patrimonio: { title: 'Patrimonio', render: patrimonio },
    inversiones: { title: 'Inversiones', render: inversiones },
    deudas: { title: 'Deudas', render: deudas }
  });
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
