Finanzas personales
Sistema financiero personal que funciona 100 % en el navegador: ingresos, gastos, transferencias, ahorro, inversiones, deudas, presupuestos, metas, recurrentes, patrimonio, análisis, proyecciones e informes. Sin servidor, sin cuentas, sin analítica.
Cómo usarla
Opción simple: abre `index.html` con doble clic (Chrome, Edge, Firefox o Safari). No necesita instalación ni internet.
Opción un solo archivo: `finanzas-personales.html` contiene toda la app en un único archivo, útil para guardarla en el celular o en una USB.
Servidor local (opcional): `python3 -m http.server` dentro de esta carpeta y abre `http://localhost:8000`.
> Los datos quedan guardados en el navegador y en el archivo/origen desde donde abriste la app. Si abres la app desde otra ruta o navegador verás una base vacía: usa **Exportar respaldo / Importar respaldo** para moverlos.
Atajos de teclado (escritorio): `n` registra un movimiento, `/` busca.
Arquitectura
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
Las capas `core`, `storage`, `finance` e `io` no tocan el DOM: pueden moverse tal cual a un backend (Node) o a otro frontend. Para pasar a Frontend → API → Base de datos basta con escribir un `ApiAdapter` con los mismos métodos que `IndexedDBAdapter` (`open`, `getAll`, `put`, `bulkPut`, `delete`, `bulkDelete`, `batch`, `replaceAll`) y la interfaz no cambia.
Reglas contables
Saldos calculados, no guardados: saldo de una cuenta = saldo inicial + efecto de todos los movimientos hasta la fecha. Editar un movimiento antiguo corrige todo el histórico.
Patrimonio neto = Activos − Pasivos. Activos: saldos positivos de cuentas, valor de inversiones, dinero que me deben y otros activos. Pasivos: tarjetas (saldo negativo), deudas y otros pasivos.
Neutros (no son ingreso ni gasto): transferencias, ahorro, inversión, retiro de inversión, préstamos recibidos/entregados y abonos a capital.
Pago de deuda: el valor de intereses se cuenta como gasto (o ingreso si te pagan a ti); el abono a capital reduce la deuda.
Inversiones: valor = última valoración manual + aportes − retiros posteriores. Ganancia = valor − (aportado − retirado).
Tasa de ahorro = (Ingresos − Gastos) ÷ Ingresos × 100. Tasa de inversión = Inversión ÷ Ingresos × 100.
Monedas: COP, USD o EUR. No hay conversión: las cuentas en otra moneda se muestran aparte.
Privacidad
El `Content-Security-Policy` del `index.html` incluye `connect-src 'none'`: el navegador bloquea cualquier petición de red desde la app. No hay fuentes, librerías ni gráficos externos.
Formato del respaldo
`financial-backup-AAAA-MM-DD.json`:
```json
{ "app": "finanzas-personales", "format": "financial-backup", "schemaVersion": 1,
  "exportedAt": "…", "currency": "COP", "counts": {…},
  "data": { "accounts": [], "categories": [], "transactions": [], "recurring": [], "budgets": [],
            "goals": [], "investments": [], "debts": [], "assets": [], "settings": [] } }
```
Antes de importar se valida estructura, versión, cada registro y sus referencias. Se puede combinar (solo agrega ids nuevos) o reemplazar (con confirmación escrita y respaldo automático previo).
Instalar en el celular (PWA)
La app es instalable y funciona sin conexión, pero el navegador solo lo permite si se sirve por HTTPS (no desde `file://`).
Sube esta carpeta completa a un hosting estático gratuito: Netlify Drop (arrastrar y soltar), GitHub Pages, Cloudflare Pages o Vercel.
Abre la dirección en el celular:
Android (Chrome): aparece el aviso «Instalar app», o menú ⋮ → Instalar aplicación.
iPhone (Safari): Compartir → Añadir a pantalla de inicio.
Ábrela desde el ícono: pantalla completa, sin barra del navegador.
> Los datos viven en el navegador del dispositivo. En iPhone la app instalada tiene almacenamiento **separado** de Safari: instálala primero o exporta/importa un respaldo. Exporta respaldos con frecuencia.
Tras cambiar cualquier archivo, ejecuta `python3 build.py`: regenera `finanzas-personales.html` y actualiza la versión del caché (`sw.js`).
