/* =========================================================================
 * ui/views/transactions.js — Histórico completo con búsqueda y filtros.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, A = F.analytics, St = F.Store, ui = F.ui, vh = F.vh;
  const esc = U.escapeHTML;
  const PAGE = 80;

  let state = null;
  function defaults() { return { q: '', period: 'all', day: U.today(), month: U.currentMonthKey(), year: U.today().slice(0, 4), from: '', to: '', type: '', categoryId: '', accountId: '', tag: '', person: '', nature: '', limit: PAGE }; }

  function range(s) {
    switch (s.period) {
      case 'day': return [s.day, s.day];
      case 'week': { const w = U.weekStart(s.day); return [w, U.addDays(w, 6)]; }
      case 'month': return [U.monthStart(s.month), U.monthEnd(s.month)];
      case 'year': return [s.year + '-01-01', s.year + '-12-31'];
      case 'custom': return [s.from || null, s.to || null];
      default: return [null, null];
    }
  }

  function filtersFromParams(p) {
    const s = defaults();
    for (const k of Object.keys(s)) if (p[k] !== undefined && k !== 'limit') s[k] = p[k];
    if (p.tag && !p.period) s.period = 'all';
    return s;
  }
  function toQuery(s) {
    const d = defaults();
    const q = [];
    for (const k of Object.keys(s)) if (k !== 'limit' && s[k] !== d[k] && s[k] !== '') q.push(k + '=' + encodeURIComponent(s[k]));
    return q.join('&');
  }

  function filterArgs(s) {
    const [from, to] = range(s);
    const types = s.type === 'flow' ? ['income', 'expense'] : s.type ? [s.type] : null;
    return { q: s.q, from, to, types, categoryId: s.categoryId, accountId: s.accountId, tag: s.tag, person: s.person, nature: s.nature };
  }

  function controls(s) {
    const accs = St.all('accounts').map(a => ({ value: a.id, label: a.name + (a.archived ? ' (archivada)' : '') }));
    const cats = St.all('categories').slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map(c => ({ value: c.id, label: (c.kind === 'income' ? 'Ingreso · ' : '') + c.name }));
    const tags = A.allTags(St).map(t => ({ value: t.tag, label: '#' + t.tag + ' (' + t.count + ')' }));
    const years = []; for (let y = Number(U.today().slice(0, 4)); y >= Number(F.ledger.firstDataMonth(St).slice(0, 4)); y--) years.push(String(y));
    let periodInput = '';
    if (s.period === 'day' || s.period === 'week') periodInput = '<input type="date" data-f="day" value="' + esc(s.day) + '" aria-label="Fecha">';
    if (s.period === 'month') periodInput = '<input type="month" data-f="month" value="' + esc(s.month) + '" aria-label="Mes">';
    if (s.period === 'year') periodInput = '<select data-f="year" aria-label="Año">' + ui.options(years, s.year) + '</select>';
    if (s.period === 'custom') periodInput = '<input type="date" data-f="from" value="' + esc(s.from) + '" aria-label="Desde"><input type="date" data-f="to" value="' + esc(s.to) + '" aria-label="Hasta">';
    const active = ['type', 'categoryId', 'accountId', 'tag', 'person', 'nature'].filter(k => s[k]).length;
    return '<div class="filters">' +
      '<label class="search">' + ui.icon('search') + '<input type="search" data-f="q" value="' + esc(s.q) + '" placeholder="Buscar: restaurante, #viaje, Nequi, 25000…" aria-label="Buscar movimientos"></label>' +
      '<div class="filter-row"><select data-f="period" aria-label="Período">' + ui.options({ all: 'Todo el histórico', day: 'Día', week: 'Semana', month: 'Mes', year: 'Año', custom: 'Rango personalizado' }, s.period) + '</select>' + periodInput + '</div>' +
      '<details class="filter-more"' + (active ? ' open' : '') + '><summary>' + ui.icon('filter') + 'Filtros' + (active ? ' <span class="count">' + active + '</span>' : '') + '</summary><div class="filter-grid">' +
      '<select data-f="type" aria-label="Tipo">' + ui.options(Object.assign({ flow: 'Ingresos y gastos' }, Object.fromEntries(Object.entries(S.TX_TYPES).map(([k, v]) => [k, v.label]))), s.type, 'Todos los tipos') + '</select>' +
      '<select data-f="categoryId" aria-label="Categoría">' + ui.options(cats, s.categoryId, 'Todas las categorías') + '</select>' +
      '<select data-f="accountId" aria-label="Cuenta">' + ui.options(accs, s.accountId, 'Todas las cuentas') + '</select>' +
      '<select data-f="tag" aria-label="Etiqueta">' + ui.options(tags, s.tag, 'Todas las etiquetas') + '</select>' +
      '<select data-f="person" aria-label="Persona">' + ui.options(S.PERSONS, s.person, 'Personal y compartidos') + '</select>' +
      '<select data-f="nature" aria-label="Fijo o variable">' + ui.options({ fixed: 'Solo gastos fijos', variable: 'Solo gastos variables' }, s.nature, 'Fijos y variables') + '</select>' +
      (active ? '<button class="btn small ghost" data-clear>Limpiar filtros</button>' : '') + '</div></details></div>';
  }

  function results(s) {
    const list = A.filterTransactions(St, filterArgs(s));
    const base = U.getBaseCurrency();
    let inc = 0, exp = 0, foreign = 0;
    for (const t of list) {
      const acc = St.get('accounts', t.accountId);
      if (acc && acc.currency !== base) { foreign++; continue; }
      for (const it of F.ledger.flowItems(t, St)) { if (it.kind === 'income') inc += it.amount; else exp += it.amount; }
    }
    const summary = '<div class="result-summary"><span><b>' + U.plainNumber(list.length) + '</b> movimiento' + (list.length === 1 ? '' : 's') + '</span>' +
      '<span>Ingresos ' + ui.amt(inc) + '</span><span>Gastos ' + ui.amt(exp) + '</span><span>Neto ' + ui.amt(inc - exp, { colored: true, sign: true }) + '</span>' +
      (list.length ? '<button class="btn small ghost" data-export-filtered>' + ui.icon('download') + 'CSV</button>' : '') + '</div>' +
      (foreign ? '<p class="muted small">' + foreign + ' movimiento(s) en otra moneda no se suman a los totales.</p>' : '');
    const empty = St.all('transactions').length
      ? ui.emptyState('search', 'Ningún movimiento coincide', 'Prueba con otro término o quita algunos filtros.')
      : ui.emptyState('list', 'Aún no hay movimientos', 'Registra tu primer gasto o ingreso con el botón +.', '<button class="btn primary" data-add-tx="expense">Registrar movimiento</button>');
    return summary + vh.txList(list, { limit: s.limit, empty }) + (list.length > s.limit ? '<button class="btn block ghost" data-more>Mostrar más (' + (list.length - s.limit) + ' restantes)</button>' : '');
  }

  function render(el, params) {
    state = filtersFromParams(params || {});
    el.innerHTML = '<div class="page">' + vh.pageHead('Movimientos', 'Todo tu histórico, desde el primer registro.', '<button class="btn primary" data-add-tx="expense">' + ui.icon('plus') + 'Registrar</button>') +
      '<div data-controls>' + controls(state) + '</div><div data-results>' + results(state) + '</div></div>';
    bind(el);
  }

  function bind(el) {
    const ctl = el.querySelector('[data-controls]'), res = el.querySelector('[data-results]');
    const refresh = (rebuildControls) => {
      state.limit = PAGE;
      const qs = toQuery(state);
      history.replaceState(null, '', '#/movimientos' + (qs ? '?' + qs : ''));
      if (rebuildControls) { ctl.innerHTML = controls(state); bindControls(); }
      res.innerHTML = results(state);
    };
    let tm = null;
    function bindControls() {
      ctl.querySelectorAll('[data-f]').forEach(inp => {
        const k = inp.dataset.f;
        const ev = k === 'q' ? 'input' : 'change';
        inp.addEventListener(ev, () => {
          state[k] = inp.value;
          if (k === 'q') { clearTimeout(tm); tm = setTimeout(() => refresh(false), 160); }
          else refresh(k === 'period');
        });
      });
      const clr = ctl.querySelector('[data-clear]');
      if (clr) clr.addEventListener('click', () => { for (const k of ['type', 'categoryId', 'accountId', 'tag', 'person', 'nature']) state[k] = ''; refresh(true); });
    }
    bindControls();
    res.addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { state.limit += PAGE * 2; res.innerHTML = results(state); }
      if (e.target.closest('[data-export-filtered]')) {
        const list = A.filterTransactions(St, filterArgs(state)).slice().reverse();
        ui.download('movimientos-filtrados-' + U.today() + '.csv', F.io.transactionsCSV(St, list), 'text/csv;charset=utf-8');
      }
    });
  }

  F.views.movimientos = { title: 'Movimientos', render, keepScrollOnDataChange: true };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
