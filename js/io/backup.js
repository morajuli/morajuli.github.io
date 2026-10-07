/* =========================================================================
 * io/backup.js — Exportación e importación (JSON y CSV) + ZIP sin compresión.
 * Funciones puras: generan/leen texto; la descarga la hace la UI.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema;

  const APP_ID = 'finanzas-personales';

  // =============================== JSON ===============================
  function buildBackup(store) {
    const data = store.snapshot();
    const counts = {};
    for (const s of S.STORES) counts[s] = data[s].length;
    return {
      app: APP_ID, format: 'financial-backup', schemaVersion: S.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(), currency: store.settings().currency, counts, data
    };
  }
  function backupFileName(date) { return 'financial-backup-' + (date || U.today()) + '.json'; }

  /**
   * Valida un respaldo antes de importarlo. Nunca modifica datos.
   * Devuelve { ok, fatal[], invalid[{store,id,reason}], data (solo registros válidos), counts, meta }.
   * El orden de validación respeta dependencias (cuentas antes que movimientos).
   */
  function validateBackup(obj) {
    const fatal = [], invalid = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, fatal: ['El archivo no contiene un objeto JSON válido.'], invalid };
    const raw = obj.data && typeof obj.data === 'object' ? obj.data : null;
    if (obj.app !== APP_ID || !raw) fatal.push('El archivo no es un respaldo de esta aplicación (falta "app" o "data").');
    if (typeof obj.schemaVersion !== 'number') fatal.push('Falta la versión del formato (schemaVersion).');
    else if (obj.schemaVersion > S.SCHEMA_VERSION) fatal.push('El respaldo fue creado con una versión más reciente de la aplicación (v' + obj.schemaVersion + ').');
    if (fatal.length) return { ok: false, fatal, invalid };

    const clean = {};
    const ids = {};
    for (const s of S.STORES) {
      const arr = raw[s] === undefined ? [] : raw[s];
      if (!Array.isArray(arr)) { fatal.push('La colección "' + s + '" no es una lista.'); continue; }
      clean[s] = [];
      ids[s] = new Map();
    }
    if (fatal.length) return { ok: false, fatal, invalid };

    const ctx = {
      account: id => ids.accounts.get(id), category: id => ids.categories.get(id), investment: id => ids.investments.get(id),
      debt: id => ids.debts.get(id), goal: id => ids.goals.get(id)
    };
    const order = ['settings', 'accounts', 'categories', 'investments', 'debts', 'assets', 'goals', 'budgets', 'recurring', 'transactions'];
    for (const s of order) {
      const seen = new Set();
      for (const rec of raw[s] || []) {
        if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) { invalid.push({ store: s, id: '?', reason: 'Registro sin id.' }); continue; }
        if (seen.has(rec.id)) { invalid.push({ store: s, id: rec.id, reason: 'Id duplicado.' }); continue; }
        seen.add(rec.id);
        let v;
        if (s === 'settings') v = { ok: rec.id === 'main' && (!rec.currency || !!U.CURRENCIES[rec.currency]), errors: { currency: 'Configuración inválida.' } };
        else if (s === 'categories') v = S.validateCategory(rec, clean.categories);
        else if (s === 'budgets') v = S.validateBudget(rec, ctx, clean.budgets);
        else if (s === 'accounts' || s === 'investments' || s === 'debts' || s === 'assets') v = S.VALIDATORS[s](rec);
        else v = S.VALIDATORS[s](rec, ctx);
        if (!v.ok) { invalid.push({ store: s, id: rec.id, reason: Object.values(v.errors)[0] || 'Inválido.' }); continue; }
        clean[s].push(rec);
        ids[s].set(rec.id, rec);
      }
    }
    const counts = {};
    for (const s of S.STORES) counts[s] = clean[s].length;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) fatal.push('El respaldo no contiene registros válidos.');
    return {
      ok: fatal.length === 0, fatal, invalid, data: clean, counts,
      meta: { exportedAt: obj.exportedAt || null, currency: obj.currency || null, schemaVersion: obj.schemaVersion }
    };
  }

  function parseJSONText(text) {
    try { return { ok: true, value: JSON.parse(String(text).replace(/^﻿/, '')) }; }
    catch (e) { return { ok: false, error: 'El archivo no es JSON válido o está dañado (' + e.message + ').' }; }
  }

  // =============================== CSV ===============================
  function csvCell(v, delim) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /["\n\r]/.test(s) || s.includes(delim) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(header, rows, delim) {
    delim = delim || ';';
    return '﻿' + [header, ...rows].map(r => r.map(c => csvCell(c, delim)).join(delim)).join('\r\n') + '\r\n';
  }
  function csvNumber(n) {
    if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
    const x = U.round2(Number(n));
    return Number.isInteger(x) ? String(x) : String(x).replace('.', ',');
  }

  /** RFC 4180 con detección de delimitador (; , o tabulador). */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/)[0] || '';
    const counts = { ';': (firstLine.match(/;/g) || []).length, ',': (firstLine.match(/,/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(c => c.trim() !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row);
    return { delim, rows };
  }

  const TX_HEADER = ['id', 'fecha', 'tipo', 'valor', 'moneda', 'cuenta', 'cuenta_destino', 'categoria', 'subcategoria', 'descripcion', 'metodo_pago', 'etiquetas', 'notas', 'naturaleza', 'persona', 'inversion', 'deuda', 'meta', 'intereses', 'recurrente'];

  function transactionsCSV(db, list) {
    list = list || db.all('transactions').slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const name = (s, id) => { const r = db.get(s, id); return r ? r.name : ''; };
    const rows = list.map(t => {
      const acc = db.get('accounts', t.accountId);
      return [t.id, t.date, S.TX_TYPES[t.type] ? S.TX_TYPES[t.type].label : t.type, csvNumber(t.amount), acc ? acc.currency : '',
        name('accounts', t.accountId), name('accounts', t.toAccountId), name('categories', t.categoryId), t.subcategory || '',
        t.description || '', t.paymentMethod || '', (t.tags || []).join(' '), t.notes || '',
        t.type === 'expense' ? S.NATURES[t.nature || ((db.get('categories', t.categoryId) || {}).nature) || 'variable'] : '',
        S.PERSONS[t.person || 'personal'] || '', name('investments', t.investmentId), name('debts', t.debtId), name('goals', t.goalId),
        t.type === 'debt_payment' ? csvNumber(t.interestAmount || 0) : '', t.recurring ? 'sí' : 'no'];
    });
    return toCSV(TX_HEADER, rows);
  }

  /** CSV genérico de cualquier colección (aplana objetos y listas). */
  function storeCSV(db, store) {
    const recs = db.all(store);
    const keys = [];
    for (const r of recs) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    const rows = recs.map(r => keys.map(k => {
      const v = r[k];
      if (Array.isArray(v)) return v.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(' | ');
      if (v && typeof v === 'object') return JSON.stringify(v);
      if (typeof v === 'number') return csvNumber(v);
      return v;
    }));
    return toCSV(keys, rows);
  }

  function monthlyCSV(db) {
    const A = F.analytics, L = F.ledger;
    const series = A.monthlySeries(db, L.firstDataMonth(db), U.currentMonthKey());
    const rows = series.map(r => [r.key, csvNumber(r.income), csvNumber(r.expense), csvNumber(r.net), csvNumber(r.saving), csvNumber(r.investment),
      r.savingsRate === null ? '' : csvNumber(r.savingsRate), csvNumber(r.fixed), csvNumber(r.variable), r.netWorth === null ? '' : csvNumber(r.netWorth)]);
    return toCSV(['mes', 'ingresos', 'gastos', 'flujo_neto', 'ahorro', 'inversion', 'tasa_ahorro_pct', 'gastos_fijos', 'gastos_variables', 'patrimonio_cierre'], rows);
  }

  // --------- Importación CSV de movimientos ---------
  const HEADER_ALIASES = {
    id: ['id'], date: ['fecha', 'date', 'dia'], type: ['tipo', 'type'], amount: ['valor', 'monto', 'amount', 'importe', 'cantidad'],
    account: ['cuenta', 'account', 'cuenta_origen', 'origen'], toAccount: ['cuenta_destino', 'destino', 'to_account'],
    category: ['categoria', 'category'], subcategory: ['subcategoria', 'subcategory'], description: ['descripcion', 'description', 'concepto', 'detalle'],
    paymentMethod: ['metodo_pago', 'metodo', 'payment_method'], tags: ['etiquetas', 'tags'], notes: ['notas', 'notes', 'nota'],
    nature: ['naturaleza', 'fijo_variable', 'nature'], person: ['persona', 'person'], interest: ['intereses', 'interes'],
    investment: ['inversion', 'investment'], debt: ['deuda', 'prestamo', 'debt'], goal: ['meta', 'goal']
  };
  function typeFromText(s) {
    const n = U.normalizeText(s).trim();
    if (!n) return null;
    for (const [k, t] of Object.entries(S.TX_TYPES)) if (n === k || n === U.normalizeText(t.label) || n === U.normalizeText(t.short)) return k;
    const extra = { ingresos: 'income', gastos: 'expense', egreso: 'expense', egresos: 'expense', transferencias: 'transfer' };
    return extra[n] || null;
  }

  /**
   * Prepara una importación CSV: interpreta cada fila y la valida sin guardar.
   * opts: { createMissing: bool, defaultAccountId }
   */
  function prepareCSVImport(db, text, opts) {
    opts = opts || {};
    const { rows, delim } = parseCSV(text);
    if (rows.length < 2) return { ok: false, error: 'El archivo no tiene filas de datos (se espera una fila de encabezados y al menos un movimiento).' };
    const header = rows[0].map(h => U.normalizeText(h).trim().replace(/\s+/g, '_'));
    const col = {};
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) { const i = header.findIndex(h => aliases.includes(h)); if (i >= 0) col[key] = i; }
    const missing = ['date', 'amount'].filter(k => col[k] === undefined);
    if (col.account === undefined && !opts.defaultAccountId) missing.push('account');
    if (missing.length) {
      const names = { date: 'fecha', amount: 'valor', account: 'cuenta' };
      return { ok: false, error: 'Faltan columnas obligatorias: ' + missing.map(m => names[m]).join(', ') + '. Descarga la plantilla para ver el formato.' };
    }
    const accByName = new Map(db.all('accounts').map(a => [U.normalizeText(a.name), a]));
    const catByName = new Map(db.all('categories').map(c => [c.kind + ':' + U.normalizeText(c.name), c]));
    const toCreate = { accounts: new Map(), categories: new Map() };
    const existingKeys = new Set(db.all('transactions').map(t => [t.date, t.amount, t.accountId, U.normalizeText(t.description)].join('|')));
    const existingIds = new Set(db.all('transactions').map(t => t.id));
    const out = [];
    const get = (r, k) => col[k] === undefined ? '' : String(r[col[k]] === undefined ? '' : r[col[k]]).trim();

    const resolveAccount = (name, errors, field) => {
      if (!name) return null;
      const n = U.normalizeText(name);
      if (accByName.has(n)) return accByName.get(n).id;
      if (toCreate.accounts.has(n)) return toCreate.accounts.get(n).id;
      if (opts.createMissing) {
        const a = { id: U.uid('acc'), name: name.slice(0, 60), type: 'bank', purpose: 'spending', currency: U.getBaseCurrency(), initialBalance: 0, openedAt: '2000-01-01', notes: 'Creada al importar CSV' };
        toCreate.accounts.set(n, a);
        return a.id;
      }
      errors[field] = 'La cuenta "' + name + '" no existe.';
      return null;
    };
    const resolveCategory = (name, kind, errors) => {
      if (!name) return null;
      const n = kind + ':' + U.normalizeText(name);
      if (catByName.has(n)) return catByName.get(n).id;
      if (toCreate.categories.has(n)) return toCreate.categories.get(n).id;
      const other = catByName.get((kind === 'income' ? 'expense' : 'income') + ':' + U.normalizeText(name));
      if (other && kind !== 'income' && kind !== 'expense') return other.id;
      if (opts.createMissing && (kind === 'income' || kind === 'expense')) {
        const c = { id: U.uid('cat'), name: name.slice(0, 40), group: kind === 'income' ? 'Ingresos' : 'Otros', kind, nature: 'variable', subcategories: [], color: '#8b93a0' };
        toCreate.categories.set(n, c);
        return c.id;
      }
      errors.categoryId = 'La categoría "' + name + '" no existe' + (kind === 'income' ? ' como categoría de ingreso.' : '.');
      return null;
    };

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const errors = {};
      const rawAmount = get(r, 'amount');
      const negative = /^\s*[-−(]/.test(rawAmount);
      const amount = U.parseAmount(rawAmount.replace(/^[-−(]|\)$/g, ''));
      let type = typeFromText(get(r, 'type'));
      if (!type && get(r, 'type')) errors.type = 'Tipo desconocido: "' + get(r, 'type') + '".';
      if (!type) type = negative ? 'expense' : (col.type === undefined ? 'income' : 'expense');
      const date = U.normalizeDate(get(r, 'date'));
      if (!date) errors.date = 'Fecha inválida: "' + get(r, 'date') + '" (usa AAAA-MM-DD o DD/MM/AAAA).';
      const tx = {
        id: get(r, 'id') && !existingIds.has(get(r, 'id')) ? get(r, 'id') : undefined,
        date: date || '', type, amount: Number.isFinite(amount) ? amount : NaN,
        accountId: resolveAccount(get(r, 'account'), errors, 'accountId') || (col.account === undefined ? opts.defaultAccountId : null),
        toAccountId: resolveAccount(get(r, 'toAccount'), errors, 'toAccountId'),
        categoryId: null, subcategory: get(r, 'subcategory').slice(0, 40), description: get(r, 'description').slice(0, 200),
        paymentMethod: get(r, 'paymentMethod').slice(0, 40), tags: U.parseTags(get(r, 'tags')), notes: get(r, 'notes').slice(0, 2000),
        person: 'personal', recurring: false
      };
      const cat = get(r, 'category');
      if (cat) tx.categoryId = resolveCategory(cat, type, errors);
      else if (type === 'income') tx.categoryId = S.FALLBACK_INCOME_CATEGORY;
      else if (type === 'expense') tx.categoryId = S.FALLBACK_EXPENSE_CATEGORY;
      const nat = U.normalizeText(get(r, 'nature'));
      if (type === 'expense' && nat) tx.nature = nat.startsWith('fij') || nat === 'fixed' ? 'fixed' : 'variable';
      const per = U.normalizeText(get(r, 'person'));
      for (const [k, v] of Object.entries(S.PERSONS)) if (per === k || per === U.normalizeText(v)) tx.person = k;
      if (type === 'debt_payment') { const ia = U.parseAmount(get(r, 'interest') || '0'); tx.interestAmount = Number.isFinite(ia) ? ia : 0; }
      const byName = (store, name) => db.all(store).find(x => U.normalizeText(x.name) === U.normalizeText(name));
      if (type === 'investment' || type === 'investment_withdrawal') {
        const inv = byName('investments', get(r, 'investment'));
        if (inv) tx.investmentId = inv.id; else errors.investmentId = 'Inversión no encontrada: "' + get(r, 'investment') + '" (créala primero en Inversiones).';
      }
      if (type === 'debt_payment' || type === 'loan_received' || type === 'loan_given') {
        const d = byName('debts', get(r, 'debt'));
        if (d) tx.debtId = d.id; else errors.debtId = 'Deuda no encontrada: "' + get(r, 'debt') + '" (créala primero en Deudas).';
      }
      if (get(r, 'goal')) { const g = byName('goals', get(r, 'goal')); if (g) tx.goalId = g.id; }
      // Validación con el mismo validador que la app (incluye cuentas que se crearían)
      const ctxAcc = id => db.get('accounts', id) || [...toCreate.accounts.values()].find(a => a.id === id);
      const ctxCat = id => db.get('categories', id) || [...toCreate.categories.values()].find(c => c.id === id);
      const v = S.validateTransaction(tx, { account: ctxAcc, category: ctxCat, investment: id => db.get('investments', id), debt: id => db.get('debts', id), goal: id => db.get('goals', id) });
      Object.assign(v.errors, errors);
      const dupKey = [tx.date, tx.amount, tx.accountId, U.normalizeText(tx.description)].join('|');
      out.push({ line: i + 1, tx, errors: v.errors, ok: Object.keys(v.errors).length === 0, duplicate: existingKeys.has(dupKey) });
    }
    return {
      ok: true, delim, rows: out, valid: out.filter(r => r.ok).length, invalid: out.filter(r => !r.ok).length,
      duplicates: out.filter(r => r.ok && r.duplicate).length,
      toCreate: { accounts: [...toCreate.accounts.values()], categories: [...toCreate.categories.values()] }
    };
  }

  function csvTemplate() {
    return toCSV(TX_HEADER.slice(1), [
      ['2026-10-02', 'Gasto', '25000', 'COP', 'Nequi', '', 'Alimentación', 'Restaurante', 'Almuerzo', 'Billetera digital', 'trabajo', '', 'Variable', 'Personal', '', '', '', '', 'no'],
      ['2026-10-01', 'Ingreso', '2000000', 'COP', 'Bancolombia', '', 'Salario', 'Nómina', 'Salario octubre', 'Transferencia', '', '', '', 'Personal', '', '', '', '', 'no'],
      ['2026-10-03', 'Transferencia', '200000', 'COP', 'Bancolombia', 'Nu', '', '', 'Paso a Nu', '', '', '', '', 'Personal', '', '', '', '', 'no']
    ]);
  }

  // =============================== ZIP (almacenado, sin compresión) ===============================
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  /** files: [{name, text}] → Uint8Array con un .zip válido. */
  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
    let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  function allCSVFiles(db) {
    const files = [{ name: 'movimientos.csv', text: transactionsCSV(db) }, { name: 'resumen_mensual.csv', text: monthlyCSV(db) }];
    const names = { accounts: 'cuentas', categories: 'categorias', recurring: 'recurrentes', budgets: 'presupuestos', goals: 'metas', investments: 'inversiones', debts: 'deudas', assets: 'otros_activos_pasivos' };
    for (const [s, n] of Object.entries(names)) files.push({ name: n + '.csv', text: storeCSV(db, s) });
    return files;
  }

  F.io = {
    APP_ID, buildBackup, backupFileName, validateBackup, parseJSONText, toCSV, parseCSV, transactionsCSV, storeCSV, monthlyCSV,
    prepareCSVImport, csvTemplate, makeZip, crc32, allCSVFiles, TX_HEADER
  };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
