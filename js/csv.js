/*
 * تصدير CSV — منصة «بصيرة»
 * UTF-8 مع BOM حتى يفتح Excel العربية صحيحة، وفواصل أسطر CRLF، وكل خلية بين علامتي تنصيص.
 * الحماية من حقن الصيغ (CSV/Formula injection): أي خلية نصية تبدأ بـ = أو + أو - أو @ أو Tab أو CR
 * تُسبق بعلامة ' حتى لا ينفذها برنامج الجداول كصيغة. الأرقام السالبة الصريحة (مثل -5) تبقى كما هي.
 * يعمل في المتصفح (window.Basira.csv) وفي Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Basira = root.Basira || {};
    root.Basira.csv = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOM = '﻿';

  function safeCell(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return s;
  }

  function quote(value) {
    return '"' + safeCell(value).replace(/"/g, '""') + '"';
  }

  // headers: [نص]، rows: [[قيمة]]. يعيد نص الملف كاملًا.
  function toCSV(headers, rows) {
    var lines = [headers.map(quote).join(',')];
    rows.forEach(function (row) { lines.push(row.map(quote).join(',')); });
    return BOM + lines.join('\r\n') + '\r\n';
  }

  return { BOM: BOM, safeCell: safeCell, toCSV: toCSV };
});
