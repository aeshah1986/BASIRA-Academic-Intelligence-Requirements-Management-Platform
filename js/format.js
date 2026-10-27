/*
 * تنسيق العرض: التواريخ، وفروق الأيام، وصياغة العدد العربية — منصة «بصيرة»
 * يعمل في المتصفح (window.Basira.format) وفي Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Basira = root.Basira || {};
    root.Basira.format = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY_MS = 864e5;
  // التقويم الميلادي والأرقام اللاتينية صراحة: «ar-SA» وحدها تعرض الهجري (D9).
  var LOCALE = 'ar-u-ca-gregory-nu-latn';
  var dateFormatter = null;

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // تاريخ اليوم بصيغة YYYY-MM-DD حسب ساعة الجهاز المحلية.
  function todayISO(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // يحوّل YYYY-MM-DD إلى ميلي ثانية (UTC)، أو null إن لم يكن تاريخًا صالحًا.
  function parseISO(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var p = value.split('-').map(Number);
    var t = Date.UTC(p[0], p[1] - 1, p[2]);
    var d = new Date(t);
    if (d.getUTCFullYear() !== p[0] || d.getUTCMonth() !== p[1] - 1 || d.getUTCDate() !== p[2]) return null;
    return t;
  }

  // عدد الأيام من from إلى to (موجب إذا كان to بعد from).
  function daysBetween(fromISO, toISO) {
    var a = parseISO(fromISO);
    var b = parseISO(toISO);
    if (a === null || b === null) return null;
    return Math.round((b - a) / DAY_MS);
  }

  function addDays(iso, days) {
    var t = parseISO(iso);
    if (t === null) return null;
    var d = new Date(t + days * DAY_MS);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  // صياغة العدد مع «يوم»: 1 يوم واحد، 2 يومان، 3–10 أيام، 11+ يومًا.
  function dayCount(n) {
    n = Math.abs(n);
    if (n === 1) return 'يوم واحد';
    if (n === 2) return 'يومان';
    if (n >= 3 && n <= 10) return n + ' أيام';
    return n + ' يومًا';
  }

  // «1 نوفمبر 2026». القيمة غير الصالحة تُعاد كما هي.
  function formatDate(iso) {
    var t = parseISO(iso);
    if (t === null) return iso ? String(iso) : '—';
    if (!dateFormatter) {
      dateFormatter = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    return dateFormatter.format(new Date(t));
  }

  // نسبة مئوية مقربة، أو null عند القسمة على صفر (تُعرض «—» لا 0%).
  function percent(part, total) {
    if (!total) return null;
    return Math.round((part / total) * 100);
  }

  return {
    todayISO: todayISO,
    parseISO: parseISO,
    daysBetween: daysBetween,
    addDays: addDays,
    dayCount: dayCount,
    formatDate: formatDate,
    percent: percent
  };
});
