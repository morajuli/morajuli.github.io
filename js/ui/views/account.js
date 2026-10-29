/* =========================================================================
 * ui/views/account.js — Cuenta en la nube: pantalla de inicio de sesión,
 * tarjeta en «Datos y ajustes» y paso de datos locales a la cuenta.
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, S = F.schema, St = F.Store, ui = F.ui, vh = F.vh, IO = F.io, C = F.cloud;
  const esc = U.escapeHTML;
  const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14"/><path d="M14 44 26 30l9 8 15-17"/></svg>';

  // ============================ Inicio de sesión ============================
  function showLogin(errorMsg) {
    document.body.classList.remove('booting');
    document.body.classList.add('auth-mode');
    const view = document.getElementById('view');
    let signup = false;
    view.innerHTML = '<div class="auth"><div class="auth-card">' +
      '<div class="auth-brand brand-mini">' + LOGO + '</div>' +
      '<h1>Finanzas personales</h1><p class="muted" data-sub>Entra con tu cuenta para ver tus datos en cualquier dispositivo.</p>' +
      '<form data-auth novalidate>' +
      '<label class="field"><span class="lbl">Correo</span><input type="email" name="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" required></label>' +
      '<label class="field"><span class="lbl">Contraseña</span><input type="password" name="pass" autocomplete="current-password" minlength="6" required></label>' +
      '<label class="field" data-confirm hidden><span class="lbl">Repite la contraseña</span><input type="password" name="pass2" autocomplete="new-password" minlength="6"></label>' +
      '<p class="auth-err" role="alert">' + (errorMsg ? esc(errorMsg) : '') + '</p>' +
      '<button class="btn primary block" type="submit" data-submit>Entrar</button>' +
      '</form>' +
      '<div class="auth-links"><button class="link-btn" type="button" data-toggle>¿No tienes cuenta? Crear una</button><button class="link-btn" type="button" data-reset>¿Olvidaste tu contraseña?</button></div>' +
      '<div class="auth-or"><span>o</span></div>' +
      '<button class="btn block" type="button" data-google><svg class="ico" viewBox="0 0 24 24"><path d="M21 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.1a4.4 4.4 0 0 1-1.9 2.9v2.4h3.1c1.8-1.7 2.7-4.1 2.7-7.1zM12 21c2.6 0 4.7-.9 6.3-2.3l-3.1-2.4c-.9.6-2 .9-3.2.9-2.5 0-4.6-1.7-5.3-3.9H3.5v2.5A9.5 9.5 0 0 0 12 21zM6.7 13.3a5.6 5.6 0 0 1 0-3.6V7.2H3.5a9.5 9.5 0 0 0 0 8.6zM12 6.3c1.4 0 2.6.5 3.6 1.4l2.7-2.7A9.5 9.5 0 0 0 3.5 7.2l3.2 2.5C7.4 7.9 9.5 6.3 12 6.3z"/></svg>Continuar con Google</button>' +
      '<p class="auth-local"><button class="link-btn" type="button" data-local>Usar sin cuenta (solo en este dispositivo)</button></p>' +
      '<p class="muted small center">' + ui.icon('lock', 'tiny') + ' Solo tu usuario puede leer tus datos. También quedan guardados en este dispositivo para usar la app sin internet.</p>' +
      '</div></div>';
    const $ = (s) => view.querySelector(s);
    const form = $('[data-auth]'), err = $('.auth-err'), submit = $('[data-submit]');
    const setErr = (m) => { err.textContent = m || ''; };
    const busy = (on) => view.querySelectorAll('button,input').forEach(b => { b.disabled = on; });
    const done = () => { C.setMode('cloud'); location.reload(); };

    $('[data-toggle]').addEventListener('click', () => {
      signup = !signup;
      $('[data-confirm]').hidden = !signup;
      submit.textContent = signup ? 'Crear cuenta' : 'Entrar';
      $('[data-toggle]').textContent = signup ? '¿Ya tienes cuenta? Entrar' : '¿No tienes cuenta? Crear una';
      form.pass.autocomplete = signup ? 'new-password' : 'current-password';
      $('[data-sub]').textContent = signup ? 'Crea tu cuenta con un correo y una contraseña (mínimo 6 caracteres).' : 'Entra con tu cuenta para ver tus datos en cualquier dispositivo.';
      setErr('');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.email.value.trim(), pass = form.pass.value;
      if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Escribe un correo válido.');
      if (pass.length < 6) return setErr('La contraseña debe tener al menos 6 caracteres.');
      if (signup && pass !== form.pass2.value) return setErr('Las contraseñas no coinciden.');
      setErr(''); busy(true);
      try { if (signup) await C.signUp(email, pass); else await C.signIn(email, pass); done(); }
      catch (ex) { busy(false); setErr(C.errorText(ex)); }
    });
    $('[data-reset]').addEventListener('click', async () => {
      const email = form.email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { setErr('Escribe tu correo arriba y vuelve a tocar «¿Olvidaste tu contraseña?».'); form.email.focus(); return; }
      busy(true);
      try { await C.resetPassword(email); setErr(''); ui.toast('Te enviamos un correo para crear una nueva contraseña (revisa también spam).', { timeout: 7000 }); }
      catch (ex) { setErr(C.errorText(ex)); }
      busy(false);
    });
    $('[data-google]').addEventListener('click', async () => {
      setErr(''); busy(true);
      try { await C.google(); done(); }
      catch (ex) { busy(false); setErr(C.errorText(ex) + (/popup/.test(ex.code || '') ? ' Si usas la app instalada en iPhone, entra con correo y contraseña.' : '')); }
    });
    $('[data-local]').addEventListener('click', () => { C.setMode('local'); location.reload(); });
  }

  /** Hay sesión pero falta la primera sincronización (sin internet). */
  function showOffline(msg) {
    document.body.classList.remove('booting');
    document.body.classList.add('auth-mode');
    const view = document.getElementById('view');
    view.innerHTML = '<div class="auth"><div class="auth-card">' +
      '<div class="auth-brand brand-mini">' + LOGO + '</div><h1>Sin conexión</h1>' +
      '<p>' + esc(msg || 'Necesitas internet la primera vez que abres tu cuenta en este dispositivo.') + '</p>' +
      '<p class="muted small">Después de esa primera vez, la app funciona sin internet y sube los cambios cuando vuelve la conexión.</p>' +
      '<button class="btn primary block" type="button" data-retry>Reintentar</button>' +
      '<p class="auth-local"><button class="link-btn" type="button" data-local>Usar sin cuenta mientras tanto</button></p></div></div>';
    view.querySelector('[data-retry]').addEventListener('click', () => location.reload());
    view.querySelector('[data-local]').addEventListener('click', () => { C.setMode('local'); location.reload(); });
    window.addEventListener('online', () => location.reload(), { once: true });
  }

  // ===================== Pasar datos de este dispositivo a la cuenta =====================
  async function maybeMigrate() {
    if (!C.user || C.migratedFor(C.user.uid)) return;
    let local;
    try {
      const a = await new F.storage.IndexedDBAdapter(S.STORES).open();
      local = {};
      for (const s of S.STORES) local[s] = await a.getAll(s);
      a.db.close();
    } catch (_) { C.markMigrated(C.user.uid); return; }
    const hasLocal = (local.accounts || []).length || (local.transactions || []).length;
    if (!hasLocal) { C.markMigrated(C.user.uid); return; }
    const v = IO.validateBackup({ app: IO.APP_ID, format: 'financial-backup', schemaVersion: S.SCHEMA_VERSION, data: local });
    if (!v.ok) { C.markMigrated(C.user.uid); return; }
    const n = (k) => U.plainNumber((v.data[k] || []).length);
    const cloudEmpty = St.isEmpty();
    const body = '<p>Este dispositivo tiene datos guardados <b>sin cuenta</b>: ' + n('accounts') + ' cuenta(s) y ' + n('transactions') + ' movimiento(s).</p>' +
      (cloudEmpty ? '<p>Tu cuenta en la nube está vacía. ¿Quieres subirlos para tenerlos en todos tus dispositivos?</p>'
        : '<p>Tu cuenta en la nube ya tiene datos. Puedes <b>combinar</b>: se agregan los registros de este dispositivo que no estén en la cuenta, sin borrar nada.</p>') +
      '<p class="muted small">Elijas lo que elijas, la copia sin cuenta sigue guardada en este dispositivo.</p>';
    const m = ui.modal({
      title: 'Datos de este dispositivo', size: 'small', body,
      footer: '<button class="btn" data-skip>' + (cloudEmpty ? 'Empezar vacío' : 'No combinar') + '</button><button class="btn primary" data-go>' + (cloudEmpty ? 'Subir a mi cuenta' : 'Combinar') + '</button>'
    });
    m.el.querySelector('[data-skip]').addEventListener('click', () => { C.markMigrated(C.user.uid); m.close(); });
    m.el.querySelector('[data-go]').addEventListener('click', async () => {
      try {
        if (cloudEmpty) {
          const data = Object.assign({}, v.data);
          const incoming = (data.settings || []).find(s => s.id === 'main');
          data.settings = [Object.assign({}, St.settings(), incoming || {}, { id: 'main', privacyNoticeSeen: true })];
          await St.replaceAll(data);
          ui.toast('Datos subidos a tu cuenta.');
        } else {
          const c = await St.merge(v.data);
          const total = Object.values(c).reduce((a, b) => a + b, 0);
          ui.toast(total ? 'Se agregaron ' + U.plainNumber(total) + ' registro(s) a tu cuenta.' : 'No había registros nuevos: todo ya estaba en tu cuenta.');
        }
        C.markMigrated(C.user.uid); m.close();
      } catch (e) { ui.toast('No se pudo: ' + C.errorText(e), { type: 'error', timeout: 8000 }); }
    });
  }

  // ============================ Tarjeta en Ajustes ============================
  const STATUS = {
    synced: ['check', 'Sincronizado'],
    pending: ['clock', 'Subiendo cambios…'],
    offline: ['alert', 'Sin conexión: trabajando con la copia de este dispositivo'],
    'offline-pending': ['clock', 'Sin conexión: los cambios se subirán al volver internet']
  };
  function statusHTML() {
    const a = C.adapter; if (!a) return '';
    const [ico, label] = STATUS[a.status()] || STATUS.synced;
    return ui.icon(ico, 'tiny') + ' ' + esc(label);
  }
  function updateStatus() { document.querySelectorAll('[data-cloud-status]').forEach(el => { el.innerHTML = statusHTML(); }); }

  function card() {
    if (!/^https?:$/.test(location.protocol)) return '';
    const active = St.adapter && St.adapter.kind === 'firestore';
    let body;
    if (active) {
      body = '<p>Entraste como <b>' + esc(C.user && (C.user.email || 'usuario de Google')) + '</b>. Tus datos se guardan en tu cuenta y se sincronizan al instante con tus otros dispositivos.</p>' +
        '<p class="drive-status" data-cloud-status>' + statusHTML() + '</p>' +
        '<p class="muted small">Plan gratuito de Firebase: sobra para uso personal. Sin internet sigues trabajando normal; los cambios se suben solos al reconectar.</p>' +
        '<div class="btn-row"><button class="btn" data-cloud-out>Cerrar sesión</button></div>';
    } else {
      const cfg = C.config();
      body = '<p>Crea una cuenta (correo y contraseña, o Google) para ver y registrar tus finanzas desde <b>cualquier dispositivo</b>, sincronizado al instante.</p>' +
        '<p class="muted small">Usa tu propio proyecto gratuito de Firebase (Google). Solo tu usuario puede leer los datos. Mientras no lo actives, todo sigue solo en este dispositivo.</p>' +
        (cfg ? '<p class="muted small">Proyecto: <code>' + esc(cfg.projectId) + '</code></p>' :
          '<label class="field"><span class="lbl">Configuración de Firebase</span><textarea data-cloud-cfg rows="5" spellcheck="false" autocapitalize="off" placeholder="const firebaseConfig = {\n  apiKey: &quot;…&quot;,\n  authDomain: &quot;…&quot;,\n  projectId: &quot;…&quot;,\n  appId: &quot;…&quot;\n};"></textarea><span class="hint">Pega el bloque <code>firebaseConfig</code> que te da Firebase (pasos abajo).</span></label>') +
        '<div class="btn-row"><button class="btn primary" data-cloud-on>' + ui.icon('lock') + (cfg ? 'Iniciar sesión o crear cuenta' : 'Activar cuenta en la nube') + '</button>' +
        (cfg && !C.hasBakedConfig() ? '<button class="btn ghost" data-cloud-reset>Cambiar proyecto</button>' : '') + '</div>' +
        '<details class="drive-help"><summary>¿Cómo creo mi proyecto gratuito de Firebase?</summary><ol class="small">' +
        '<li>Entra a <b>console.firebase.google.com</b> → <b>Crear proyecto</b> (puedes desactivar Google Analytics). No pide tarjeta: queda en el plan gratuito <b>Spark</b>.</li>' +
        '<li><b>Authentication → Comenzar → Método de acceso</b>: activa <b>Correo electrónico/contraseña</b> (y <b>Google</b> si quieres).</li>' +
        '<li><b>Authentication → Configuración → Dominios autorizados</b>: agrega <code>' + esc(location.hostname) + '</code>.</li>' +
        '<li><b>Firestore Database → Crear base de datos</b> (modo producción, ubicación cercana). En la pestaña <b>Reglas</b> pega las reglas del archivo <code>firestore.rules</code> y pulsa <b>Publicar</b>.</li>' +
        '<li><b>Configuración del proyecto → Tus apps → Web (&lt;/&gt;)</b>: registra la app y copia el bloque <code>firebaseConfig</code>. Pégalo arriba.</li></ol></details>';
    }
    return vh.card('Cuenta en la nube', body, { icon: 'lock', cls: 'cloud-card' });
  }
  function bind(el) {
    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener('click', fn); };
    on('[data-cloud-on]', () => {
      const ta = el.querySelector('[data-cloud-cfg]');
      if (ta) {
        const c = C.saveConfig(ta.value);
        if (!c) { ui.toast('No reconozco esa configuración. Debe incluir apiKey y projectId.', { type: 'error', timeout: 6000 }); return; }
      }
      C.setMode('cloud'); location.reload();
    });
    on('[data-cloud-reset]', () => { try { const s = JSON.parse(localStorage.getItem('finanzas-cloud') || '{}'); delete s.config; localStorage.setItem('finanzas-cloud', JSON.stringify(s)); } catch (_) {} F.app.render(true); });
    on('[data-cloud-out]', async () => {
      const ok = await ui.confirmDialog({ title: 'Cerrar sesión', html: '<p>Tus datos siguen seguros en tu cuenta. En este dispositivo se borrará la copia de la nube hasta que vuelvas a entrar.</p>', confirmText: 'Cerrar sesión' });
      if (!ok) return;
      await C.signOut(); location.reload();
    });
  }

  F.account = { showLogin, showOffline, maybeMigrate, card, bind, updateStatus };
})(window.FIN);
