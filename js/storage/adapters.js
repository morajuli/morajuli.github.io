/* =========================================================================
 * storage/adapters.js — Adaptadores de persistencia intercambiables.
 *
 * Todos implementan la misma interfaz asíncrona:
 *   open() · getAll(store) · put(store, record) · bulkPut(store, records)
 *   delete(store, id) · bulkDelete(store, ids) · clear(store)
 *   replaceAll(dataByStore) · estimate()
 *
 * Para migrar a un backend basta con escribir un ApiAdapter con estos
 * mismos métodos (p. ej. GET /api/:store, PUT /api/:store/:id ...).
 * ========================================================================= */
(function (F) {
  'use strict';

  const DB_NAME = 'finanzas-personales';
  const DB_VERSION = 1;

  // ---------------- IndexedDB ----------------
  function IndexedDBAdapter(stores) {
    this.stores = stores;
    this.db = null;
    this.kind = 'indexeddb';
  }
  function req2promise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transacción cancelada'));
    });
  }
  IndexedDBAdapter.prototype.open = function () {
    const self = this;
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB no está disponible en este navegador.'));
      let request;
      try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch (err) { return reject(err); }
      request.onupgradeneeded = (ev) => {
        const db = request.result;
        // Migraciones por versión: añadir aquí futuros cambios de esquema.
        if (ev.oldVersion < 1) {
          for (const s of self.stores) {
            if (!db.objectStoreNames.contains(s)) {
              const os = db.createObjectStore(s, { keyPath: 'id' });
              if (s === 'transactions') { os.createIndex('date', 'date'); os.createIndex('accountId', 'accountId'); }
            }
          }
        }
      };
      request.onsuccess = () => {
        self.db = request.result;
        self.db.onversionchange = () => { self.db.close(); };
        resolve(self);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña.'));
    });
  };
  IndexedDBAdapter.prototype.getAll = function (store) {
    const tx = this.db.transaction(store, 'readonly');
    return req2promise(tx.objectStore(store).getAll());
  };
  IndexedDBAdapter.prototype.put = function (store, record) { return this.bulkPut(store, [record]); };
  IndexedDBAdapter.prototype.bulkPut = function (store, records) {
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const r of records) os.put(r);
    return txDone(tx);
  };
  IndexedDBAdapter.prototype.delete = function (store, id) { return this.bulkDelete(store, [id]); };
  IndexedDBAdapter.prototype.bulkDelete = function (store, ids) {
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const id of ids) os.delete(id);
    return txDone(tx);
  };
  IndexedDBAdapter.prototype.clear = function (store) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    return txDone(tx);
  };
  /** Reemplaza todo el contenido en UNA transacción atómica (o todo o nada). */
  IndexedDBAdapter.prototype.replaceAll = function (data) {
    const tx = this.db.transaction(this.stores, 'readwrite');
    for (const s of this.stores) {
      const os = tx.objectStore(s);
      os.clear();
      for (const r of data[s] || []) os.put(r);
    }
    return txDone(tx);
  };
  /** Aplica varias operaciones en distintas colecciones de forma atómica. ops: [{store, put:[...], del:[...]}] */
  IndexedDBAdapter.prototype.batch = function (ops) {
    const names = [...new Set(ops.map(o => o.store))];
    if (!names.length) return Promise.resolve();
    const tx = this.db.transaction(names, 'readwrite');
    for (const o of ops) {
      const os = tx.objectStore(o.store);
      for (const r of o.put || []) os.put(r);
      for (const id of o.del || []) os.delete(id);
    }
    return txDone(tx);
  };
  IndexedDBAdapter.prototype.estimate = async function () {
    const out = { kind: 'IndexedDB', persisted: null, usage: null, quota: null };
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        out.usage = e.usage; out.quota = e.quota;
      }
      if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    } catch (_) { /* sin datos de cuota */ }
    return out;
  };
  /** Pide al navegador que no borre los datos automáticamente (almacenamiento persistente). */
  IndexedDBAdapter.prototype.requestPersistence = async function () {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (_) {}
    return false;
  };

  // ---------------- Memoria (pruebas / navegador sin IndexedDB) ----------------
  function MemoryAdapter(stores) {
    this.stores = stores;
    this.kind = 'memory';
    this.data = {};
    for (const s of stores) this.data[s] = new Map();
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  MemoryAdapter.prototype.open = function () { return Promise.resolve(this); };
  MemoryAdapter.prototype.getAll = function (s) { return Promise.resolve([...this.data[s].values()].map(clone)); };
  MemoryAdapter.prototype.put = function (s, r) { this.data[s].set(r.id, clone(r)); return Promise.resolve(); };
  MemoryAdapter.prototype.bulkPut = function (s, rs) { for (const r of rs) this.data[s].set(r.id, clone(r)); return Promise.resolve(); };
  MemoryAdapter.prototype.delete = function (s, id) { this.data[s].delete(id); return Promise.resolve(); };
  MemoryAdapter.prototype.bulkDelete = function (s, ids) { for (const id of ids) this.data[s].delete(id); return Promise.resolve(); };
  MemoryAdapter.prototype.clear = function (s) { this.data[s].clear(); return Promise.resolve(); };
  MemoryAdapter.prototype.replaceAll = function (data) {
    for (const s of this.stores) { this.data[s] = new Map(); for (const r of data[s] || []) this.data[s].set(r.id, clone(r)); }
    return Promise.resolve();
  };
  MemoryAdapter.prototype.batch = function (ops) {
    for (const o of ops) { for (const r of o.put || []) this.data[o.store].set(r.id, clone(r)); for (const id of o.del || []) this.data[o.store].delete(id); }
    return Promise.resolve();
  };
  MemoryAdapter.prototype.estimate = function () { return Promise.resolve({ kind: 'Memoria (temporal)', persisted: false, usage: null, quota: null }); };
  MemoryAdapter.prototype.requestPersistence = function () { return Promise.resolve(false); };

  F.storage = F.storage || {};
  F.storage.IndexedDBAdapter = IndexedDBAdapter;
  F.storage.MemoryAdapter = MemoryAdapter;
  F.storage.DB_NAME = DB_NAME;
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
