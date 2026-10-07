/* =========================================================================
 * core/utils.js — Utilidades puras: números seguros, dinero, fechas, ids.
 * Sin dependencias del DOM: se pueden reutilizar en un backend futuro.
 * ========================================================================= */
(function (F) {
  'use strict';

  // ---------- Números seguros ----------
  /** Convierte cualquier valor en número finito; si no lo es, devuelve `fallback`. */
  function num(v, fallback) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }
  /** Redondeo monetario a 2 decimales evitando errores de coma flotante. */
  function round2(n) { return Math.round((num(n) + Number.EPSILON) * 100) / 100; }
  /** Suma segura de una lista (o de una proyección de ella). */
  function sum(list, fn) {
    let t = 0;
    for (const x of list || []) t += num(fn ? fn(x) : x);
    return round2(t);
  }
  /** División segura: devuelve null si el denominador es 0 (para mostrar "—"). */
  function safeDiv(a, b) {
    a = num(a); b = num(b);
    if (b === 0) return null;
    const r = a / b;
    return Number.isFinite(r) ? r : null;
  }
  /** Variación porcentual (a respecto a b). null si b es 0. */
  function pctChange(current, previous) {
    current = num(current); previous = num(previous);
    if (previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, num(n))); }
  function avg(list) { return list && list.length ? sum(list) / list.length : 0; }

  // ---------- Moneda ----------
  const CURRENCIES = {
    COP: { code: 'COP', symbol: '$', decimals: 0, name: 'Peso colombiano' },
    USD: { code: 'USD', symbol: 'US$', decimals: 2, name: 'Dólar estadounidense' },
    EUR: { code: 'EUR', symbol: '€', decimals: 2, name: 'Euro' }
  };
  let baseCurrency = 'COP';
  function setBaseCurrency(c) { if (CURRENCIES[c]) baseCurrency = c; }
  function getBaseCurrency() { return baseCurrency; }

  function groupThousands(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /**
   * Formato monetario con convención colombiana: $1.000.000 / US$1.234,56.
   * Nunca devuelve NaN/undefined/null: entradas inválidas se muestran como 0.
   * opts: { currency, sign: true (muestra + en positivos), compact: true ($1,2 M) }
   */
  function money(value, opts) {
    opts = opts || {};
    const cur = CURRENCIES[opts.currency] || CURRENCIES[baseCurrency];
    let n = num(value);
    const neg = n < 0;
    n = Math.abs(n);
    let body;
    if (opts.compact && n >= 1e6) {
      const units = n >= 1e12 ? [1e12, ' B'] : n >= 1e9 ? [1e9, ' mil M'] : [1e6, ' M'];
      const v = n / units[0];
      body = v.toFixed(v >= 100 ? 0 : 1).replace('.', ',').replace(/,0$/, '') + units[1];
    } else if (opts.compact && n >= 1e4) {
      body = Math.round(n / 1e3) + ' mil';
    } else {
      const d = opts.decimals !== undefined ? opts.decimals : cur.decimals;
      const fixed = n.toFixed(d);
      const parts = fixed.split('.');
      body = groupThousands(parts[0]) + (d > 0 ? ',' + parts[1] : '');
    }
    const sign = neg ? '−' : (opts.sign && n > 0 ? '+' : '');
    return sign + cur.symbol + body;
  }

  /**
   * Interpreta lo que una persona escribe como valor: "25.000", "25000", "1.250.000,50",
   * "12,5", "25k", "$ 3.000". Devuelve número o NaN si no es interpretable.
   */
  function parseAmount(input) {
    if (typeof input === 'number') return input;
    if (input === null || input === undefined) return NaN;
    let s = String(input).trim().toLowerCase().replace(/\s|\$|us|cop|usd|eur|€/g, '');
    if (!s) return NaN;
    let mult = 1;
    if (/k$/.test(s)) { mult = 1e3; s = s.slice(0, -1); }
    else if (/(mm|millones|millon|millón)$/.test(s)) { mult = 1e6; s = s.replace(/(mm|millones|millon|millón)$/, ''); }
    if (s.startsWith('-') || s.startsWith('−')) return NaN; // los valores se registran en positivo
    if (!/^[\d.,]+$/.test(s)) return NaN;
    if (s.includes(',')) {
      // Coma = decimal, punto = miles (convención es-CO)
      if ((s.match(/,/g) || []).length > 1) return NaN;
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes('.')) {
      // Solo puntos: si forman grupos de miles (1.000 / 12.500.000) son miles; si no, decimal (12.5)
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      else if ((s.match(/\./g) || []).length > 1) return NaN;
    }
    const n = parseFloat(s) * mult;
    return Number.isFinite(n) ? round2(n) : NaN;
  }

  /** Formatea mientras se escribe (agrupa miles, respeta decimales con coma). */
  function formatAmountInput(raw, currency) {
    const cur = CURRENCIES[currency] || CURRENCIES[baseCurrency];
    let s = String(raw || '').replace(/[^\d,]/g, '');
    if (!s) return '';
    let [i, d] = s.split(',');
    i = i.replace(/^0+(?=\d)/, '');
    let out = groupThousands(i || '0');
    if (cur.decimals > 0 && d !== undefined) out += ',' + d.slice(0, cur.decimals);
    return out;
  }

  function pct(value, decimals) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const d = decimals === undefined ? 1 : decimals;
    return value.toFixed(d).replace('.', ',').replace(/,0+$/, '') + '%';
  }
  function signedPct(value, decimals) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return (value > 0 ? '+' : value < 0 ? '−' : '') + pct(Math.abs(value), decimals);
  }
  function plainNumber(n, d) {
    n = num(n);
    const fixed = n.toFixed(d || 0).split('.');
    return (n < 0 ? '−' : '') + groupThousands(fixed[0].replace('-', '')) + (fixed[1] ? ',' + fixed[1] : '');
  }

  // ---------- Fechas (siempre 'YYYY-MM-DD' en hora local) ----------
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  let _nowOverride = null; // para pruebas
  function setNow(d) { _nowOverride = d ? new Date(d) : null; }
  function now() { return _nowOverride ? new Date(_nowOverride) : new Date(); }

  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return toISO(now()); }
  function parseISO(s) {
    if (!isValidDate(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  /** Fecha válida y razonable (1900–2100). */
  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 1900 || y > 2100) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  /** Acepta YYYY-MM-DD, DD/MM/YYYY o DD-MM-YYYY. Devuelve ISO o null. */
  function normalizeDate(s) {
    if (!s) return null;
    s = String(s).trim();
    if (isValidDate(s)) return s;
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) { const iso = m[3] + '-' + pad(m[2]) + '-' + pad(m[1]); return isValidDate(iso) ? iso : null; }
    m = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
    if (m) { const iso = m[1] + '-' + pad(m[2]) + '-' + pad(m[3]); return isValidDate(iso) ? iso : null; }
    return null;
  }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  /** Suma meses conservando el día cuando existe (31 ene + 1 mes → 28/29 feb). */
  function addMonths(iso, n, anchorDay) {
    const d = parseISO(iso);
    const day = anchorDay || d.getDate();
    const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, dim));
    return toISO(target);
  }
  function monthKey(iso) { return iso.slice(0, 7); }
  function monthStart(key) { return key + '-01'; }
  function monthEnd(key) { const [y, m] = key.split('-').map(Number); return key + '-' + pad(new Date(y, m, 0).getDate()); }
  function daysInMonth(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); }
  function addMonthKey(key, n) { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function currentMonthKey() { return monthKey(today()); }
  function monthRange(fromKey, toKey) {
    const out = [];
    if (!fromKey || !toKey || fromKey > toKey) return out;
    let k = fromKey, guard = 0;
    while (k <= toKey && guard++ < 2400) { out.push(k); k = addMonthKey(k, 1); }
    return out;
  }
  function monthLabel(key, short) {
    if (!key) return '';
    const [y, m] = key.split('-').map(Number);
    return short ? MONTHS_SHORT[m - 1] + ' ' + String(y).slice(2) : cap(MONTHS[m - 1]) + ' ' + y;
  }
  function dateLabel(iso, opts) {
    const d = parseISO(iso);
    if (!d) return '';
    opts = opts || {};
    const base = d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
    return opts.year === false ? base : base + ' ' + d.getFullYear();
  }
  function relativeDayLabel(iso) {
    const t = today();
    if (iso === t) return 'Hoy';
    if (iso === addDays(t, -1)) return 'Ayer';
    if (iso === addDays(t, 1)) return 'Mañana';
    const d = parseISO(iso);
    const wd = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getDay()];
    return cap(wd) + ' ' + dateLabel(iso, { year: iso.slice(0, 4) !== t.slice(0, 4) });
  }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  /** Meses (fraccionarios) entre dos fechas. */
  function monthsBetween(a, b) { return daysBetween(a, b) / 30.4375; }
  /** Lunes de la semana de una fecha. */
  function weekStart(iso) { const d = parseISO(iso); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return toISO(d); }
  function quarterOf(iso) { return Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1; }

  // ---------- Texto / ids ----------
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function normalizeText(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function uid(prefix) {
    const rnd = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')
      : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    return (prefix ? prefix + '_' : '') + Date.now().toString(36) + rnd.slice(0, 10);
  }
  function escapeHTML(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /** Normaliza etiquetas: "#Universidad, viaje" → ['universidad','viaje'] */
  function parseTags(input) {
    const arr = Array.isArray(input) ? input : String(input || '').split(/[,\s]+/);
    const out = [];
    for (let t of arr) {
      t = normalizeText(String(t).replace(/^#+/, '').trim()).replace(/[^a-z0-9ñ_\-]/g, '');
      if (t && t.length <= 40 && !out.includes(t)) out.push(t);
    }
    return out.slice(0, 20);
  }
  function deepClone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function groupBy(list, fn) {
    const m = new Map();
    for (const x of list) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  }

  F.utils = {
    num, round2, sum, safeDiv, pctChange, clamp, avg,
    CURRENCIES, setBaseCurrency, getBaseCurrency, money, parseAmount, formatAmountInput, pct, signedPct, plainNumber,
    MONTHS, MONTHS_SHORT, WEEKDAYS_SHORT, setNow, now, toISO, today, parseISO, isValidDate, normalizeDate,
    addDays, addMonths, monthKey, monthStart, monthEnd, daysInMonth, addMonthKey, currentMonthKey, monthRange,
    monthLabel, dateLabel, relativeDayLabel, daysBetween, monthsBetween, weekStart, quarterOf,
    cap, normalizeText, uid, escapeHTML, parseTags, deepClone, groupBy, pad
  };
})(typeof window !== 'undefined' ? (window.FIN = window.FIN || {}) : (globalThis.FIN = globalThis.FIN || {}));
