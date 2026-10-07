/* =========================================================================
 * storage/store.js — Repositorio de datos.
 *
 * - Mantiene una copia en memoria (caché) de todas las colecciones para que
 *   los análisis sean instantáneos, y escribe cada cambio en el adaptador
 *   (IndexedDB). La interfaz nunca habla con IndexedDB directamente.
 * - Valida cada registro antes de guardarlo y protege la integridad
 *   referencial (no se puede borrar una cuenta con movimientos, etc.).
 * - Emite eventos 'change' para que la UI se actualice.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema;

  function ValidationError(errors, message) {
    this.name = 'ValidationError';
    this.errors = errors || {};
    this.message = message || Object.values(this.errors)[0] || 'Datos inválidos.';
  }
  ValidationError.prototype = Object.create(Error.prototype);

  const Store = {
    adapter: null,
    cache: {},
    index: {},
    listeners: [],
    ready: false,

    async init(adapter) {
      this.adapter = await adapter.open();
      for (const s of S.STORES) {
        const rows = await this.adapter.getAll(s);
        this._setCache(s, rows);
      }
      // Primer uso: configuración y categorías por defecto.
      if (!this.index.settings.get('main')) {
        const st = Object.assign({}, S.DEFAULT_SETTINGS, { createdAt: new Date().toISOString() });
        await this.adapter.put('settings', st);
        this._setCache('settings', [st]);
      }
      if (this.cache.categories.length === 0 && !this.settings().categoriesSeeded) {
        const now = new Date().toISOString();
        const cats = S.DEFAULT_CATEGORIES.map(c => Object.assign({}, U.deepClone(c), { createdAt: now, updatedAt: now }));
        await this.adapter.bulkPut('categories', cats);
        this._setCache('categories', cats);
        await this.saveSettings({ categoriesSeeded: true });
      }
      U.setBaseCurrency(this.settings().currency);
      this.ready = true;
      this.emit({ store: '*', action: 'init' });
      return this;
    },

    _setCache(store, rows) {
      this.cache[store] = rows;
      this.index[store] = new Map(rows.map(r => [r.id, r]));
    },
    _upsertCache(store, rec) {
      if (this.index[store].has(rec.id)) {
        const i = this.cache[store].findIndex(r => r.id === rec.id);
        this.cache[store][i] = rec;
      } else this.cache[store].push(rec);
      this.index[store].set(rec.id, rec);
    },
    _removeCache(store, ids) {
      const set = new Set(ids);
      this.cache[store] = this.cache[store].filter(r => !set.has(r.id));
      for (const id of ids) this.index[store].delete(id);
    },

    on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; },
    emit(detail) { for (const fn of this.listeners) { try { fn(detail); } catch (e) { console.error(e); } } },

    all(store) { return this.cache[store] || []; },
    get(store, id) { return id ? this.index[store].get(id) : undefined; },
    settings() { return this.index.settings.get('main') || S.DEFAULT_SETTINGS; },

    /** Contexto de búsqueda para validaciones referenciales. */
    ctx() {
      return {
        account: id => this.get('accounts', id),
        category: id => this.get('categories', id),
        investment: id => this.get('investments', id),
        debt: id => this.get('debts', id),
        goal: id => this.get('goals', id)
      };
    },

    validate(store, rec) {
      const v = S.VALIDATORS[store];
      if (!v) return { ok: true, errors: {} };
      if (store === 'categories') return v(rec, this.all('categories'));
      if (store === 'budgets') return v(rec, this.ctx(), this.all('budgets'));
      if (store === 'accounts' || store === 'investments' || store === 'debts' || store === 'assets') return v(rec);
      return v(rec, this.ctx());
    },

    /** Crea o actualiza un registro después de validarlo. Devuelve el registro guardado. */
    async save(store, record) {
      const rec = U.deepClone(record);
      const isNew = !rec.id || !this.index[store].has(rec.id);
      if (!rec.id) rec.id = U.uid(store.slice(0, 3));
      const v = this.validate(store, rec);
      if (!v.ok) throw new ValidationError(v.errors);
      const nowIso = new Date().toISOString();
      if (isNew) rec.createdAt = rec.createdAt || nowIso;
      rec.updatedAt = nowIso;
      await this.adapter.put(store, rec);
      this._upsertCache(store, rec);
      this.emit({ store, action: isNew ? 'create' : 'update', id: rec.id });
      return rec;
    },

    /** Guarda muchos registros de una vez (importaciones). Deben venir ya validados. */
    async saveMany(store, records) {
      const nowIso = new Date().toISOString();
      const recs = records.map(r => Object.assign({ createdAt: nowIso }, U.deepClone(r), { updatedAt: r.updatedAt || nowIso }));
      await this.adapter.bulkPut(store, recs);
      for (const r of recs) this._upsertCache(store, r);
      this.emit({ store, action: 'bulk' });
      return recs;
    },

    async saveSettings(patch) {
      const st = Object.assign({}, this.settings(), patch, { id: 'main', updatedAt: new Date().toISOString() });
      if (!U.CURRENCIES[st.currency]) throw new ValidationError({ currency: 'Moneda no soportada.' });
      await this.adapter.put('settings', st);
      this._upsertCache('settings', st);
      U.setBaseCurrency(st.currency);
      this.emit({ store: 'settings', action: 'update' });
      return st;
    },

    /** Lista de usos de un registro (para impedir borrados que romperían datos). */
    usages(store, id) {
      const tx = this.all('transactions'), rc = this.all('recurring');
      switch (store) {
        case 'accounts': return {
          transactions: tx.filter(t => t.accountId === id || t.toAccountId === id).length,
          recurring: rc.filter(r => r.accountId === id || r.toAccountId === id).length,
          goals: this.all('goals').filter(g => g.accountId === id).length
        };
        case 'categories': return {
          transactions: tx.filter(t => t.categoryId === id).length,
          recurring: rc.filter(r => r.categoryId === id).length,
          budgets: this.all('budgets').filter(b => b.categoryId === id).length
        };
        case 'investments': return { transactions: tx.filter(t => t.investmentId === id).length, recurring: rc.filter(r => r.investmentId === id).length };
        case 'debts': return { transactions: tx.filter(t => t.debtId === id).length, recurring: rc.filter(r => r.debtId === id).length };
        case 'goals': return { transactions: tx.filter(t => t.goalId === id).length };
        default: return {};
      }
    },

    /**
     * Elimina un registro.
     * opts.replacementCategoryId: para categorías en uso, reasigna sus movimientos.
     * opts.cascade: para inversiones/deudas, elimina también sus movimientos.
     */
    async remove(store, id, opts) {
      opts = opts || {};
      const rec = this.get(store, id);
      if (!rec) return;
      const ops = [];
      const u = this.usages(store, id);
      if (store === 'accounts' && (u.transactions || u.recurring)) {
        throw new ValidationError({}, 'La cuenta tiene ' + u.transactions + ' movimiento(s) y ' + u.recurring + ' recurrente(s). Archívala en lugar de eliminarla para conservar el histórico.');
      }
      if (store === 'accounts' && u.goals) {
        ops.push({ store: 'goals', put: this.all('goals').filter(g => g.accountId === id).map(g => Object.assign({}, g, { accountId: null })) });
      }
      if (store === 'categories') {
        if (rec.id === S.FALLBACK_EXPENSE_CATEGORY || rec.id === S.FALLBACK_INCOME_CATEGORY) throw new ValidationError({}, 'Esta categoría se usa como respaldo y no se puede eliminar.');
        if (u.transactions || u.recurring) {
          const rep = this.get('categories', opts.replacementCategoryId);
          if (!rep || rep.kind !== rec.kind || rep.id === id) throw new ValidationError({}, 'Elige una categoría de reemplazo del mismo tipo.');
          ops.push({ store: 'transactions', put: this.all('transactions').filter(t => t.categoryId === id).map(t => Object.assign({}, t, { categoryId: rep.id, subcategory: '' })) });
          ops.push({ store: 'recurring', put: this.all('recurring').filter(r => r.categoryId === id).map(r => Object.assign({}, r, { categoryId: rep.id, subcategory: '' })) });
        }
        if (u.budgets) ops.push({ store: 'budgets', del: this.all('budgets').filter(b => b.categoryId === id).map(b => b.id) });
      }
      if ((store === 'investments' || store === 'debts') && (u.transactions || u.recurring)) {
        if (!opts.cascade) throw new ValidationError({}, 'Tiene ' + u.transactions + ' movimiento(s) asociados.');
        const key = store === 'investments' ? 'investmentId' : 'debtId';
        ops.push({ store: 'transactions', del: this.all('transactions').filter(t => t[key] === id).map(t => t.id) });
        ops.push({ store: 'recurring', del: this.all('recurring').filter(r => r[key] === id).map(r => r.id) });
      }
      if (store === 'goals' && u.transactions) {
        ops.push({ store: 'transactions', put: this.all('transactions').filter(t => t.goalId === id).map(t => Object.assign({}, t, { goalId: null })) });
      }
      ops.push({ store, del: [id] });
      await this.adapter.batch(ops);
      this._applyOps(ops);
      this.emit({ store, action: 'delete', id });
    },

    async removeMany(store, ids) {
      await this.adapter.bulkDelete(store, ids);
      this._removeCache(store, ids);
      this.emit({ store, action: 'bulk-delete' });
    },

    _applyOps(ops) {
      for (const o of ops) {
        for (const r of o.put || []) this._upsertCache(o.store, r);
        if (o.del && o.del.length) this._removeCache(o.store, o.del);
      }
    },

    /** Copia completa de los datos (para respaldos). */
    snapshot() {
      const out = {};
      for (const s of S.STORES) out[s] = U.deepClone(this.all(s));
      return out;
    },

    /** Reemplaza TODO de forma atómica. */
    async replaceAll(data) {
      const clean = {};
      for (const s of S.STORES) clean[s] = Array.isArray(data[s]) ? data[s] : [];
      if (!clean.settings.find(x => x.id === 'main')) clean.settings.push(Object.assign({}, this.settings()));
      await this.adapter.replaceAll(clean);
      for (const s of S.STORES) this._setCache(s, U.deepClone(clean[s]));
      U.setBaseCurrency(this.settings().currency);
      this.emit({ store: '*', action: 'replace' });
    },

    /** Combina registros sin borrar nada: agrega los ids nuevos y conserva los existentes. */
    async merge(data) {
      const ops = [];
      const counts = {};
      for (const s of S.STORES) {
        if (s === 'settings') continue;
        const incoming = (data[s] || []).filter(r => r && r.id && !this.index[s].has(r.id));
        counts[s] = incoming.length;
        if (incoming.length) ops.push({ store: s, put: incoming });
      }
      await this.adapter.batch(ops);
      this._applyOps(ops);
      this.emit({ store: '*', action: 'merge' });
      return counts;
    },

    /**
     * Elimina únicamente los datos de demostración (isDemo === true).
     * Si un dato real usa una cuenta/inversión/deuda de demostración, esa entidad
     * se conserva y se convierte en real para no dejar movimientos huérfanos.
     */
    async removeDemo() {
      const ops = [];
      const kept = [];
      const realTx = this.all('transactions').filter(t => !t.isDemo);
      const realRec = this.all('recurring').filter(r => !r.isDemo);
      const realRefs = [...realTx, ...realRec];
      const refSets = {
        accounts: new Set(realRefs.flatMap(t => [t.accountId, t.toAccountId]).concat(this.all('goals').filter(g => !g.isDemo).map(g => g.accountId)).filter(Boolean)),
        investments: new Set(realRefs.map(t => t.investmentId).filter(Boolean)),
        debts: new Set(realRefs.map(t => t.debtId).filter(Boolean)),
        goals: new Set(realTx.map(t => t.goalId).filter(Boolean)),
        categories: new Set(realRefs.map(t => t.categoryId).concat(this.all('budgets').filter(b => !b.isDemo).map(b => b.categoryId)).filter(Boolean))
      };
      let removed = 0;
      for (const s of S.STORES) {
        if (s === 'settings') continue;
        const demo = this.all(s).filter(r => r.isDemo);
        const del = [], put = [];
        for (const r of demo) {
          if (refSets[s] && refSets[s].has(r.id)) { put.push(Object.assign({}, r, { isDemo: false })); kept.push(r.name || r.id); }
          else del.push(r.id);
        }
        removed += del.length;
        if (del.length || put.length) ops.push({ store: s, del, put });
      }
      await this.adapter.batch(ops);
      this._applyOps(ops);
      await this.saveSettings({ demoLoaded: false });
      this.emit({ store: '*', action: 'demo-removed' });
      return { removed, kept };
    },

    hasDemo() { return S.STORES.some(s => s !== 'settings' && this.all(s).some(r => r.isDemo)); },
    isEmpty() { return this.all('transactions').length === 0 && this.all('accounts').length === 0; }
  };

  F.Store = Store;
  F.ValidationError = ValidationError;
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
