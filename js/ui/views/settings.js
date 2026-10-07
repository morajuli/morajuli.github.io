/* =========================================================================
 * ui/views/settings.js — Categorías, Datos y ajustes (respaldo, importación,
 * exportación, demo, moneda, privacidad) y menú "Más".
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, L = F.ledger, St = F.Store, ui = F.ui, vh = F.vh, IO = F.io;
  const esc = U.escapeHTML;

  // ================================ CATEGORÍAS ================================
  let catKind = 'expense';
  function categorias(el) {
    const cats = St.all('categories').filter(c => c.kind === catKind);
    const since = U.addDays(U.today(), -365);
    const usage = new Map(), amount = new Map();
    for (const t of St.all('transactions')) if (t.categoryId) { usage.set(t.categoryId, (usage.get(t.categoryId) || 0) + 1); if (t.date >= since) amount.set(t.categoryId, (amount.get(t.categoryId) || 0) + t.amount); }
    const groups = catKind === 'income' ? ['Ingresos'] : S.EXPENSE_GROUPS;
    let h = '';
    for (const g of groups) {
      const list = cats.filter(c => (c.group || 'Otros') === g).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) continue;
      h += '<section class="cat-group"><h2>' + esc(g) + '</h2><ul class="cat-list">' + list.map(c => '<li><button class="cat-row" data-edit-cat="' + esc(c.id) + '"><i class="dot" style="background:' + esc(c.color) + '"></i><span class="cat-name">' + esc(c.name) +
        '<small class="muted">' + (c.subcategories.length ? esc(c.subcategories.join(', ')) : 'Sin subcategorías') + '</small></span>' + (c.kind === 'expense' ? '<span class="badge">' + esc(S.NATURES[c.nature || 'variable']) + '</span>' : '') +
        '<span class="cat-use"><b>' + (usage.get(c.id) || 0) + '</b> mov.' + (amount.get(c.id) ? '<small>' + esc(U.money(amount.get(c.id), { compact: true })) + ' / 12 m</small>' : '') + '</span></button></li>').join('') + '</ul></section>';
    }
    el.innerHTML = '<div class="page">' + vh.pageHead('Categorías', 'Edita nombres, subcategorías y si un gasto suele ser fijo o variable.', '<button class="btn primary" data-new-cat>' + ui.icon('plus') + 'Nueva categoría</button>') +
      '<nav class="subtabs"><a href="#" data-kind="expense"' + (catKind === 'expense' ? ' class="on"' : '') + '>Gastos</a><a href="#" data-kind="income"' + (catKind === 'income' ? ' class="on"' : '') + '>Ingresos</a></nav>' + h + '</div>';
    el.querySelectorAll('[data-kind]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); catKind = a.dataset.kind; categorias(el); }));
    el.querySelector('[data-new-cat]').addEventListener('click', () => F.forms.category(null, catKind));
    el.querySelectorAll('[data-edit-cat]').forEach(b => b.addEventListener('click', () => F.forms.category(St.get('categories', b.dataset.editCat))));
  }

  // ================================ RESPALDO / IMPORTACIÓN ================================
  function exportBackup() {
    const b = IO.buildBackup(St);
    ui.download(IO.backupFileName(), JSON.stringify(b, null, 1), 'application/json');
    St.saveSettings({ lastBackupAt: new Date().toISOString() });
    ui.toast('Respaldo exportado: ' + IO.backupFileName());
  }

  async function importBackup() {
    const file = await ui.pickFile('.json,application/json');
    if (!file) return;
    let text;
    try { text = await ui.readText(file); } catch (e) { ui.toast(e.message, { type: 'error' }); return; }
    const parsed = IO.parseJSONText(text);
    const v = parsed.ok ? IO.validateBackup(parsed.value) : { ok: false, fatal: [parsed.error], invalid: [] };
    const names = { accounts: 'Cuentas', categories: 'Categorías', transactions: 'Movimientos', recurring: 'Recurrentes', budgets: 'Presupuestos', goals: 'Metas', investments: 'Inversiones', debts: 'Deudas', assets: 'Otros activos', settings: 'Configuración' };
    let body = '<p class="muted small">Archivo: ' + esc(file.name) + ' · ' + U.plainNumber(file.size / 1024, 1) + ' KB</p>';
    if (!v.ok) {
      body += '<div class="alert error">' + ui.icon('alert') + '<div><strong>No se puede importar este archivo.</strong><ul>' + v.fatal.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul><p>Tus datos actuales no se modificaron.</p></div></div>';
      ui.modal({ title: 'Importar respaldo', size: 'small', body, footer: '<button class="btn primary" data-close>Entendido</button>' });
      return;
    }
    body += '<p>Respaldo del <b>' + esc(v.meta.exportedAt ? U.dateLabel(v.meta.exportedAt.slice(0, 10)) : 'fecha desconocida') + '</b>' + (v.meta.currency ? ' · moneda ' + esc(v.meta.currency) : '') + '.</p>' +
      '<div class="table-wrap"><table class="tbl compact"><thead><tr><th></th><th>En el archivo</th><th>Actualmente</th></tr></thead><tbody>' +
      Object.keys(names).filter(k => k !== 'settings').map(k => '<tr><th>' + names[k] + '</th><td>' + U.plainNumber(v.counts[k]) + '</td><td>' + U.plainNumber(St.all(k).length) + '</td></tr>').join('') + '</tbody></table></div>';
    if (v.invalid.length) body += '<div class="alert warn">' + ui.icon('alert') + '<div><strong>' + v.invalid.length + ' registro(s) inválido(s) se omitirán.</strong><ul>' + v.invalid.slice(0, 8).map(i => '<li>' + esc(names[i.store] || i.store) + ' ' + esc(i.id) + ': ' + esc(i.reason) + '</li>').join('') + '</ul></div></div>' +
      '<label class="switch"><input type="checkbox" data-ack><span>Entiendo que esos registros no se importarán</span></label>';
    body += '<div class="import-options"><div><h3>Combinar</h3><p>Agrega los registros del archivo que no existan aquí (mismo id). No borra ni modifica nada de lo que ya tienes.</p><button class="btn" data-merge>Combinar con mis datos</button></div>' +
      '<div><h3>Reemplazar</h3><p>Borra los datos actuales y deja exactamente los del archivo. Antes se descargará un respaldo de lo que tienes ahora.</p><button class="btn danger" data-replace>Reemplazar todo</button></div></div>';
    const m = ui.modal({ title: 'Importar respaldo', body, size: 'wide' });
    const ackOk = () => { const a = m.el.querySelector('[data-ack]'); if (a && !a.checked) { ui.toast('Confirma que entiendes que se omitirán registros inválidos.', { type: 'error' }); return false; } return true; };
    m.el.querySelector('[data-merge]').addEventListener('click', async () => {
      if (!ackOk()) return;
      const counts = await St.merge(v.data);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      m.close();
      ui.toast(total ? 'Se agregaron ' + U.plainNumber(total) + ' registro(s).' : 'No había registros nuevos: todo ya existía.');
    });
    m.el.querySelector('[data-replace]').addEventListener('click', async () => {
      if (!ackOk()) return;
      const ok = await ui.confirmDialog({ title: 'Reemplazar todos los datos', html: '<p>Se eliminarán tus ' + U.plainNumber(St.all('transactions').length) + ' movimientos y demás datos actuales, y se cargarán los del archivo.</p><p>Primero se descargará un respaldo automático de tus datos actuales.</p>', confirmText: 'Reemplazar', danger: true, typeToConfirm: 'REEMPLAZAR' });
      if (!ok) return;
      if (!St.isEmpty()) ui.download('financial-backup-antes-de-importar-' + U.today() + '.json', JSON.stringify(IO.buildBackup(St), null, 1), 'application/json');
      const data = Object.assign({}, v.data);
      const keepSettings = St.settings();
      const incomingSettings = (data.settings || []).find(s => s.id === 'main');
      data.settings = [Object.assign({}, keepSettings, incomingSettings || {}, { id: 'main', privacyNoticeSeen: true })];
      try { await St.replaceAll(data); m.close(); ui.toast('Datos reemplazados correctamente.'); }
      catch (e) { ui.toast('No se pudo importar: ' + e.message + '. Tus datos no cambiaron.', { type: 'error', timeout: 8000 }); }
    });
  }

  async function importCSV() {
    const file = await ui.pickFile('.csv,text/csv,.txt');
    if (!file) return;
    let text;
    try { text = await ui.readText(file); } catch (e) { ui.toast(e.message, { type: 'error' }); return; }
    let createMissing = false, skipDup = true;
    const m = ui.modal({ title: 'Importar movimientos (CSV)', size: 'wide', body: '<div data-csv></div>', footer: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-go disabled>Importar</button>' });
    const go = m.el.querySelector('[data-go]');
    let prep;
    const draw = () => {
      prep = IO.prepareCSVImport(St, text, { createMissing });
      const host = m.el.querySelector('[data-csv]');
      if (!prep.ok) { host.innerHTML = '<div class="alert error">' + ui.icon('alert') + '<div>' + esc(prep.error) + '</div></div><button class="btn small ghost" data-tpl>Descargar plantilla CSV</button>'; go.disabled = true; host.querySelector('[data-tpl]').addEventListener('click', () => ui.download('plantilla-movimientos.csv', IO.csvTemplate(), 'text/csv')); return; }
      const toImport = prep.rows.filter(r => r.ok && !(skipDup && r.duplicate));
      host.innerHTML = '<p>' + U.plainNumber(prep.rows.length) + ' filas leídas (separador «' + (prep.delim === '\t' ? 'tab' : prep.delim) + '»): <b>' + prep.valid + ' válidas</b>, ' + prep.invalid + ' con errores' + (prep.duplicates ? ', ' + prep.duplicates + ' posibles duplicados' : '') + '.</p>' +
        '<label class="switch"><input type="checkbox" data-cm' + (createMissing ? ' checked' : '') + '><span>Crear las cuentas y categorías que no existan</span></label>' +
        (prep.toCreate.accounts.length || prep.toCreate.categories.length ? '<p class="muted small">Se crearán: ' + esc(prep.toCreate.accounts.map(a => 'cuenta «' + a.name + '»').concat(prep.toCreate.categories.map(c => 'categoría «' + c.name + '»')).join(', ')) + '.</p>' : '') +
        '<label class="switch"><input type="checkbox" data-dup' + (skipDup ? ' checked' : '') + '><span>Omitir posibles duplicados (misma fecha, valor, cuenta y descripción)</span></label>' +
        (prep.invalid ? '<details open><summary>Filas con errores (' + prep.invalid + ')</summary><ul class="csv-errors">' + prep.rows.filter(r => !r.ok).slice(0, 30).map(r => '<li>Línea ' + r.line + ': ' + esc(Object.values(r.errors).join(' ')) + '</li>').join('') + '</ul></details>' : '') +
        '<details><summary>Vista previa</summary><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Fecha</th><th>Tipo</th><th>Valor</th><th>Descripción</th><th></th></tr></thead><tbody>' + prep.rows.slice(0, 15).map(r => '<tr><td>' + esc(r.tx.date) + '</td><td>' + esc(S.TX_TYPES[r.tx.type] ? S.TX_TYPES[r.tx.type].short : r.tx.type) + '</td><td>' + (Number.isFinite(r.tx.amount) ? esc(U.money(r.tx.amount)) : '—') + '</td><td>' + esc(r.tx.description) + '</td><td>' + (r.ok ? (r.duplicate ? '<span class="badge warn">duplicado</span>' : '<span class="badge">ok</span>') : '<span class="badge over">error</span>') + '</td></tr>').join('') + '</tbody></table></div></details>';
      go.disabled = toImport.length === 0;
      go.textContent = 'Importar ' + toImport.length + ' movimiento(s)';
      host.querySelector('[data-cm]').addEventListener('change', e => { createMissing = e.target.checked; draw(); });
      host.querySelector('[data-dup]').addEventListener('change', e => { skipDup = e.target.checked; draw(); });
    };
    draw();
    go.addEventListener('click', async () => {
      const rows = prep.rows.filter(r => r.ok && !(skipDup && r.duplicate));
      if (!rows.length) return;
      go.disabled = true;
      try {
        if (prep.toCreate.categories.length) await St.saveMany('categories', prep.toCreate.categories);
        if (prep.toCreate.accounts.length) {
          const accs = prep.toCreate.accounts.map(a => { const first = rows.filter(r => r.tx.accountId === a.id || r.tx.toAccountId === a.id).map(r => r.tx.date).sort()[0]; return Object.assign({}, a, { openedAt: first || U.today() }); });
          await St.saveMany('accounts', accs);
        }
        await St.saveMany('transactions', rows.map(r => Object.assign({}, r.tx, { id: r.tx.id || U.uid('tra'), createdAt: r.tx.date + 'T12:00:00.000Z' })));
        m.close();
        ui.toast('Se importaron ' + rows.length + ' movimiento(s).');
      } catch (e) { go.disabled = false; ui.toast('Error al importar: ' + e.message, { type: 'error' }); }
    });
  }

  async function loadDemo() {
    if (St.hasDemo()) { ui.toast('Los datos de ejemplo ya están cargados.'); return; }
    const ok = await ui.confirmDialog({ title: 'Cargar datos de ejemplo', html: '<p>Se agregarán 12 meses de información ficticia (cuentas, movimientos, metas, inversiones, deudas) marcada como <b>demo</b>.</p><p>Tus datos reales no se modifican y podrás eliminar los de ejemplo cuando quieras.</p>', confirmText: 'Cargar ejemplo' });
    if (!ok) return;
    const r = await F.demo.load(St);
    ui.toast('Datos de ejemplo cargados (' + r.transactions + ' movimientos).');
    location.hash = '#/';
  }
  async function removeDemo() {
    const ok = await ui.confirmDialog({ title: 'Eliminar datos de ejemplo', message: 'Se eliminarán únicamente los registros marcados como demo. Tus datos reales se conservan.', confirmText: 'Eliminar ejemplo', danger: true });
    if (!ok) return;
    const r = await St.removeDemo();
    ui.toast('Se eliminaron ' + r.removed + ' registros de ejemplo.' + (r.kept.length ? ' Se conservaron ' + r.kept.length + ' porque los usan datos reales.' : ''), { timeout: 6000 });
  }
  async function wipeAll() {
    const ok = await ui.confirmDialog({ title: 'Borrar todos los datos', html: '<p>Se eliminará <b>todo</b>: cuentas, movimientos, metas, inversiones, deudas y configuración de este navegador.</p><p>Antes se descargará automáticamente un respaldo.</p>', confirmText: 'Borrar todo', danger: true, typeToConfirm: 'BORRAR' });
    if (!ok) return;
    if (!St.isEmpty()) ui.download('financial-backup-antes-de-borrar-' + U.today() + '.json', JSON.stringify(IO.buildBackup(St), null, 1), 'application/json');
    const now = new Date().toISOString();
    await St.replaceAll({ settings: [Object.assign({}, S.DEFAULT_SETTINGS, { privacyNoticeSeen: true, categoriesSeeded: true, currency: St.settings().currency })], categories: S.DEFAULT_CATEGORIES.map(c => Object.assign(U.deepClone(c), { createdAt: now, updatedAt: now })) });
    ui.toast('Datos borrados.');
    location.hash = '#/';
  }

  // ================================ AJUSTES ================================
  async function ajustes(el) {
    const st = St.settings();
    const counts = S.STORES.filter(s => s !== 'settings').map(s => [s, St.all(s).length]);
    const names = { accounts: 'Cuentas', categories: 'Categorías', transactions: 'Movimientos', recurring: 'Recurrentes', budgets: 'Presupuestos', goals: 'Metas', investments: 'Inversiones', debts: 'Deudas', assets: 'Otros activos' };
    el.innerHTML = '<div class="page">' + vh.pageHead('Datos y ajustes', '') +
      '<section class="card privacy">' + ui.icon('lock') + '<div><h2>Privacidad</h2><p>Tus datos se almacenan <b>solo en este dispositivo</b>, dentro del navegador (IndexedDB). La aplicación no tiene servidor, no envía información a ningún lugar, no usa analítica ni publicidad y funciona sin conexión.</p><p class="muted small">Si borras los datos del navegador, cambias de equipo o usas modo incógnito, los datos no estarán. Por eso es importante exportar respaldos.</p></div></section>' +
      '<div class="grid-2">' +
      vh.card('Copias de seguridad', '<p>Exporta un archivo <code>financial-backup-AAAA-MM-DD.json</code> con todos tus datos y guárdalo en un lugar seguro (nube personal, USB).</p>' +
        '<p class="muted small">Último respaldo: ' + (st.lastBackupAt ? esc(U.dateLabel(st.lastBackupAt.slice(0, 10))) : 'nunca') + '</p>' +
        '<div class="btn-row"><button class="btn primary" data-act="export-backup">' + ui.icon('download') + 'Exportar respaldo</button><button class="btn" data-act="import-backup">' + ui.icon('upload') + 'Importar respaldo</button></div>' +
        '<p class="muted small">Al importar se valida el archivo y puedes elegir combinar (sin borrar nada) o reemplazar (con confirmación y respaldo automático previo).</p>', { icon: 'shield' }) +
      vh.card('Exportar a CSV', '<p>Para abrir en Excel o Google Sheets (separador «;», compatible con configuración regional en español).</p><div class="btn-row">' +
        '<button class="btn" data-csv="tx">Movimientos</button><button class="btn" data-csv="monthly">Resumen mensual</button><button class="btn" data-csv="zip">Todo (.zip)</button></div>' +
        '<h3 class="h3">Importar movimientos desde CSV</h3><p class="muted small">Columnas mínimas: fecha, valor, cuenta. Opcionales: tipo, categoría, subcategoría, descripción, etiquetas, notas… Si no hay columna «tipo», los valores negativos se toman como gastos.</p>' +
        '<div class="btn-row"><button class="btn" data-act="import-csv">' + ui.icon('upload') + 'Importar CSV</button><button class="btn ghost" data-tpl>Descargar plantilla</button></div>') + '</div>' +
      '<div class="grid-2">' +
      vh.card('Preferencias', '<label class="field"><span class="lbl">Moneda principal</span><select data-set="currency">' + ui.options(Object.fromEntries(Object.entries(U.CURRENCIES).map(([k, c]) => [k, k + ' · ' + c.name])), st.currency) + '</select><span class="hint">Define el formato y qué cuentas se suman a los totales. No convierte monedas: las cuentas en otra moneda se muestran aparte.</span></label>' +
        '<label class="field"><span class="lbl">Apariencia</span><select data-set="theme">' + ui.options({ auto: 'Automática (según el sistema)', light: 'Clara', dark: 'Oscura' }, st.theme || 'auto') + '</select></label>') +
      vh.card('Datos de ejemplo', '<p>Carga 12 meses de información ficticia para explorar gráficos, análisis y filtros. Se marcan como «demo» y se pueden eliminar sin afectar tus datos reales.</p><div class="btn-row">' +
        (St.hasDemo() ? '<button class="btn danger" data-act="remove-demo">Eliminar datos de ejemplo</button>' : '<button class="btn" data-act="load-demo">Cargar datos de ejemplo</button>') + '</div>') + '</div>' +
      '<div class="grid-2">' + vh.card('Almacenamiento', '<div data-storage><p class="muted">Consultando…</p></div><table class="tbl compact"><tbody>' + counts.map(([k, n]) => '<tr><th>' + names[k] + '</th><td>' + U.plainNumber(n) + '</td></tr>').join('') + '</tbody></table>') +
      vh.card('Zona de cuidado', '<p>Elimina todos los datos de este navegador. Se descargará un respaldo antes de borrar.</p><button class="btn danger" data-wipe>Borrar todos los datos</button>', { cls: 'danger-zone' }) + '</div>' +
      '<p class="muted small center">Finanzas personales · formato de datos v' + S.SCHEMA_VERSION + ' · todo funciona localmente</p></div>';
    el.querySelectorAll('[data-set]').forEach(s => s.addEventListener('change', async () => {
      await St.saveSettings({ [s.dataset.set]: s.value });
      if (s.dataset.set === 'theme') F.app.applyTheme();
      ui.toast('Preferencia guardada');
    }));
    el.querySelectorAll('[data-csv]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.csv;
      if (k === 'tx') ui.download('movimientos-' + U.today() + '.csv', IO.transactionsCSV(St), 'text/csv;charset=utf-8');
      if (k === 'monthly') ui.download('resumen-mensual-' + U.today() + '.csv', IO.monthlyCSV(St), 'text/csv;charset=utf-8');
      if (k === 'zip') ui.download('finanzas-csv-' + U.today() + '.zip', new Blob([IO.makeZip(IO.allCSVFiles(St))], { type: 'application/zip' }));
    }));
    el.querySelector('[data-tpl]').addEventListener('click', () => ui.download('plantilla-movimientos.csv', IO.csvTemplate(), 'text/csv;charset=utf-8'));
    el.querySelector('[data-wipe]').addEventListener('click', wipeAll);
    const info = await St.adapter.estimate();
    const host = el.querySelector('[data-storage]');
    if (host) {
      host.innerHTML = '<p>Motor: <b>' + esc(info.kind) + '</b>' + (info.usage !== null ? ' · uso aprox. ' + U.plainNumber(info.usage / 1024 / 1024, 2) + ' MB' : '') + '</p>' +
        '<p>' + (info.persisted ? ui.icon('check', 'tiny') + ' Almacenamiento persistente concedido: el navegador no borrará los datos automáticamente.' : 'El navegador podría liberar espacio en situaciones extremas. ') + '</p>' +
        (info.persisted ? '' : '<button class="btn small" data-persist>Solicitar almacenamiento persistente</button>');
      const pb = host.querySelector('[data-persist]');
      if (pb) pb.addEventListener('click', async () => { const ok = await St.adapter.requestPersistence(); ui.toast(ok ? 'Almacenamiento persistente concedido' : 'El navegador no lo concedió (suele concederse al instalar o usar la app con frecuencia).'); ajustes(el); });
    }
  }

  // ================================ MÁS ================================
  function mas(el) {
    const sections = [
      ['Resumen', [['inicio', 'Inicio', 'home'], ['movimientos', 'Movimientos', 'list'], ['calendario', 'Calendario', 'calendar']]],
      ['Análisis', [['mes', 'Análisis mensual', 'chart'], ['anual', 'Análisis anual', 'chart'], ['ingresos', 'Ingresos', 'income'], ['gastos', 'Gastos', 'expense'], ['ahorro', 'Ahorro y flujo', 'coins'], ['proyeccion', 'Proyección', 'projection'], ['salud', 'Indicadores', 'pulse'], ['informes', 'Informes', 'file']]],
      ['Patrimonio', [['cuentas', 'Mis cuentas', 'wallet'], ['patrimonio', 'Patrimonio neto', 'layers'], ['inversiones', 'Inversiones', 'trending'], ['deudas', 'Deudas y préstamos', 'debt']]],
      ['Planeación', [['presupuestos', 'Presupuestos', 'target'], ['metas', 'Metas', 'target'], ['recurrentes', 'Recurrentes y suscripciones', 'repeat']]],
      ['Configuración', [['categorias', 'Categorías', 'tag'], ['ajustes', 'Datos, respaldo y ajustes', 'settings']]]
    ];
    el.innerHTML = '<div class="page">' + vh.pageHead('Todas las secciones', '') + sections.map(([t, items]) => '<section class="menu-sec"><h2>' + esc(t) + '</h2><div class="menu-grid">' + items.map(([r, l, i]) => '<a class="menu-tile" href="#/' + r + '">' + ui.icon(i) + '<span>' + esc(l) + '</span></a>').join('') + '</div></section>').join('') + '</div>';
  }

  Object.assign(F.views, {
    categorias: { title: 'Categorías', render: categorias },
    ajustes: { title: 'Datos y ajustes', render: ajustes },
    mas: { title: 'Más', render: mas }
  });
  F.actions = Object.assign(F.actions || {}, { exportBackup, importBackup, importCSV, loadDemo, removeDemo, wipeAll });
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
