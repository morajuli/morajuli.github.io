// Carga los módulos del navegador en Node (sin DOM) para probar la lógica.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, crypto: require('crypto').webcrypto, TextEncoder, Date, Math, JSON, Promise, setTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
const root = path.join(__dirname, '..');
for (const f of ['js/core/utils.js', 'js/core/schema.js', 'js/storage/adapters.js', 'js/storage/store.js', 'js/finance/ledger.js',
  'js/finance/recurring.js', 'js/finance/analytics.js', 'js/io/backup.js', 'js/io/demo.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
module.exports = ctx.FIN;
