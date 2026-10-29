/* Configuración opcional (valores públicos, no secretos: la seguridad la dan las reglas de Firestore).
 *
 * firebase:      pega aquí tu firebaseConfig para que todos tus dispositivos muestren
 *                directamente la pantalla de inicio de sesión (sin pegarlo en cada uno).
 * driveClientId: ID de cliente de Google para la copia en Google Drive (opcional).
 */
(function (F) {
  F.config = Object.assign({
    firebase: null,
    // firebase: { apiKey: '...', authDomain: 'tu-proyecto.firebaseapp.com', projectId: 'tu-proyecto', appId: '...' },
    driveClientId: ''
  }, F.config || {});
})(window.FIN = window.FIN || {});
