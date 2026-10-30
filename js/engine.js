/*
 * محرك حساب المؤشرات من الملفات المصدرية — منصة «بصيرة» (docs/design/06)
 * ------------------------------------------------------------
 * - مدخلات بعمليات محددة فقط: pick وcount وcountWhere وcountDistinct وsum وmanual وcountDistinctAcross.
 * - صيغ بلغة صغيرة مقيدة تُحلل نصيًا (دوال من قائمة بيضاء ومعرّفات مدخلات وأرقام). لا eval ولا Function:
 *   أي دالة غير معروفة تُرفض قبل أي حساب.
 * - لكل نتيجة: بيان حساب نصي (أعداد لا أسماء)، وتنبيهات منهجية، ونسبة التقدم عن العام الماضي (C-YOY).
 * - الجداول (tables) من sources.toTable وتبقى في الذاكرة. ما يُخزن هو storableRun() فقط.
 * يعمل في المتصفح (window.Basira.engine) وفي Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sources.js'), require('./normalize.js'), require('./format.js'));
  } else {
    root.Basira = root.Basira || {};
    root.Basira.engine = factory(root.Basira.sources, root.Basira.normalize, root.Basira.format);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S, N, F) {
  'use strict';

  // ---------- خانات المصادر للتصنيف العربي – التعليم والتعلم ----------
  var SLOTS = {
    admission: { label: 'عمادة القبول والتسجيل', kind: 'aggregate', hint: 'جدول تجميعي: العمود الأول اسم البند' },
    graduate: { label: 'وكالة الدراسات العليا', kind: 'aggregate', hint: 'جدول تجميعي: العمود الأول اسم البند' },
    faculty: { label: 'المحاضرون الفعالون', kind: 'list', hint: 'قائمة أفراد فيها RANK_DESC' },
    top500: { label: 'Top 500 authors by h-index (SciVal)', kind: 'list', hint: 'سطر العناوين غالبًا في الصف 13' },
    heqs: { label: 'HEQS-F01.11 أعضاء هيئة التدريس', kind: 'list', optional: true, hint: 'اختياري: للعد الموحد مع ملف المحاضرين' },
    keymap: { label: 'ملف ربط المفاتيح', kind: 'list', optional: true, hint: 'اختياري: EMPLOYEE_ID ورقم الهوية معًا' },
    form3: { label: 'نموذج المؤشر 3 بعد التعبئة', kind: 'list' },
    form4: { label: 'نموذج المؤشر 4 بعد التعبئة', kind: 'list' },
    form6: { label: 'نموذج المؤشر 6 بعد التعبئة', kind: 'list' },
    form7: { label: 'نموذج المؤشر 7 بعد التعبئة', kind: 'list' },
    form8: { label: 'نموذج المؤشر 8 بعد التعبئة', kind: 'list' }
  };

  var OPS = ['pick', 'count', 'countWhere', 'countDistinct', 'sum', 'manual', 'countDistinctAcross'];
  var FUNCTIONS = {
    value: { arity: [1, 1], label: 'value(أ)' },
    add: { arity: [1, 20], label: 'add(أ، ب، …)' },
    subtract: { arity: [2, 2], label: 'subtract(أ، ب)' },
    divide: { arity: [2, 2], label: 'divide(أ، ب)' },
    ratio: { arity: [2, 2], label: 'ratio(أ، ب)' },
    percent: { arity: [2, 2], label: 'percent(أ، ب)' },
    fte: { arity: [1, 2], label: 'fte(المتفرغون، غير المتفرغين)' }
  };
  var DIRECTIONS = { higher_better: 'الأعلى أفضل', lower_better: 'الأقل أفضل' };

  function round(n, d) { var p = Math.pow(10, d); return Math.round(n * p) / p; }
  function fmtNum(n) { return String(round(n, 2)); }
  function q(s) { return '«' + s + '»'; }
  // صياغة العدد: صف واحد، صفان، 3–10 صفوف، 11+ صفًا.
  function rowsPhrase(n) {
    if (n === 1) return 'صف واحد';
    if (n === 2) return 'صفان';
    if (n >= 3 && n <= 10) return n + ' صفوف';
    return n + ' صفًا';
  }
  function slotLabel(slot) { return SLOTS[slot] ? SLOTS[slot].label : slot; }

  // ---------- الدورة الافتراضية: التصنيف العربي 2026 ----------
  function defaultCycle() {
    var formInput = function (n) {
      return { key: 'form' + n + 'Rows', label: 'صفوف نموذج المؤشر ' + n, slot: 'form' + n, op: 'countWhere', args: { column: '', mode: 'notEmpty' } };
    };
    return {
      id: 'ARAB-2026', ranking: 'ARAB', label: 'التصنيف العربي 2026', params: { hIndexThreshold: 10 },
      inputs: [
        { key: 'admissionStudents', label: 'طلبة القبول والتسجيل', slot: 'admission', op: 'pick', args: { items: [], column: 'B' } },
        { key: 'graduateStudents', label: 'طلبة الدراسات العليا', slot: 'graduate', op: 'pick', args: { items: [], column: 'B' } },
        { key: 'facultyFull', label: 'أعضاء هيئة التدريس المتفرغون', slot: 'faculty', op: 'countWhere', args: { column: 'RANK_DESC', mode: 'in', values: [] } },
        { key: 'facultyPart', label: 'أعضاء هيئة التدريس غير المتفرغين', op: 'manual', args: { value: '', reason: '' } },
        { key: 'phdHolders', label: 'أعضاء هيئة التدريس حملة الدكتوراه', slot: 'faculty', op: 'countWhere', args: { column: 'RANK_DESC', mode: 'in', values: [] } },
        { key: 'hCount', label: 'أعضاء بمعامل هيرش ≥ العتبة', slot: 'top500', op: 'countWhere', args: { column: 'h-index', mode: 'gte', param: 'hIndexThreshold' } },
        formInput(3), formInput(4), formInput(6), formInput(7), formInput(8)
      ],
      recipes: [
        { indicatorCode: 'AR-EDU-1', formula: 'ratio(add(admissionStudents, graduateStudents), fte(facultyFull, facultyPart))', direction: 'lower_better', checks: ['fte', 'phdItem'] },
        { indicatorCode: 'AR-EDU-2', formula: 'ratio(add(admissionStudents, graduateStudents), phdHolders)', direction: 'lower_better', checks: ['phdItem'] },
        { indicatorCode: 'AR-EDU-3', formula: 'value(form3Rows)', direction: 'higher_better', checks: [] },
        { indicatorCode: 'AR-EDU-4', formula: 'value(form4Rows)', direction: 'higher_better', checks: [] },
        { indicatorCode: 'AR-EDU-5', formula: 'value(hCount)', direction: 'higher_better', checks: ['hCutoff', 'hThreshold'] },
        { indicatorCode: 'AR-EDU-6', formula: 'value(form6Rows)', direction: 'higher_better', checks: [] },
        { indicatorCode: 'AR-EDU-7', formula: 'value(form7Rows)', direction: 'higher_better', checks: [] },
        { indicatorCode: 'AR-EDU-8', formula: 'value(form8Rows)', direction: 'higher_better', checks: [], linkCheck: { slot: 'form8', column: '', domain: 'scopus.com' } }
      ],
      sources: [],
      runs: []
    };
  }

  // ---------- لغة الصيغ المقيدة ----------
  function tokenize(s) {
    var tokens = [];
    var re = /\s*(?:([A-Za-z_][A-Za-z0-9_]*)|(\d+(?:\.\d+)?)|([(),]))/y;
    var i = 0;
    var str = String(s || '');
    while (i < str.length) {
      if (/^\s*$/.test(str.slice(i))) break;
      re.lastIndex = i;
      var m = re.exec(str);
      if (!m) return { error: 'رمز غير مسموح في الصيغة قرب ' + q(str.slice(i).trim().slice(0, 12)) + '.' };
      if (m[1]) tokens.push({ t: 'id', v: m[1] });
      else if (m[2]) tokens.push({ t: 'num', v: Number(m[2]) });
      else tokens.push({ t: m[3] });
      i = re.lastIndex;
    }
    return { tokens: tokens };
  }

  /*
   * يحلل الصيغة إلى شجرة دون تنفيذ أي شيء. inputKeys: المعرّفات المسموحة.
   * يعيد { ok, ast } أو { ok: false, message }.
   */
  function parseFormula(text, inputKeys) {
    var tk = tokenize(text);
    if (tk.error) return { ok: false, message: tk.error };
    var toks = tk.tokens;
    if (!toks.length) return { ok: false, message: 'الصيغة فارغة.' };
    var pos = 0;
    // كائن بلا نموذج أولي: «constructor» و«toString» ليست معرّفات مسموحة (خلل وجده ENG-14).
    var allowed = Object.create(null);
    (inputKeys || []).forEach(function (k) { allowed[k] = true; });
    function fail(msg) { throw new Error(msg); }
    function expr() {
      var t = toks[pos++];
      if (!t) fail('الصيغة ناقصة.');
      if (t.t === 'num') return { num: t.v };
      if (t.t !== 'id') fail('رمز غير متوقع في الصيغة.');
      if (toks[pos] && toks[pos].t === '(') {
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, t.v)) fail('الدالة ' + q(t.v) + ' غير معروفة. المسموح: ' + Object.keys(FUNCTIONS).join('، ') + '.');
        pos++;
        var args = [];
        if (toks[pos] && toks[pos].t === ')') { pos++; } else {
          for (;;) {
            args.push(expr());
            var sep = toks[pos++];
            if (!sep) fail('قوس غير مغلق في الصيغة.');
            if (sep.t === ')') break;
            if (sep.t !== ',') fail('يتوقع فاصلة أو قوس إغلاق.');
          }
        }
        var ar = FUNCTIONS[t.v].arity;
        if (args.length < ar[0] || args.length > ar[1]) fail('عدد معاملات ' + t.v + ' غير صحيح: ' + FUNCTIONS[t.v].label + '.');
        return { fn: t.v, args: args };
      }
      if (!allowed[t.v]) fail('المدخل ' + q(t.v) + ' غير معرّف.');
      return { input: t.v };
    }
    try {
      var ast = expr();
      if (pos !== toks.length) fail('نص زائد بعد نهاية الصيغة.');
      if (containsRatio(ast, true)) fail('ratio تُستخدم في المستوى الأعلى من الصيغة فقط.');
      return { ok: true, ast: ast };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  // ratio يعيد «1:x» فلا يدخل في حساب آخر.
  function containsRatio(node, top) {
    if (!node.fn) return false;
    if (node.fn === 'ratio' && !top) return true;
    return node.args.some(function (a) { return containsRatio(a, false); });
  }

  function evaluate(node, values, labels) {
    if (node.num !== undefined) return node.num;
    if (node.input) {
      var v = values[node.input];
      if (v === null || v === undefined) throw new Error('ينقص المدخل ' + q(labels[node.input] || node.input) + '.');
      return v;
    }
    if (node.fn === 'fte') {
      var full = evaluate(node.args[0], values, labels);
      var part = 0;
      if (node.args[1]) { var pv = node.args[1].input ? values[node.args[1].input] : evaluate(node.args[1], values, labels); part = pv === null || pv === undefined ? 0 : pv; }
      return full + part / 3;
    }
    var a = node.args.map(function (x) { return evaluate(x, values, labels); });
    switch (node.fn) {
      case 'value': return a[0];
      case 'add': return a.reduce(function (s, x) { return s + x; }, 0);
      case 'subtract': return a[0] - a[1];
      case 'divide':
        if (a[1] === 0) throw new Error('قسمة على صفر.');
        return a[0] / a[1];
      case 'percent':
        if (a[1] === 0) throw new Error('قسمة على صفر.');
        return a[0] / a[1] * 100;
      case 'ratio':
        if (a[1] === 0) throw new Error('قسمة على صفر.');
        return { ratio: a[0] / a[1] };
    }
    throw new Error('دالة غير معروفة.');
  }

  // «1:x» حيث x مقرب لخانة عشرية واحدة (06 §4).
  function formatRatio(x) { return '1:' + String(round(x, 1)); }
  function ratio(a, b) { return b ? formatRatio(a / b) : null; }

  // ---------- العمليات على الجداول ----------
  function colIndexOf(table, col) {
    if (/^[A-Z]{1,2}$/.test(col || '')) {
      var n = 0;
      for (var i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
      return n - 1 < table.columns.length ? n - 1 : -1;
    }
    return table.columns.indexOf(col);
  }

  function matcher(args, params) {
    var mode = args.mode || 'notEmpty';
    if (mode === 'in') {
      var set = {};
      (args.values || []).forEach(function (v) { set[String(v).trim()] = true; });
      return { test: function (v) { return !!set[String(v).trim()]; }, text: 'ضمن {' + (args.values || []).join('، ') + '}' };
    }
    if (mode === 'gte') {
      var th = args.param ? Number(params && params[args.param]) : S.toNumber(args.value);
      return { threshold: th, test: function (v) { var n = S.toNumber(v); return n !== null && n >= th; }, text: '≥ ' + th };
    }
    if (mode === 'notNA') return { test: function (v) { return !S.isBlank(v) && !/^(n\/?a|na)$/i.test(String(v).trim()); }, text: 'ليست فارغة ولا N/A' };
    return { test: function (v) { return !S.isBlank(v); }, text: 'غير فارغة' };
  }

  function needColumn(table, col, input) {
    if (!col) return { error: 'لم يُحدد العمود للمدخل ' + q(input.label) + '.' };
    var i = colIndexOf(table, col);
    if (i === -1) return { error: 'العمود ' + q(col) + ' غير موجود في ملف ' + q(slotLabel(input.slot)) + '. الأعمدة الموجودة: ' + table.columns.join('، ') + '.' };
    return { index: i };
  }

  /*
   * يحسب مدخلًا واحدًا: { key, value, audit, error, stats }
   * tables: { slot: جدول }، params: معاملات الدورة.
   */
  function runInput(input, tables, params) {
    var out = { key: input.key, value: null, audit: '', error: null, stats: {} };
    var args = input.args || {};
    if (OPS.indexOf(input.op) === -1) { out.error = 'العملية ' + q(input.op) + ' غير مسموحة.'; return out; }
    if (input.op === 'manual') {
      if (S.isBlank(args.value)) { out.audit = 'غير متوفر (إدخال يدوي فارغ)'; return out; }
      var mv = S.toNumber(args.value);
      if (mv === null) { out.error = 'القيمة اليدوية للمدخل ' + q(input.label) + ' ليست رقمًا.'; return out; }
      if (S.isBlank(args.reason)) { out.error = 'يرجى كتابة سبب للإدخال اليدوي في ' + q(input.label) + '.'; return out; }
      out.value = mv;
      out.audit = 'إدخال يدوي: ' + fmtNum(mv) + ' (السبب: ' + String(args.reason).trim() + ')';
      return out;
    }
    var table = tables && tables[input.slot];
    if (!table) { out.missing = input.slot; out.error = 'ينقصه: ملف ' + q(slotLabel(input.slot)) + '.'; return out; }
    var total = table.records.length;
    var file = q(table.fileName || slotLabel(input.slot));

    if (input.op === 'pick') {
      var items = (args.items || []).filter(function (x) { return !S.isBlank(x); });
      if (!items.length) { out.error = 'لم تُختر بنود من ملف ' + q(slotLabel(input.slot)) + ' للمدخل ' + q(input.label) + '.'; return out; }
      var vc = needColumn(table, args.column || 'B', input);
      if (vc.error) { out.error = vc.error; return out; }
      var parts = [];
      var sum = 0;
      for (var i = 0; i < items.length; i++) {
        var rec = table.records.filter(function (r) { return String(r[0]).trim() === String(items[i]).trim(); })[0];
        if (!rec) { out.error = 'البند ' + q(items[i]) + ' غير موجود في ملف ' + q(slotLabel(input.slot)) + '.'; return out; }
        var n = S.toNumber(rec[vc.index]);
        if (n === null) { out.error = 'قيمة البند ' + q(items[i]) + ' في العمود ' + q(table.columns[vc.index]) + ' ليست رقمًا.'; return out; }
        sum += n;
        parts.push(q(items[i]) + ' ' + fmtNum(n));
      }
      out.value = sum;
      out.stats.items = items.slice();
      out.audit = parts.join(' + ') + ' = ' + fmtNum(sum) + ' · من ' + file + '، العمود ' + q(table.columns[vc.index]);
      return out;
    }

    if (input.op === 'count') {
      out.value = total;
      out.audit = rowsPhrase(total) + ' · من ' + file;
      return out;
    }

    if (input.op === 'countWhere' || input.op === 'sum') {
      var c = needColumn(table, args.column, input);
      if (c.error) { out.error = c.error; return out; }
      if (input.op === 'countWhere' && (args.mode || 'notEmpty') === 'in' && !(args.values || []).length) { out.error = 'لم تُختر قيم التصفية للمدخل ' + q(input.label) + ' من العمود ' + q(args.column) + '.'; return out; }
      var m = matcher(input.op === 'sum' ? (args.where || { mode: 'notEmpty' }) : args, params);
      if (m.threshold !== undefined && !isFinite(m.threshold)) { out.error = 'معامل العتبة غير صالح.'; return out; }
      var whereIdx = input.op === 'sum' && args.where && args.where.column ? colIndexOf(table, args.where.column) : c.index;
      var matched = 0;
      var s = 0;
      var nums = [];
      table.records.forEach(function (r) {
        var nv = S.toNumber(r[c.index]);
        if (nv !== null) nums.push(nv);
        if (m.test(r[whereIdx])) { matched++; if (input.op === 'sum' && nv !== null) s += nv; }
      });
      if (nums.length) { out.stats.min = Math.min.apply(null, nums); out.stats.max = Math.max.apply(null, nums); }
      out.stats.total = total;
      out.stats.excluded = total - matched;
      if (input.op === 'sum') {
        out.value = s;
        out.audit = 'مجموع ' + q(args.column) + ' = ' + fmtNum(s) + ' · ' + rowsPhrase(total) + ' · من ' + file;
      } else {
        out.value = matched;
        out.audit = rowsPhrase(total) + ' · استُبعد ' + (total - matched) + ' · ' + q(table.columns[c.index]) + ' ' + m.text + ' · من ' + file;
      }
      return out;
    }

    if (input.op === 'countDistinct') {
      var cd = needColumn(table, args.column, input);
      if (cd.error) { out.error = cd.error; return out; }
      var seen = {};
      table.records.forEach(function (r) { if (!S.isBlank(r[cd.index])) seen[String(r[cd.index]).trim()] = true; });
      out.value = Object.keys(seen).length;
      out.audit = out.value + ' قيمة فريدة في ' + q(args.column) + ' من ' + rowsPhrase(total) + ' · من ' + file;
      return out;
    }

    // countDistinctAcross (G3): عدد موحد لأفراد ملفين بمفتاحين مختلفين عبر ملف ربط اختياري.
    var tb = tables[args.slotB];
    if (!tb) { out.missing = args.slotB; out.error = 'ينقصه: ملف ' + q(slotLabel(args.slotB)) + '.'; return out; }
    var ca = needColumn(table, args.columnA, input);
    var cb = needColumn(tb, args.columnB, { label: input.label, slot: args.slotB });
    if (ca.error || cb.error) { out.error = ca.error || cb.error; return out; }
    var keysA = {};
    var keysB = {};
    table.records.forEach(function (r) { if (!S.isBlank(r[ca.index])) keysA[String(r[ca.index]).trim()] = true; });
    tb.records.forEach(function (r) { if (!S.isBlank(r[cb.index])) keysB[String(r[cb.index]).trim()] = true; });
    var nA = Object.keys(keysA).length;
    var nB = Object.keys(keysB).length;
    var map = args.mapSlot ? tables[args.mapSlot] : null;
    if (!map) {
      out.value = null;
      out.range = { min: Math.max(nA, nB), max: nA + nB };
      out.audit = q(slotLabel(input.slot)) + ' ' + nA + ' · ' + q(slotLabel(args.slotB)) + ' ' + nB + ' · دون ملف ربط';
      out.warning = 'لا مفتاح مشترك بين الملفين ولا ملف ربط: العدد الموحد بين ' + out.range.min + ' و' + out.range.max + '. يرجى رفع ملف ربط فيه المفتاحان معًا.';
      return out;
    }
    var ma = needColumn(map, args.mapColA, { label: input.label, slot: args.mapSlot });
    var mb = needColumn(map, args.mapColB, { label: input.label, slot: args.mapSlot });
    if (ma.error || mb.error) { out.error = ma.error || mb.error; return out; }
    var bToA = {};
    map.records.forEach(function (r) { bToA[String(r[mb.index]).trim()] = String(r[ma.index]).trim(); });
    var extra = Object.keys(keysB).filter(function (k) { return !(bToA[k] && keysA[bToA[k]]); }).length;
    out.value = nA + extra;
    out.audit = q(slotLabel(input.slot)) + ' ' + nA + ' + من ' + q(slotLabel(args.slotB)) + ' غير المشتركين ' + extra + ' (المشتركون ' + (nB - extra) + ' عبر ملف الربط) = ' + out.value;
    return out;
  }

  // ---------- G4: فحص نطاق الروابط ----------
  function linkDomainCheck(table, columnName, domain) {
    var i = colIndexOf(table, columnName);
    if (i === -1) return { ok: false, message: 'العمود ' + q(columnName) + ' غير موجود.' };
    var d = String(domain).toLowerCase().replace(/^www\./, '');
    var violations = [];
    var invalid = [];
    var okCount = 0;
    table.records.forEach(function (r, k) {
      var v = String(r[i] || '').trim();
      var m = v.match(/^https?:\/\/([^/?#:]+)/i);
      if (!m) { invalid.push(table.rowNumbers[k]); return; }
      var host = m[1].toLowerCase();
      if (host === d || host.slice(-(d.length + 1)) === '.' + d) okCount++;
      else violations.push(table.rowNumbers[k]);
    });
    return { ok: true, column: columnName, domain: d, total: table.records.length, matching: okCount, violations: { count: violations.length, rows: violations }, invalid: { count: invalid.length, rows: invalid } };
  }

  // ---------- C-YOY ----------
  function parseMetric(v) {
    var s = String(v == null ? '' : v).trim();
    var m = s.match(/^1\s*:\s*(.+)$/);
    if (m) return S.toNumber(m[1]);
    return S.toNumber(s);
  }

  /*
   * نسبة التقدم عن العام الماضي (06 §6). direction: higher_better | lower_better.
   * { pct, label }، وpct = null عند تعذر الحساب (قيمة ناقصة أو الماضي صفر أو صيغة غير مفهومة).
   */
  function yoy(current, last, direction) {
    var c = parseMetric(current);
    var l = parseMetric(last);
    if (c === null || l === null || l === 0) return { pct: null, label: 'لا يمكن حساب التقدم' };
    var raw = direction === 'lower_better' ? (l - c) / l * 100 : (c - l) / l * 100;
    var pct = Math.round(raw);
    if (pct === 0) return { pct: 0, label: 'ثابت' };
    return { pct: pct, label: (pct > 0 ? 'تحسّن ' : 'تراجع ') + Math.abs(pct) + '%' };
  }

  // تعارض بين القيمة المحسوبة وقيمة ملف التقدم (بالأرقام إن أمكن).
  function conflicts(computed, progress) {
    if (S.isBlank(computed) || S.isBlank(progress)) return false;
    var a = parseMetric(computed);
    var b = parseMetric(progress);
    if (a !== null && b !== null) return round(a, 1) !== round(b, 1);
    return String(computed).trim() !== String(progress).trim();
  }

  // ---------- التنبيهات المنهجية ----------
  function checkWarnings(recipe, inputsOut, cycle, tables) {
    var w = [];
    (recipe.checks || []).forEach(function (c) {
      if (c === 'fte' && inputsOut.facultyPart && inputsOut.facultyPart.value === null) {
        w.push({ key: 'fte', text: 'لا بيانات للتفرغ الجزئي: FTE = المتفرغون فقط (س10).',
          suggest: { entityHint: 'الموارد البشرية', title: 'بيانات أعضاء هيئة التدريس غير المتفرغين', missingData: 'أعداد غير المتفرغين لحساب العدد المكافئ للدوام الكامل (FTE)' } });
      }
      if (c === 'phdItem' && inputsOut.graduateStudents && inputsOut.graduateStudents.stats && inputsOut.graduateStudents.stats.items) {
        var hasPhd = inputsOut.graduateStudents.stats.items.some(function (it) { return /دكتور/.test(N.normalizeText(it)); });
        if (!hasPhd) w.push({ key: 'phdItem', text: 'بند طلبة الدكتوراه غير مختار في ملف الدراسات العليا (س5).',
          suggest: { entityHint: 'الدراسات العليا', title: 'أعداد طلبة الدكتوراه', missingData: 'أعداد طلبة الدكتوراه للدورة' } });
      }
      if (c === 'hCutoff' && inputsOut.hCount && inputsOut.hCount.stats && inputsOut.hCount.stats.min !== undefined) {
        var th = Number(cycle.params.hIndexThreshold);
        if (inputsOut.hCount.stats.min >= th) {
          w.push({ key: 'hCutoff', text: 'أدنى معامل هيرش في الملف (' + inputsOut.hCount.stats.min + ') ≥ العتبة (' + th + '): قد يكون العد ناقصًا لأن القائمة مقطوعة عند 500.',
            suggest: { entityHint: 'البحث', title: 'قائمة كاملة لمعاملات هيرش دون حد 500', missingData: 'قائمة SciVal كاملة أو مصفاة بالعتبة' } });
        }
      }
      if (c === 'hThreshold') {
        w.push({ key: 'hThreshold', text: 'العتبة المستخدمة ' + cycle.params.hIndexThreshold + ' (من معاملات الدورة). منصة 2026 تذكر 10، وFAQ 2025 يذكر 20: يرجى التأكد من الدورة.' });
      }
    });
    if (recipe.linkCheck && recipe.linkCheck.column && tables[recipe.linkCheck.slot]) {
      var lc = linkDomainCheck(tables[recipe.linkCheck.slot], recipe.linkCheck.column, recipe.linkCheck.domain);
      if (lc.ok && (lc.violations.count || lc.invalid.count)) {
        var t = [];
        if (lc.violations.count) t.push(lc.violations.count + ' مخالفة للنطاق ' + lc.domain + ' (الصفوف ' + lc.violations.rows.join('، ') + ')');
        if (lc.invalid.count) t.push(lc.invalid.count + ' رابط غير صالح أو فارغ (الصفوف ' + lc.invalid.rows.join('، ') + ')');
        w.push({ key: 'linkDomain', text: 'الروابط: ' + t.join('، و') + '.', suggest: { entityHint: 'البحث', title: 'تصحيح روابط النموذج إلى ' + lc.domain, missingData: t.join('، ') } });
      }
    }
    return w;
  }

  /*
   * تشغيل كل الوصفات: { at, results: [{ indicatorCode, value, numeric, direction, audit[], warnings[], error, missing[] }], inputs }
   * tables: { slot: جدول (مع fileName اختياريًا) }.
   */
  function run(cycle, tables, at) {
    tables = tables || {};
    var inputsOut = {};
    var labels = {};
    var values = {};
    cycle.inputs.forEach(function (inp) {
      labels[inp.key] = inp.label;
      var r = runInput(inp, tables, cycle.params);
      inputsOut[inp.key] = r;
      values[inp.key] = r.error ? undefined : r.value;
    });
    var keys = cycle.inputs.map(function (i) { return i.key; });
    var results = cycle.recipes.map(function (rc) {
      var res = { indicatorCode: rc.indicatorCode, formula: rc.formula, direction: rc.direction, value: null, numeric: null, audit: [], warnings: [], error: null, missing: [] };
      var parsed = parseFormula(rc.formula, keys);
      if (!parsed.ok) { res.error = parsed.message; return res; }
      var used = usedInputs(parsed.ast);
      used.forEach(function (k) {
        var r = inputsOut[k];
        if (r.missing && res.missing.indexOf(slotLabel(r.missing)) === -1) res.missing.push(slotLabel(r.missing));
        res.audit.push(labels[k] + ': ' + (r.error ? '✗ ' + r.error : r.audit || (r.value === null ? 'غير متوفر' : fmtNum(r.value))));
        if (r.warning) res.warnings.push({ key: 'keymap', text: r.warning, suggest: { entityHint: 'الموارد البشرية', title: 'ملف ربط EMPLOYEE_ID برقم الهوية', missingData: 'ملف فيه المفتاحان معًا' } });
      });
      var blocking = used.filter(function (k) { return inputsOut[k].error; });
      if (blocking.length) {
        res.error = res.missing.length ? 'ينقصه: ' + res.missing.join('، ') + '.' : inputsOut[blocking[0]].error;
        return res;
      }
      try {
        var v = evaluate(parsed.ast, values, labels);
        if (v && typeof v === 'object') { res.value = formatRatio(v.ratio); res.numeric = round(v.ratio, 1); }
        else { res.value = fmtNum(v); res.numeric = round(v, 2); }
      } catch (e) {
        res.error = e.message;
        return res;
      }
      res.warnings = res.warnings.concat(checkWarnings(rc, inputsOut, cycle, tables));
      return res;
    });
    return { at: at || '', cycleId: cycle.id, params: JSON.parse(JSON.stringify(cycle.params)), results: results, inputs: inputsOut };
  }

  function usedInputs(ast) {
    var out = [];
    (function walk(n) {
      if (n.input && out.indexOf(n.input) === -1) out.push(n.input);
      (n.args || []).forEach(walk);
    })(ast);
    return out;
  }

  // يضيف المقارنة بقيم المؤشر: ملف التقدم (تعارض) والعام الماضي (C-YOY).
  function compare(result, indicator) {
    var ind = indicator || {};
    return {
      progressFileValue: ind.progressFileValue || '',
      conflict: result.value !== null && conflicts(result.value, ind.progressFileValue),
      lastYearValue: ind.lastYearValue || '',
      yoy: result.value === null ? { pct: null, label: 'لا يمكن حساب التقدم' } : yoy(result.value, ind.lastYearValue, result.direction)
    };
  }

  /*
   * النسخة التي يجوز تخزينها من تشغيل (06 §9): النتائج المجمعة وبيان الحساب والتنبيهات فقط،
   * دون الجداول ودون إحصاءات الصفوف. sourcesMeta: من sources.describe.
   */
  function storableRun(runOut) {
    return {
      at: runOut.at, cycleId: runOut.cycleId, params: runOut.params,
      results: runOut.results.map(function (r) {
        return { indicatorCode: r.indicatorCode, value: r.value, direction: r.direction, audit: r.audit.slice(),
          warnings: r.warnings.map(function (w) { return w.text; }), error: r.error, missing: r.missing.slice() };
      })
    };
  }

  // نص «مصدر الرقم» عند الاعتماد (G1): الملفات والتصفية والتاريخ، بحد 200 حرف.
  function sourceText(result, cycle, today) {
    var files = (cycle.sources || []).map(function (s) { return s.fileName; }).filter(Boolean);
    var t = 'محسوب في بصيرة (' + cycle.label + '): ' + result.formula + (files.length ? ' · الملفات: ' + files.join('، ') : '') + ' · ' + today;
    return t.length > 200 ? t.slice(0, 199) + '…' : t;
  }

  // ---------- G2: متطلب مقترح من تنبيه ----------
  /*
   * يعيد { input, existingId }: input جاهز لـ actions.createRequirement، وexistingId إذا وُجد متطلب مفتوح
   * للمؤشر نفسه بالعنوان نفسه (فلا يُكرر).
   */
  function suggestRequirement(warning, indicator, data, today) {
    if (!warning || !warning.suggest || !indicator) return null;
    var s = warning.suggest;
    var hint = N.normalizeText(s.entityHint || '');
    var ent = (data.entities || []).filter(function (e) { return hint && N.normalizeText(e.name).indexOf(hint) !== -1; })[0] || null;
    var rk = (data.rankings || []).filter(function (r) { return r.id === indicator.ranking; })[0];
    var deadline = F.addDays(today, 7);
    if (rk && rk.submissionDeadline) {
      var beforeSubmission = F.addDays(rk.submissionDeadline, -2);
      if (beforeSubmission && beforeSubmission < deadline && beforeSubmission >= today) deadline = beforeSubmission;
    }
    var existing = (data.requirements || []).filter(function (r) {
      return r.indicatorId === indicator.id && r.status !== 'done' && N.normalizeText(r.title) === N.normalizeText(s.title);
    })[0];
    return {
      input: {
        title: s.title, description: 'أُنشئ من تنبيه محرك الحساب: ' + warning.text, indicatorId: indicator.id,
        entityId: ent ? ent.id : '', assignee: '', deadline: deadline, status: 'new', priority: 'high', missingData: s.missingData, evidenceLink: ''
      },
      entityFound: !!ent,
      existingId: existing ? existing.id : null
    };
  }

  return {
    SLOTS: SLOTS,
    OPS: OPS,
    FUNCTIONS: FUNCTIONS,
    DIRECTIONS: DIRECTIONS,
    defaultCycle: defaultCycle,
    parseFormula: parseFormula,
    formatRatio: formatRatio,
    ratio: ratio,
    runInput: runInput,
    run: run,
    compare: compare,
    yoy: yoy,
    conflicts: conflicts,
    linkDomainCheck: linkDomainCheck,
    storableRun: storableRun,
    sourceText: sourceText,
    suggestRequirement: suggestRequirement
  };
});
