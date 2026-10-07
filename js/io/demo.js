/* =========================================================================
 * io/demo.js — Datos de demostración (ficticios), 12 meses hasta hoy.
 * Todos los registros llevan isDemo: true para poder eliminarlos sin tocar
 * los datos reales. Generador determinista (misma semilla = mismos datos).
 * ========================================================================= */
(function (F) {
  'use strict';
  const U = F.utils, L = F.ledger;

  function rng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function build(todayISO) {
    const T = todayISO || U.today();
    const r = rng(20261005);
    const rand = (a, b) => a + (b - a) * r();
    const round = (n, step) => Math.round(n / (step || 100)) * (step || 100);
    const pick = arr => arr[Math.floor(r() * arr.length)];
    const curKey = U.monthKey(T);
    const startKey = U.addMonthKey(curKey, -12);
    const start = U.monthStart(startKey);
    const id = p => 'demo_' + p + '_' + Math.floor(r() * 1e9).toString(36) + Math.floor(r() * 1e9).toString(36);
    const D = (key, day) => key + '-' + U.pad(Math.min(day, U.daysInMonth(key)));
    const demo = { isDemo: true };

    // ---------- Cuentas ----------
    const acc = {
      banco: { id: 'demo_acc_bancolombia', name: 'Bancolombia', type: 'bank', purpose: 'spending', currency: 'COP', initialBalance: 2600000, openedAt: start, notes: 'Cuenta de nómina' },
      nequi: { id: 'demo_acc_nequi', name: 'Nequi', type: 'wallet', purpose: 'spending', currency: 'COP', initialBalance: 150000, openedAt: start, notes: '' },
      nu: { id: 'demo_acc_nu', name: 'Nu', type: 'bank', purpose: 'spending', currency: 'COP', initialBalance: 300000, openedAt: start, notes: '' },
      efectivo: { id: 'demo_acc_efectivo', name: 'Efectivo', type: 'cash', purpose: 'spending', currency: 'COP', initialBalance: 80000, openedAt: start, notes: '' },
      cajita: { id: 'demo_acc_cajita', name: 'Cajita Nu (emergencias)', type: 'goal_savings', purpose: 'savings', currency: 'COP', initialBalance: 1500000, openedAt: start, notes: 'Fondo de emergencia' },
      bolsillo: { id: 'demo_acc_bolsillo', name: 'Bolsillo computador', type: 'goal_savings', purpose: 'savings', currency: 'COP', initialBalance: 0, openedAt: start, notes: '' },
      visa: { id: 'demo_acc_visa', name: 'Tarjeta Visa', type: 'credit_card', purpose: 'spending', currency: 'COP', initialBalance: 0, openedAt: start, notes: 'Cupo $5.000.000' }
    };
    const accounts = Object.values(acc).map(a => Object.assign({}, a, demo));

    // ---------- Inversiones ----------
    const etf = { id: 'demo_inv_etf', name: 'ETF S&P 500', type: 'etf', openingContributed: 2000000, startDate: start, valuations: [{ date: start, value: 2000000, at: '2000-01-01T00:00:00Z' }], notes: 'Valor actualizado manualmente', ...demo };
    const cdtStart = D(U.addMonthKey(startKey, 3), 15);
    const cdt = { id: 'demo_inv_cdt', name: 'CDT 12 meses', type: 'cdt', openingContributed: 0, startDate: cdtStart, valuations: [], notes: 'Tasa 10,5% EA', ...demo };
    const btc = { id: 'demo_inv_btc', name: 'Bitcoin', type: 'crypto', openingContributed: 500000, startDate: start, valuations: [{ date: start, value: 500000, at: '2000-01-01T00:00:00Z' }], notes: '', ...demo };

    // ---------- Deudas ----------
    const loan = { id: 'demo_debt_libre', name: 'Crédito libre inversión', counterparty: 'Banco de Bogotá', direction: 'payable', kind: 'consumer', principal: 8000000, openingBalance: 6400000, interestRate: 24, monthlyPayment: 420000, startDate: start, endDate: U.addMonths(start, 20), dueDay: 15, notes: '', ...demo };
    const lent = { id: 'demo_debt_andres', name: 'Préstamo a Andrés', counterparty: 'Andrés', direction: 'receivable', kind: 'personal', principal: 500000, openingBalance: 0, interestRate: 0, monthlyPayment: 0, startDate: start, endDate: null, dueDay: null, notes: 'Me paga en cuotas', ...demo };

    // ---------- Metas ----------
    const goals = [
      { id: 'demo_goal_emergencia', name: 'Fondo de emergencia', kind: 'emergency', targetAmount: 9000000, manualAmount: 0, accountId: acc.cajita.id, targetDate: U.addMonths(T, 14), monthlyContribution: 400000, notes: '', ...demo },
      { id: 'demo_goal_pc', name: 'Computador nuevo', kind: 'computer', targetAmount: 4500000, manualAmount: 0, accountId: acc.bolsillo.id, targetDate: U.addMonths(T, 6), monthlyContribution: 300000, notes: '', ...demo },
      { id: 'demo_goal_viaje', name: 'Viaje a Cartagena', kind: 'travel', targetAmount: 2500000, manualAmount: 900000, accountId: null, targetDate: U.addMonths(T, 3), monthlyContribution: 250000, notes: 'Ahorro en efectivo aparte', ...demo }
    ];

    // ---------- Presupuestos ----------
    const budgets = [
      ['cat_alimentacion', 750000], ['cat_transporte', 280000], ['cat_entretenimiento', 150000], ['cat_restaurantes', 220000], ['cat_compras', 200000], ['cat_suscripciones', 210000]
    ].map(([c, a]) => ({ id: 'demo_bud_' + c, categoryId: c, amount: a, notes: '', ...demo }));

    // ---------- Reglas recurrentes ----------
    const rule = (o) => Object.assign({ id: 'demo_rec_' + o.key, active: true, autoConfirm: false, isSubscription: false, tags: [], person: 'personal', paymentMethod: '', subcategory: '', description: o.name, startDate: start, anchorDay: o.day }, o, demo);
    const rules = [
      rule({ key: 'salario', name: 'Salario', type: 'income', amount: 4500000, accountId: acc.banco.id, categoryId: 'cat_salario', subcategory: 'Nómina', frequency: 'monthly', day: 30, startDate: D(curKey, 30), paymentMethod: 'Transferencia' }),
      rule({ key: 'arriendo', name: 'Arriendo', type: 'expense', amount: 1100000, accountId: acc.banco.id, categoryId: 'cat_vivienda', subcategory: 'Arriendo', nature: 'fixed', frequency: 'monthly', day: 5, paymentMethod: 'Transferencia' }),
      rule({ key: 'internet', name: 'Internet hogar', type: 'expense', amount: 89000, accountId: acc.banco.id, categoryId: 'cat_servicios', subcategory: 'Internet', nature: 'fixed', frequency: 'monthly', day: 8, paymentMethod: 'Débito automático', autoConfirm: true }),
      rule({ key: 'celular', name: 'Plan celular', type: 'expense', amount: 55000, accountId: acc.nu.id, categoryId: 'cat_comunicaciones', subcategory: 'Celular', nature: 'fixed', frequency: 'monthly', day: 18, paymentMethod: 'Débito automático', autoConfirm: true }),
      rule({ key: 'netflix', name: 'Netflix', type: 'expense', amount: 26900, accountId: acc.visa.id, categoryId: 'cat_suscripciones', subcategory: 'Streaming', nature: 'fixed', frequency: 'monthly', day: 12, isSubscription: true, paymentMethod: 'Tarjeta de crédito', autoConfirm: true }),
      rule({ key: 'spotify', name: 'Spotify', type: 'expense', amount: 16900, accountId: acc.visa.id, categoryId: 'cat_suscripciones', subcategory: 'Música', nature: 'fixed', frequency: 'monthly', day: 20, isSubscription: true, paymentMethod: 'Tarjeta de crédito', autoConfirm: true }),
      rule({ key: 'gym', name: 'Gimnasio', type: 'expense', amount: 99000, accountId: acc.nu.id, categoryId: 'cat_suscripciones', subcategory: 'Gimnasio', nature: 'fixed', frequency: 'monthly', day: 1, isSubscription: true, paymentMethod: 'Débito automático', autoConfirm: true }),
      rule({ key: 'icloud', name: 'Almacenamiento en la nube', type: 'expense', amount: 179900, accountId: acc.visa.id, categoryId: 'cat_suscripciones', subcategory: 'Software', nature: 'fixed', frequency: 'annual', day: 22, startDate: D(U.addMonthKey(startKey, 2), 22), isSubscription: true, paymentMethod: 'Tarjeta de crédito', autoConfirm: true }),
      rule({ key: 'ahorro', name: 'Ahorro fondo de emergencia', type: 'saving', amount: 400000, accountId: acc.banco.id, toAccountId: acc.cajita.id, goalId: goals[0].id, frequency: 'monthly', day: 1, autoConfirm: true }),
      rule({ key: 'ahorropc', name: 'Ahorro computador', type: 'saving', amount: 300000, accountId: acc.banco.id, toAccountId: acc.bolsillo.id, goalId: goals[1].id, frequency: 'monthly', day: 2, startDate: D(U.addMonthKey(startKey, 4), 2), autoConfirm: true }),
      rule({ key: 'etf', name: 'Aporte ETF', type: 'investment', amount: 300000, accountId: acc.banco.id, investmentId: etf.id, frequency: 'monthly', day: 3, autoConfirm: false }),
      rule({ key: 'credito', name: 'Cuota crédito libre inversión', type: 'debt_payment', amount: 420000, accountId: acc.banco.id, debtId: loan.id, frequency: 'monthly', day: 15, interestAmount: 0 })
    ];

    const txs = [];
    const add = (o) => txs.push(Object.assign({ id: id('tx'), tags: [], person: 'personal', notes: '', paymentMethod: '', subcategory: '', recurring: false }, o, demo));

    // Ocurrencias pasadas de reglas (estrictamente antes de hoy). Hoy queda pendiente.
    let loanBal = loan.openingBalance;
    const monthlyRate = Math.pow(1.24, 1 / 12) - 1;
    for (const ru of rules) {
      let d = ru.startDate.slice(0, 8) + U.pad(Math.min(ru.anchorDay, U.daysInMonth(ru.startDate.slice(0, 7))));
      if (d < ru.startDate) d = F.recurring.step(ru, d);
      while (d < T) {
        const base = { date: d, type: ru.type, amount: ru.amount, accountId: ru.accountId, toAccountId: ru.toAccountId || null, categoryId: ru.categoryId || null,
          subcategory: ru.subcategory, description: ru.name, nature: ru.nature, recurring: true, recurringId: ru.id, paymentMethod: ru.paymentMethod,
          investmentId: ru.investmentId || null, debtId: ru.debtId || null, goalId: ru.goalId || null };
        if (ru.type === 'debt_payment') {
          const interest = round(loanBal * monthlyRate);
          const pay = Math.min(ru.amount, round(loanBal + interest));
          if (pay <= 0) break;
          base.amount = pay; base.interestAmount = interest;
          loanBal = loanBal + interest - pay;
        }
        add(base);
        d = F.recurring.step(ru, d);
      }
      ru.nextDate = d;
    }

    // Movimientos variables mes a mes
    const months = U.monthRange(startKey, curKey);
    let freelanceCount = 0;
    months.forEach((k, mi) => {
      const salary = mi >= 6 ? 4500000 : 4200000;
      const inMonth = day => D(k, day);
      const ok = date => date < T || (date === T && false);
      // Salario: último día hábil aproximado (día 30 / fin de mes) — corresponde al mes
      const payDay = inMonth(30);
      if (ok(payDay)) add({ date: payDay, type: 'income', amount: salary, accountId: acc.banco.id, categoryId: 'cat_salario', subcategory: 'Nómina', description: 'Salario ' + U.monthLabel(k).toLowerCase(), paymentMethod: 'Transferencia' });
      const m = Number(k.slice(5, 7));
      if ((m === 6 || m === 12) && ok(inMonth(20))) add({ date: inMonth(20), type: 'income', amount: salary / 2, accountId: acc.banco.id, categoryId: 'cat_salario', subcategory: 'Prima', description: 'Prima de servicios' });
      if (m === 2 && ok(inMonth(14))) add({ date: inMonth(14), type: 'income', amount: round(salary * 0.9, 1000), accountId: acc.banco.id, categoryId: 'cat_salario', subcategory: 'Cesantías', description: 'Retiro parcial de cesantías', notes: 'Consignadas al fondo' });
      if (r() < 0.55 && ok(inMonth(12 + Math.floor(rand(0, 10))))) {
        freelanceCount++;
        add({ date: inMonth(12 + Math.floor(rand(0, 10))), type: 'income', amount: round(rand(500000, 1400000), 10000), accountId: freelanceCount % 3 === 0 ? acc.nu.id : acc.banco.id, categoryId: 'cat_freelance', description: pick(['Diseño de logo', 'Consultoría de datos', 'Página web cliente', 'Clases particulares']), tags: ['trabajo'] });
      }
      if (ok(inMonth(28))) add({ date: inMonth(28), type: 'income', amount: round(rand(9000, 16000)), accountId: acc.cajita.id, categoryId: 'cat_rendimientos', description: 'Rendimientos Cajita' });

      // Transferencias Bancolombia → Nequi
      for (const day of [2, 16]) if (ok(inMonth(day))) add({ date: inMonth(day), type: 'transfer', amount: 230000, accountId: acc.banco.id, toAccountId: acc.nequi.id, description: 'Recarga Nequi' });
      if (ok(inMonth(2))) add({ date: inMonth(2), type: 'transfer', amount: 220000, accountId: acc.banco.id, toAccountId: acc.nu.id, description: 'Paso a Nu' });
      if (ok(inMonth(6))) add({ date: inMonth(6), type: 'transfer', amount: 60000, accountId: acc.banco.id, toAccountId: acc.efectivo.id, description: 'Retiro cajero', paymentMethod: 'Débito' });

      // Servicios variables
      for (const [sub, lo, hi, day] of [['Energía', 95000, 140000, 10], ['Agua', 45000, 70000, 14], ['Gas', 18000, 35000, 16]]) {
        if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(lo, hi)), accountId: acc.banco.id, categoryId: 'cat_servicios', subcategory: sub, description: 'Factura ' + sub.toLowerCase(), nature: 'fixed', paymentMethod: 'PSE' });
      }
      // Mercado (tendencia creciente para demostrar análisis)
      const foodTrend = 1 + mi * 0.012;
      for (const day of [4, 11, 19, 26]) {
        if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(120000, 185000) * foodTrend), accountId: day % 2 ? acc.visa.id : acc.banco.id, categoryId: 'cat_alimentacion', subcategory: 'Mercado', description: pick(['Mercado Éxito', 'Mercado D1', 'Carulla', 'Plaza de mercado']), person: r() < 0.4 ? 'compartido' : 'personal', paymentMethod: day % 2 ? 'Tarjeta de crédito' : 'Débito' });
      }
      // Almuerzos, cafés, domicilios
      const lunches = Math.floor(rand(5, 10));
      for (let i = 0; i < lunches; i++) {
        const day = 1 + Math.floor(rand(0, U.daysInMonth(k)));
        if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(16000, 32000)), accountId: acc.nequi.id, categoryId: 'cat_alimentacion', subcategory: 'Restaurante', description: 'Almuerzo', tags: r() < 0.6 ? ['trabajo'] : [], paymentMethod: 'Billetera digital' });
      }
      const coffees = Math.floor(rand(4, 9));
      for (let i = 0; i < coffees; i++) {
        const day = 1 + Math.floor(rand(0, U.daysInMonth(k)));
        if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(4500, 9000)), accountId: r() < 0.5 ? acc.efectivo.id : acc.nequi.id, categoryId: 'cat_alimentacion', subcategory: 'Café y snacks', description: pick(['Café', 'Tinto y pandebono', 'Café Juan Valdez']) });
      }
      for (let i = 0; i < Math.floor(rand(1, 4)); i++) {
        const day = 1 + Math.floor(rand(0, U.daysInMonth(k)));
        if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(35000, 70000)), accountId: acc.visa.id, categoryId: 'cat_alimentacion', subcategory: 'Domicilios', description: 'Domicilio Rappi', paymentMethod: 'Tarjeta de crédito' });
      }
      // Restaurantes / salidas
      for (let i = 0; i < Math.floor(rand(1, 4)); i++) {
        const day = 1 + Math.floor(rand(0, U.daysInMonth(k)));
        if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(60000, 140000)), accountId: acc.visa.id, categoryId: 'cat_restaurantes', subcategory: pick(['Cenas', 'Almuerzos', 'Bares']), description: pick(['Cena con amigos', 'Restaurante fin de semana', 'Cervezas']), person: r() < 0.5 ? 'pareja' : 'personal', tags: ['ocio'], paymentMethod: 'Tarjeta de crédito' });
      }
      // Transporte
      for (let i = 0; i < 5; i++) {
        const day = 1 + i * 6;
        if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: 30000, accountId: acc.nequi.id, categoryId: 'cat_transporte', subcategory: 'Transporte público', description: 'Recarga TuLlave', paymentMethod: 'Billetera digital' });
      }
      for (let i = 0; i < Math.floor(rand(2, 6)); i++) {
        const day = 1 + Math.floor(rand(0, U.daysInMonth(k)));
        if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(12000, 32000)), accountId: acc.nequi.id, categoryId: 'cat_transporte', subcategory: 'Taxi / apps', description: pick(['Uber', 'Taxi', 'DiDi']) });
      }
      // Entretenimiento, ropa, compras, salud, educación
      if (r() < 0.8) { const day = 1 + Math.floor(rand(0, 27)); if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(30000, 120000)), accountId: acc.visa.id, categoryId: 'cat_entretenimiento', subcategory: pick(['Cine', 'Eventos', 'Salidas']), description: pick(['Cine', 'Concierto', 'Partido de fútbol', 'Bolos']), tags: ['ocio'], person: r() < 0.5 ? 'pareja' : 'personal', paymentMethod: 'Tarjeta de crédito' }); }
      if (r() < 0.45) { const day = 1 + Math.floor(rand(0, 27)); if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(80000, 260000), 1000), accountId: acc.visa.id, categoryId: 'cat_ropa', subcategory: pick(['Ropa', 'Calzado']), description: pick(['Camisa', 'Tenis', 'Jean', 'Chaqueta']), paymentMethod: 'Tarjeta de crédito' }); }
      if (r() < 0.6) { const day = 1 + Math.floor(rand(0, 27)); if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(25000, 180000), 1000), accountId: acc.nu.id, categoryId: 'cat_compras', subcategory: pick(['Hogar', 'Varios', 'Tecnología']), description: pick(['Cosas para la casa', 'Audífonos', 'Artículos de aseo', 'Regalo pequeño']) }); }
      if (r() < 0.4) { const day = 1 + Math.floor(rand(0, 27)); if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(20000, 90000)), accountId: acc.efectivo.id, categoryId: 'cat_salud', subcategory: pick(['Medicamentos', 'Consultas']), description: pick(['Droguería', 'Cita médica', 'Exámenes']) }); }
      if (mi % 3 === 1) { const day = 7; if (ok(inMonth(day))) add({ date: inMonth(day), type: 'expense', amount: round(rand(180000, 420000), 1000), accountId: acc.banco.id, categoryId: 'cat_educacion', subcategory: 'Cursos', description: pick(['Curso de inglés', 'Diplomado virtual', 'Curso de Python']), tags: ['universidad'], paymentMethod: 'PSE' }); }
      if (m === 2 && ok(inMonth(3))) add({ date: inMonth(3), type: 'expense', amount: 1850000, accountId: acc.banco.id, categoryId: 'cat_educacion', subcategory: 'Matrícula', description: 'Matrícula semestre', tags: ['universidad'], nature: 'fixed', paymentMethod: 'PSE' });
      if (m === 12) {
        if (ok(inMonth(15))) add({ date: inMonth(15), type: 'expense', amount: 420000, accountId: acc.visa.id, categoryId: 'cat_regalos', description: 'Regalos de Navidad', tags: ['familia'], person: 'familia' });
        if (ok(inMonth(27))) add({ date: inMonth(27), type: 'expense', amount: 1650000, accountId: acc.banco.id, categoryId: 'cat_viajes', subcategory: 'Tiquetes', description: 'Tiquetes y hotel Santa Marta', tags: ['viaje'], person: 'pareja' });
      }
      if (m === 1 && ok(inMonth(4))) add({ date: inMonth(4), type: 'expense', amount: 520000, accountId: acc.visa.id, categoryId: 'cat_viajes', subcategory: 'Actividades', description: 'Gastos del viaje', tags: ['viaje'], person: 'pareja' });
      // Comisiones bancarias y 4x1000
      if (ok(inMonth(28))) add({ date: inMonth(28), type: 'expense', amount: round(rand(14000, 22000)), accountId: acc.banco.id, categoryId: 'cat_comisiones', subcategory: '4x1000', description: 'GMF 4x1000 y cuota de manejo', nature: 'fixed' });
      // Pago de tarjeta: total gastado con la Visa el mes anterior
      const prevKey = U.addMonthKey(k, -1);
      if (prevKey >= startKey && ok(inMonth(10))) {
        const card = txs.filter(t => t.accountId === acc.visa.id && t.type === 'expense' && U.monthKey(t.date) === prevKey).reduce((a, t) => a + t.amount, 0);
        if (card > 0) add({ date: inMonth(10), type: 'transfer', amount: card, accountId: acc.banco.id, toAccountId: acc.visa.id, description: 'Pago tarjeta Visa' });
      }
      // Valoración mensual del ETF y BTC (fin de mes)
      const vd = inMonth(U.daysInMonth(k));
      if (vd < T && mi > 0) {
        etf.valuations.push({ date: vd, value: 0, at: vd + 'T23:00:00Z', _drift: rand(-0.035, 0.05) });
        btc.valuations.push({ date: vd, value: 0, at: vd + 'T23:00:00Z', _drift: rand(-0.15, 0.18) });
      }
    });

    // CDT: aporte inicial único
    if (cdtStart < T) {
      add({ date: cdtStart, type: 'investment', amount: 3000000, accountId: acc.banco.id, investmentId: cdt.id, description: 'Apertura CDT 12 meses' });
      cdt.valuations.push({ date: cdtStart, value: 3000000, at: cdtStart + 'T23:59:00Z' });
    }
    // Préstamo a Andrés
    const lendDate = D(U.addMonthKey(curKey, -4), 10), back1 = D(U.addMonthKey(curKey, -2), 20), back2 = D(U.addMonthKey(curKey, -1), 20);
    add({ date: lendDate, type: 'loan_given', amount: 500000, accountId: acc.nequi.id, debtId: lent.id, description: 'Préstamo a Andrés' });
    add({ date: back1, type: 'debt_payment', amount: 200000, interestAmount: 0, accountId: acc.nequi.id, debtId: lent.id, description: 'Andrés abona' });
    add({ date: back2, type: 'debt_payment', amount: 100000, interestAmount: 0, accountId: acc.nequi.id, debtId: lent.id, description: 'Andrés abona' });
    // Comisión de inversión
    add({ date: D(U.addMonthKey(curKey, -3), 5), type: 'expense', amount: 12000, accountId: acc.banco.id, categoryId: 'cat_comisiones', subcategory: 'Inversión', description: 'Comisión broker', investmentId: etf.id });

    // Valoraciones ETF/BTC: valor previo + aportes del mes, con variación de mercado
    const fillVals = (inv) => {
      let value = inv.valuations[0] ? inv.valuations[0].value : 0;
      let prevDate = inv.valuations[0] ? inv.valuations[0].date : inv.startDate;
      for (let i = 1; i < inv.valuations.length; i++) {
        const v = inv.valuations[i];
        const flows = txs.filter(t => t.investmentId === inv.id && t.date > prevDate && t.date <= v.date)
          .reduce((a, t) => a + (t.type === 'investment' ? t.amount : t.type === 'investment_withdrawal' ? -t.amount : 0), 0);
        value = round((value + flows) * (1 + v._drift), 1000);
        v.value = Math.max(0, value);
        delete v._drift;
        prevDate = v.date;
      }
    };
    fillVals(etf); fillVals(btc);
    // CDT: valoración con intereses causados
    if (cdtStart < T) { const months = Math.floor(U.monthsBetween(cdtStart, T)); if (months > 0) cdt.valuations.push({ date: U.addDays(T, -1), value: round(3000000 * Math.pow(1.105, months / 12), 1000), at: U.addDays(T, -1) + 'T23:00:00Z' }); }

    // Otros activos
    const assets = [{ id: 'demo_asset_moto', name: 'Moto', kind: 'vehicle', valuations: [{ date: start, value: 7500000 }, { date: D(U.addMonthKey(curKey, -6), 1), value: 6900000 }], notes: 'Valor estimado', ...demo }];

    return {
      accounts, transactions: txs, recurring: rules, budgets, goals,
      investments: [etf, cdt, btc], debts: [loan, lent], assets, categories: [], settings: []
    };
  }

  /** Carga los datos de demostración (no toca datos reales). */
  async function load(store) {
    const data = build(U.today());
    const ops = [];
    const nowIso = new Date().toISOString();
    // createdAt de cada movimiento = su propia fecha (orden estable y coherente con las valoraciones)
    for (const [s, list] of Object.entries(data)) if (list.length) ops.push({ store: s, put: list.map(r => Object.assign({ createdAt: s === 'transactions' ? r.date + 'T12:00:00.000Z' : nowIso, updatedAt: nowIso }, r)) });
    // Validación previa con el mismo validador de importación
    const check = F.io.validateBackup({ app: F.io.APP_ID, schemaVersion: F.schema.SCHEMA_VERSION, data: Object.assign({}, store.snapshot(), data, {
      categories: store.all('categories'), settings: store.all('settings') }) });
    if (check.invalid.length) console.warn('Datos demo inválidos', check.invalid.slice(0, 5));
    await store.adapter.batch(ops);
    store._applyOps(ops);
    await store.saveSettings({ demoLoaded: true });
    store.emit({ store: '*', action: 'demo-loaded' });
    L.invalidate();
    return { transactions: data.transactions.length, invalid: check.invalid.length };
  }

  F.demo = { build, load };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
