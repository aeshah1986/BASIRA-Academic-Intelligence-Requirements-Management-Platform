/*
 * مصادر البيانات والحساب — #/calculate (docs/design/06 §10)
 * ------------------------------------------------------------
 * الملفات تُقرأ في ذاكرة هذه الصفحة فقط (session) ولا تُخزن: تختفي بإعادة التحميل.
 * يُحفظ عند «احسب» فقط: إعداد الدورة، ووصف الملفات (الاسم وعدد الصفوف والأعمدة)، والنتائج المجمعة.
 * الحساب نفسه في js/engine.js، والقراءة في js/sources.js وjs/xlsx.js.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var S = B.sources;
  var X = B.xlsx;
  var E = B.engine;
  var A = B.actions;

  // ذاكرة الصفحة: لا تُكتب في التخزين أبدًا.
  var session = { tables: {}, raw: {}, buffers: {}, info: {}, draft: null, lastRun: null, busy: {} };

  var MAIN_SLOTS = ['admission', 'graduate', 'faculty', 'top500', 'form3', 'form4', 'form6', 'form7', 'form8'];
  var OPTIONAL_SLOTS = ['heqs', 'keymap'];

  function savedCycle(data) {
    return data.calc && Array.isArray(data.calc.cycles) ? data.calc.cycles.filter(function (c) { return c.id === 'ARAB-2026'; })[0] : null;
  }

  // المسودة: الدورة الافتراضية مع ما حُفظ من إعداد سابق (البنود والقيم والأعمدة والمعاملات).
  function draftFor(data) {
    if (session.draft) return session.draft;
    var d = E.defaultCycle();
    var saved = savedCycle(data);
    if (saved) {
      d.params = Object.assign({}, d.params, saved.params);
      d.sources = (saved.sources || []).slice();
      (saved.inputs || []).forEach(function (si) {
        var mine = d.inputs.filter(function (x) { return x.key === si.key; })[0];
        if (mine && mine.op === si.op) mine.args = JSON.parse(JSON.stringify(si.args));
      });
      (saved.recipes || []).forEach(function (sr) {
        var mine = d.recipes.filter(function (x) { return x.indicatorCode === sr.indicatorCode; })[0];
        if (mine && mine.linkCheck && sr.linkCheck) mine.linkCheck.column = sr.linkCheck.column || '';
      });
    }
    session.draft = d;
    return d;
  }

  function rowsPhrase(n) {
    if (n === 1) return 'صف واحد';
    if (n === 2) return 'صفان';
    if (n >= 3 && n <= 10) return n + ' صفوف';
    return n + ' صفًا';
  }

  // ---------- قراءة الملف ----------
  function loadFile(ctx, slot, file) {
    if (!file) return;
    var started = Date.now();
    session.busy[slot] = true;
    file.slice(0, 8).arrayBuffer().then(function (head) {
      var chk = S.checkFile(file.name, file.size, new Uint8Array(head));
      if (!chk.ok) throw new Error(chk.message);
      return file.arrayBuffer().then(function (buf) {
        if (chk.kind === 'xlsx') {
          session.buffers[slot] = buf;
          return X.readXlsx(buf).then(function (o) { return { rows: o.rows, sheets: o.sheets, sheet: o.sheet, encoding: '' }; });
        }
        var dec = S.decodeBytes(buf);
        return { rows: S.parseCSV(dec.text), encoding: dec.encoding };
      });
    }).then(function (res) {
      var t = S.toTable(res.rows);
      if (!t.ok) throw new Error(t.message);
      t.fileName = file.name;
      session.raw[slot] = res.rows;
      session.tables[slot] = t;
      session.info[slot] = { fileName: file.name, size: file.size, encoding: res.encoding, sheets: res.sheets || null, sheet: res.sheet || '', ms: Date.now() - started, error: '' };
      session.busy[slot] = false;
      ctx.toast('قُرئ «' + file.name + '»: ' + rowsPhrase(t.records.length) + ' (' + ((Date.now() - started) / 1000).toFixed(1) + ' ث).', 'success');
      ctx.rerender();
    }).catch(function (err) {
      session.busy[slot] = false;
      delete session.tables[slot];
      delete session.raw[slot];
      session.info[slot] = { fileName: file.name, error: err.message || String(err) };
      ctx.toast('لم يُقرأ «' + file.name + '»: ' + (err.message || err), 'error');
      ctx.rerender();
    });
  }

  function setHeader(ctx, slot, n) {
    var t = S.toTable(session.raw[slot], n);
    if (!t.ok) { ctx.toast(t.message, 'error'); return; }
    t.fileName = session.tables[slot].fileName;
    session.tables[slot] = t;
    ctx.rerender();
  }

  function setSheet(ctx, slot, name) {
    X.readXlsx(session.buffers[slot], { sheet: name }).then(function (o) {
      var t = S.toTable(o.rows);
      if (!t.ok) throw new Error(t.message);
      t.fileName = session.tables[slot].fileName;
      session.raw[slot] = o.rows;
      session.tables[slot] = t;
      session.info[slot].sheet = o.sheet;
      ctx.rerender();
    }).catch(function (err) { ctx.toast(err.message, 'error'); });
  }

  // أعمدة الجودة المناسبة لكل خانة (أرقام الصفوف فقط).
  function qualityFor(slot, t, draft) {
    var opts = { columns: [] };
    if (t.columns.indexOf('EMPLOYEE_ID') !== -1) opts.keyColumn = 'EMPLOYEE_ID';
    else if (t.columns.indexOf('Scopus author ID') !== -1) opts.keyColumn = 'Scopus author ID';
    if (t.columns.indexOf('h-index') !== -1) opts.numericColumns = ['h-index'];
    var link = draft.recipes.filter(function (r) { return r.linkCheck && r.linkCheck.slot === slot && r.linkCheck.column; })[0];
    if (link) opts.naColumn = link.linkCheck.column;
    draft.inputs.forEach(function (i) { if (i.slot === slot && i.args.column && t.columns.indexOf(i.args.column) !== -1 && opts.columns.indexOf(i.args.column) === -1) opts.columns.push(i.args.column); });
    return S.qualitySummary(S.quality(t, opts));
  }

  // ---------- المصادر ----------
  function slotCard(ctx, slot, draft) {
    var def = E.SLOTS[slot];
    var t = session.tables[slot];
    var info = session.info[slot] || {};
    var saved = savedCycle(ctx.data);
    var prev = saved ? (saved.sources || []).filter(function (s) { return s.slot === slot; })[0] : null;
    var input = h('input', { type: 'file', id: 'file-' + slot, class: 'visually-hidden', accept: '.csv,.txt,.xlsx,.xls',
      onchange: function () { loadFile(ctx, slot, input.files && input.files[0]); } });
    var body = [];
    if (t) {
      body.push(h('p', { class: 'slot__status' }, B.dom.badge('مرفوع', 'success'), ' ', h('strong', null, info.fileName), ' · ', rowsPhrase(t.records.length),
        ' · سطر العناوين ', B.dom.ltr(String(t.headerRow)), info.encoding ? ' · ' + info.encoding : '', info.sheet ? ' · الورقة: ' + info.sheet : ''));
      body.push(h('p', { class: 'muted small slot__cols' }, 'الأعمدة: ', t.columns.slice(0, 10).join('، '), t.columns.length > 10 ? '… (' + t.columns.length + ')' : ''));
      var hdr = h('input', { type: 'number', min: '1', max: String(session.raw[slot].length), value: String(t.headerRow), class: 'input input--narrow', id: 'hdr-' + slot });
      body.push(h('div', { class: 'inline-form' },
        U.field({ id: 'hdr-' + slot, name: 'header', label: 'سطر العناوين', control: hdr }),
        h('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: function () { setHeader(ctx, slot, Number(hdr.value)); } }, 'تطبيق'),
        info.sheets && info.sheets.length > 1 ? U.field({ id: 'sheet-' + slot, name: 'sheet', label: 'الورقة', control: (function () {
          var s = U.selectControl('sheet', info.sheets.map(function (n) { return { value: n, label: n }; }), info.sheet);
          s.addEventListener('change', function () { setSheet(ctx, slot, s.value); });
          return s;
        })() }) : null));
      var q = qualityFor(slot, t, draft);
      body.push(q.length ? h('ul', { class: 'compact-list quality' }, q.map(function (x) { return h('li', null, B.dom.badge('جودة', 'warning'), ' ', x); }))
        : h('p', { class: 'muted small' }, B.dom.icon('check'), ' لا ملاحظات جودة.'));
    } else if (info.error) {
      body.push(h('p', { class: 'banner banner--danger', role: 'alert' }, info.error));
    } else {
      body.push(h('p', { class: 'muted small' }, session.busy[slot] ? 'جارٍ القراءة…' : 'لم يُرفع ملف.',
        prev ? ' آخر ملف استُخدم: «' + prev.fileName + '» (' + rowsPhrase(prev.rowCount) + '). يلزم رفعه من جديد للحساب، لأن الملفات لا تُخزن.' : ''));
    }
    return h('section', { class: 'slot card', 'data-slot': slot, 'aria-labelledby': 'slot-title-' + slot },
      h('div', { class: 'slot__head' },
        h('h3', { class: 'slot__title', id: 'slot-title-' + slot }, def.label),
        B.dom.badge(def.kind === 'aggregate' ? 'جدول تجميعي' : 'قائمة', 'neutral')),
      def.hint ? h('p', { class: 'muted small' }, def.hint) : null,
      body,
      h('div', { class: 'form-actions' },
        h('label', { class: 'btn btn--secondary btn--small', for: 'file-' + slot }, B.dom.icon('plus'), t ? 'استبدال الملف' : 'رفع ملف (CSV أو xlsx)'),
        input,
        t ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: function () {
          delete session.tables[slot]; delete session.raw[slot]; delete session.buffers[slot]; delete session.info[slot]; ctx.rerender();
        } }, 'إزالة') : null));
  }

  // ---------- إعداد الوصفة ----------
  function columnSelect(id, t, value, onChange) {
    var s = U.selectControl('column', t.columns.map(function (c) { return { value: c, label: c }; }), value, 'اختيار العمود');
    s.id = id;
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }

  function checksList(name, options, chosen, onChange) {
    var set = {};
    (chosen || []).forEach(function (v) { set[v] = true; });
    return h('div', { class: 'checks', role: 'group' }, options.map(function (o) {
      var cb = h('input', { type: 'checkbox', name: name, value: o.value, checked: !!set[o.value] });
      cb.addEventListener('change', function () {
        var list = [].slice.call(document.querySelectorAll('input[name="' + name + '"]:checked')).map(function (x) { return x.value; });
        onChange(list);
      });
      return h('label', { class: 'check' }, cb, ' ', o.label);
    }));
  }

  function inputEditor(ctx, inp, draft) {
    var t = inp.slot ? session.tables[inp.slot] : null;
    var head = h('p', { class: 'strong' }, inp.label, inp.slot ? h('span', { class: 'muted small' }, ' · من ' + E.SLOTS[inp.slot].label) : null);
    if (inp.op === 'manual') {
      var v = h('input', { type: 'text', class: 'input input--narrow', value: inp.args.value || '', inputmode: 'decimal', dir: 'ltr' });
      var r = h('input', { type: 'text', class: 'input', value: inp.args.reason || '', dir: 'auto' });
      v.addEventListener('input', function () { inp.args.value = v.value; });
      r.addEventListener('input', function () { inp.args.reason = r.value; });
      return h('div', { class: 'recipe-input', 'data-input': inp.key }, head,
        h('div', { class: 'form-grid' },
          U.field({ id: 'manual-' + inp.key, name: 'value', label: 'القيمة (اختيارية)', hint: 'إذا تُركت فارغة يُحسب FTE من المتفرغين فقط مع تنبيه.', control: v }),
          U.field({ id: 'reason-' + inp.key, name: 'reason', label: 'السبب أو المصدر', hint: 'مطلوب إذا أُدخلت قيمة.', control: r })));
    }
    if (!t) return h('div', { class: 'recipe-input', 'data-input': inp.key }, head, h('p', { class: 'muted small' }, 'يرجى رفع ملف «' + E.SLOTS[inp.slot].label + '» أولًا.'));
    var parts = [head];
    if (inp.op === 'pick') {
      var items = t.records.map(function (rec) { return String(rec[0]).trim(); }).filter(Boolean);
      parts.push(U.field({ id: 'col-' + inp.key, name: 'column', label: 'عمود القيمة', control: columnSelect('col-' + inp.key, t, inp.args.column === 'B' ? t.columns[1] : inp.args.column, function (val) { inp.args.column = val; }) }));
      parts.push(h('p', { class: 'field__label' }, 'البنود المختارة (تُجمع)'));
      parts.push(checksList('items-' + inp.key, items.map(function (x) { return { value: x, label: x }; }), inp.args.items, function (list) { inp.args.items = list; }));
    } else if (inp.op === 'countWhere') {
      parts.push(U.field({ id: 'col-' + inp.key, name: 'column', label: 'العمود', control: columnSelect('col-' + inp.key, t, inp.args.column, function (val) {
        inp.args.column = val;
        if (inp.args.mode === 'in') { inp.args.values = []; ctx.rerender(); }
      }) }));
      if (inp.args.mode === 'in') {
        var dv = inp.args.column ? S.distinctValues(t, inp.args.column) : null;
        if (dv) {
          parts.push(h('p', { class: 'field__label' }, 'القيم التي تُعد (تُعرض للاختيار ولا يُخزن إلا المختار)'));
          parts.push(checksList('values-' + inp.key, dv.map(function (x) { return { value: x.value, label: x.value + ' (' + x.count + ')' }; }), inp.args.values, function (list) { inp.args.values = list; }));
        }
      } else if (inp.args.mode === 'gte') {
        parts.push(h('p', { class: 'muted small' }, 'تُعد الصفوف التي قيمتها ≥ عتبة هيرش في معاملات الدورة (' + draft.params.hIndexThreshold + ').'));
      } else {
        parts.push(h('p', { class: 'muted small' }, 'تُعد الصفوف التي فيها قيمة في هذا العمود.'));
      }
    }
    return h('div', { class: 'recipe-input', 'data-input': inp.key }, parts);
  }

  function linkCheckEditor(ctx, draft) {
    var rc = draft.recipes.filter(function (r) { return r.linkCheck; })[0];
    var t = session.tables[rc.linkCheck.slot];
    if (!t) return null;
    return h('div', { class: 'recipe-input', 'data-input': 'linkCheck' },
      h('p', { class: 'strong' }, 'فحص نطاق الروابط في نموذج المؤشر 8 (النطاق المتوقع ' + rc.linkCheck.domain + ')'),
      U.field({ id: 'col-linkCheck', name: 'column', label: 'عمود الرابط', control: columnSelect('col-linkCheck', t, rc.linkCheck.column, function (val) { rc.linkCheck.column = val; }) }));
  }

  // ---------- الحساب ----------
  function compute(ctx, draft) {
    var loaded = Object.keys(session.tables);
    if (!loaded.length) { ctx.toast('يرجى رفع ملف واحد على الأقل قبل الحساب.', 'error'); return; }
    var out = E.run(draft, session.tables, ctx.today);
    session.lastRun = out;
    var meta = loaded.map(function (slot) {
      var m = S.describe(session.tables[slot], session.info[slot].fileName, ctx.today);
      m.slot = slot;
      if (session.info[slot].sheet) m.sheet = session.info[slot].sheet;
      return m;
    });
    draft.sources = meta;
    var res = A.recordCalcRun(ctx.data, draft, E.storableRun(out), meta, ctx.env());
    if (!res.ok) { ctx.toast(res.message, 'error'); return; }
    ctx.save('حُسبت المؤشرات: ' + res.info.withValue + ' من ' + out.results.length + ' بنتيجة.');
    ctx.rerender();
    var t = document.getElementById('results-title');
    if (t) t.scrollIntoView({ block: 'start' });
  }

  // نتائج للعرض: من تشغيل هذه الجلسة، أو آخر تشغيل محفوظ (دون اقتراحات المتطلبات).
  function viewResults(ctx) {
    if (session.lastRun) return { live: true, at: session.lastRun.at, results: session.lastRun.results };
    var saved = savedCycle(ctx.data);
    var last = saved && saved.runs && saved.runs[0];
    if (!last) return null;
    return { live: false, at: last.at, results: last.results.map(function (r) {
      return Object.assign({}, r, { warnings: (r.warnings || []).map(function (w) { return typeof w === 'string' ? { text: w } : w; }) });
    }) };
  }

  function indicatorByCode(ctx, code) {
    return ctx.data.indicators.filter(function (i) { return i.code === code; })[0] || null;
  }

  function approve(ctx, r, draft) {
    var ind = indicatorByCode(ctx, r.indicatorCode);
    if (!ind) { ctx.toast('المؤشر ' + r.indicatorCode + ' غير موجود في البيانات.', 'error'); return; }
    var source = E.sourceText(Object.assign({ formula: r.formula || (draft.recipes.filter(function (x) { return x.indicatorCode === r.indicatorCode; })[0] || {}).formula }, r), draft, ctx.today);
    ctx.confirm({
      title: 'اعتماد القيمة المحسوبة؟',
      body: 'ستصبح القيمة الحالية للمؤشر ' + ind.code + ' «' + r.value + '»' + (ind.currentValue ? ' بدل «' + ind.currentValue + '»' : '') + '، ويُكتب مصدرها: «' + source + '». لا تتغير حالة العمل.',
      confirmLabel: 'اعتماد القيمة'
    }).then(function (ok) {
      if (!ok) return;
      var res = A.approveCalculatedValue(ctx.data, ind.id, { value: r.value, source: source }, ctx.env());
      if (!res.ok) { ctx.toast(res.message, 'error'); return; }
      ctx.save('اعتُمدت القيمة ' + r.value + ' للمؤشر ' + ind.code + '.');
      ctx.rerender();
    });
  }

  function makeRequirement(ctx, w, r) {
    var ind = indicatorByCode(ctx, r.indicatorCode);
    var s = E.suggestRequirement(w, ind, ctx.data, ctx.today);
    if (!s) return;
    if (s.existingId) {
      ctx.toast('يوجد متطلب مفتوح بالعنوان نفسه لهذا المؤشر، فلم يُنشأ متطلب مكرر.', 'info');
      ctx.go('#/requirements/' + encodeURIComponent(s.existingId));
      return;
    }
    if (!s.entityFound) { ctx.toast('لم تُعرف الجهة المناسبة («' + w.suggest.entityHint + '»). يرجى إنشاء المتطلب يدويًا من صفحة المتطلبات.', 'error'); return; }
    var ent = ctx.lookups.entitiesById[s.input.entityId];
    ctx.confirm({
      title: 'إنشاء متطلب من التنبيه؟',
      body: 'سيُنشأ متطلب «' + s.input.title + '» للمؤشر ' + ind.code + '، والجهة «' + ent.name + '»، والموعد ' + B.format.formatDate(s.input.deadline) + '، وأولوية عالية. يمكن تعديله بعد الإنشاء.',
      confirmLabel: 'إنشاء المتطلب'
    }).then(function (ok) {
      if (!ok) return;
      var res = A.createRequirementFromWarning(ctx.data, s, ctx.env());
      if (!res.ok) { ctx.toast(res.message, 'error'); return; }
      ctx.save('أُنشئ المتطلب «' + s.input.title + '».');
      ctx.rerender();
    });
  }

  function exportCsv(ctx, vr) {
    var rows = vr.results.map(function (r) {
      var ind = indicatorByCode(ctx, r.indicatorCode);
      var cmp = E.compare(r, ind);
      return [r.indicatorCode, ind ? ind.name : '', r.value === null ? '' : r.value, cmp.progressFileValue, cmp.conflict ? 'نعم' : 'لا', cmp.lastYearValue, cmp.yoy.label,
        r.warnings.map(function (w) { return w.text; }).join('؛ '), (r.audit || []).join('؛ '), r.error || ''];
    });
    var name = 'basira-calculation-' + ctx.today + '.csv';
    ctx.download(name, B.csv.toCSV(['رمز المؤشر', 'المؤشر', 'القيمة المحسوبة', 'ملف التقدم', 'تعارض', 'العام الماضي', 'التقدم', 'التنبيهات', 'بيان الحساب', 'الخطأ'], rows), 'text/csv;charset=utf-8');
    ctx.toast('نُزّل الملف: ' + name, 'success');
  }

  function resultsCard(ctx, draft) {
    var vr = viewResults(ctx);
    if (!vr) return U.card('النتائج', h('p', { class: 'muted' }, 'لا نتائج بعد. يرجى رفع الملفات وضبط الوصفة ثم «احسب».'), { id: 'results-title' });
    var table = U.responsiveTable('نتائج الحساب', [
      { label: 'المؤشر', cls: 'col-main', cell: function (r) {
        var ind = indicatorByCode(ctx, r.indicatorCode);
        return h('span', null, B.dom.ltr(r.indicatorCode, 'strong'), ind ? [' ', ind.name] : null);
      } },
      { label: 'المحسوبة', cell: function (r) {
        return r.value !== null && !r.error ? B.dom.ltr(r.value, 'strong calc-value') : h('span', { class: 'calc-error' }, B.dom.badge('لم تُحسب', 'neutral'), ' ', r.error || '');
      } },
      { label: 'المقارنة', cell: function (r) {
        var cmp = E.compare(r, indicatorByCode(ctx, r.indicatorCode));
        return h('span', { class: 'stack-xs compare' },
          h('span', { class: 'small' }, 'ملف التقدم: ', B.dom.ltr(cmp.progressFileValue || '—'), cmp.conflict ? [' ', B.dom.badge('تعارض', 'danger')] : null),
          h('span', { class: 'small' }, 'العام الماضي: ', B.dom.ltr(cmp.lastYearValue || '—')),
          h('span', { class: 'small yoy' }, cmp.yoy.label),
          h('span', { class: 'muted small' }, E.DIRECTIONS[r.direction] || ''));
      } },
      { label: 'التنبيهات وبيان الحساب', cell: function (r) {
        return h('div', null,
          r.warnings.length ? h('ul', { class: 'compact-list warn-list' }, r.warnings.map(function (w) {
            return h('li', null, B.dom.badge('تنبيه', 'warning'), ' ', w.text,
              vr.live && w.suggest ? h('button', { type: 'button', class: 'link-button small make-req', onclick: function () { makeRequirement(ctx, w, r); } }, ' أنشئ متطلبًا') : null);
          })) : null,
          (r.audit || []).length ? h('details', { class: 'details-toggle audit' }, h('summary', null, 'بيان الحساب'),
            h('ul', { class: 'compact-list' }, r.audit.map(function (a) { return h('li', null, a); }))) : null);
      } },
      { label: 'إجراء', cell: function (r) {
        var ind = indicatorByCode(ctx, r.indicatorCode);
        if (r.value === null || r.error || !ind) return h('span', { class: 'muted small' }, '—');
        if (ind.currentValue === r.value) return h('span', { class: 'small' }, B.dom.icon('check'), ' معتمدة');
        return h('button', { type: 'button', class: 'btn btn--primary btn--small approve', 'data-code': r.indicatorCode, onclick: function () { approve(ctx, r, draft); } }, 'اعتماد القيمة');
      } }
    ], vr.results, function (r) { return r.indicatorCode; });
    return U.card('النتائج', h('div', { class: 'stack' },
      h('p', { class: 'muted small', id: 'results-meta' }, vr.live ? 'نتائج حساب هذه الجلسة.' : 'نتائج آخر تشغيل محفوظ (' + B.format.formatDate(vr.at) + '). لإعادة الحساب يلزم رفع الملفات من جديد.'),
      table,
      h('div', { class: 'form-actions no-print' },
        h('button', { type: 'button', class: 'btn btn--secondary', id: 'calc-export', onclick: function () { exportCsv(ctx, vr); } }, B.dom.icon('download'), 'تصدير تقرير الحساب CSV'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: function () { root.print(); } }, B.dom.icon('printer'), 'طباعة'))), { id: 'results-title' });
  }

  // ---------- الصفحة ----------
  B.views.calculate = function (ctx) {
    var draft = draftFor(ctx.data);
    var th = h('input', { type: 'number', min: '1', step: '1', class: 'input input--narrow', value: String(draft.params.hIndexThreshold), id: 'param-h' });
    th.addEventListener('change', function () {
      var n = Number(th.value);
      if (!(n > 0)) { ctx.toast('عتبة هيرش يجب أن تكون رقمًا أكبر من صفر.', 'error'); th.value = String(draft.params.hIndexThreshold); return; }
      draft.params.hIndexThreshold = n;
    });
    var inputsBySlot = draft.inputs;
    var loadedCount = Object.keys(session.tables).length;
    return h('div', { class: 'calculate' },
      U.pageHeader('مصادر البيانات والحساب', draft.label + ': رفع ملفات المصدر وحساب قيم المؤشرات بوصفات معلنة.',
        h('button', { type: 'button', class: 'btn btn--primary', id: 'calc-run', onclick: function () { compute(ctx, draft); } }, 'احسب')),
      h('div', { class: 'banner banner--info rules-notice', role: 'note' }, B.dom.icon('shield'),
        h('span', null, h('strong', null, 'الخصوصية: '), 'الملفات تُقرأ في هذا المتصفح فقط ولا تُخزن ولا تُرسل، وتختفي بإعادة تحميل الصفحة. يُحفظ فقط اسم الملف وعدد صفوفه وأعمدته والنتائج المجمعة. الحساب بقواعد مكتوبة، لا ذكاء اصطناعي.')),
      U.card('معاملات الدورة', h('div', { class: 'inline-form' },
        U.field({ id: 'param-h', name: 'hIndexThreshold', label: 'عتبة معامل هيرش (المؤشر 5)', hint: 'منصة 2026 تذكر 10، وFAQ 2025 يذكر 20.', control: th }))),
      h('h2', { class: 'section-title' }, 'ملفات المصدر (' + loadedCount + ' في الذاكرة)'),
      h('div', { class: 'slot-grid' }, MAIN_SLOTS.map(function (s) { return slotCard(ctx, s, draft); })),
      h('details', { class: 'details-toggle' }, h('summary', null, 'مصادر اختيارية: ملف HEQS وملف ربط المفاتيح'),
        h('div', { class: 'slot-grid' }, OPTIONAL_SLOTS.map(function (s) { return slotCard(ctx, s, draft); }))),
      U.card('إعداد الوصفة', h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, 'تُختار البنود والقيم من الملف المرفوع، وتُحفظ مع الحساب للدورات التالية.'),
        inputsBySlot.map(function (inp) { return inputEditor(ctx, inp, draft); }),
        linkCheckEditor(ctx, draft),
        h('details', { class: 'details-toggle' }, h('summary', null, 'الصيغ المستخدمة'),
          h('ul', { class: 'compact-list' }, draft.recipes.map(function (r) {
            return h('li', null, B.dom.ltr(r.indicatorCode, 'strong'), ': ', E.explainFormula(r.formula, draft.inputs), ' · ', E.DIRECTIONS[r.direction],
              h('br'), h('code', { class: 'formula', dir: 'ltr' }, r.formula));
          })))), { id: 'recipe-title' }),
      h('div', { class: 'form-actions no-print' }, h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { compute(ctx, draft); } }, 'احسب')),
      resultsCard(ctx, draft));
  };

  // للفحص فقط: إفراغ ذاكرة الصفحة (يعادل إعادة التحميل).
  B.views.calculate.resetSession = function () { session = { tables: {}, raw: {}, buffers: {}, info: {}, draft: null, lastRun: null, busy: {} }; };
})(window);
