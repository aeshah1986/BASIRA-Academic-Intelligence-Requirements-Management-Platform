/*
 * الأدلة الوصفية وحالة التحقق — #/evidence، و#/evidence/new، و#/evidence/:id، و#/evidence/:id/edit
 * (G6 في docs/design/08). يُسجَّل وصف الدليل ومكانه، لا الملف نفسه. كل تغيير عبر js/actions.js.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var M = B.model;
  var A = B.actions;

  B.views.evidenceList = function (ctx) {
    var d = ctx.data;
    var all = d.evidence || [];
    var status = M.isEnum(M.EVIDENCE_STATUSES, ctx.query.get('status')) ? ctx.query.get('status') : '';
    var list = all.filter(function (e) { return !status || e.status === status; });
    var counts = { pending: 0, verified: 0, rejected: 0 };
    all.forEach(function (e) { if (counts[e.status] !== undefined) counts[e.status]++; });

    var tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'حالة التحقق' },
      [{ v: '', l: 'الكل (' + all.length + ')' }].concat(Object.keys(M.EVIDENCE_STATUSES).map(function (k) { return { v: k, l: M.EVIDENCE_STATUSES[k] + ' (' + counts[k] + ')' }; }))
        .map(function (t) { return h('a', { href: B.app.buildHash('/evidence', { status: t.v }), role: 'tab', class: 'tab', 'aria-selected': String(t.v === status) }, t.l); }));

    var body = list.length ? U.responsiveTable('الأدلة', [
      { label: 'الدليل', cls: 'col-main', cell: function (e) { return h('a', { href: '#/evidence/' + encodeURIComponent(e.id), class: 'row-link' }, e.title); } },
      { label: 'المؤشر', cell: function (e) { var i = ctx.lookups.indicatorsById[e.indicatorId]; return i ? h('a', { href: '#/indicators/' + encodeURIComponent(i.id) }, B.dom.ltr(i.code)) : '—'; } },
      { label: 'المتطلب', cls: 'col-secondary', cell: function (e) { var r = e.requirementId ? ctx.lookups.requirementsById[e.requirementId] : null; return r ? r.title : '—'; } },
      { label: 'النوع', cell: function (e) { return M.EVIDENCE_TYPES[e.type] || e.type; } },
      { label: 'حالة التحقق', cell: function (e) { return U.evidenceBadge(e.status); } },
      { label: 'ملاحظة المراجعة', cls: 'col-secondary', cell: function (e) { return e.reviewNote || '—'; } }
    ], list, function (e) { return e.id; })
      : all.length ? B.dom.emptyState('لا أدلة بهذه الحالة', null, h('a', { href: '#/evidence', class: 'btn btn--secondary' }, 'عرض الكل'))
        : B.dom.emptyState('لا أدلة مسجلة بعد', 'يُسجَّل الدليل بوصفه ومكانه أو رابطه، ثم يُراجَع للتحقق.');

    return h('div', null,
      U.pageHeader('الأدلة', 'وصف كل دليل ومكانه، وحالة التحقق منه.',
        h('a', { href: '#/evidence/new', class: 'btn btn--primary' }, B.dom.icon('plus'), 'تسجيل دليل')),
      tabs, U.card(null, body));
  };

  B.views.evidenceItem = function (ctx) {
    var ev = (ctx.data.evidence || []).filter(function (e) { return e.id === ctx.params[0]; })[0];
    if (!ev) return U.notFoundState('الدليل', '#/evidence', 'العودة إلى الأدلة');
    var ind = ctx.lookups.indicatorsById[ev.indicatorId];
    var req = ev.requirementId ? ctx.lookups.requirementsById[ev.requirementId] : null;
    var refIsLink = M.isHttpUrl(ev.reference);

    function remove() {
      ctx.confirm({ title: 'حذف الدليل؟', body: 'سيُحذف سجل الدليل «' + ev.title + '» نهائيًا.', confirmLabel: 'تأكيد الحذف', danger: true }).then(function (ok) {
        if (!ok) return;
        var res = A.deleteEvidence(ctx.data, ev.id, ctx.env());
        if (!res.ok) { ctx.toast(res.message, 'error'); return; }
        ctx.save('حُذف الدليل.');
        ctx.go('#/evidence');
      });
    }

    var review = h('form', { class: 'form form--compact', novalidate: true },
      h('h3', { class: 'card__subtitle' }, 'نتيجة التحقق'),
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('div', { class: 'field', dataset: { field: 'result' } },
        h('span', { class: 'field__label', id: 'rv-result-label' }, 'النتيجة ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')),
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'rv-result-label' },
          h('label', { class: 'segmented__item' }, h('input', { type: 'radio', name: 'result', value: 'verified' }), h('span', null, 'متحقق منه')),
          h('label', { class: 'segmented__item' }, h('input', { type: 'radio', name: 'result', value: 'rejected' }), h('span', null, 'مرفوض'))),
        h('p', { class: 'field__error', id: 'rv-result-error', 'aria-live': 'polite' })),
      U.field({ id: 'rv-note', name: 'note', label: 'ملاحظة المراجعة', hint: 'إلزامية عند الرفض: سبب الرفض.', wide: true, control: h('textarea', { name: 'note', class: 'input', rows: '2', maxlength: '520', dir: 'auto' }) }),
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn--secondary' }, 'حفظ نتيجة التحقق')));
    review.addEventListener('submit', function (e) {
      e.preventDefault();
      var checked = review.querySelector('input[name="result"]:checked');
      var res = A.reviewEvidence(ctx.data, ev.id, { result: checked ? checked.value : '', note: review.elements.note.value }, ctx.env());
      if (!U.handle(review, res, ctx)) return;
      ctx.save(ev.status === 'verified' ? 'سُجل التحقق من الدليل.' : 'سُجل رفض الدليل.');
      ctx.rerender();
    });

    return h('div', null,
      U.backLink('#/evidence', 'الأدلة'),
      U.pageHeader(ev.title, null, [
        h('a', { href: '#/evidence/' + encodeURIComponent(ev.id) + '/edit', class: 'btn btn--primary' }, 'تعديل'),
        h('button', { type: 'button', class: 'btn btn--ghost-danger', onclick: remove }, 'حذف')
      ]),
      h('p', { class: 'meta-line' }, U.evidenceBadge(ev.status), ' ', B.dom.badge(M.EVIDENCE_TYPES[ev.type] || ev.type, 'neutral'),
        ev.reviewedOn ? ' · رُوجع في ' + B.format.formatDate(ev.reviewedOn) : ''),
      ev.status === 'rejected' ? h('div', { class: 'banner banner--danger', role: 'status' }, B.dom.icon('alert'), h('span', null, 'سبب الرفض: ' + (ev.reviewNote || '—'))) : null,
      h('div', { class: 'grid grid--main-side' },
        U.card('البيانات', h('dl', { class: 'details' },
          h('div', null, h('dt', null, 'المؤشر'), h('dd', null, ind ? h('a', { href: '#/indicators/' + encodeURIComponent(ind.id) }, B.dom.ltr(ind.code), ' · ', ind.name) : '—')),
          h('div', null, h('dt', null, 'المتطلب'), h('dd', null, req ? h('a', { href: '#/requirements/' + encodeURIComponent(req.id) }, req.title) : h('span', { class: 'muted' }, 'غير مرتبط بمتطلب'))),
          h('div', null, h('dt', null, 'المكان أو الرابط'), h('dd', null, refIsLink ? h('a', { href: ev.reference, target: '_blank', rel: 'noopener noreferrer' }, B.dom.ltr(ev.reference)) : ev.reference)),
          h('div', null, h('dt', null, 'ملاحظات'), h('dd', null, ev.notes || h('span', { class: 'muted' }, 'لا شيء'))),
          ev.reviewNote && ev.status !== 'rejected' ? h('div', null, h('dt', null, 'ملاحظة المراجعة'), h('dd', null, ev.reviewNote)) : null)),
        U.card('التحقق', review)));
  };

  B.views.evidenceForm = function (ctx) {
    var d = ctx.data;
    var editing = ctx.params.length ? (d.evidence || []).filter(function (e) { return e.id === ctx.params[0]; })[0] : null;
    if (ctx.params.length && !editing) return U.notFoundState('الدليل', '#/evidence', 'العودة إلى الأدلة');
    var preReq = ctx.lookups.requirementsById[ctx.query.get('requirement') || ''];
    var ev = editing || { indicatorId: preReq ? preReq.indicatorId : (ctx.query.get('indicator') || ''), requirementId: preReq ? preReq.id : '', title: '', type: '', reference: '', notes: '' };
    var back = editing ? '#/evidence/' + encodeURIComponent(editing.id) : preReq ? '#/requirements/' + encodeURIComponent(preReq.id) : ev.indicatorId ? '#/indicators/' + encodeURIComponent(ev.indicatorId) : '#/evidence';

    var keepId = editing ? editing.indicatorId : null;
    var indicatorSel = U.selectControl('indicatorId', U.indicatorOptions(d.indicators, '', { activeOnly: true, keepId: keepId }), ev.indicatorId, 'اختيار المؤشر');
    function requirementOptions(indicatorId) {
      return d.requirements.filter(function (r) { return r.indicatorId === indicatorId; }).map(function (r) { return { value: r.id, label: r.title }; });
    }
    var reqSel = U.selectControl('requirementId', requirementOptions(ev.indicatorId), ev.requirementId, 'بلا متطلب');
    indicatorSel.addEventListener('change', function () {
      var fresh = U.selectControl('requirementId', requirementOptions(indicatorSel.value), '', 'بلا متطلب');
      fresh.id = reqSel.id;
      fresh.setAttribute('aria-describedby', reqSel.getAttribute('aria-describedby'));
      reqSel.replaceWith(fresh);
      reqSel = fresh;
    });

    var form = h('form', { class: 'form card', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      editing && editing.status !== 'pending' ? h('p', { class: 'note' }, 'تنبيه: تغيير المؤشر أو المتطلب أو النوع أو المكان يعيد الدليل إلى «بانتظار التحقق».') : null,
      h('div', { class: 'form-grid' },
        U.field({ id: 'v-title', name: 'title', label: 'عنوان الدليل', required: true, wide: true, control: h('input', { type: 'text', name: 'title', class: 'input', maxlength: '210', value: ev.title, dir: 'auto' }) }),
        U.field({ id: 'v-indicator', name: 'indicatorId', label: 'المؤشر', required: true, control: indicatorSel }),
        U.field({ id: 'v-requirement', name: 'requirementId', label: 'المتطلب', hint: 'اختياري، ومن متطلبات المؤشر نفسه.', control: reqSel }),
        U.field({ id: 'v-type', name: 'type', label: 'نوع الدليل', required: true, control: U.selectControl('type', U.optionsFromMap(M.EVIDENCE_TYPES), ev.type, 'اختيار النوع') }),
        U.field({ id: 'v-reference', name: 'reference', label: 'المكان أو الرابط', required: true, hint: 'مكان حفظ الملف أو رقم الخطاب، أو رابط يبدأ بـ https:// لنوع «رابط».', control: h('input', { type: 'text', name: 'reference', class: 'input', maxlength: '310', value: ev.reference, dir: 'auto' }) }),
        U.field({ id: 'v-notes', name: 'notes', label: 'ملاحظات', wide: true, control: h('textarea', { name: 'notes', class: 'input', rows: '2', maxlength: '1100', dir: 'auto' }, ev.notes || '') })),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, editing ? 'حفظ التعديلات' : 'حفظ الدليل'),
        h('a', { href: back, class: 'btn btn--ghost' }, 'إلغاء')));

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var input = { indicatorId: indicatorSel.value, requirementId: reqSel.value, title: f.title.value, type: f.type.value, reference: f.reference.value, notes: f.notes.value };
      var res = editing ? A.updateEvidence(d, editing.id, input, ctx.env()) : A.createEvidence(d, input, ctx.env());
      if (!U.handle(form, res, ctx)) return;
      ctx.save(editing ? (res.info && res.info.resetToPending ? 'حُفظت التعديلات، وعاد الدليل إلى «بانتظار التحقق».' : 'حُفظت التعديلات.') : 'سُجل الدليل بانتظار التحقق.');
      ctx.go('#/evidence/' + encodeURIComponent(res.id));
    });
    return h('div', null, U.backLink(back, 'رجوع'), U.pageHeader(editing ? 'تعديل الدليل' : 'تسجيل دليل', 'يُسجَّل وصف الدليل ومكانه، لا الملف نفسه.'), form);
  };
})(window);
