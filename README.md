# Finanzas personales

Sistema financiero personal que funciona 100 % en el navegador: ingresos, gastos, transferencias, ahorro, inversiones, deudas, presupuestos, metas, recurrentes, patrimonio, análisis, proyecciones e informes. Sin servidor, sin cuentas, sin analítica.

## Cómo usarla

- **Opción simple:** abre `index.html` con doble clic (Chrome, Edge, Firefox o Safari). No necesita instalación ni internet.
- **Opción un solo archivo:** `finanzas-personales.html` contiene toda la app en un único archivo, útil para guardarla en el celular o en una USB.
- **Servidor local (opcional):** `python3 -m http.server` dentro de esta carpeta y abre `http://localhost:8000`.

> Los datos quedan guardados en el navegador y en el archivo/origen desde donde abriste la app. Si abres la app desde otra ruta o navegador verás una base vacía: usa **Exportar respaldo / Importar respaldo** para moverlos.

Atajos de teclado (escritorio): `n` registra un movimiento, `/` busca.

## Arquitectura

```
index.html                 Estructura y carga de módulos (scripts clásicos: funcionan con file://)
css/styles.css             Estilos mobile-first, tema claro/oscuro
js/core/utils.js           Números seguros, dinero (formato es-CO), fechas, ids  — sin DOM
js/core/schema.js          Modelo de datos: catálogos, categorías por defecto, validaciones
js/storage/adapters.js     Adaptadores de persistencia: IndexedDB y memoria (misma interfaz)
js/storage/store.js        Repositorio: caché, validación, integridad referencial, eventos
js/finance/ledger.js       Contabilidad: efectos de cada movimiento, saldos, inversiones, deudas, patrimonio
js/finance/recurring.js    Recurrentes y suscripciones
js/finance/analytics.js    Resúmenes, comparaciones, patrones, proyección, indicadores, informes
js/io/backup.js            Respaldo JSON, CSV (exportar/importar), ZIP
js/io/demo.js              Datos de ejemplo (marcados isDemo)
js/ui/*                    Interfaz: gráficos SVG propios, formularios, vistas
js/app.js                  Arranque y enrutador
tests/run-tests.js         136 pruebas de la lógica (node tests/run-tests.js)
```

Las capas `core`, `storage`, `finance` e `io` no tocan el DOM: pueden moverse tal cual a un backend (Node) o a otro frontend. Para pasar a **Frontend → API → Base de datos** basta con escribir un `ApiAdapter` con los mismos métodos que `IndexedDBAdapter` (`open`, `getAll`, `put`, `bulkPut`, `delete`, `bulkDelete`, `batch`, `replaceAll`) y la interfaz no cambia.

## Reglas contables

- **Saldos calculados, no guardados:** saldo de una cuenta = saldo inicial + efecto de todos los movimientos hasta la fecha. Editar un movimiento antiguo corrige todo el histórico.
- **Patrimonio neto = Activos − Pasivos.** Activos: saldos positivos de cuentas, valor de inversiones, dinero que me deben y otros activos. Pasivos: tarjetas (saldo negativo), deudas y otros pasivos.
- **Neutros (no son ingreso ni gasto):** transferencias, ahorro, inversión, retiro de inversión, préstamos recibidos/entregados y abonos a capital.
- **Pago de deuda:** el valor de intereses se cuenta como gasto (o ingreso si te pagan a ti); el abono a capital reduce la deuda.
- **Inversiones:** valor = última valoración manual + aportes − retiros posteriores. Ganancia = valor − (aportado − retirado).
- **Tasa de ahorro** = (Ingresos − Gastos) ÷ Ingresos × 100. **Tasa de inversión** = Inversión ÷ Ingresos × 100.
- **Monedas:** COP, USD o EUR. No hay conversión: las cuentas en otra moneda se muestran aparte.

## Privacidad

El `Content-Security-Policy` del `index.html` incluye `connect-src 'none'`: el navegador bloquea cualquier petición de red desde la app. No hay fuentes, librerías ni gráficos externos.

## Formato del respaldo

`financial-backup-AAAA-MM-DD.json`:

```json
{ "app": "finanzas-personales", "format": "financial-backup", "schemaVersion": 1,
  "exportedAt": "…", "currency": "COP", "counts": {…},
  "data": { "accounts": [], "categories": [], "transactions": [], "recurring": [], "budgets": [],
            "goals": [], "investments": [], "debts": [], "assets": [], "settings": [] } }
```

Antes de importar se valida estructura, versión, cada registro y sus referencias. Se puede **combinar** (solo agrega ids nuevos) o **reemplazar** (con confirmación escrita y respaldo automático previo).

## Instalar en el celular (PWA)

La app es instalable y funciona sin conexión, pero el navegador solo lo permite si se sirve por **HTTPS** (no desde `file://`).

1. Sube **esta carpeta completa** a un hosting estático gratuito: Netlify Drop (arrastrar y soltar), GitHub Pages, Cloudflare Pages o Vercel.
2. Abre la dirección en el celular:
   - **Android (Chrome):** aparece el aviso «Instalar app», o menú ⋮ → *Instalar aplicación*.
   - **iPhone (Safari):** Compartir → *Añadir a pantalla de inicio*.
3. Ábrela desde el ícono: pantalla completa, sin barra del navegador.

> Los datos viven en el navegador del dispositivo. En iPhone la app instalada tiene almacenamiento **separado** de Safari: instálala primero o exporta/importa un respaldo. Exporta respaldos con frecuencia.

Tras cambiar cualquier archivo, ejecuta `python3 build.py`: regenera `finanzas-personales.html` y actualiza la versión del caché (`sw.js`).

## Copia automática en Google Drive (opcional)

En **Datos y ajustes → Google Drive** puedes conectar tu cuenta. La app crea la carpeta «Finanzas personales» en tu Drive y mantiene ahí `finanzas-respaldo.json`, actualizado unos segundos después de cada cambio.

- Permiso mínimo (`drive.file`): solo ve lo que ella misma crea.
- Nunca pisa en silencio: si el respaldo de Drive cambió desde otro dispositivo, se detiene y te deja elegir *Restaurar* (combinar o reemplazar) o *Reemplazar Drive*.
- Sin conectar, la app no hace ninguna petición de red. El `Content-Security-Policy` solo permite hablar con `accounts.google.com` y `www.googleapis.com`.
- La sesión de Google dura 1 hora. Después, un aviso ofrece «Reconectar» (un toque); tus cambios siguen guardados en el dispositivo mientras tanto.
- Necesita un **ID de cliente de OAuth** (gratis, se crea una vez): Google Cloud → habilitar *Google Drive API* → pantalla de consentimiento (Externo, scope `drive.file`, publicada) → credenciales *ID de cliente OAuth → Aplicación web* con origen autorizado `https://morajuli.github.io`. Pégalo en la app, o en `js/config.js` (`driveClientId`) para no repetirlo en cada dispositivo.
- Pruebas: `node tests/drive-tests.js` (Drive simulado).

## Cuenta en la nube con Firebase (plan gratuito)

Con una cuenta (correo y contraseña, o Google) tus datos se sincronizan **al instante** entre celular, tablet y computador, y la app sigue funcionando **sin internet** (los cambios se suben solos al reconectar).

### Configuración (una sola vez, ~10 minutos, sin tarjeta)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Crear proyecto** (puedes desactivar Analytics). Queda en el plan gratuito **Spark**.
2. **Authentication → Comenzar → Método de acceso**: activa **Correo electrónico/contraseña** (y **Google** si quieres).
3. **Authentication → Configuración → Dominios autorizados**: agrega `morajuli.github.io`.
4. **Firestore Database → Crear base de datos** (modo producción, ubicación cercana, p. ej. `southamerica-east1`). Pestaña **Reglas**: pega el contenido de `firestore.rules` → **Publicar**.
5. **Configuración del proyecto (⚙) → Tus apps → Web `</>`** → registra la app → copia el bloque `firebaseConfig`.
6. Pega ese bloque en `js/config.js` (campo `firebase`) y sube los archivos a GitHub. Desde ese momento cualquier dispositivo que abra la app verá la pantalla de inicio de sesión. *(Alternativa: pegarlo en la app, en Datos y ajustes → Cuenta en la nube, en cada dispositivo.)*

La primera vez que entres en un dispositivo que ya tenía datos sin cuenta, la app ofrece **subirlos** (si la cuenta está vacía) o **combinarlos**.

### Cómo se guarda (pensado para el plan gratuito)

```
users/{uid}/data/{colección}   1 documento por colección  { items: { id: registro } }
users/{uid}/tx/{AAAA-MM}       1 documento por mes        { items: { id: movimiento } }
```

- Abrir la app en otro dispositivo lee ~10 documentos + 1 por mes con movimientos (no uno por movimiento). Registrar un movimiento = 1 escritura. El plan gratuito permite 50.000 lecturas y 20.000 escrituras por día.
- Cada cambio escribe solo el campo de ese registro: dos dispositivos editando registros distintos no se pisan.
- Límite práctico: ~2.000 movimientos en un mismo mes (tamaño máximo de documento de Firestore: 1 MiB).
- Reglas (`firestore.rules`): cada usuario solo puede leer y escribir `users/{su uid}`.
- La configuración de Firebase (`apiKey`, etc.) es pública por diseño; la seguridad la dan las reglas.
- El SDK de Firebase va incluido en `js/vendor/firebase-sdk.js` (v13.1.0, empaquetado con esbuild) y solo se carga si activas la cuenta, así funciona sin conexión y no depende de otros servidores.
- «Cerrar sesión» borra la copia local de la nube de ese dispositivo (privacidad).
- Google en la **app instalada en iPhone** puede fallar (ventanas emergentes); allí usa correo y contraseña.

### Pruebas

- `node tests/cloud-tests.js`: adaptador con un Firestore simulado y varios dispositivos (38 pruebas).
- Probado de punta a punta con el SDK real contra los emuladores oficiales de Firebase (Auth + Firestore + reglas): crear cuenta, subir datos locales, segundo dispositivo, sincronización en vivo (<1 s), trabajo sin internet y reconexión, abrir sin internet, cerrar sesión, y reglas que bloquean a otros usuarios. Para el emulador: `firebase: { …, emulatorHost: '127.0.0.1' }`.
