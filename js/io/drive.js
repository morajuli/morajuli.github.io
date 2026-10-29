/* =========================================================================
 * io/drive.js — Copia automática en Google Drive (opcional).
 *
 * - Usa el permiso mínimo `drive.file`: la app solo ve los archivos que ella
 *   misma crea (la carpeta «Finanzas personales» y su respaldo), nunca el
 *   resto de tu Drive.
 * - Sube un respaldo completo (.json) unos segundos después de cada cambio.
 * - Nunca pisa en silencio lo que haya en Drive: si el archivo cambió desde
 *   otro dispositivo, se detiene y pide elegir (restaurar o reemplazar).
 * - No toca el DOM. Todas las dependencias (fetch, token, store…) se pueden
 *   inyectar, por eso se prueba en Node con un Drive simulado.
 * - El script de Google se carga solo cuando el usuario conecta Drive.
 * ========================================================================= */
(function (F) {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_NAME = 'Finanzas personales';
  const FILE_NAME = 'finanzas-respaldo.json';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const KEY = 'finanzas-drive';
  const DEBOUNCE_MS = 4000;

  function mkErr(kind, message) { const e = new Error(message); e.kind = kind; return e; }

  function create(deps) {
    const d = Object.assign({
      fetch: (...a) => fetch(...a),
      now: () => Date.now(),
      setTimeout: (...a) => setTimeout(...a),
      clearTimeout: (...a) => clearTimeout(...a),
      online: () => (typeof navigator === 'undefined' || navigator.onLine !== false),
      storage: (typeof localStorage !== 'undefined' ? localStorage : null),
      config: () => (F.config || {}),
      getToken: null,      // async (interactive, hint) => { access_token, expires_in }
      revoke: null
    }, deps);

    const listeners = [];
    let st = load();
    let status = st.connected ? 'idle' : 'off';
    let detail = '';
    let remote = null;       // { id, modifiedTime } cuando hay conflicto / datos nuevos
    let timer = null;
    let busy = null;
    let token = readToken();

    // ---------- persistencia local (por dispositivo; NO va dentro de los respaldos) ----------
    function load() {
      try { return Object.assign({ connected: false, clientId: '', folderId: null, fileId: null, remoteModified: null, lastSyncAt: null, dirty: false, account: '' }, JSON.parse(d.storage.getItem(KEY) || '{}')); }
      catch (_) { return { connected: false, clientId: '', folderId: null, fileId: null, remoteModified: null, lastSyncAt: null, dirty: false, account: '' }; }
    }
    function save() { try { d.storage.setItem(KEY, JSON.stringify(st)); } catch (_) { /* sin almacenamiento */ } }
    function readToken() {
      try { const t = JSON.parse(d.storage.getItem(KEY + '-token') || 'null'); return t && t.exp > d.now() ? t : null; } catch (_) { return null; }
    }
    function writeToken(t) { token = t; try { if (t) d.storage.setItem(KEY + '-token', JSON.stringify(t)); else d.storage.removeItem(KEY + '-token'); } catch (_) {} }

    function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }
    function setStatus(s, msg) { status = s; detail = msg || ''; emit(); }

    const clientId = () => (st.clientId || d.config().driveClientId || '').trim();

    // ---------- token ----------
    async function ensureToken(interactive) {
      if (token && token.exp > d.now()) return token.value;
      // Sin gesto del usuario los navegadores bloquean la ventana de Google: solo se pide el permiso al tocar un botón.
      if (!interactive) throw mkErr('auth', 'Toca «Reconectar» para volver a iniciar sesión con Google (por seguridad, la sesión dura 1 hora).');
      if (!d.getToken) throw mkErr('auth', 'Inicio de sesión de Google no disponible.');
      let r;
      try { r = await d.getToken(!!interactive, st.account || undefined, clientId()); }
      catch (e) { throw e.kind ? e : mkErr('auth', e.message || 'No se pudo iniciar sesión con Google.'); }
      writeToken({ value: r.access_token, exp: d.now() + Math.max(60, (r.expires_in || 3600) - 120) * 1000 });
      return token.value;
    }

    // ---------- llamadas a la API ----------
    async function call(tk, url, init) {
      let res;
      try { res = await d.fetch(url, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + tk }, (init && init.headers) || {}) })); }
      catch (e) { throw mkErr('network', 'Sin conexión con Google Drive.'); }
      if (res.ok) return res;
      let msg = '';
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || ''; } catch (_) {}
      if (res.status === 401) { writeToken(null); throw mkErr('auth', 'La sesión de Google venció.'); }
      if (res.status === 404) throw mkErr('notfound', 'No encontrado en Drive.');
      if (res.status === 403 && /has not been used|disabled|accessNotConfigured/i.test(msg)) throw mkErr('config', 'La API de Google Drive no está activada en tu proyecto de Google Cloud.');
      if (res.status === 403) throw mkErr('forbidden', msg || 'Google rechazó el permiso.');
      throw mkErr('http', 'Drive respondió ' + res.status + (msg ? ': ' + msg : ''));
    }
    const q = encodeURIComponent;

    async function ensureFolder(tk) {
      if (st.folderId) {
        try { const j = await (await call(tk, API + '/files/' + st.folderId + '?fields=id,trashed')).json(); if (!j.trashed) return st.folderId; }
        catch (e) { if (e.kind !== 'notfound') throw e; }
        st.folderId = null; st.fileId = null; st.remoteModified = null;
      }
      const list = await (await call(tk, API + '/files?fields=files(id)&q=' + q("mimeType='application/vnd.google-apps.folder' and name='" + FOLDER_NAME + "' and trashed=false"))).json();
      if (list.files && list.files.length) st.folderId = list.files[0].id;
      else {
        const made = await (await call(tk, API + '/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) })).json();
        st.folderId = made.id;
      }
      save();
      return st.folderId;
    }
    async function findFile(tk, folderId) {
      if (st.fileId) {
        try { const j = await (await call(tk, API + '/files/' + st.fileId + '?fields=id,modifiedTime,trashed')).json(); if (!j.trashed) return { id: j.id, modifiedTime: j.modifiedTime }; }
        catch (e) { if (e.kind !== 'notfound') throw e; }
        st.fileId = null;
      }
      const list = await (await call(tk, API + '/files?orderBy=modifiedTime%20desc&fields=files(id,modifiedTime)&q=' + q("name='" + FILE_NAME + "' and '" + folderId + "' in parents and trashed=false"))).json();
      return list.files && list.files.length ? { id: list.files[0].id, modifiedTime: list.files[0].modifiedTime } : null;
    }
    async function upload(tk, folderId, fileId, content) {
      const b = 'finanzas' + d.now().toString(36);
      const meta = fileId ? {} : { name: FILE_NAME, parents: [folderId], mimeType: 'application/json' };
      const body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
        '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + content + '\r\n--' + b + '--';
      const url = (fileId ? UPLOAD + '/files/' + fileId : UPLOAD + '/files') + '?uploadType=multipart&fields=id,modifiedTime';
      return (await call(tk, url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body })).json();
    }
    async function loadAccount(tk) {
      try { const j = await (await call(tk, API + '/about?fields=user(emailAddress)')).json(); if (j.user && j.user.emailAddress) { st.account = j.user.emailAddress; save(); } } catch (_) { /* opcional */ }
    }

    // ---------- manejo común de errores ----------
    function fail(e) {
      if (e.kind === 'auth') { setStatus('needs-auth', e.message); return; }
      if (e.kind === 'network') { setStatus('offline', e.message); return; }
      setStatus('error', e.message || 'Error al sincronizar.');
    }
    function serialize(fn) {
      if (busy) return busy;
      busy = (async () => { try { return await fn(); } finally { busy = null; } })();
      return busy;
    }

    // ---------- operaciones ----------
    /** Sube el respaldo. Si Drive cambió por otro lado, se detiene (salvo force). */
    function push(opts) {
      opts = opts || {};
      if (!st.connected) return Promise.resolve();
      return serialize(async () => {
        if (!d.online()) { setStatus('offline', 'Sin internet: se subirá al volver la conexión.'); return; }
        setStatus('syncing');
        try {
          const tk = await ensureToken(!!opts.interactive);
          const folderId = await ensureFolder(tk);
          const file = await findFile(tk, folderId);
          if (file && !opts.force && file.modifiedTime !== st.remoteModified) {
            remote = file;
            setStatus(d.store.isEmpty() ? 'remote-newer' : 'conflict', 'Hay un respaldo en Drive distinto al de este dispositivo.');
            return;
          }
          remote = null;
          st.dirty = false;                                   // si cambia durante la subida, markDirty() lo vuelve a marcar
          const json = JSON.stringify(d.io.buildBackup(d.store));
          let out;
          try { out = await upload(tk, folderId, file ? file.id : null, json); }
          catch (e) { st.dirty = true; save(); throw e; }
          st.fileId = out.id; st.remoteModified = out.modifiedTime; st.lastSyncAt = new Date(d.now()).toISOString();
          save();
          setStatus(st.dirty ? 'pending' : 'idle');
          if (st.dirty) schedule();
        } catch (e) { st.dirty = true; save(); fail(e); }
      });
    }
    function schedule() {
      if (timer) d.clearTimeout(timer);
      timer = d.setTimeout(() => { timer = null; return push(); }, DEBOUNCE_MS);
    }
    /** Llamar en cada cambio de datos. */
    function markDirty() {
      if (!st.connected) return;
      st.dirty = true; save();
      if (status === 'conflict' || status === 'remote-newer') return;   // esperando decisión del usuario
      if (status !== 'needs-auth') setStatus('pending');
      schedule();
    }
    /** Al abrir la app o volver a ella: ¿hay algo nuevo en Drive? */
    function check() {
      if (!st.connected) return Promise.resolve();
      if (st.dirty && status !== 'conflict' && status !== 'remote-newer') return push();
      return serialize(async () => {
        if (!d.online() || !(token && token.exp > d.now())) { if (!d.online()) setStatus('offline'); return; }
        try {
          const tk = await ensureToken(false);
          const folderId = await ensureFolder(tk);
          const file = await findFile(tk, folderId);
          if (file && file.modifiedTime !== st.remoteModified) { remote = file; setStatus(d.store.isEmpty() ? 'remote-newer' : 'conflict', 'Hay datos más recientes en Drive.'); }
          else if (status !== 'idle') setStatus('idle');
        } catch (e) { fail(e); }
      });
    }
    /** Descarga el respaldo de Drive (texto JSON) sin aplicarlo. */
    async function fetchRemote(interactive) {
      const tk = await ensureToken(!!interactive);
      const folderId = await ensureFolder(tk);
      const file = await findFile(tk, folderId);
      if (!file) throw mkErr('notfound', 'Todavía no hay un respaldo en tu Drive.');
      const text = await (await call(tk, API + '/files/' + file.id + '?alt=media')).text();
      return { text, id: file.id, modifiedTime: file.modifiedTime };
    }
    /** Tras importar lo descargado: reemplazar = ya estamos iguales; combinar = hay que subir el resultado. */
    function adopt(r, replaced) {
      st.fileId = r.id; st.remoteModified = r.modifiedTime; remote = null;
      if (replaced) { st.dirty = false; save(); if (timer) { d.clearTimeout(timer); timer = null; } st.lastSyncAt = new Date(d.now()).toISOString(); save(); setStatus('idle'); }
      else { st.dirty = true; save(); setStatus('pending'); schedule(); }
    }

    async function connect(id) {
      if (id !== undefined) { st.clientId = String(id || '').trim(); save(); }
      if (!clientId()) throw mkErr('config', 'Falta el ID de cliente de Google.');
      const tk = await ensureToken(true);
      st.connected = true; st.dirty = true; save();
      await loadAccount(tk);
      await push();
    }
    function disconnect() {
      if (timer) { d.clearTimeout(timer); timer = null; }
      const t = token && token.value;
      writeToken(null);
      if (t && d.revoke) { try { d.revoke(t); } catch (_) {} }
      st = Object.assign(load(), { connected: false, folderId: null, fileId: null, remoteModified: null, lastSyncAt: null, dirty: false, account: '' });
      st.clientId = st.clientId || '';
      save(); remote = null; setStatus('off');
    }

    return {
      configured: () => !!clientId(),
      hasConfigClientId: () => !!(d.config().driveClientId || '').trim(),
      connected: () => !!st.connected,
      connect, disconnect, push, check, markDirty, fetchRemote, adopt,
      state: () => ({ status, detail, connected: !!st.connected, dirty: st.dirty, lastSyncAt: st.lastSyncAt, account: st.account, folderId: st.folderId, remote }),
      folderURL: () => st.folderId ? 'https://drive.google.com/drive/folders/' + st.folderId : null,
      onChange: (fn) => { listeners.push(fn); },
      FOLDER_NAME, FILE_NAME
    };
  }

  // ---------- Inicio de sesión de Google (Google Identity Services), cargado solo al conectar ----------
  function browserGetToken() {
    function loadGIS() {
      if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(mkErr('network', 'No se pudo cargar el inicio de sesión de Google. ¿Hay internet?'));
        document.head.appendChild(s);
      });
    }
    return async function (interactive, hint, clientId) {
      await loadGIS();
      return new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId, scope: SCOPE, hint: hint || undefined,
          callback: (r) => r && r.access_token ? resolve(r) : reject(mkErr('auth', (r && (r.error_description || r.error)) || 'Google no concedió el permiso.')),
          error_callback: (e) => reject(mkErr('auth', e && e.type === 'popup_closed' ? 'Cerraste la ventana de Google antes de terminar.' : e && e.type === 'popup_failed_to_open' ? 'El navegador bloqueó la ventana de Google. Toca de nuevo el botón.' : 'No se pudo iniciar sesión con Google.'))
        });
        client.requestAccessToken({ prompt: interactive && !hint ? 'select_account' : '' });
      });
    };
  }

  F.driveCreate = create;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    F.drive = create({
      getToken: browserGetToken(),
      revoke: (t) => { if (window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(t, () => {}); },
      store: F.Store, io: F.io
    });
  }
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
