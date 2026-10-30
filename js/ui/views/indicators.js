/*
 * التصنيفات والمؤشرات — #/rankings، و#/indicators/new، و#/indicators/:id، و#/indicators/:id/edit
 * (docs/design/01 §2). كل تغيير عبر js/actions.js.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;
  var M = B.model;
  var A = B.actions;

  function openCount(ctx, indicatorId) {
    return ctx.data.requirements.filter(function (r) { return r.indicatorId === indicatorId && r.status !== 'done'; }).length;
  }

  function rankingCodes(d) {
    return (d.rankings || []).map(function (r) { return r.id; }).filter(function (c) { return d.indicators.some(function (i) { return i.ranking === c; }) || true; });
  }

  // نموذج موعد التسليم ووصف الدورة لتصنيف.
  function deadlineForm(ctx, rankingId) {
    var rk = (ctx.data.rankings || []).filter(function (r) { return r.id === rankingId; })[0];
    if (!rk) return null;
    var form = h('form', { class: 'inline-form', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      U.field({ id: 'rk-deadline', name: 'submissionDeadline', label: 'موعد التسليم', control: h('input', { type: 'date', name: 'submissionDeadline', class: 'input', value: rk.submissionDeadline || '' }) }),
      U.field({ id: 'rk-cycle', name: 'cycleLabel', label: 'وصف الدورة', control: h('input', { type: 'text', name: 'cycleLabel', class: 'input', maxlength: '50', value: rk.cycleLabel || '', dir: 'auto' }) }),
      h('button', { type: 'submit', class: 'btn btn--secondary' }, 'حفظ الموعد'));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var res = A.updateRanking(ctx.data, rankingId, { submissionDeadline: form.elements.submissionDeadline.value, cycleLabel: form.elements.cycleLabel.value }, ctx.env());
      if (!U.handle(form, res, ctx)) return;
      ctx.save('حُفظ موعد التسليم.');
      ctx.rerender();
    });
    return form;
  }

  // ---------- القائمة ----------
  B.views.rankings = function (ctx) {
    var d = ctx.data;
    var codes = rankingCodes(d);
    var ranking = ctx.query.get('ranking');
    if (codes.indexOf(ranking) === -1) ranking = codes[0] || 'ARAB';
    var conflictOnly = ctx.query.get('conflict') === '1';
    var showInactive = ctx.query.get('inactive') === '1';
    var work = ctx.query.get('work') || '';

    var all = d.indicators.filter(function (i) { return i.ranking === ranking; });
    var active = D.activeIndicators(all);
    var shown = all.filter(function (i) {
      return (showInactive || i.active !== false) && (!conflictOnly || D.hasValueConflict(i)) && (!work || i.workStatus === work);
    });
    var st = D.rankingStatus(d, ranking, ctx.today);

    var tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'التصنيف' }, codes.map(function (c) {
      return h('a', { href: B.app.buildHash('/rankings', { ranking: c }), role: 'tab', class: 'tab', 'aria-selected': String(c === ranking) }, U.rankingName(c));
    }));

    var update = function (patch) {
      var next = { ranking: ranking, conflict: conflictOnly ? '1' : '', inactive: showInactive ? '1' : '', work: work };
      Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
      ctx.go(B.app.buildHash('/rankings', next));
    };

    var filters = h('div', { class: 'filters filters--inline' },
      U.field({ id: 'f-work', name: 'work', label: 'حالة العمل', control: U.selectControl('work', U.optionsFromMap(M.WORK_STATUSES), work, 'الكل') }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: conflictOnly, onchange: function (e) { update({ conflict: e.target.checked ? '1' : '' }); } }), ' فيها تعارض فقط'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showInactive, onchange: function (e) { update({ inactive: e.target.checked ? '1' : '' }); } }), ' إظهار المعطلة'));
    filters.querySelector('#f-work').addEventListener('change', function (e) { update({ work: e.target.value }); });

    var summary = h('div', { class: 'card' },
      h('div', { class: 'summary-row' },
        h('div', null, h('span', { class: 'muted small' }, 'مُدخل في المنصة'), h('p', { class: 'big' }, st.entered + ' من ' + st.total)),
        h('div', { class: 'summary-row__bar' }, B.dom.progress('جاهزية المؤشرات', st.readiness)),
        h('div', null, h('span', { class: 'muted small' }, 'موعد التسليم'),
          h('p', { class: 'strong' }, st.deadline ? B.format.formatDate(st.deadline) : 'لم يُحدد بعد'),
          st.days !== null ? h('p', { class: 'muted small' }, st.days >= 0 ? 'متبقٍ ' + B.format.dayCount(st.days) : 'انتهى منذ ' + B.format.dayCount(st.days)) : null)),
      st.risk ? h('p', { class: 'rank-card__reason' }, B.dom.icon('alert'), st.reasons.join(' · ')) : null,
      h('details', { class: 'details-toggle' }, h('summary', null, 'تعديل موعد التسليم'), deadlineForm(ctx, ranking)));

    var domains = [];
    shown.forEach(function (i) { if (domains.indexOf(i.domain) === -1) domains.push(i.domain); });

    var body = shown.length ? domains.map(function (dom) {
      var list = shown.filter(function (i) { return i.domain === dom; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      return h('section', { class: 'card', 'aria-label': dom },
        h('h2', { class: 'card__title' }, dom),
        U.responsiveTable('مؤشرات ' + dom, [
          { label: 'الرمز', cell: function (i) { return B.dom.ltr(i.code); } },
          { label: 'المؤشر', cls: 'col-main', cell: function (i) {
            return h('span', null, h('a', { href: '#/indicators/' + encodeURIComponent(i.id), class: 'row-link' }, i.name), i.active === false ? [' ', B.dom.badge('معطل', 'neutral')] : null);
          } },
          { label: 'حالة العمل', cell: function (i) { return U.workBadge(i.workStatus); } },
          { label: 'القيمة الحالية', cell: function (i) { return B.dom.ltr(i.currentValue); } },
          { label: 'ملف التقدم', cell: function (i) { return B.dom.ltr(i.progressFileValue); } },
          { label: 'العام الماضي', cls: 'col-secondary', cell: function (i) { return B.dom.ltr(i.lastYearValue); } },
          { label: 'تعارض', cell: function (i) { return D.hasValueConflict(i) ? B.dom.badge('تعارض', 'danger') : h('span', { class: 'muted' }, 'لا'); } },
          { label: 'متطلبات مفتوحة', cell: function (i) { return String(openCount(ctx, i.id)); } }
        ], list, function (i) { return i.id; }));
    }) : !all.length ? B.dom.emptyState('لا توجد مؤشرات بعد', 'يمكن إضافة مؤشر من زر «إضافة مؤشر».')
      : B.dom.emptyState('لا توجد مؤشرات مطابقة', 'يمكن تغيير التصفية لعرض مؤشرات أخرى.',
        h('a', { href: B.app.buildHash('/rankings', { ranking: ranking }), class: 'btn btn--secondary' }, 'مسح التصفية'));

    var inactiveCount = all.length - active.length;
    return h('div', null,
      U.pageHeader('التصنيفات والمؤشرات', 'جاهزية كل مؤشر وقيمه وتعارضها مع ملف التقدم.',
        h('a', { href: '#/indicators/new?ranking=' + ranking, class: 'btn btn--primary' }, B.dom.icon('plus'), 'إضافة مؤشر')),
      tabs, summary, filters,
      h('p', { class: 'muted small', 'aria-live': 'polite' }, 'عدد المؤشرات المعروضة: ' + shown.length + ' من ' + all.length + (inactiveCount ? ' (منها ' + inactiveCount + ' معطل)' : '')),
      body);
  };

  // آخر قيمة محسوبة من الملفات المصدرية لهذا المؤشر، مع «اعتماد القيمة» إذا اختلفت عن الحالية.
  function calcSection(ctx, ind) {
    var fd = B.engine.findings(ctx.data);
    var x = fd && fd.items.filter(function (i) { return i.code === ind.code; })[0];
    if (!x) return null;
    var cycle = ctx.data.calc.cycles.filter(function (c) { return c.id === fd.cycleId; })[0];
    return U.card('آخر قيمة محسوبة من الملفات', h('div', { class: 'stack', id: 'indicator-calc' },
      h('p', null, U.calcStatusBadge(x.status), ' ',
        x.value === null ? h('span', { class: 'muted' }, x.error) : ['المحسوبة: ', B.dom.ltr(x.value, 'big')],
        x.conflict ? [' ', B.dom.badge('تعارض مع ملف التقدم (' + x.progressFileValue + ')', 'danger')] : null),
      x.value !== null ? h('p', { class: 'small', id: 'indicator-calc-yoy' }, 'مقارنة بالعام الماضي (' + (x.lastYearValue || '—') + (x.lastYearSource === 'file' ? '، من ملفه' : x.lastYearSource === 'manual' ? '، مكتوبة' : '') + '): ', x.yoy.label, ' · ', B.format.formatDate(fd.at)) : null,
      x.changes.length ? h('ul', { class: 'compact-list' }, x.changes.map(function (c) { return h('li', null, c); })) : null,
      x.warnings.length ? h('ul', { class: 'compact-list' }, x.warnings.map(function (w) { return h('li', null, B.dom.badge('تنبيه', 'warning'), ' ', w); })) : null,
      x.audit.length ? h('details', { class: 'details-toggle' }, h('summary', null, 'بيان الحساب'), h('ul', { class: 'compact-list' }, x.audit.map(function (a) { return h('li', null, a); }))) : null,
      h('div', { class: 'form-actions' },
        x.status === 'pending' && ind.active !== false ? h('button', { type: 'button', class: 'btn btn--primary', id: 'indicator-approve', onclick: function () {
          U.approveCalculated(ctx, ind, x.value, B.engine.sourceText(x, cycle, ctx.today));
        } }, 'اعتماد القيمة المحسوبة') : null,
        x.lastYearSource === 'file' && x.lastYearValue !== ind.lastYearValue ? h('button', { type: 'button', class: 'btn btn--secondary', id: 'indicator-approve-last', onclick: function () {
          ctx.confirm({ title: 'اعتماد قيمة العام الماضي المحسوبة؟', body: 'ستصبح قيمة العام الماضي للمؤشر ' + ind.code + ' «' + x.lastYearValue + '» (محسوبة من ملف العام الماضي)' + (ind.lastYearValue ? ' بدل «' + ind.lastYearValue + '» المكتوبة' : '') + '.', confirmLabel: 'اعتماد قيمة العام الماضي' }).then(function (ok) {
            if (!ok) return;
            var res = B.actions.approveLastYearValue(ctx.data, ind.id, x.lastYearValue, ctx.env());
            if (!res.ok) { ctx.toast(res.message, 'error'); return; }
            ctx.save('اعتُمدت قيمة العام الماضي ' + x.lastYearValue + ' للمؤشر ' + ind.code + '.');
            ctx.rerender();
          });
        } }, 'اعتماد قيمة العام الماضي المحسوبة') : null,
        h('a', { href: '#/calculate', class: 'btn btn--secondary' }, 'مصادر البيانات والحساب'))));
  }

  // ---------- التفاصيل ----------
  B.views.indicator = function (ctx) {
    var ind = ctx.lookups.indicatorsById[ctx.params[0]];
    if (!ind) return U.notFoundState('المؤشر', '#/rankings', 'العودة إلى المؤشرات');
    var inactive = ind.active === false;
    var conflict = D.hasValueConflict(ind);
    var reqs = D.sortByUrgency(ctx.data.requirements.filter(function (r) { return r.indicatorId === ind.id; }), ctx.today);
    var questions = ctx.data.decisions.filter(function (q) { return q.indicatorId === ind.id; });
    var evidence = (ctx.data.evidence || []).filter(function (e) { return e.indicatorId === ind.id; });

    function toggleActive() {
      var impact = A.indicatorImpact(ctx.data, ind.id);
      ctx.confirm({
        title: inactive ? 'تفعيل المؤشر؟' : 'تعطيل المؤشر؟',
        body: inactive
          ? 'سيعود المؤشر ' + ind.code + ' إلى الحسابات وقوائم الاختيار.'
          : 'لن يُحذف المؤشر ' + ind.code + ' ولا متطلباته (' + impact.requirements + ') ولا أدلته (' + impact.evidence + ')، لكنه يخرج من حساب الجاهزية والمُدخل، ولا يمكن ربط متطلبات أو أدلة جديدة به.' +
            (impact.openRequirements ? ' تنبيه: لديه ' + impact.openRequirements + ' متطلبات مفتوحة.' : ''),
        confirmLabel: inactive ? 'تفعيل المؤشر' : 'تعطيل المؤشر',
        danger: !inactive
      }).then(function (ok) {
        if (!ok) return;
        var res = A.setIndicatorActive(ctx.data, ind.id, inactive, ctx.env());
        if (!res.ok) { ctx.toast(res.message, 'error'); return; }
        ctx.save(inactive ? 'فُعّل المؤشر ' + ind.code + '.' : 'عُطّل المؤشر ' + ind.code + '.');
        ctx.rerender();
      });
    }

    var values = h('dl', { class: 'values' },
      h('div', null, h('dt', null, 'القيمة الحالية'), h('dd', null, B.dom.ltr(ind.currentValue, 'big'))),
      h('div', null, h('dt', null, 'قيمة ملف التقدم'), h('dd', null, B.dom.ltr(ind.progressFileValue, 'big'))),
      h('div', null, h('dt', null, 'العام الماضي (للمقارنة)'), h('dd', null, B.dom.ltr(ind.lastYearValue, 'big'))),
      h('div', null, h('dt', null, 'مصدر الرقم'), h('dd', null, ind.valueSource || h('span', { class: 'muted' }, 'غير مسجل'))));

    return h('div', null,
      U.backLink(B.app.buildHash('/rankings', { ranking: ind.ranking }), 'المؤشرات'),
      U.pageHeader(ind.name, null, [
        h('a', { href: '#/indicators/' + encodeURIComponent(ind.id) + '/edit', class: 'btn btn--primary' }, 'تعديل'),
        h('button', { type: 'button', class: inactive ? 'btn btn--secondary' : 'btn btn--ghost-danger', onclick: toggleActive }, inactive ? 'تفعيل المؤشر' : 'تعطيل المؤشر')
      ]),
      h('p', { class: 'meta-line' }, B.dom.ltr(ind.code, 'strong'), ' · ', U.rankingName(ind.ranking), ' ← ', ind.domain, ' · ', U.workBadge(ind.workStatus), inactive ? [' ', B.dom.badge('معطل', 'neutral')] : null),
      inactive ? h('div', { class: 'banner banner--warning', role: 'status' }, B.dom.icon('alert'), h('span', null, 'المؤشر معطل: خارج حسابات الجاهزية، ولا يُربط به جديد. بياناته محفوظة.')) : null,
      conflict ? h('div', { class: 'banner banner--danger', role: 'status' }, B.dom.icon('alert'),
        h('span', null, 'يختلف عن ملف التقدم: القيمة الحالية ', B.dom.ltr(ind.currentValue, 'strong'), ' وقيمة ملف التقدم ', B.dom.ltr(ind.progressFileValue, 'strong'), '. يُنصح بمراجعة المصدر أو تسجيل سؤال للمسؤول.')) : null,
      U.card('القيم', h('div', null, values, ind.notes ? h('p', { class: 'muted' }, 'ملاحظات: ', ind.notes) : null)),
      calcSection(ctx, ind),
      U.card('المتطلبات المرتبطة (' + reqs.length + ')', h('div', { class: 'stack' },
        reqs.length ? U.requirementsTable(ctx, reqs, 'متطلبات المؤشر') : B.dom.emptyState('لا توجد متطلبات لهذا المؤشر', null),
        inactive ? null : h('a', { href: '#/requirements/new?indicator=' + encodeURIComponent(ind.id), class: 'btn btn--secondary' }, B.dom.icon('plus'), 'إضافة متطلب لهذا المؤشر'))),
      U.card('الأدلة (' + evidence.length + ')', h('div', { class: 'stack' },
        evidence.length ? U.evidenceList(ctx, evidence) : h('p', { class: 'muted' }, 'لا أدلة مسجلة لهذا المؤشر.'),
        inactive ? null : h('a', { href: '#/evidence/new?indicator=' + encodeURIComponent(ind.id), class: 'btn btn--secondary' }, B.dom.icon('plus'), 'تسجيل دليل'))),
      U.card('الأسئلة والقرارات (' + questions.length + ')', h('div', { class: 'stack' },
        questions.length ? h('ul', { class: 'plain-list' }, questions.map(function (q) { return U.decisionItem(ctx, q, false); })) : h('p', { class: 'muted' }, 'لا توجد أسئلة لهذا المؤشر.'),
        h('a', { href: '#/decisions/new?indicator=' + encodeURIComponent(ind.id), class: 'btn btn--secondary' }, B.dom.icon('plus'), 'طرح سؤال على مسؤول'))));
  };

  // ---------- إضافة مؤشر ----------
  B.views.indicatorNew = function (ctx) {
    var d = ctx.data;
    var preRanking = ctx.query.get('ranking') || '';
    var domains = [];
    d.indicators.forEach(function (i) { if (domains.indexOf(i.domain) === -1) domains.push(i.domain); });
    var back = B.app.buildHash('/rankings', { ranking: preRanking });
    var form = h('form', { class: 'form card', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('div', { class: 'form-grid' },
        U.field({ id: 'n-ranking', name: 'ranking', label: 'التصنيف', required: true, control: U.selectControl('ranking', (d.rankings || []).map(function (r) { return { value: r.id, label: r.name }; }), preRanking, 'اختيار التصنيف') }),
        U.field({ id: 'n-domain', name: 'domain', label: 'المعيار', required: true, hint: 'مثل «التعليم والتعلم» أو «البحث العلمي».', control: h('input', { type: 'text', name: 'domain', class: 'input', list: 'domain-list', maxlength: '90', dir: 'auto' }) }),
        h('datalist', { id: 'domain-list' }, domains.map(function (x) { return h('option', { value: x }); })),
        U.field({ id: 'n-code', name: 'code', label: 'الرمز', required: true, hint: 'أحرف إنجليزية وأرقام وشرطة، مثل AR-RES-1.', control: h('input', { type: 'text', name: 'code', class: 'input', dir: 'ltr', maxlength: '20', autocomplete: 'off' }) }),
        U.field({ id: 'n-order', name: 'order', label: 'الترتيب', hint: 'اختياري. افتراضيًا بعد آخر مؤشر.', control: h('input', { type: 'number', name: 'order', class: 'input', min: '1', step: '1', dir: 'ltr' }) }),
        U.field({ id: 'n-name', name: 'name', label: 'اسم المؤشر', required: true, wide: true, control: h('input', { type: 'text', name: 'name', class: 'input', maxlength: '260', dir: 'auto' }) })),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'حفظ المؤشر'),
        h('a', { href: back, class: 'btn btn--ghost' }, 'إلغاء')));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var res = A.createIndicator(d, { ranking: f.ranking.value, domain: f.domain.value, code: f.code.value, name: f.name.value, order: f.order.value }, ctx.env());
      if (!U.handle(form, res, ctx)) return;
      ctx.save('أُضيف المؤشر.');
      ctx.go('#/indicators/' + encodeURIComponent(res.id));
    });
    return h('div', null, U.backLink(back, 'المؤشرات'), U.pageHeader('إضافة مؤشر', 'الحقول المعلَّمة بـ * إلزامية.'), form);
  };

  // ---------- تعديل المؤشر ----------
  B.views.indicatorEdit = function (ctx) {
    var ind = ctx.lookups.indicatorsById[ctx.params[0]];
    if (!ind) return U.notFoundState('المؤشر', '#/rankings', 'العودة إلى المؤشرات');
    var detail = '#/indicators/' + encodeURIComponent(ind.id);
    var valueInput = function (name, v) { return h('input', { type: 'text', name: name, class: 'input', dir: 'ltr', maxlength: '40', value: v || '', autocomplete: 'off' }); };
    var form = h('form', { class: 'form card', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('div', { class: 'form-grid' },
        U.field({ id: 'i-name', name: 'name', label: 'اسم المؤشر', required: true, wide: true, control: h('input', { type: 'text', name: 'name', class: 'input', maxlength: '260', dir: 'auto', value: ind.name }) }),
        U.field({ id: 'i-domain', name: 'domain', label: 'المعيار', required: true, control: h('input', { type: 'text', name: 'domain', class: 'input', maxlength: '90', dir: 'auto', value: ind.domain }) }),
        U.field({ id: 'i-work', name: 'workStatus', label: 'حالة العمل', required: true, control: U.selectControl('workStatus', U.optionsFromMap(M.WORK_STATUSES), ind.workStatus) }),
        U.field({ id: 'i-current', name: 'currentValue', label: 'القيمة الحالية', hint: 'نص قصير، مثل 120 أو 1:15 (حتى 30 حرفًا).', control: valueInput('currentValue', ind.currentValue) }),
        U.field({ id: 'i-progress', name: 'progressFileValue', label: 'قيمة ملف التقدم', control: valueInput('progressFileValue', ind.progressFileValue) }),
        U.field({ id: 'i-last', name: 'lastYearValue', label: 'قيمة العام الماضي', control: valueInput('lastYearValue', ind.lastYearValue) }),
        U.field({ id: 'i-source', name: 'valueSource', label: 'مصدر الرقم', hint: 'مطلوب لحالتي «محسوب بالأدلة» و«مُدخل في المنصة».', control: h('input', { type: 'text', name: 'valueSource', class: 'input', maxlength: '220', dir: 'auto', value: ind.valueSource || '' }) }),
        U.field({ id: 'i-notes', name: 'notes', label: 'ملاحظات', wide: true, control: h('textarea', { name: 'notes', class: 'input', rows: '3', maxlength: '1100', dir: 'auto' }, ind.notes || '') })),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'حفظ'),
        h('a', { href: detail, class: 'btn btn--ghost' }, 'إلغاء')));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var res = A.updateIndicator(ctx.data, ind.id, {
        name: f.name.value, domain: f.domain.value, workStatus: f.workStatus.value, currentValue: f.currentValue.value,
        progressFileValue: f.progressFileValue.value, lastYearValue: f.lastYearValue.value, valueSource: f.valueSource.value, notes: f.notes.value
      }, ctx.env());
      if (!U.handle(form, res, ctx)) return;
      ctx.save('حُفظت بيانات المؤشر ' + ind.code + '.');
      ctx.go(detail);
    });
    return h('div', null, U.backLink(detail, ind.code), U.pageHeader('تعديل المؤشر', ind.code), form);
  };
})(window);
