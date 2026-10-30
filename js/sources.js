/*
 * قراءة الملفات المصدرية وفحص جودتها — منصة «بصيرة» (docs/design/06 §2، §7، §8، §9)
 * ------------------------------------------------------------
 * - CSV: يُكتشف BOM والفاصل (، أو ; أو Tab)، وتُدعم الخانات بين علامات التنصيص (بما فيها الفواصل والأسطر).
 * - سطر العناوين يُكتشف تلقائيًا (قد يكون الصف 13 مثلًا) ويمكن تغييره يدويًا.
 * - الخصوصية: هذا الملف يقرأ في الذاكرة فقط. ما يُخزن لاحقًا هو describe() وحده: اسم الملف، وعدد الصفوف،
 *   وسطر العناوين، وأسماء الأعمدة. لا محتوى صفوف.
 * يعمل في المتصفح (window.Basira.sources) وفي Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Basira = root.Basira || {};
    root.Basira.sources = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_BYTES = 60 * 1024 * 1024; // ملفا الـ 41MB يدخلان، وما فوق ذلك يُطلب تنظيفه أولًا
  var HEADER_SCAN = 40;
  var NA = /^(n\/?a|na|null|none|-|—|لا يوجد|غير متوفر)$/i;

  var MESSAGES = {
    xls: 'صيغة .xls القديمة غير مدعومة. يرجى فتح الملف في Excel ثم «حفظ باسم» بصيغة «CSV UTF-8» أو «Excel Workbook (.xlsx)»، ثم رفعه من جديد.',
    unknownType: 'نوع الملف غير مدعوم. الصيغ المقبولة: CSV وxlsx.',
    tooLarge: 'الملف أكبر من 60MB. غالبًا فيه صفوف فارغة منسقة: يرجى حذفها أو نسخ الجدول إلى ملف جديد ثم رفعه.',
    empty: 'الملف فارغ أو لا يحتوي صفوفًا قابلة للقراءة.',
    badHeader: 'سطر العناوين المختار خارج حدود الملف.'
  };

  // نوع الملف من الاسم أو من أول البايتات (xls القديم يبدأ بتوقيع OLE: D0 CF 11 E0).
  function fileKind(name, firstBytes) {
    var n = String(name || '').toLowerCase();
    if (firstBytes && firstBytes.length >= 4 && firstBytes[0] === 0xD0 && firstBytes[1] === 0xCF && firstBytes[2] === 0x11 && firstBytes[3] === 0xE0) return 'xls';
    if (/\.xls$/.test(n)) return 'xls';
    if (/\.xlsx$/.test(n)) return 'xlsx';
    if (/\.(csv|txt)$/.test(n)) return 'csv';
    return 'other';
  }

  function checkFile(name, size, firstBytes) {
    var kind = fileKind(name, firstBytes);
    if (kind === 'xls') return { ok: false, kind: kind, message: MESSAGES.xls };
    if (kind === 'other') return { ok: false, kind: kind, message: MESSAGES.unknownType };
    if (size > MAX_BYTES) return { ok: false, kind: kind, message: MESSAGES.tooLarge };
    return { ok: true, kind: kind, message: '' };
  }

  // الفاصل الأكثر تكرارًا خارج علامات التنصيص في أول الأسطر.
  function detectDelimiter(text) {
    var sample = String(text).slice(0, 20000);
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var inQ = false;
    for (var i = 0; i < sample.length; i++) {
      var ch = sample[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] !== undefined) counts[ch]++;
    }
    var best = ',';
    Object.keys(counts).forEach(function (k) { if (counts[k] > counts[best]) best = k; });
    return best;
  }

  // يحلل CSV إلى مصفوفة صفوف (كل صف مصفوفة نصوص). يحافظ على الصفوف الفارغة حتى تبقى أرقام الصفوف صحيحة.
  function parseCSV(text, opts) {
    var s = String(text == null ? '' : text).replace(/^﻿/, '');
    var d = (opts && opts.delimiter) || detectDelimiter(s);
    var rows = [];
    var row = [];
    var cell = '';
    var inQ = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (inQ) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
        } else cell += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === d) {
        row.push(cell); cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function isBlank(v) { return String(v == null ? '' : v).trim() === ''; }
  function filled(row) { return (row || []).filter(function (c) { return !isBlank(c); }).length; }
  function isNumericText(v) { return toNumber(v) !== null; }

  // رقم من نص: يقبل الأرقام العربية الهندية، والفواصل العشرية والآلاف، والمسافات. وإلا null.
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    s = s.replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); })
      .replace(/٫/g, '.').replace(/[٬,\s]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }

  /*
   * سطر العناوين: أول صف (في أول 40 صفًا) عدد خاناته غير الفارغة ≥ 60% من أكبر عدد في العينة، وأغلبها نصوص
   * لا أرقام، ويليه صف فيه بيانات. أسطر الوصف في أعلى ملفات مثل Top 500 فيها خانة أو خانتان فقط فتُتجاوز.
   * يعيد رقم الصف (يبدأ من 1).
   */
  function detectHeaderRow(rows) {
    var sample = rows.slice(0, HEADER_SCAN);
    var max = sample.reduce(function (m, r) { return Math.max(m, filled(r)); }, 0);
    if (max === 0) return 1;
    for (var i = 0; i < sample.length; i++) {
      var r = sample[i];
      var n = filled(r);
      if (n < Math.max(2, Math.ceil(max * 0.6))) continue;
      var textual = r.filter(function (c) { return !isBlank(c) && !isNumericText(c); }).length;
      if (textual < Math.ceil(n * 0.6)) continue;
      var next = rows.slice(i + 1).filter(function (x) { return filled(x) > 0; })[0];
      if (next) return i + 1;
    }
    return 1;
  }

  /*
   * جدول من الصفوف وسطر العناوين: { headerRow, columns, records, rowNumbers, emptyInside, trailingEmpty, trailingFrom }
   * records: صفوف البيانات غير الفارغة. rowNumbers: رقم كل منها في الملف الأصلي (لذكر الصفوف في التنبيهات).
   */
  function toTable(rows, headerRow) {
    var h = headerRow || detectHeaderRow(rows);
    if (h < 1 || h > rows.length) return { ok: false, message: MESSAGES.badHeader };
    var columns = (rows[h - 1] || []).map(function (c, i) { var t = String(c).trim(); return t || 'عمود ' + (i + 1); });
    var body = rows.slice(h);
    var lastFilled = -1;
    body.forEach(function (r, i) { if (filled(r)) lastFilled = i; });
    var records = [];
    var rowNumbers = [];
    var emptyInside = [];
    for (var i = 0; i <= lastFilled; i++) {
      if (!filled(body[i])) { emptyInside.push(h + i + 1); continue; }
      var rec = [];
      for (var c = 0; c < columns.length; c++) rec.push(String(body[i][c] == null ? '' : body[i][c]).trim());
      records.push(rec);
      rowNumbers.push(h + i + 1);
    }
    var trailing = body.length - lastFilled - 1;
    if (!records.length) return { ok: false, message: MESSAGES.empty };
    return {
      ok: true, headerRow: h, columns: columns, records: records, rowNumbers: rowNumbers,
      emptyInside: emptyInside, trailingEmpty: trailing, trailingFrom: trailing ? h + lastFilled + 2 : null
    };
  }

  function columnIndex(table, name) {
    return table.columns.indexOf(name);
  }

  function column(table, name) {
    var i = columnIndex(table, name);
    return i === -1 ? null : table.records.map(function (r) { return r[i]; });
  }

  // القيم المختلفة في عمود مع عددها (لاختيار قيم التصفية من قائمة، مثل الرتب). لا تُخزن، تُعرض فقط.
  function distinctValues(table, name) {
    var vals = column(table, name);
    if (!vals) return null;
    var counts = {};
    vals.forEach(function (v) { if (!isBlank(v)) counts[v] = (counts[v] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, 'ar'); }).map(function (k) { return { value: k, count: counts[k] }; });
  }

  /*
   * فحوص الجودة (06 §7): { emptyInside, trailingEmpty, trailingFrom, emptyCells: {عمود: n},
   *   na: { column, count, rows }, duplicates: { column, count, rows }, nonNumeric: {عمود: { count, rows }} }
   * تُذكر أرقام الصفوف لا محتواها.
   */
  function quality(table, opts) {
    opts = opts || {};
    var out = { emptyInside: table.emptyInside.slice(), trailingEmpty: table.trailingEmpty, trailingFrom: table.trailingFrom, emptyCells: {}, na: null, duplicates: null, nonNumeric: {} };
    (opts.columns || []).forEach(function (name) {
      var vals = column(table, name);
      if (vals) out.emptyCells[name] = vals.filter(isBlank).length;
    });
    if (opts.naColumn) {
      var naVals = column(table, opts.naColumn) || [];
      var naRows = [];
      naVals.forEach(function (v, i) { if (NA.test(String(v).trim())) naRows.push(table.rowNumbers[i]); });
      out.na = { column: opts.naColumn, count: naRows.length, rows: naRows };
    }
    if (opts.keyColumn) {
      var keys = column(table, opts.keyColumn) || [];
      var seen = {};
      var dupRows = [];
      keys.forEach(function (k, i) {
        if (isBlank(k)) return;
        if (seen[k]) dupRows.push(table.rowNumbers[i]); else seen[k] = true;
      });
      out.duplicates = { column: opts.keyColumn, count: dupRows.length, rows: dupRows };
    }
    (opts.numericColumns || []).forEach(function (name) {
      var vals = column(table, name);
      if (!vals) return;
      var bad = [];
      vals.forEach(function (v, i) { if (!isBlank(v) && toNumber(v) === null) bad.push(table.rowNumbers[i]); });
      out.nonNumeric[name] = { count: bad.length, rows: bad };
    });
    return out;
  }

  // صياغة العدد: صف واحد فارغ، صفان فارغان، 3–10 صفوف فارغة، 11+ صفًا فارغًا.
  function emptyRows(n) {
    if (n === 1) return 'صف واحد فارغ';
    if (n === 2) return 'صفان فارغان';
    if (n >= 3 && n <= 10) return n + ' صفوف فارغة';
    return n + ' صفًا فارغًا';
  }

  // نص مختصر لنتيجة الجودة (أرقام فقط).
  function qualitySummary(q) {
    var parts = [];
    if (q.trailingEmpty) parts.push(emptyRows(q.trailingEmpty) + ' في آخر الملف (من الصف ' + q.trailingFrom + ')');
    if (q.emptyInside.length) parts.push(emptyRows(q.emptyInside.length) + ' داخل البيانات (الصفوف ' + q.emptyInside.join('، ') + ')');
    if (q.duplicates && q.duplicates.count) parts.push(q.duplicates.count + ' مكرر في «' + q.duplicates.column + '» (الصفوف ' + q.duplicates.rows.join('، ') + ')');
    if (q.na && q.na.count) parts.push(q.na.count + ' «N/A» في «' + q.na.column + '» (الصفوف ' + q.na.rows.join('، ') + ')');
    Object.keys(q.emptyCells).forEach(function (k) { if (q.emptyCells[k]) parts.push(q.emptyCells[k] + ' خانة فارغة في «' + k + '»'); });
    Object.keys(q.nonNumeric).forEach(function (k) { if (q.nonNumeric[k].count) parts.push(q.nonNumeric[k].count + ' قيمة غير رقمية في «' + k + '» (الصفوف ' + q.nonNumeric[k].rows.join('، ') + ')'); });
    return parts;
  }

  // الوصف الوحيد الذي يجوز تخزينه عن ملف (06 §9).
  function describe(table, fileName, uploadedAt) {
    return { fileName: String(fileName || ''), uploadedAt: uploadedAt || '', rowCount: table.records.length, headerRow: table.headerRow, columns: table.columns.slice() };
  }

  // من نص CSV إلى جدول في خطوة واحدة.
  function tableFromCSV(text, headerRow) {
    var rows = parseCSV(text);
    if (!rows.some(function (r) { return filled(r); })) return { ok: false, message: MESSAGES.empty };
    return toTable(rows, headerRow);
  }

  return {
    MAX_BYTES: MAX_BYTES,
    MESSAGES: MESSAGES,
    fileKind: fileKind,
    checkFile: checkFile,
    detectDelimiter: detectDelimiter,
    parseCSV: parseCSV,
    toNumber: toNumber,
    detectHeaderRow: detectHeaderRow,
    toTable: toTable,
    tableFromCSV: tableFromCSV,
    columnIndex: columnIndex,
    column: column,
    distinctValues: distinctValues,
    quality: quality,
    qualitySummary: qualitySummary,
    describe: describe,
    isBlank: isBlank
  };
});
