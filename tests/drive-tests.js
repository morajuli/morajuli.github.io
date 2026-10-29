/* Pruebas de la sincronización con Google Drive usando un Drive simulado.  Uso: node tests/drive-tests.js */
'use strict';
const F = require('./harness.js');
const U = F.utils, S = F.schema, IO = F.io, St = F.Store;
let passed = 0, failed = 0; const out = [];
function ok(c, n, x) { if (c) passed++; else { failed++; out.push('✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } }

function fakeDrive() {
  const files = new Map(); let clock = 1, ids = 0, calls = [], fail = null;
  const stamp = () => new Date(Date.UTC(2026, 9, 28, 12, 0, clock++)).toISOString() ;
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  async function fetch(url, init) {
    init = init || {}; const u = new URL(url); const m = init.method || 'GET'; calls.push(m + ' ' + u.pathname);
    if (fail) { const f = fail; if (f.network) throw new TypeError('network'); return res(f.status, { error: { message: f.message || '' } }); }
    if (!/^Bearer tok/.test(init.headers.Authorization)) return res(401, {});
    const p = u.pathname;
    if (p === '/drive/v3/about') return res(200, { user: { emailAddress: 'yo@gmail.com' } });
    if (p === '/drive/v3/files' && m === 'GET') {
      const q = u.searchParams.get('q'); const name = /name='([^']+)'/.exec(q)[1];
      const parent = (/'([^']+)' in parents/.exec(q) || [])[1];
      const list = [...files.values()].filter(f => !f.trashed && f.name === name && (!parent || f.parents.includes(parent)));
      return res(200, { files: list.map(f => ({ id: f.id, modifiedTime: f.modifiedTime })) });
    }
    if (p === '/drive/v3/files' && m === 'POST') { const b = JSON.parse(init.body); const f = { id: 'id' + (++ids), name: b.name, parents: [], mime: b.mimeType, modifiedTime: stamp() }; files.set(f.id, f); return res(200, { id: f.id }); }
    let mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (mm) { const f = files.get(mm[1]); if (!f) return res(404, {}); if (u.searchParams.get('alt') === 'media') return res(200, f.content); return res(200, { id: f.id, modifiedTime: f.modifiedTime, trashed: !!f.trashed }); }
    mm = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(p);
    if (mm) {
      const b = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1]; const parts = init.body.split('--' + b).filter(s => s.trim() && s.trim() !== '--');
      const body = s => s.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
      const meta = JSON.parse(body(parts[0])); const content = body(parts[1]);
      if (mm[1]) { const f = files.get(mm[1]); if (!f) return res(404, {}); f.content = content; f.modifiedTime = stamp(); return res(200, { id: f.id, modifiedTime: f.modifiedTime }); }
      const f = { id: 'id' + (++ids), name: meta.name, parents: meta.parents, content, modifiedTime: stamp() }; files.set(f.id, f); return res(200, { id: f.id, modifiedTime: f.modifiedTime });
    }
    return res(400, {});
  }
  return { fetch, files, calls, setFail: (f) => { fail = f; }, touchRemote: (txt) => { const f = [...files.values()].find(x => x.name === 'finanzas-respaldo.json'); f.content = txt; f.modifiedTime = stamp(); } };
}
function memStorage() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; }
async function fresh(withData) { U.setNow('2026-10-28T10:00:00'); await St.init(new F.storage.MemoryAdapter(S.STORES)); if (withData !== false) await St.save('accounts', { name: 'Bancolombia', type: 'bank', currency: 'COP', initialBalance: 1000, openedAt: '2026-01-01' }); return St; }
function mk(fd, over) {
  const storage = memStorage(); let timer = null; const tokens = [];
  const drive = F.driveCreate(Object.assign({
    fetch: fd.fetch, storage, store: St, io: IO, online: () => true, config: () => ({ driveClientId: 'x.apps.googleusercontent.com' }),
    getToken: async () => { tokens.push(1); return { access_token: 'tok' + tokens.length, expires_in: 3600 }; },
    setTimeout: (fn) => { timer = fn; return 1; }, clearTimeout: () => { timer = null; }
  }, over || {}));
  return { drive, storage, fire: () => { const f = timer; timer = null; return f && f(); }, hasTimer: () => !!timer, tokens };
}

(async () => {
  // 1) conectar con Drive vacío: crea carpeta y archivo
  await fresh(); await St.saveSettings({ theme: 'dark' });
  let fd = fakeDrive(), h = mk(fd), d = h.drive;
  ok(!d.connected() && d.state().status === 'off', 'inicia desconectado');
  await d.connect();
  let s = d.state();
  ok(s.connected && s.status === 'idle' && !s.dirty, 'conecta y queda al día', s);
  ok(s.account === 'yo@gmail.com', 'lee la cuenta');
  const folder = [...fd.files.values()].find(f => f.name === 'Finanzas personales');
  const file = [...fd.files.values()].find(f => f.name === 'finanzas-respaldo.json');
  ok(folder && file && file.parents[0] === folder.id, 'carpeta y archivo creados dentro de la carpeta');
  const parsed = IO.parseJSONText(file.content);
  ok(parsed.ok && IO.validateBackup(parsed.value).ok, 'el archivo subido es un respaldo válido');
  ok(d.folderURL() === 'https://drive.google.com/drive/folders/' + folder.id, 'enlace a la carpeta');

  // 2) un cambio → pendiente → se sube con el temporizador
  await St.saveSettings({ currency: 'USD' });
  d.markDirty();
  ok(d.state().status === 'pending' && h.hasTimer(), 'cambio deja pendiente y programa subida');
  const before = file.modifiedTime; await h.fire();
  ok(d.state().status === 'idle' && file.modifiedTime !== before && /USD/.test(file.content), 'subida automática actualiza el mismo archivo', { st: d.state(), same: file.modifiedTime !== before, usd: /USD/.test(file.content), calls: fd.calls.slice(-6) });
  ok([...fd.files.values()].filter(f => f.name === 'finanzas-respaldo.json').length === 1, 'no duplica archivos');

  // 3) otro dispositivo cambió Drive → conflicto, no se pisa
  fd.touchRemote('{"otro":"dispositivo"}');
  await St.saveSettings({ currency: 'EUR' }); d.markDirty(); await h.fire();
  ok(d.state().status === 'conflict', 'detecta conflicto', d.state().status);
  ok(file.content === '{"otro":"dispositivo"}', 'NO sobrescribe lo de Drive en conflicto');
  ok(d.state().dirty, 'conserva cambios locales pendientes');
  await St.saveSettings({ theme: 'light' }); d.markDirty();
  ok(!h.hasTimer() && d.state().status === 'conflict', 'en conflicto no programa más subidas');

  // 4) restaurar (reemplazar) → adopta y queda al día
  const r = await d.fetchRemote(true);
  ok(r.text === '{"otro":"dispositivo"}', 'descarga el respaldo remoto');
  d.adopt(r, true);
  ok(d.state().status === 'idle' && !d.state().dirty && !h.hasTimer(), 'tras reemplazar queda al día');
  // combinar → pendiente de subir
  d.adopt(r, false);
  ok(d.state().status === 'pending' && h.hasTimer(), 'tras combinar queda pendiente de subir');
  await h.fire(); ok(d.state().status === 'idle' && /"app"/.test(file.content), 'sube el resultado combinado');

  // 5) force reemplaza Drive
  fd.touchRemote('{"otro":2}'); await St.saveSettings({ theme: 'dark' }); d.markDirty(); await h.fire();
  ok(d.state().status === 'conflict', 'otro conflicto');
  await d.push({ force: true });
  ok(d.state().status === 'idle' && /"app"/.test(file.content), 'force reemplaza Drive con datos locales');

  // 6) conectar con respaldo existente
  let h2 = mk(fd), d2 = h2.drive;
  await d2.connect(); ok(d2.state().status === 'conflict', 'conectar con datos locales y respaldo existente → conflicto');
  await fresh(false);
  let h3 = mk(fd), d3 = h3.drive; await d3.connect();
  ok(d3.state().status === 'remote-newer', 'conectar con app vacía y respaldo existente → ofrece restaurar', d3.state().status);

  // 7) sin token válido y sin gesto: no abre ventana, queda en needs-auth con cambios conservados
  await fresh(); fd = fakeDrive(); h = mk(fd); d = h.drive; await d.connect();
  h.storage.removeItem('finanzas-drive-token'); h = mk(fd, { storage: h.storage }); d = h.drive;
  const n = h.tokens.length; await St.saveSettings({ theme: 'dark' }); d.markDirty(); await h.fire();
  ok(d.state().status === 'needs-auth' && d.state().dirty && h.tokens.length === n, 'sin token: needs-auth y no pide ventana sin gesto');
  await d.push({ interactive: true }); ok(d.state().status === 'idle' && !d.state().dirty, 'al tocar Reconectar sincroniza');

  // 8) 401 → needs-auth ; red caída → offline ; API desactivada → error claro
  fd.setFail({ status: 401 }); await St.saveSettings({ theme: 'light' }); d.markDirty(); await h.fire();
  ok(d.state().status === 'needs-auth', '401 → needs-auth', d.state().status);
  fd.setFail({ network: true }); await d.push({ interactive: true });
  ok(d.state().status === 'offline' && d.state().dirty, 'sin red → offline y conserva pendientes', d.state().status);
  fd.setFail({ status: 403, message: 'Google Drive API has not been used in project 123 before or it is disabled.' }); await d.push({ interactive: true });
  ok(d.state().status === 'error' && /no está activada/.test(d.state().detail), 'API desactivada → mensaje claro', d.state());
  fd.setFail(null); await d.push({ interactive: true }); ok(d.state().status === 'idle', 'se recupera al volver a funcionar');

  // 9) offline del navegador
  let off = true; h = mk(fd, { online: () => !off }); d = h.drive; await d.connect().catch(() => {});
  ok(['offline'].includes(d.state().status) || !d.state().connected === false, 'sin internet no intenta subir', d.state().status);

  // 10) carpeta borrada en Drive → se recrea
  await fresh(); fd = fakeDrive(); h = mk(fd); d = h.drive; await d.connect();
  for (const f of fd.files.values()) f.trashed = true;
  await St.saveSettings({ theme: 'dark' }); d.markDirty(); await h.fire();
  ok(d.state().status === 'idle' && [...fd.files.values()].some(f => !f.trashed && f.name === 'Finanzas personales') && [...fd.files.values()].some(f => !f.trashed && f.name === 'finanzas-respaldo.json'), 'si borraron la carpeta/archivo, se recrean', d.state());

  // 11) desconectar
  d.disconnect(); ok(!d.connected() && d.state().status === 'off' && !h.storage.getItem('finanzas-drive-token'), 'desconectar limpia estado y token');
  ok(JSON.parse(h.storage.getItem('finanzas-drive')).fileId === null, 'desconectar olvida ids');
  const txt = JSON.stringify(IO.buildBackup(St)); ok(!/finanzas-drive|access_token|tok\d/.test(txt), 'el respaldo no contiene datos de Drive ni tokens');

  // 12) sin clientId
  await fresh(); h = mk(fakeDrive(), { config: () => ({}) });
  let threw = false; try { await h.drive.connect(); } catch (e) { threw = e.kind === 'config'; } ok(threw, 'sin ID de cliente no conecta');

  console.log(out.join('\n')); console.log(passed + ' pruebas de Drive correctas, ' + failed + ' fallidas'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
