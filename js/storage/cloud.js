/* =========================================================================
 * storage/cloud.js — Cuenta en la nube con Firebase (plan gratuito Spark).
 *
 * FirestoreAdapter implementa la MISMA interfaz que IndexedDBAdapter, así que
 * el resto de la app no cambia. Diseño pensado para el plan gratuito:
 *
 *   users/{uid}/data/{colección}   un documento por colección  { items: { id: registro } }
 *   users/{uid}/tx/{AAAA-MM}       un documento por mes         { items: { id: movimiento } }
 *
 * Así, abrir la app lee ~10 documentos + 1 por mes con movimientos (no uno por
 * movimiento), y cada cambio escribe solo el campo de ese registro, de modo que
 * dos dispositivos editando registros distintos no se pisan.
 *
 * Firestore guarda una copia local (funciona sin conexión) y encola los cambios
 * hasta que vuelve internet. Los cambios de otros dispositivos llegan en vivo.
 * ========================================================================= */
(function (F) {
  'use strict';

  const KEY = 'finanzas-cloud';
  const CHUNK = 400;                 // operaciones por lote (límite de Firestore: 500)
  const monthOf = (rec) => (rec && typeof rec.date === 'string' && /^\d{4}-\d{2}/.test(rec.date)) ? rec.date.slice(0, 7) : 'sin-fecha';
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ============================== Adaptador ==============================
  /**
   * opts: { fs (funciones del SDK), db, uid, account, onRemote(), onError(err), onStatus(status) }
   */
  function FirestoreAdapter(stores, opts) {
    this.stores = stores;
    this.kind = 'firestore';
    this.fs = opts.fs; this.db = opts.db; this.uid = opts.uid; this.account = opts.account || '';
    this.onRemote = opts.onRemote || function () {};
    this.onError = opts.onError || function (e) { console.error(e); };
    this.onStatus = opts.onStatus || function () {};
    this.everSynced = !!opts.everSynced;            // ¿este dispositivo ya recibió datos del servidor alguna vez?
    this.onSynced = opts.onSynced || function () {};
    this.firstSyncTimeoutMs = opts.firstSyncTimeoutMs || 25000;
    this.isOnline = opts.isOnline || (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    this.data = {};
    for (const s of stores) this.data[s] = new Map();
    this.txMonth = new Map();        // id de movimiento → mes donde está guardado
    this.months = new Set();         // meses con documento en la nube
    this.unsubs = [];
    this.opened = null;
    this.meta = { data: { pending: false, fromCache: true }, tx: { pending: false, fromCache: true } };
    this._remoteTimer = null;
  }
  const P = FirestoreAdapter.prototype;

  P._dataCol = function () { return this.fs.collection(this.db, 'users', this.uid, 'data'); };
  P._txCol = function () { return this.fs.collection(this.db, 'users', this.uid, 'tx'); };
  P._dataRef = function (store) { return this.fs.doc(this.db, 'users', this.uid, 'data', store); };
  P._txRef = function (month) { return this.fs.doc(this.db, 'users', this.uid, 'tx', month); };

  P.status = function () {
    const pending = this.meta.data.pending || this.meta.tx.pending;
    const offline = this.meta.data.fromCache || this.meta.tx.fromCache;
    return pending ? (offline ? 'offline-pending' : 'pending') : (offline ? 'offline' : 'synced');
  };

  P.open = function () {
    if (this.opened) return this.opened;
    const self = this;
    this.opened = new Promise((resolve, reject) => {
      let gotData = false, gotTx = false, done = false;
      const ready = () => {
        if (!done && gotData && gotTx) {
          done = true; clearTimeout(timer);
          if (!self.everSynced) { self.everSynced = true; self.onSynced(); }
          resolve(self);
        }
      };
      let failed = false;
      const fail = (err) => { if (failed) return; if (!done) { done = failed = true; clearTimeout(timer); self.close(); reject(err); } else self.onError(err); };
      // Primera vez en este dispositivo: esperar datos del SERVIDOR (no una caché vacía), para no
      // sobrescribir la cuenta con valores por defecto.
      const timer = this.everSynced ? null : setTimeout(() => {
        const e = new Error('Necesitas internet la primera vez que abres tu cuenta en este dispositivo.'); e.code = 'first-sync';
        fail(e);
      }, this.firstSyncTimeoutMs);
      const handle = (kind, snap) => {
        if (failed) return;
        if (!self.everSynced && snap.metadata.fromCache) {
          if (!self.isOnline()) { const e = new Error('Necesitas internet la primera vez que abres tu cuenta en este dispositivo.'); e.code = 'first-sync'; return fail(e); }
          return;  // esperar la respuesta del servidor
        }
        if (kind === 'data') self._applyData(snap); else self._applyTx(snap);
        self.meta[kind] = { pending: !!snap.metadata.hasPendingWrites, fromCache: !!snap.metadata.fromCache };
        self.onStatus(self.status());
        const first = kind === 'data' ? !gotData : !gotTx;
        if (kind === 'data') gotData = true; else gotTx = true;
        if (first) return ready();
        // Cambios hechos en OTRO dispositivo (no los nuestros pendientes).
        if (!snap.metadata.hasPendingWrites && snap.docChanges().length) {
          clearTimeout(self._remoteTimer);
          self._remoteTimer = setTimeout(() => self.onRemote(), 250);
        }
      };
      this.unsubs.push(this.fs.onSnapshot(this._dataCol(), { includeMetadataChanges: true }, (s) => handle('data', s), fail));
      this.unsubs.push(this.fs.onSnapshot(this._txCol(), { includeMetadataChanges: true }, (s) => handle('tx', s), fail));
    });
    return this.opened;
  };
  P.close = function () { for (const u of this.unsubs) { try { u(); } catch (_) {} } this.unsubs = []; this.opened = null; };

  P._applyData = function (snap) {
    for (const s of this.stores) if (s !== 'transactions') this.data[s] = new Map();
    snap.forEach((d) => {
      if (d.id === 'transactions' || !this.data[d.id]) return;
      const items = (d.data() || {}).items || {};
      this.data[d.id] = new Map(Object.entries(items));
    });
  };
  P._applyTx = function (snap) {
    const map = new Map(); this.txMonth = new Map(); this.months = new Set();
    snap.forEach((d) => {
      this.months.add(d.id);
      const items = (d.data() || {}).items || {};
      for (const [id, rec] of Object.entries(items)) { map.set(id, rec); this.txMonth.set(id, d.id); }
    });
    this.data.transactions = map;
  };

  // ---- escritura: se agrupa por documento y se envía sin esperar al servidor ----
  P._group = function () { return new Map(); };
  P._field = function (groups, ref, id, value) {
    const key = ref.path;
    let g = groups.get(key);
    if (!g) { g = { ref, items: {}, fields: [] }; groups.set(key, g); }
    g.items[id] = value;
    g.fields.push(new this.fs.FieldPath('items', id));
  };
  P._stage = function (groups, store, puts, dels) {
    const isTx = store === 'transactions';
    for (const id of dels || []) {
      if (!this.data[store].has(id) && !(isTx && this.txMonth.has(id))) continue;
      this.data[store].delete(id);
      if (isTx) {
        const m = this.txMonth.get(id);
        if (m) this._field(groups, this._txRef(m), id, this.fs.deleteField());
        this.txMonth.delete(id);
      } else this._field(groups, this._dataRef(store), id, this.fs.deleteField());
    }
    for (const rec of puts || []) {
      const r = clone(rec);
      this.data[store].set(r.id, r);
      if (isTx) {
        const m = monthOf(r), old = this.txMonth.get(r.id);
        if (old && old !== m) this._field(groups, this._txRef(old), r.id, this.fs.deleteField());
        this._field(groups, this._txRef(m), r.id, r);
        this.txMonth.set(r.id, m); this.months.add(m);
      } else this._field(groups, this._dataRef(store), r.id, r);
    }
  };
  P._send = function (writes) {
    // writes: [fn(batch)] — se parte en lotes y se confirma en segundo plano.
    const self = this;
    for (let i = 0; i < writes.length; i += CHUNK) {
      const b = this.fs.writeBatch(this.db);
      for (const w of writes.slice(i, i + CHUNK)) w(b);
      b.commit().catch((e) => self.onError(e));
    }
    return Promise.resolve();
  };
  P._flush = function (groups) {
    const writes = [];
    for (const g of groups.values()) writes.push((b) => b.set(g.ref, { items: g.items }, { mergeFields: g.fields }));
    return this._send(writes);
  };

  P.getAll = function (store) { return Promise.resolve([...this.data[store].values()].map(clone)); };
  P.put = function (store, rec) { return this.bulkPut(store, [rec]); };
  P.bulkPut = function (store, recs) { const g = this._group(); this._stage(g, store, recs, []); return this._flush(g); };
  P.delete = function (store, id) { return this.bulkDelete(store, [id]); };
  P.bulkDelete = function (store, ids) { const g = this._group(); this._stage(g, store, [], ids); return this._flush(g); };
  P.batch = function (ops) { const g = this._group(); for (const o of ops) this._stage(g, o.store, o.put, o.del); return this._flush(g); };
  P.clear = function (store) {
    if (store === 'transactions') {
      const writes = [...this.months].map((m) => (b) => b.delete(this._txRef(m)));
      this.data.transactions = new Map(); this.txMonth = new Map(); this.months = new Set();
      return this._send(writes);
    }
    this.data[store] = new Map();
    return this._send([(b) => b.set(this._dataRef(store), { items: {} })]);
  };
  /** Reemplaza todo el contenido de la cuenta. */
  P.replaceAll = function (data) {
    const writes = [];
    for (const s of this.stores) {
      if (s === 'transactions') continue;
      const items = {};
      for (const r of data[s] || []) items[r.id] = clone(r);
      this.data[s] = new Map(Object.entries(items));
      writes.push((b) => b.set(this._dataRef(s), { items }));
    }
    const byMonth = new Map();
    for (const r of data.transactions || []) { const m = monthOf(r); if (!byMonth.has(m)) byMonth.set(m, {}); byMonth.get(m)[r.id] = clone(r); }
    for (const m of this.months) if (!byMonth.has(m)) writes.push((b) => b.delete(this._txRef(m)));
    this.data.transactions = new Map(); this.txMonth = new Map(); this.months = new Set();
    for (const [m, items] of byMonth) {
      writes.push((b) => b.set(this._txRef(m), { items }));
      this.months.add(m);
      for (const [id, r] of Object.entries(items)) { this.data.transactions.set(id, r); this.txMonth.set(id, m); }
    }
    return this._send(writes);
  };
  P.estimate = function () {
    let tx = 0; const sizes = [];
    for (const m of this.months) { let n = 0; for (const v of this.txMonth.values()) if (v === m) n++; sizes.push(n); tx += n; }
    return Promise.resolve({ kind: 'Nube (Firebase)' + (this.account ? ' · ' + this.account : ''), persisted: true, usage: null, quota: null, cloud: true, months: this.months.size, maxPerMonth: Math.max(0, ...sizes) });
  };
  P.requestPersistence = function () { return Promise.resolve(true); };

  // ============================== Controlador ==============================
  function readState() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } }
  function writeState(patch) { const s = Object.assign(readState(), patch); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} return s; }

  /** Extrae { apiKey, authDomain, projectId, appId, … } de lo que se pegue (JSON o el fragmento de código de Firebase). */
  function parseConfig(text) {
    if (!text) return null;
    if (typeof text === 'object') return text && text.apiKey && text.projectId ? text : null;
    const out = {};
    for (const k of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']) {
      const m = new RegExp('["\']?' + k + '["\']?\\s*:\\s*["\']([^"\']+)["\']').exec(text);
      if (m) out[k] = m[1].trim();
    }
    if (!out.apiKey || !out.projectId) return null;
    if (!out.authDomain) out.authDomain = out.projectId + '.firebaseapp.com';
    return out;
  }

  const ERR = {
    'auth/invalid-email': 'El correo no es válido.',
    'auth/missing-password': 'Escribe la contraseña.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Usa «Entrar».',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/wrong-password': 'Correo o contraseña incorrectos.',
    'auth/user-not-found': 'No hay una cuenta con ese correo.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Sin conexión. Necesitas internet para iniciar sesión.',
    'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de Google.',
    'auth/operation-not-allowed': 'Ese método de inicio de sesión no está activado en tu proyecto de Firebase (Authentication → Método de acceso).',
    'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication → Configuración → Dominios autorizados).',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'La configuración de Firebase no es válida (apiKey).',
    'auth/invalid-api-key': 'La configuración de Firebase no es válida (apiKey).',
    'permission-denied': 'Firebase rechazó el acceso: revisa las reglas de Firestore.',
    'unavailable': 'Sin conexión con la nube: los cambios se guardan aquí y se suben al volver internet.',
    'resource-exhausted': 'Se alcanzó el límite gratuito diario de Firebase. Los cambios quedan guardados en este dispositivo y se subirán mañana.',
    'failed-precondition': 'La nube no está lista (¿creaste la base de datos Firestore?).',
    'first-sync': 'Necesitas internet la primera vez que abres tu cuenta en este dispositivo.',
    'not-found': 'No existe la base de datos Firestore en tu proyecto. Créala en la consola de Firebase.'
  };
  function errorText(e) {
    if (!e) return 'Error desconocido.';
    return ERR[e.code] || ERR[(e.code || '').replace(/^firestore\//, '')] || e.message || String(e);
  }

  const cloud = {
    sdk: null, app: null, auth: null, db: null, user: null, adapter: null,
    config() { return parseConfig(readState().config) || parseConfig((F.config || {}).firebase) || null; },
    hasBakedConfig() { return !!parseConfig((F.config || {}).firebase); },
    /** 'cloud' si el usuario eligió cuenta; 'local' si eligió solo este dispositivo. */
    mode() {
      const s = readState();
      if (s.mode) return s.mode;
      return this.hasBakedConfig() ? 'cloud' : 'local';
    },
    enabled() { return this.mode() === 'cloud' && !!this.config() && /^https?:$/.test(location.protocol); },
    saveConfig(text) { const c = parseConfig(text); if (!c) return null; writeState({ config: c }); return c; },
    setMode(m) { writeState({ mode: m }); },
    migratedFor(uid) { return !!(readState().migrated || {})[uid]; },
    markMigrated(uid) { const s = readState(); const m = Object.assign({}, s.migrated || {}, { [uid]: true }); writeState({ migrated: m }); },

    loadSDK() {
      if (window.FirebaseSDK) return Promise.resolve(window.FirebaseSDK);
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/firebase-sdk.js';
        s.onload = () => window.FirebaseSDK ? resolve(window.FirebaseSDK) : reject(new Error('No se pudo cargar Firebase.'));
        s.onerror = () => reject(new Error('No se pudo cargar Firebase (abre la app con internet una vez).'));
        document.head.appendChild(s);
      });
    },
    /** Inicia Firebase y espera a saber si hay sesión (funciona sin internet si ya habías entrado). */
    async boot() {
      const fb = this.sdk = await this.loadSDK();
      const cfg = this.config();
      this.app = fb.getApps().length ? fb.getApps()[0] : fb.initializeApp(cfg);
      this.auth = fb.initializeAuth(this.app, { persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence], popupRedirectResolver: fb.browserPopupRedirectResolver });
      let cache;
      try { cache = fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }); } catch (_) { cache = fb.memoryLocalCache(); }
      this.db = fb.initializeFirestore(this.app, { localCache: cache, ignoreUndefinedProperties: true });
      if (cfg.emulatorHost) {   // solo para pruebas locales con el emulador de Firebase
        fb.connectAuthEmulator(this.auth, 'http://' + cfg.emulatorHost + ':9099', { disableWarnings: true });
        fb.connectFirestoreEmulator(this.db, cfg.emulatorHost, 8080);
      }
      this.user = await new Promise((resolve) => { const off = fb.onAuthStateChanged(this.auth, (u) => { off(); resolve(u); }); });
      return this.user;
    },
    makeAdapter(stores, handlers) {
      const uid = this.user.uid;
      const synced = !!(readState().synced || {})[uid];
      this.adapter = new FirestoreAdapter(stores, Object.assign({
        fs: this.sdk, db: this.db, uid, account: this.user.email || '', everSynced: synced,
        onSynced: () => { const s = readState(); writeState({ synced: Object.assign({}, s.synced || {}, { [uid]: true }) }); }
      }, handlers));
      return this.adapter;
    },
    async signIn(email, pass) { return (await this.sdk.signInWithEmailAndPassword(this.auth, email, pass)).user; },
    async signUp(email, pass) { return (await this.sdk.createUserWithEmailAndPassword(this.auth, email, pass)).user; },
    async resetPassword(email) { return this.sdk.sendPasswordResetEmail(this.auth, email); },
    async google() { const p = new this.sdk.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return (await this.sdk.signInWithPopup(this.auth, p)).user; },
    /** Cierra sesión y borra la copia local de la nube de este dispositivo (privacidad). */
    async signOut() {
      if (this.adapter) this.adapter.close();
      try { await this.sdk.signOut(this.auth); } catch (_) {}
      try { await this.sdk.terminate(this.db); await this.sdk.clearIndexedDbPersistence(this.db); } catch (e) { console.warn(e); }
      if (this.user) { const s = readState(); const sy = Object.assign({}, s.synced || {}); delete sy[this.user.uid]; writeState({ synced: sy }); }
    },
    errorText, parseConfig
  };

  F.storage = F.storage || {};
  F.storage.FirestoreAdapter = FirestoreAdapter;
  F.storage.monthOf = monthOf;
  F.cloud = cloud;
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
