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
    keymap: { label: 'ملف ربط المفاتيح', kind: 'list', optional: true, hint: 'اختياري: EMPLOYEE_ID ورقم الهوية معًا' }
  };

  var OPS = ['pick', 'count', 'countRows', 'countWhere', 'countDistinct', 'sum', 'manual', 'countDistinctAcross'];
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
  function slotLabel(slot) { return /^ind:/.test(slot) ? 'ملف المؤشر ' + slot.slice(4) : SLOTS[slot] ? SLOTS[slot].label : slot; }

  // ---------- الدورة الافتراضية: التصنيف العربي 2026 ----------
  /*
   * دورة الحساب مبنية من المؤشرات نفسها (لا قائمة ثابتة في الكود):
   * - المؤشرات 1 و2 و5 من التعليم والتعلم: قواعدها الخاصة (الطلبة والرتب ومعامل هيرش)، بملفاتها المشتركة.
   * - كل مؤشر مفعّل آخر، ومنها المؤشرات الجديدة ومؤشرات QS: خانة «ملف المؤشر» تُعدّ صفوفه التي فيها بيانات تلقائيًا
   *   (countRows) دون أي اختيار، مع فحص الروابط إن وُجد عمود روابط (ونطاق scopus.com للمؤشر 8).
   * indicators: قائمة المؤشرات. دونها تُبنى المؤشرات الخاصة الثلاثة فقط (للفحوص).
   */
  var SPECIAL = ['AR-EDU-1', 'AR-EDU-2', 'AR-EDU-5'];
  var LINK_DOMAINS = { 'AR-EDU-8': 'scopus.com' };
  function rowsKey(code) { return 'rows_' + String(code).replace(/[^A-Za-z0-9]/g, '_'); }
  function indicatorSlot(code) { return 'ind:' + code; }

  function defaultCycle(indicators) {
    var list = Array.isArray(indicators) ? indicators.filter(function (i) { return i.active !== false; }) : null;
    var has = function (code) { return !list || list.some(function (i) { return i.code === code; }); };
    var inputs = [
      { key: 'admissionStudents', label: 'طلبة القبول والتسجيل', slot: 'admission', op: 'pick', args: { items: [], column: 'B' } },
      { key: 'graduateStudents', label: 'طلبة الدراسات العليا', slot: 'graduate', op: 'pick', args: { items: [], column: 'B' } },
      { key: 'facultyFull', label: 'أعضاء هيئة التدريس المتفرغون', slot: 'faculty', op: 'countWhere', args: { column: 'RANK_DESC', mode: 'in', values: [] } },
      { key: 'facultyPart', label: 'أعضاء هيئة التدريس غير المتفرغين', op: 'manual', args: { value: '', reason: '' } },
      { key: 'phdHolders', label: 'أعضاء هيئة التدريس حملة الدكتوراه', slot: 'faculty', op: 'countWhere', args: { column: 'RANK_DESC', mode: 'in', values: [] } },
      { key: 'hCount', label: 'أعضاء بمعامل هيرش ≥ العتبة', slot: 'top500', op: 'countWhere', args: { column: 'h-index', mode: 'gte', param: 'hIndexThreshold' } }
    ];
    var recipes = [];
    if (has('AR-EDU-1')) recipes.push({ indicatorCode: 'AR-EDU-1', formula: 'ratio(add(admissionStudents, graduateStudents), fte(facultyFull, facultyPart))', direction: 'lower_better', checks: ['fte', 'phdItem'] });
    if (has('AR-EDU-2')) recipes.push({ indicatorCode: 'AR-EDU-2', formula: 'ratio(add(admissionStudents, graduateStudents), phdHolders)', direction: 'lower_better', checks: ['phdItem'] });
    if (has('AR-EDU-5')) recipes.push({ indicatorCode: 'AR-EDU-5', formula: 'value(hCount)', direction: 'higher_better', checks: ['hCutoff', 'hThreshold'] });
    (list || []).filter(function (i) { return SPECIAL.indexOf(i.code) === -1; })
      .sort(function (a, b) { return a.ranking < b.ranking ? -1 : a.ranking > b.ranking ? 1 : (a.order || 0) - (b.order || 0); })
      .forEach(function (i) {
        var key = rowsKey(i.code);
        var slot = indicatorSlot(i.code);
        inputs.push({ key: key, label: 'صفوف ملف المؤشر ' + i.code, slot: slot, op: 'countRows', args: {} });
        recipes.push({ indicatorCode: i.code, formula: 'value(' + key + ')', direction: 'higher_better', checks: [], linkCheck: { slot: slot, column: '', domain: LINK_DOMAINS[i.code] || '' } });
      });
    recipes.sort(function (a, b) { return a.indicatorCode < b.indicatorCode ? -1 : a.indicatorCode > b.indicatorCode ? 1 : 0; });
    return { id: 'CYCLE-2026', ranking: 'ARAB', label: 'دورة 2026', params: { hIndexThreshold: 10 }, inputs: inputs, recipes: recipes, sources: [], runs: [] };
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
  // اسم العمود أولًا، ثم حرف العمود (B، N) إن لم يوجد عمود بهذا الاسم. عمود اسمه «ID» لا يُعامل كحرف (خلل B30).
  function colIndexOf(table, col) {
    var byName = table.columns.indexOf(col);
    if (byName !== -1) return byName;
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
    if (!col) return { error: 'لم يُحدد العمود للمدخل ' + q(input.label) + '. يرجى اختياره من «إعداد الوصفة».' };
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
      if (!items.length) { out.error = 'لم تُختر بنود من ملف ' + q(slotLabel(input.slot)) + ' للمدخل ' + q(input.label) + '. يرجى اختيارها من «إعداد الوصفة».'; return out; }
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
      out.stats.itemValues = {};
      items.forEach(function (it) {
        var rr = table.records.filter(function (r) { return String(r[0]).trim() === String(it).trim(); })[0];
        out.stats.itemValues[it] = S.toNumber(rr[vc.index]);
      });
      out.audit = parts.join(' + ') + ' = ' + fmtNum(sum) + ' · من ' + file + '، العمود ' + q(table.columns[vc.index]);
      return out;
    }

    if (input.op === 'count') {
      out.value = total;
      out.audit = rowsPhrase(total) + ' · من ' + file;
      return out;
    }

    // countRows: عدّ تلقائي دون أي اختيار. الصفوف الفارغة لم تُقرأ أصلًا، والصف المطابق لصف قبله تمامًا لا يُعد مرتين.
    if (input.op === 'countRows') {
      var seenRows = {};
      var dupRows = [];
      table.records.forEach(function (r, i) {
        var key = r.map(function (x) { return String(x).trim(); }).join('\u0001');
        if (seenRows[key]) dupRows.push(table.rowNumbers[i]); else seenRows[key] = true;
      });
      out.value = total - dupRows.length;
      out.stats.duplicates = dupRows;
      out.audit = 'عُدّ ' + rowsPhrase(out.value) + ' فيها بيانات' + (dupRows.length ? ' · استُبعد ' + dupRows.length + ' مكرر تمامًا (الصفوف ' + dupRows.join('، ') + ')' : '') + ' · من ' + file;
      return out;
    }

    if (input.op === 'countWhere' || input.op === 'sum') {
      var c = needColumn(table, args.column, input);
      if (c.error) { out.error = c.error; return out; }
      if (input.op === 'countWhere' && (args.mode || 'notEmpty') === 'in' && !(args.values || []).length) { out.error = 'لم تُختر قيم التصفية للمدخل ' + q(input.label) + ' من العمود ' + q(args.column) + '. يرجى اختيارها من «إعداد الوصفة».'; return out; }
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
      if (!d || host === d || host.slice(-(d.length + 1)) === '.' + d) okCount++;
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
        w.push({ key: 'linkDomain', text: 'الروابط: ' + t.join('، و') + '.', suggest: { entityHint: 'البحث', title: lc.domain ? 'تصحيح روابط النموذج إلى ' + lc.domain : 'تصحيح روابط ملف المؤشر ' + recipe.indicatorCode, missingData: t.join('، ') } });
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
      res.inputs = used;
      used.forEach(function (k) {
        var r = inputsOut[k];
        if (r.missing && res.missing.indexOf(slotLabel(r.missing)) === -1) res.missing.push(slotLabel(r.missing));
        res.audit.push(labels[k] + ': ' + (r.error ? '✗ ' + r.error : r.audit || (r.value === null ? 'غير متوفر' : fmtNum(r.value))));
        if (r.stats && r.stats.duplicates && r.stats.duplicates.length) res.warnings.push({ key: 'duplicates', text: 'استُبعد من العدّ ' + r.stats.duplicates.length + ' صف مكرر تمامًا (الصفوف ' + r.stats.duplicates.join('، ') + '). يرجى التأكد أنه تكرار فعلًا.' });
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

  /*
   * مقارنة السنتين: كل سنة تُحسب من ملفها وحده بالقواعد نفسها (قد يختلف عدد الصفوف بين السنتين، فلا تُطابَق الصفوف).
   * يضيف إلى كل نتيجة حالية: lastYear (قيمة العام الماضي المحسوبة من ملفه)، وchanges (ما تغيّر في كل مدخل وبند).
   */
  // نص عربي للتغير دون أسهم أو إشارات (تنقلب في اتجاه RTL): «من 25 إلى 20 (نقص 5)».
  function changeText(a, b) {
    var d = Math.round((b - a) * 100) / 100;
    return 'من ' + fmtNum(a) + ' إلى ' + fmtNum(b) + ' (' + (d > 0 ? 'زيادة ' + d : d < 0 ? 'نقص ' + Math.abs(d) : 'دون تغيير') + ')';
  }
  function attachLastYear(curOut, lastOut, cycle) {
    if (!lastOut) return curOut;
    var labels = {};
    cycle.inputs.forEach(function (i) { labels[i.key] = i.label; });
    curOut.results.forEach(function (r) {
      var lr = lastOut.results.filter(function (x) { return x.indicatorCode === r.indicatorCode; })[0];
      if (!lr) return;
      r.lastYear = lr.value !== null && !lr.error ? lr.value : null;
      r.lastYearError = r.lastYear === null ? lr.error : null;
      var lines = [];
      (r.inputs || []).forEach(function (k) {
        var c = curOut.inputs[k], l = lastOut.inputs[k];
        if (!c || !l || c.error || l.error || c.value === null || l.value === null) return;
        var ci = c.stats && c.stats.itemValues, li = l.stats && l.stats.itemValues;
        if (ci && li) {
          Object.keys(Object.assign({}, li, ci)).forEach(function (it) {
            if (ci[it] === undefined) lines.push(q(it) + ': ' + li[it] + ' في العام الماضي، وغير موجود هذا العام');
            else if (li[it] === undefined) lines.push(q(it) + ': جديد هذا العام (' + ci[it] + ')');
            else lines.push(q(it) + ': ' + changeText(li[it], ci[it]));
          });
        } else {
          lines.push(labels[k] + ': ' + changeText(l.value, c.value));
        }
      });
      r.changes = lines;
    });
    return curOut;
  }

  // يضيف المقارنة بقيم المؤشر: ملف التقدم (تعارض) والعام الماضي (C-YOY). العام الماضي المحسوب من ملفه أولًا، وإلا المكتوب في المؤشر.
  function compare(result, indicator) {
    var ind = indicator || {};
    var fromFile = result.lastYear !== undefined && result.lastYear !== null && result.lastYear !== '';
    return {
      progressFileValue: ind.progressFileValue || '',
      conflict: result.value !== null && conflicts(result.value, ind.progressFileValue),
      lastYearValue: fromFile ? result.lastYear : ind.lastYearValue || '',
      lastYearSource: fromFile ? 'file' : ind.lastYearValue ? 'manual' : '',
      yoy: result.value === null ? { pct: null, label: 'لا يمكن حساب التقدم' } : yoy(result.value, fromFile ? result.lastYear : ind.lastYearValue, result.direction)
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
        var o = { indicatorCode: r.indicatorCode, value: r.value, direction: r.direction, audit: r.audit.slice(),
          warnings: r.warnings.map(function (w) { return w.text; }), error: r.error, missing: r.missing.slice() };
        if (r.lastYear !== undefined) { o.lastYear = r.lastYear; o.lastYearError = r.lastYearError || null; o.changes = (r.changes || []).slice(); }
        return o;
      })
    };
  }

  // شرح عربي للصيغة من شجرتها: «نسبة: مجموع (طلبة القبول، طلبة الدراسات العليا) إلى العدد المكافئ (…)».
  var FN_AR = { value: '', add: 'مجموع', subtract: 'الفرق بين', divide: 'قسمة', percent: 'نسبة مئوية', fte: 'العدد المكافئ للدوام الكامل من' };
  function explainFormula(formula, inputs) {
    var labels = {};
    (inputs || []).forEach(function (i) { labels[i.key] = i.label; });
    var parsed = parseFormula(formula, Object.keys(labels));
    if (!parsed.ok) return parsed.message;
    function say(n) {
      if (n.num !== undefined) return String(n.num);
      if (n.input) return labels[n.input];
      var parts = n.args.map(say);
      if (n.fn === 'ratio') return 'نسبة 1 إلى (' + parts[0] + ' ÷ ' + parts[1] + ')';
      if (n.fn === 'value') return parts[0];
      return FN_AR[n.fn] + ' (' + parts.join('، ') + ')';
    }
    return say(parsed.ast);
  }

  // نص «مصدر الرقم» عند الاعتماد (G1): الملفات والتصفية والتاريخ، بحد 200 حرف.
  function sourceText(result, cycle, today) {
    var files = (cycle.sources || []).map(function (s) { return s.fileName; }).filter(Boolean);
    // نص عربي يُعرض في صفحة المؤشر. الصيغة نفسها محفوظة في وصفة الدورة وتشغيلاتها.
    var t = 'محسوب في بصيرة (' + cycle.label + ')' + (files.length ? ' · الملفات: ' + files.join('، ') : '') + ' · ' + today;
    return t.length > 200 ? t.slice(0, 199) + '…' : t;
  }

  // ---------- الاختيار التلقائي من محتوى الملف ----------
  /*
   * يملأ الاختيارات الفارغة فقط (لا يغيّر اختيارًا موجودًا) بقواعد كلمات معلنة بعد توحيد الهمزات والتاء المربوطة:
   * - بنود الطلبة في الجداول التجميعية: فيها «طلبة/طلاب/طالب»، وليست صفوف مجموع أو موظفين أو أعضاء.
   * - الرتب الأكاديمية: فيها «أستاذ/محاضر/معيد/مدرس» وليست «فني/إداري/موظف/عامل».
   * - حملة الدكتوراه: الرتب التي تبدأ بـ «أستاذ» (أستاذ، مشارك، مساعد).
   * - عمود الرتبة إن لم يوجد RANK_DESC، وعمود معامل هيرش، وعمود العدّ في النماذج، وعمود الروابط.
   * كل مدخل يُملأ تلقائيًا يُعلَّم auto: true ويُذكر في notes، والمستخدمة تعدّله من «إعداد الوصفة».
   */
  var RX = {
    student: /(طلبه|طلاب|طالب)/, notStudent: /(موظف|اداري|عضو|هيئه|خريج|مجموع|اجمالي|المجموع)/,
    academic: /(استاذ|محاضر|معيد|مدرس)/, nonAcademic: /(فني|اداري|موظف|عامل)/, phd: /^استاذ/,
    rankCol: /(rank_desc|rank|رتب)/i, hCol: /(h.?index|هيرش)/i
  };
  function norm(s) { return N.normalizeText(String(s || '')); }

  function autoSelect(cycle, tables) {
    var notes = [];
    cycle.inputs.forEach(function (inp) {
      var t = inp.slot ? tables[inp.slot] : null;
      if (!t) return;
      var a = inp.args;
      if (inp.op === 'pick' && !(a.items || []).length) {
        var items = t.records.map(function (r) { return String(r[0]).trim(); })
          .filter(function (x) { var n = norm(x); return RX.student.test(n) && !RX.notStudent.test(n); });
        if (items.length) { a.items = items; a.auto = true; notes.push({ key: inp.key, text: inp.label + ': ' + items.join('، ') }); }
      }
      if (inp.op === 'countWhere') {
        if (a.mode === 'in') {
          if (!a.column || t.columns.indexOf(a.column) === -1) {
            if (!(a.values || []).length) {
              var rc = t.columns.filter(function (c) { return RX.rankCol.test(c); })[0];
              if (rc) { a.column = rc; a.auto = true; }
            }
          }
          if (!(a.values || []).length && t.columns.indexOf(a.column) !== -1) {
            var dv = S.distinctValues(t, a.column).map(function (x) { return x.value; });
            var phd = inp.key === 'phdHolders';
            var vals = dv.filter(function (v) { var n = norm(v); return phd ? RX.phd.test(n) && !RX.nonAcademic.test(n) : RX.academic.test(n) && !RX.nonAcademic.test(n); });
            if (vals.length) { a.values = vals; a.auto = true; notes.push({ key: inp.key, text: inp.label + ': ' + vals.join('، ') }); }
          }
        } else if (a.mode === 'gte') {
          if (t.columns.indexOf(a.column) === -1) {
            var hc = t.columns.filter(function (c) { return RX.hCol.test(c); })[0];
            if (hc) { a.column = hc; a.auto = true; notes.push({ key: inp.key, text: inp.label + ': العمود ' + hc }); }
          }
        } else if (!a.column || t.columns.indexOf(a.column) === -1) {
          a.column = t.columns[0];
          a.auto = true;
          notes.push({ key: inp.key, text: inp.label + ': الصفوف التي فيها قيمة في العمود ' + t.columns[0] });
        }
      }
    });
    cycle.recipes.forEach(function (rc) {
      var lc = rc.linkCheck;
      var t = lc && tables[lc.slot];
      if (!t || (lc.column && t.columns.indexOf(lc.column) !== -1)) return;
      var best = null;
      t.columns.forEach(function (c, i) {
        var n = t.records.filter(function (r) { return /^https?:\/\//i.test(String(r[i]).trim()); }).length;
        if (n && (!best || n > best.n)) best = { c: c, n: n };
      });
      if (best) { lc.column = best.c; lc.auto = true; notes.push({ key: 'linkCheck', text: 'عمود الروابط في نموذج المؤشر 8: ' + best.c }); }
    });
    return notes;
  }

  // ---------- ربط النتائج ببقية المنصة ----------
  /*
   * أحدث نتيجة حساب محفوظة (latest، وإلا آخر تشغيل) مقارنة بالمؤشرات الحالية، لتقرأها صفحات
   * التحليل ولوحة القيادة والمؤشر. لكل مؤشر: status = pending (محسوبة تختلف عن الحالية، بانتظار الاعتماد)
   * | approved (مطابقة للحالية) | error (لم تُحسب). يعيد null إذا لم يُشغَّل الحساب بعد.
   */
  function findings(data) {
    var cycles = data && data.calc && Array.isArray(data.calc.cycles) ? data.calc.cycles : [];
    var cycle = cycles.filter(function (c) { return c.latest || (c.runs && c.runs.length); })[0];
    if (!cycle) return null;
    var run = cycle.latest || cycle.runs[0];
    var byCode = {};
    (data.indicators || []).forEach(function (i) { byCode[i.code] = i; });
    var items = run.results.map(function (r) {
      var ind = byCode[r.indicatorCode] || null;
      var cmp = compare(r, ind);
      var ok = r.value !== null && r.value !== undefined && !r.error;
      return {
        code: r.indicatorCode, indicator: ind, value: ok ? r.value : null, current: ind ? ind.currentValue || '' : '',
        progressFileValue: cmp.progressFileValue, lastYearValue: cmp.lastYearValue, lastYearSource: cmp.lastYearSource,
        changes: (r.changes || []).slice(), lastYearError: r.lastYearError || null,
        conflict: ok && cmp.conflict, yoy: ok ? cmp.yoy : { pct: null, label: 'لا يمكن حساب التقدم' },
        warnings: (r.warnings || []).map(function (w) { return typeof w === 'string' ? w : w.text; }),
        audit: (r.audit || []).slice(), error: r.error || (ok ? null : 'لم تُحسب.'),
        status: !ok ? 'error' : ind && ind.currentValue === r.value ? 'approved' : 'pending', direction: r.direction
      };
    });
    var count = function (fn) { return items.filter(fn).length; };
    return {
      cycleId: cycle.id, label: cycle.label, at: run.at, sources: (cycle.sources || []).slice(), items: items,
      counts: {
        total: items.length, computed: count(function (x) { return x.status !== 'error'; }), pending: count(function (x) { return x.status === 'pending' && x.indicator && x.indicator.active !== false; }),
        conflicts: count(function (x) { return x.conflict; }), warnings: items.reduce(function (s, x) { return s + x.warnings.length; }, 0),
        quality: (cycle.sources || []).reduce(function (s, x) { return s + ((x.quality || []).length); }, 0)
      }
    };
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
    explainFormula: explainFormula,
    sourceText: sourceText,
    suggestRequirement: suggestRequirement,
    autoSelect: autoSelect,
    findings: findings,
    attachLastYear: attachLastYear
  };
});
