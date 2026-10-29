/* Pruebas del adaptador de Firebase con un Firestore simulado (varios "dispositivos").  Uso: node tests/cloud-tests.js */
'use strict';
const F = require('./harness.js');
const U = F.utils, S = F.schema, St = F.Store, A = F.analytics;
let passed = 0, failed = 0; const out = [];
function ok(c, n, x) { if (c) passed++; else { failed++; out.push('✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------- Firestore simulado ----------------
const DELETE = { __delete: true };
class FieldPath { constructor(...seg) { this.seg = seg; } }
function backend() {
  const docs = new Map();           // path → data
  const listeners = [];             // { col, client, cb }
  let writes = 0, reads = 0;
  const snapFor = (col, pending, fromCache, changed) => {
    const list = [...docs.entries()].filter(([p]) => p.startsWith(col + '/') && !p.slice(col.length + 1).includes('/'))
      .map(([p, d]) => ({ id: p.slice(col.length + 1), data: () => JSON.parse(JSON.stringify(d)) }));
    return { metadata: { hasPendingWrites: pending, fromCache }, forEach: (cb) => list.forEach(cb), docs: list, docChanges: () => changed };
  };
  return {
    docs, get writes() { return writes; }, get reads() { return reads; },
    client(name, opts) {
      opts = opts || {};
      const fs = {
        FieldPath, deleteField: () => DELETE,
        collection: (db, ...seg) => ({ path: seg.join('/') }),
        doc: (db, ...seg) => ({ path: seg.join('/') }),
        onSnapshot: (ref, o, cb, err) => {
          const l = { col: ref.path, client: name, cb };
          listeners.push(l);
          setTimeout(() => {
            if (opts.offline) return cb(snapFor(ref.path, false, true, []));
            if (opts.denied) return err(Object.assign(new Error('denied'), { code: 'permission-denied' }));
            const s = snapFor(ref.path, false, false, []); reads += s.docs.length; cb(s);
          }, 0);
          return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
        },
        writeBatch: () => {
          const ops = [];
          return {
            set: (ref, data, o) => ops.push({ t: 'set', ref, data, o }),
            delete: (ref) => ops.push({ t: 'del', ref }),
            commit: async () => {
              const touched = new Set();
              for (const op of ops) {
                writes++;
                touched.add(op.ref.path.split('/').slice(0, -1).join('/'));
                if (op.t === 'del') { docs.delete(op.ref.path); continue; }
                if (op.o && op.o.mergeFields) {
                  const cur = docs.get(op.ref.path) || {};
                  for (const fp of op.o.mergeFields) {
                    let src = op.data; for (const s of fp.seg) src = src[s];
                    let tgt = cur; for (const s of fp.seg.slice(0, -1)) tgt = (tgt[s] = tgt[s] || {});
                    const last = fp.seg[fp.seg.length - 1];
                    if (src === DELETE) delete tgt[last]; else tgt[last] = JSON.parse(JSON.stringify(src));
                  }
                  docs.set(op.ref.path, cur);
                } else docs.set(op.ref.path, JSON.parse(JSON.stringify(op.data)));
              }
              for (const l of listeners.slice()) if (touched.has(l.col)) l.cb(snapFor(l.col, l.client === name, false, [{ type: 'modified' }]));
            }
          };
        }
      };
      return fs;
    }
  };
}
function adapter(be, name, uid, extra) {
  const remote = { n: 0 };
  const a = new F.storage.FirestoreAdapter(S.STORES, Object.assign({ fs: be.client(name, extra && extra.client), db: {}, uid: uid || 'u1', account: 'yo@correo.com', everSynced: false, onRemote: () => { remote.n++; } }, extra || {}));
  a.remote = remote;
  return a;
}
const docOf = (be, p) => be.docs.get(p);

(async () => {
  U.setNow('2026-10-29T10:00:00');
  const be = backend();

  // 1) Dispositivo A: cuenta nueva → crea configuración y categorías en la nube
  const a = adapter(be, 'A');
  await St.init(a);
  ok(St.all('categories').length > 0 && St.settings().categoriesSeeded, 'cuenta nueva: crea categorías por defecto');
  ok(Object.keys(docOf(be, 'users/u1/data/categories').items).length === St.all('categories').length, 'categorías guardadas en un solo documento');
  ok(docOf(be, 'users/u1/data/settings').items.main, 'configuración guardada en la nube');

  // 2) datos de ejemplo (12 meses) → agrupados por mes
  await F.demo.load(St);
  const txN = St.all('transactions').length;
  const months = [...be.docs.keys()].filter(k => k.startsWith('users/u1/tx/'));
  let inCloud = 0; for (const m of months) inCloud += Object.keys(docOf(be, m).items).length;
  ok(txN > 50 && inCloud === txN, 'todos los movimientos están en la nube', { txN, inCloud });
  ok(months.length >= 12 && months.length <= 14, 'un documento por mes (' + months.length + ')');
  const est = await a.estimate();
  ok(est.cloud && est.months === months.length, 'estimate informa meses');

  // 3) Dispositivo B abre la misma cuenta y ve exactamente lo mismo
  const readsBefore = be.reads;
  const b = adapter(be, 'B');
  await b.open();
  const bReads = be.reads - readsBefore;
  ok(bReads <= months.length + S.STORES.length, 'abrir en otro dispositivo cuesta pocas lecturas (' + bReads + ')');
  for (const s of S.STORES) {
    const x = (await b.getAll(s)).map(r => r.id).sort(), y = St.all(s).map(r => r.id).sort();
    ok(JSON.stringify(x) === JSON.stringify(y), 'B ve igual ' + s);
  }

  // 4) A registra un gasto → B lo recibe en vivo
  const acc = St.all('accounts')[0], cat = St.all('categories').find(c => c.kind === 'expense');
  const tx = await St.save('transactions', { type: 'expense', amount: 12345, date: '2026-10-29', accountId: acc.id, categoryId: cat.id, description: 'Café nube' });
  await sleep(300);
  ok(b.remote.n >= 1, 'B recibe aviso de cambio remoto');
  ok((await b.getAll('transactions')).some(t => t.id === tx.id && t.amount === 12345), 'B ve el gasto nuevo');
  ok(a.remote.n === 0, 'A no se avisa a sí mismo');

  // 5) mover de mes al cambiar la fecha
  await St.save('transactions', Object.assign({}, St.get('transactions', tx.id), { date: '2026-09-15' }));
  ok(!docOf(be, 'users/u1/tx/2026-10').items[tx.id] && docOf(be, 'users/u1/tx/2026-09').items[tx.id], 'cambiar la fecha mueve el movimiento al otro mes');

  // 6) ediciones simultáneas de registros distintos del mismo mes no se pisan
  const [t1, t2] = St.all('transactions').filter(t => t.date.startsWith('2026-08')).slice(0, 2);
  await b.put('transactions', Object.assign({}, t2, { description: 'editado en B' }));
  await St.save('transactions', Object.assign({}, St.get('transactions', t1.id), { description: 'editado en A' }));
  const aug = docOf(be, 'users/u1/tx/2026-08').items;
  ok(aug[t1.id].description === 'editado en A' && aug[t2.id].description === 'editado en B', 'A y B editan el mismo mes sin perder cambios');
  await sleep(300);
  await St.init(St.adapter);   // lo que hace la app al recibir onRemote
  ok(St.get('transactions', t2.id).description === 'editado en B', 'A ve la edición de B tras recargar');

  // 7) borrar
  await St.remove('transactions', tx.id);
  ok(!docOf(be, 'users/u1/tx/2026-09').items[tx.id], 'borrar quita el movimiento de la nube');
  await sleep(300); ok(!(await b.getAll('transactions')).some(t => t.id === tx.id), 'B ve el borrado');

  // 8) campos eliminados en una edición no reaparecen (se reemplaza el registro completo)
  const t3 = St.all('transactions')[0];
  await St.save('transactions', Object.assign({}, t3, { notes: 'temporal' }));
  const t3b = Object.assign({}, St.get('transactions', t3.id)); delete t3b.notes;
  await St.save('transactions', t3b);
  const m3 = 'users/u1/tx/' + t3.date.slice(0, 7);
  ok(!('notes' in docOf(be, m3).items[t3.id]) || !docOf(be, m3).items[t3.id].notes, 'quitar un campo lo quita también en la nube');

  // 9) los análisis dan igual que con almacenamiento local
  const cloudSummary = JSON.stringify(A.monthSummary ? A.monthSummary(St, '2026-08') : St.all('transactions').length);
  const snap = St.snapshot();
  await St.init(new F.storage.MemoryAdapter(S.STORES)); await St.replaceAll(snap);
  const localSummary = JSON.stringify(A.monthSummary ? A.monthSummary(St, '2026-08') : St.all('transactions').length);
  ok(cloudSummary === localSummary, 'análisis idénticos en nube y local');

  // 10) reemplazar todo (importar / borrar todo)
  await St.init(a);
  await St.replaceAll({ settings: [St.settings()], categories: St.all('categories') });
  ok(![...be.docs.keys()].some(k => k.startsWith('users/u1/tx/')), 'reemplazar todo elimina los meses');
  ok(St.all('transactions').length === 0 && St.all('categories').length > 0, 'queda la base limpia con categorías');

  // 11) otro usuario no ve nada de u1
  const c = adapter(be, 'C', 'u2'); await c.open();
  ok((await c.getAll('categories')).length === 0, 'otro usuario empieza vacío (datos separados por uid)');

  // 12) primera vez sin internet: no inicia con caché vacía (evita pisar la cuenta)
  const d = adapter(be, 'D', 'u1', { client: { offline: true }, firstSyncTimeoutMs: 5000, isOnline: () => false });
  let code = null; try { await d.open(); } catch (e) { code = e.code; }
  ok(code === 'first-sync', 'primer uso sin internet: pide conexión en vez de crear datos vacíos', code);
  // ya sincronizado antes: abre desde la caché sin internet
  const e2 = adapter(be, 'E', 'u1', { client: { offline: true }, everSynced: true });
  let opened = false; try { await e2.open(); opened = true; } catch (_) {}
  ok(opened, 'dispositivo ya sincronizado abre sin internet');
  // sin respuesta del servidor → timeout claro
  const f = adapter(be, 'F', 'u1', { client: { offline: true }, firstSyncTimeoutMs: 100 });
  code = null; try { await f.open(); } catch (e) { code = e.code; }
  ok(code === 'first-sync', 'sin respuesta del servidor → mensaje claro');

  // 13) reglas que rechazan → error permission-denied
  const g = adapter(be, 'G', 'u1', { client: { denied: true } });
  code = null; try { await g.open(); } catch (e) { code = e.code; }
  ok(code === 'permission-denied' && /reglas/.test(F.cloud.errorText({ code })), 'reglas mal configuradas → mensaje claro');

  // 14) leer la configuración pegada desde Firebase
  const cfg = F.cloud.parseConfig('const firebaseConfig = {\n  apiKey: "AIzaXYZ",\n  authDomain: "mis-finanzas.firebaseapp.com",\n  projectId: "mis-finanzas",\n  storageBucket: "mis-finanzas.appspot.com",\n  appId: "1:123:web:abc"\n};');
  ok(cfg && cfg.apiKey === 'AIzaXYZ' && cfg.projectId === 'mis-finanzas' && cfg.appId === '1:123:web:abc', 'reconoce el bloque firebaseConfig');
  ok(F.cloud.parseConfig('{"apiKey":"k","projectId":"p"}').authDomain === 'p.firebaseapp.com', 'reconoce JSON y completa authDomain');
  ok(F.cloud.parseConfig('hola') === null, 'rechaza texto sin configuración');

  // 15) cuota del plan gratuito: escrituras por operación típica
  const w0 = be.writes; await St.init(a);
  await St.save('transactions', { type: 'expense', amount: 1000, date: '2026-10-29', accountId: St.all('accounts')[0] ? St.all('accounts')[0].id : acc.id, categoryId: cat.id, description: 'x' }).catch(() => {});
  ok(be.writes - w0 <= 2, 'registrar un movimiento = 1-2 escrituras (' + (be.writes - w0) + ')');

  for (const x of [a, b, c, d, e2, f, g]) x.close();
  console.log(out.join('\n')); console.log(passed + ' pruebas de la nube correctas, ' + failed + ' fallidas');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
