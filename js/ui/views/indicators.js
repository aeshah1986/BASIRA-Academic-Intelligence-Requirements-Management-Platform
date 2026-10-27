/*
 * التصنيفات والمؤشرات — #/rankings، و#/indicators/:id، و#/indicators/:id/edit  (docs/design/01 §2)
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;
  var M = B.model;

  function openCount(ctx, indicatorId) {
    return ctx.data.requirements.filter(function (r) { return r.indicatorId === indicatorId && r.status !== 'done'; }).length;
  }

  // ---------- القائمة ----------
  B.views.rankings = function (ctx) {
    var d = ctx.data;
    var codes = ['ARAB', 'QS'].filter(function (c) { return d.indicators.some(function (i) { return i.ranking === c; }); });
    var ranking = ctx.query.get('ranking');
    if (codes.indexOf(ranking) === -1) ranking = codes[0] || 'ARAB';
    var conflictOnly = ctx.query.get('conflict') === '1';
    var work = ctx.query.get('work') || '';

    var all = d.indicators.filter(function (i) { return i.ranking === ranking; });
    var shown = all.filter(function (i) {
      return (!conflictOnly || D.hasValueConflict(i)) && (!work || i.workStatus === work);
    });

    var tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'التصنيف' }, codes.map(function (c) {
      return h('a', { href: B.app.buildHash('/rankings', { ranking: c }), role: 'tab', class: 'tab', 'aria-selected': String(c === ranking) }, U.rankingName(c));
    }));

    var update = function (patch) {
      var next = { ranking: ranking, conflict: conflictOnly ? '1' : '', work: work };
      Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
      ctx.go(B.app.buildHash('/rankings', next));
    };

    var filters = h('div', { class: 'filters filters--inline' },
      U.field({ id: 'f-work', name: 'work', label: 'حالة العمل', control: U.selectControl('work', U.optionsFromMap(M.WORK_STATUSES), work, 'الكل') }),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: conflictOnly, onchange: function (e) { update({ conflict: e.target.checked ? '1' : '' }); } }),
        ' فيها تعارض فقط'));
    filters.querySelector('#f-work').addEventListener('change', function (e) { update({ work: e.target.value }); });

    var summary = h('div', { class: 'card summary-row' },
      h('div', null, h('span', { class: 'muted small' }, 'مُدخل في المنصة'), h('p', { class: 'big' }, D.enteredCount(all) + ' من ' + all.length)),
      h('div', { class: 'summary-row__bar' }, B.dom.progress('جاهزية المؤشرات', D.indicatorReadiness(all))),
      h('div', null, h('span', { class: 'muted small' }, 'موعد التسليم'), h('p', null, 'لم يُحدد بعد')));

    var domains = [];
    shown.forEach(function (i) { if (domains.indexOf(i.domain) === -1) domains.push(i.domain); });

    var body = shown.length ? domains.map(function (dom) {
      var list = shown.filter(function (i) { return i.domain === dom; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      return h('section', { class: 'card', 'aria-label': dom },
        h('h2', { class: 'card__title' }, dom),
        U.responsiveTable('مؤشرات ' + dom, [
          { label: 'الرمز', cell: function (i) { return B.dom.ltr(i.code); } },
          { label: 'المؤشر', cls: 'col-main', cell: function (i) { return h('a', { href: '#/indicators/' + encodeURIComponent(i.id), class: 'row-link' }, i.name); } },
          { label: 'حالة العمل', cell: function (i) { return U.workBadge(i.workStatus); } },
          { label: 'القيمة الحالية', cell: function (i) { return B.dom.ltr(i.currentValue); } },
          { label: 'ملف التقدم', cell: function (i) { return B.dom.ltr(i.progressFileValue); } },
          { label: 'العام الماضي', cls: 'col-secondary', cell: function (i) { return B.dom.ltr(i.lastYearValue); } },
          { label: 'تعارض', cell: function (i) { return D.hasValueConflict(i) ? B.dom.badge('تعارض', 'danger') : h('span', { class: 'muted' }, 'لا'); } },
          { label: 'متطلبات مفتوحة', cell: function (i) { return String(openCount(ctx, i.id)); } }
        ], list, function (i) { return i.id; }));
    }) : !all.length ? B.dom.emptyState('لا توجد مؤشرات بعد', 'تُحمَّل المؤشرات من البيانات التجريبية أو من نسخة احتياطية عبر زر «البيانات».')
      : B.dom.emptyState('لا توجد مؤشرات مطابقة', 'يمكن تغيير التصفية لعرض مؤشرات أخرى.',
        h('a', { href: B.app.buildHash('/rankings', { ranking: ranking }), class: 'btn btn--secondary' }, 'مسح التصفية'));

    return h('div', null,
      U.pageHeader('التصنيفات والمؤشرات', 'جاهزية كل مؤشر وقيمه وتعارضها مع ملف التقدم.'),
      tabs, summary, filters,
      h('p', { class: 'muted small', 'aria-live': 'polite' }, 'عدد المؤشرات المعروضة: ' + shown.length + ' من ' + all.length),
      body);
  };

  // ---------- التفاصيل ----------
  B.views.indicator = function (ctx) {
    var ind = ctx.lookups.indicatorsById[ctx.params[0]];
    if (!ind) return U.notFoundState('المؤشر', '#/rankings', 'العودة إلى المؤشرات');
    var conflict = D.hasValueConflict(ind);
    var reqs = D.sortByUrgency(ctx.data.requirements.filter(function (r) { return r.indicatorId === ind.id; }), ctx.today);
    var questions = ctx.data.decisions.filter(function (q) { return q.indicatorId === ind.id; });

    var values = h('dl', { class: 'values' },
      h('div', null, h('dt', null, 'القيمة الحالية'), h('dd', null, B.dom.ltr(ind.currentValue, 'big'))),
      h('div', null, h('dt', null, 'قيمة ملف التقدم'), h('dd', null, B.dom.ltr(ind.progressFileValue, 'big'))),
      h('div', null, h('dt', null, 'العام الماضي (للمقارنة)'), h('dd', null, B.dom.ltr(ind.lastYearValue, 'big'))),
      h('div', null, h('dt', null, 'مصدر الرقم'), h('dd', null, ind.valueSource || h('span', { class: 'muted' }, 'غير مسجل'))));

    return h('div', null,
      U.backLink(B.app.buildHash('/rankings', { ranking: ind.ranking }), 'المؤشرات'),
      U.pageHeader(ind.name, null,
        h('a', { href: '#/indicators/' + encodeURIComponent(ind.id) + '/edit', class: 'btn btn--primary' }, 'تعديل القيم والحالة')),
      h('p', { class: 'meta-line' }, B.dom.ltr(ind.code, 'strong'), ' · ', U.rankingName(ind.ranking), ' ← ', ind.domain, ' · ', U.workBadge(ind.workStatus)),
      conflict ? h('div', { class: 'banner banner--danger', role: 'status' }, B.dom.icon('alert'),
        h('span', null, 'يختلف عن ملف التقدم: القيمة الحالية ', B.dom.ltr(ind.currentValue, 'strong'), ' وقيمة ملف التقدم ', B.dom.ltr(ind.progressFileValue, 'strong'), '. يُنصح بمراجعة المصدر أو تسجيل سؤال للمسؤول.')) : null,
      U.card('القيم', h('div', null, values, ind.notes ? h('p', { class: 'muted' }, 'ملاحظات: ', ind.notes) : null)),
      U.card('المتطلبات المرتبطة (' + reqs.length + ')', h('div', { class: 'stack' },
        reqs.length ? U.requirementsTable(ctx, reqs, 'متطلبات المؤشر') : B.dom.emptyState('لا توجد متطلبات لهذا المؤشر', null),
        h('a', { href: '#/requirements/new?indicator=' + encodeURIComponent(ind.id), class: 'btn btn--secondary' }, B.dom.icon('plus'), 'إضافة متطلب لهذا المؤشر'))),
      U.card('الأسئلة والقرارات (' + questions.length + ')', questions.length ? h('ul', { class: 'plain-list' }, questions.map(function (q) {
        return h('li', null, h('p', { class: 'strong' }, q.question),
          h('p', { class: 'muted small' }, 'موجه إلى: ', q.askedTo, ' · ', B.format.formatDate(q.askedOn), ' · ',
            q.status === 'open' ? B.dom.badge('مفتوح', 'warning') : B.dom.badge('محسوم', 'success')),
          q.decision ? h('p', null, 'القرار: ', q.decision) : null);
      })) : h('p', { class: 'muted' }, 'لا توجد أسئلة لهذا المؤشر.')));
  };

  // ---------- تعديل القيم والحالة ----------
  B.views.indicatorEdit = function (ctx) {
    var ind = ctx.lookups.indicatorsById[ctx.params[0]];
    if (!ind) return U.notFoundState('المؤشر', '#/rankings', 'العودة إلى المؤشرات');
    var detail = '#/indicators/' + encodeURIComponent(ind.id);

    var valueInput = function (name, v) { return h('input', { type: 'text', name: name, class: 'input', dir: 'ltr', maxlength: '40', value: v || '', autocomplete: 'off' }); };
    var form = h('form', { class: 'form card', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('div', { class: 'form-grid' },
        U.field({ id: 'i-work', name: 'workStatus', label: 'حالة العمل', required: true, control: U.selectControl('workStatus', U.optionsFromMap(M.WORK_STATUSES), ind.workStatus) }),
        U.field({ id: 'i-current', name: 'currentValue', label: 'القيمة الحالية', hint: 'نص قصير، مثل 120 أو 1:15 (حتى 30 حرفًا).', control: valueInput('currentValue', ind.currentValue) }),
        U.field({ id: 'i-progress', name: 'progressFileValue', label: 'قيمة ملف التقدم', control: valueInput('progressFileValue', ind.progressFileValue) }),
        U.field({ id: 'i-last', name: 'lastYearValue', label: 'قيمة العام الماضي', control: valueInput('lastYearValue', ind.lastYearValue) }),
        U.field({ id: 'i-source', name: 'valueSource', label: 'مصدر الرقم', wide: true, hint: 'مطلوب لحالتي «محسوب بالأدلة» و«مُدخل في المنصة».', control: h('input', { type: 'text', name: 'valueSource', class: 'input', maxlength: '220', dir: 'auto', value: ind.valueSource || '' }) }),
        U.field({ id: 'i-notes', name: 'notes', label: 'ملاحظات', wide: true, control: h('textarea', { name: 'notes', class: 'input', rows: '3', maxlength: '1100', dir: 'auto' }, ind.notes || '') })),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'حفظ'),
        h('a', { href: detail, class: 'btn btn--ghost' }, 'إلغاء')));

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var v = {
        workStatus: f.workStatus.value,
        currentValue: f.currentValue.value.trim(),
        progressFileValue: f.progressFileValue.value.trim(),
        lastYearValue: f.lastYearValue.value.trim(),
        valueSource: f.valueSource.value.replace(/\s+/g, ' ').trim(),
        notes: f.notes.value.trim()
      };
      var errors = {};
      if (!Object.prototype.hasOwnProperty.call(M.WORK_STATUSES, v.workStatus)) errors.workStatus = 'الحالة غير معروفة.';
      ['currentValue', 'progressFileValue', 'lastYearValue'].forEach(function (k) {
        if (v[k].length > 30) errors[k] = 'القيمة أطول من 30 حرفًا.';
      });
      if ((v.workStatus === 'evidenced' || v.workStatus === 'entered') && !v.currentValue) {
        errors.currentValue = 'لا يمكن اختيار «' + M.WORK_STATUSES[v.workStatus] + '» دون قيمة حالية.';
      }
      if ((v.workStatus === 'evidenced' || v.workStatus === 'entered') && !v.valueSource) {
        errors.valueSource = 'يرجى ذكر مصدر الرقم قبل اختيار «' + M.WORK_STATUSES[v.workStatus] + '».';
      }
      if (v.valueSource.length > 200) errors.valueSource = 'النص أطول من 200 حرف.';
      if (v.notes.length > 1000) errors.notes = 'النص أطول من 1000 حرف.';
      if (!U.showErrors(form, errors)) return;
      Object.keys(v).forEach(function (k) { ind[k] = v[k]; });
      ctx.save('حُفظت قيم المؤشر ' + ind.code + '.');
      ctx.go(detail);
    });

    return h('div', null,
      U.backLink(detail, ind.code),
      U.pageHeader('تعديل القيم والحالة', ind.name),
      form);
  };
})(window);
