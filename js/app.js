/* =========================================================================
 * app.js — Arranque, enrutador por hash, navegación y acciones globales.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, St = F.Store, R = F.recurring, ui = F.ui;
  const esc = U.escapeHTML;

  const NAV = [
    { title: 'Resumen', items: [['inicio', 'Inicio', 'home'], ['movimientos', 'Movimientos', 'list'], ['calendario', 'Calendario', 'calendar']] },
    { title: 'Análisis', items: [['mes', 'Mes', 'chart'], ['anual', 'Año', 'chart'], ['ingresos', 'Ingresos', 'income'], ['gastos', 'Gastos', 'expense'], ['ahorro', 'Ahorro y flujo', 'coins'], ['proyeccion', 'Proyección', 'projection'], ['salud', 'Indicadores', 'pulse'], ['informes', 'Informes', 'file']] },
    { title: 'Patrimonio', items: [['cuentas', 'Mis cuentas', 'wallet'], ['patrimonio', 'Patrimonio neto', 'layers'], ['inversiones', 'Inversiones', 'trending'], ['deudas', 'Deudas', 'debt']] },
    { title: 'Planeación', items: [['presupuestos', 'Presupuestos', 'target'], ['metas', 'Metas', 'target'], ['recurrentes', 'Recurrentes', 'repeat']] },
    { title: 'Configuración', items: [['categorias', 'Categorías', 'tag'], ['ajustes', 'Datos y ajustes', 'settings']] }
  ];
  const TABS = [['inicio', 'Inicio', 'home'], ['movimientos', 'Movimientos', 'list'], ['+', '', 'plus'], ['mes', 'Análisis', 'chart'], ['mas', 'Más', 'more']];
  const ANALYSIS = ['mes', 'anual', 'ingresos', 'gastos', 'ahorro', 'proyeccion', 'salud', 'informes'];

  let current = { name: 'inicio', params: {} };
  let renderQueued = false;
  let lastDay = null;

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, query] = h.split('?');
    const params = {};
    if (query) for (const kv of query.split('&')) { const [k, v] = kv.split('='); if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || ''); }
    const name = path && F.views[path] ? path : 'inicio';
    return { name, params };
  }

  function buildShell() {
    const side = document.querySelector('.sidebar nav');
    side.innerHTML = NAV.map(g => '<div class="nav-group"><h3>' + esc(g.title) + '</h3>' + g.items.map(([r, l, i]) => '<a href="#/' + r + '" data-nav="' + r + '">' + ui.icon(i) + '<span>' + esc(l) + '</span></a>').join('') + '</div>').join('');
    document.querySelector('.tabbar').innerHTML = TABS.map(([r, l, i]) => r === '+'
      ? '<button class="tab-add" data-add-tx="expense" aria-label="Registrar movimiento">' + ui.icon('plus') + '</button>'
      : '<a href="#/' + r + '" data-tab="' + r + '">' + ui.icon(i) + '<span>' + esc(l) + '</span></a>').join('');
  }

  function markNav(name) {
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === name));
    const tab = ANALYSIS.includes(name) ? 'mes' : ['inicio', 'movimientos'].includes(name) ? name : 'mas';
    document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    const v = F.views[name];
    document.querySelector('.topbar-title').textContent = v ? v.title : '';
    document.title = (v && name !== 'inicio' ? v.title + ' · ' : '') + 'Finanzas personales';
  }

  function render(keepScroll) {
    const view = document.getElementById('view');
    const v = F.views[current.name];
    const y = window.scrollY;
    try { v.render(view, current.params || {}); }
    catch (e) {
      console.error(e);
      view.innerHTML = '<div class="page"><div class="alert error">' + ui.icon('alert') + '<div><strong>Algo salió mal al mostrar esta sección.</strong><p>' + esc(e.message) + '</p><p>Tus datos no se modificaron. Puedes exportar un respaldo desde <a href="#/ajustes">Datos y ajustes</a>.</p></div></div></div>';
    }
    markNav(current.name);
    if (keepScroll) window.scrollTo(0, y);
    lastDay = U.today();
  }
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(true); updateBanners(); });
  }

  function navigate() {
    current = parseHash();
    render(false);
    window.scrollTo(0, 0);
    const main = document.getElementById('view');
    if (main) main.focus({ preventScroll: true });
  }

  function applyTheme() {
    const t = St.settings().theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  function updateBanners() {
    const host = document.getElementById('banners');
    let h = '';
    if (St.adapter && St.adapter.kind === 'memory') h += '<div class="banner error">' + ui.icon('alert') + '<span>No se pudo abrir el almacenamiento local de este navegador (¿modo privado?). Los cambios <b>no se guardarán</b> al cerrar. Exporta un respaldo antes de salir.</span></div>';
    if (!St.settings().privacyNoticeSeen && !St.isEmpty()) h += '<div class="banner">' + ui.icon('lock') + '<span>Tus datos se guardan solo en este dispositivo, en el navegador. No se envían a ningún servidor.</span><button class="btn small" data-dismiss-privacy>Entendido</button></div>';
    const pm = F.pwa && F.pwa.mode();
    if (pm && !F.pwa.dismissed()) {
      h += '<div class="banner install">' + ui.icon('home') + '<span>' + (pm === 'prompt'
        ? '<b>Instala la app</b> para abrirla desde tu pantalla de inicio y usarla sin conexión.'
        : '<b>Instala la app:</b> toca <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>.') +
        '</span>' + (pm === 'prompt' ? '<button class="btn small primary" data-pwa-install>Instalar</button>' : '') +
        '<button class="btn small" data-pwa-dismiss>Ahora no</button></div>';
    }
    host.innerHTML = h;
    const pi = host.querySelector('[data-pwa-install]');
    if (pi) pi.addEventListener('click', () => F.pwa.install().then(updateBanners));
    const pd = host.querySelector('[data-pwa-dismiss]');
    if (pd) pd.addEventListener('click', () => { F.pwa.dismiss(); updateBanners(); });
    const b = host.querySelector('[data-dismiss-privacy]');
    if (b) b.addEventListener('click', () => St.saveSettings({ privacyNoticeSeen: true }));
  }

  // ---------------- Acciones globales (delegación) ----------------
  function onClick(e) {
    const t = e.target.closest('[data-add-tx],[data-edit-tx],[data-act],[data-confirm-rec],[data-skip-rec],[data-edit-rec-tx],[data-month-step],[data-year-step]');
    if (!t) return;
    if (t.hasAttribute('data-add-tx')) { e.preventDefault(); F.txForm.open({ type: t.getAttribute('data-add-tx') }); return; }
    if (t.hasAttribute('data-edit-tx')) {
      e.preventDefault();
      const tx = St.get('transactions', t.getAttribute('data-edit-tx'));
      if (tx) F.txForm.open({ tx });
      return;
    }
    if (t.hasAttribute('data-act')) {
      e.preventDefault();
      const a = t.getAttribute('data-act');
      if (a === 'new-account') F.forms.account(null, acc => ui.toast('Cuenta «' + acc.name + '» creada'));
      else if (a === 'load-demo') F.actions.loadDemo();
      else if (a === 'remove-demo') F.actions.removeDemo();
      else if (a === 'import-backup') F.actions.importBackup();
      else if (a === 'export-backup') F.actions.exportBackup();
      else if (a === 'import-csv') F.actions.importCSV();
      return;
    }
    if (t.hasAttribute('data-confirm-rec')) {
      e.preventDefault(); t.disabled = true;
      R.confirm(St, t.getAttribute('data-confirm-rec')).then(tx => ui.toast(S.TX_TYPES[tx.type].label + ' registrado · ' + U.money(tx.amount), { action: { label: 'Deshacer', fn: () => undoConfirm(tx) } }))
        .catch(err => { t.disabled = false; ui.toast(err.message || 'No se pudo registrar: revisa la regla (cuenta o categoría).', { type: 'error', timeout: 6000 }); });
      return;
    }
    if (t.hasAttribute('data-skip-rec')) { e.preventDefault(); R.skip(St, t.getAttribute('data-skip-rec')).then(() => ui.toast('Pago omitido')); return; }
    if (t.hasAttribute('data-edit-rec-tx')) {
      e.preventDefault();
      const rule = St.get('recurring', t.getAttribute('data-edit-rec-tx'));
      if (!rule) return;
      const preset = R.buildTx(rule, rule.nextDate);
      F.txForm.open({ type: rule.type, preset, onSaved: async () => { const r = St.get('recurring', rule.id); if (r) await St.save('recurring', Object.assign({}, r, { nextDate: R.step(r, r.nextDate) })); } });
      return;
    }
    if (t.hasAttribute('data-month-step')) {
      const box = t.closest('.month-picker');
      const cur = (current.params.m && /^\d{4}-\d{2}$/.test(current.params.m)) ? current.params.m : U.currentMonthKey();
      let next = U.addMonthKey(cur, Number(t.getAttribute('data-month-step')));
      if (next > U.currentMonthKey()) next = U.currentMonthKey();
      location.hash = '#/' + box.dataset.route + '?m=' + next;
      return;
    }
    if (t.hasAttribute('data-year-step')) {
      const box = t.closest('.month-picker');
      const cur = Number(current.params.y || U.today().slice(0, 4));
      location.hash = '#/' + box.dataset.route + '?y=' + Math.min(Number(U.today().slice(0, 4)), cur + Number(t.getAttribute('data-year-step')));
    }
  }
  async function undoConfirm(tx) {
    await St.remove('transactions', tx.id);
    const r = St.get('recurring', tx.recurringId);
    if (r) await St.save('recurring', Object.assign({}, r, { nextDate: tx.date, active: true }));
    ui.toast('Registro deshecho');
  }
  function onChange(e) {
    const inp = e.target.closest('[data-month-input]');
    if (inp && /^\d{4}-\d{2}$/.test(inp.value)) {
      const box = inp.closest('.month-picker');
      const v = inp.value > U.currentMonthKey() ? U.currentMonthKey() : inp.value;
      location.hash = '#/' + box.dataset.route + '?m=' + v;
    }
  }
  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (document.querySelector('.modal-root')) return;
    if (e.key === 'n' || e.key === '+') { e.preventDefault(); F.txForm.open({ type: 'expense' }); }
    if (e.key === '/') { e.preventDefault(); location.hash = '#/movimientos'; setTimeout(() => { const s = document.querySelector('[data-f="q"]'); if (s) s.focus(); }, 50); }
  }

  // ---------------- Arranque ----------------
  async function start() {
    buildShell();
    let adapter = new F.storage.IndexedDBAdapter(S.STORES);
    try { await St.init(adapter); }
    catch (e) {
      console.warn('IndexedDB no disponible, se usa memoria', e);
      adapter = new F.storage.MemoryAdapter(S.STORES);
      await St.init(adapter);
    }
    applyTheme();
    try {
      const created = await R.runAuto(St);
      if (created) ui.toast('Se registraron ' + created + ' movimiento(s) recurrente(s) automáticos.', { timeout: 4500 });
    } catch (e) { console.warn(e); }
    if (!St.isEmpty() && adapter.kind === 'indexeddb') adapter.requestPersistence();
    St.on(scheduleRender);
    // Sincronización entre pestañas: si otra pestaña cambia datos, recargar.
    try {
      const ch = new BroadcastChannel('finanzas-personales');
      let fromOther = false;
      St.on(() => { if (!fromOther) ch.postMessage({ t: 'changed', at: Date.now() }); });
      ch.onmessage = async () => { fromOther = true; try { await St.init(St.adapter); } finally { fromOther = false; } };
    } catch (_) { /* navegador sin BroadcastChannel */ }
    window.addEventListener('hashchange', navigate);
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && lastDay && lastDay !== U.today()) {
        await R.runAuto(St);
        F.ledger.invalidate();
        render(true);
      }
    });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => F.charts.redrawAll());
    document.body.classList.remove('booting');
    if (F.pwa) F.pwa.init(updateBanners);
    updateBanners();
    navigate();
    if (current.params.add) { const t = current.params.add; history.replaceState(null, '', location.pathname + '#/' + current.name); F.txForm.open({ type: S.TX_TYPES[t] ? t : 'expense' }); }
  }

  F.app = { start, applyTheme, render, navigate };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(window.FIN);
