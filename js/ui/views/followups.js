/*
 * المتابعات والقرارات — #/followups (تبويبات: مستحقة الآن، كل المتابعات، الأسئلة والقرارات)،
 * و#/decisions/new، و#/decisions/:id/resolve  (docs/design/01 §5). كل تغيير عبر js/actions.js.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;
  var M = B.model;
  var A = B.actions;

  function followUpRow(ctx, r, f, extra) {
    var ent = ctx.lookups.entitiesById[r.entityId];
    return h('li', null,
      h('p', { class: 'timeline__head' }, h('span', { class: 'strong' }, B.format.formatDate(f.date)),
        f.type ? B.dom.badge(M.FOLLOWUP_TYPES[f.type] || f.type, 'neutral') : null, U.outcomeBadge(f.outcome), extra || null),
      h('p', null, f.note),
      h('p', { class: 'muted small' }, h('a', { href: '#/requirements/' + encodeURIComponent(r.id) }, r.title), ent ? ' · ' + ent.name : '',
        f.nextActionDate ? ' · الإجراء التالي: ' + B.format.formatDate(f.nextActionDate) : ''));
  }

  B.views.followups = function (ctx) {
    var tab = ['due', 'all', 'decisions'].indexOf(ctx.query.get('tab')) >= 0 ? ctx.query.get('tab') : 'due';
    var due = D.dueFollowUps(ctx.data.requirements, ctx.today);
    var openQ = ctx.data.decisions.filter(function (q) { return q.status === 'open'; }).length;
    var tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'أقسام المتابعات' },
      h('a', { href: '#/followups?tab=due', role: 'tab', class: 'tab', 'aria-selected': String(tab === 'due') }, 'مستحقة الآن (' + due.length + ')'),
      h('a', { href: '#/followups?tab=all', role: 'tab', class: 'tab', 'aria-selected': String(tab === 'all') }, 'كل المتابعات'),
      h('a', { href: '#/followups?tab=decisions', role: 'tab', class: 'tab', 'aria-selected': String(tab === 'decisions') }, 'الأسئلة والقرارات (' + openQ + ' مفتوحة)'));

    var content;
    if (tab === 'due') {
      content = due.length ? h('ol', { class: 'timeline' }, due.map(function (x) {
        return followUpRow(ctx, x.requirement, x.followUp, B.dom.badge(x.daysLate > 0 ? 'مستحق منذ ' + B.format.dayCount(x.daysLate) : 'مستحق اليوم', 'warning'));
      })) : B.dom.emptyState('لا متابعات مستحقة الآن', 'تظهر هنا المتطلبات التي حلّ موعد الإجراء التالي في آخر متابعة لها.');
      content = h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'المتطلبات غير المكتملة التي حلّ موعد الإجراء التالي في آخر متابعة لها. تُسجَّل المتابعة الجديدة من صفحة المتطلب.'), U.card(null, content));
    } else if (tab === 'all') {
      var items = [];
      ctx.data.requirements.forEach(function (r) { (r.followUps || []).forEach(function (f) { items.push({ f: f, r: r }); }); });
      items.sort(function (a, b) { return a.f.date < b.f.date ? 1 : a.f.date > b.f.date ? -1 : 0; });
      content = items.length ? h('ol', { class: 'timeline' }, items.map(function (x) { return followUpRow(ctx, x.r, x.f); }))
        : B.dom.emptyState('لا توجد متابعات بعد', 'تُضاف المتابعة من صفحة المتطلب.', h('a', { href: '#/requirements', class: 'btn btn--secondary' }, 'فتح المتطلبات'));
      content = h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'تُضاف المتابعة من صفحة المتطلب المعني.'), U.card(null, content));
    } else {
      var list = ctx.data.decisions.slice().sort(function (a, b) { return a.status === b.status ? (a.askedOn < b.askedOn ? 1 : -1) : a.status === 'open' ? -1 : 1; });
      content = h('div', { class: 'stack' },
        h('div', null, h('a', { href: '#/decisions/new', class: 'btn btn--primary' }, B.dom.icon('plus'), 'طرح سؤال على مسؤول')),
        U.card(null, list.length ? h('ul', { class: 'plain-list' }, list.map(function (q) { return U.decisionItem(ctx, q, true); }))
          : B.dom.emptyState('لا توجد أسئلة', null)));
    }
    return h('div', null, U.pageHeader('المتابعات', 'ماذا طُلب ومتى، وما المستحق الآن، وما ينتظر قرارًا.'), tabs, content);
  };

  B.views.decisionForm = function (ctx) {
    var d = ctx.data;
    var pre = ctx.query.get('indicator') || '';
    var back = pre && ctx.lookups.indicatorsById[pre] ? '#/indicators/' + encodeURIComponent(pre) : '#/followups?tab=decisions';
    var form = h('form', { class: 'form card', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('div', { class: 'form-grid' },
        U.field({ id: 'q-indicator', name: 'indicatorId', label: 'المؤشر', required: true, control: U.selectControl('indicatorId', U.indicatorOptions(d.indicators), pre, 'اختيار المؤشر') }),
        U.field({ id: 'q-asked-to', name: 'askedTo', label: 'الموجه إليه (وصف وظيفي)', required: true, hint: 'مثل «وكيل الجامعة للشؤون التعليمية». دون بريد أو هاتف.', control: h('input', { type: 'text', name: 'askedTo', class: 'input', maxlength: '110', dir: 'auto' }) }),
        U.field({ id: 'q-asked-on', name: 'askedOn', label: 'تاريخ الطرح', required: true, control: h('input', { type: 'date', name: 'askedOn', class: 'input', value: ctx.today, max: ctx.today }) }),
        U.field({ id: 'q-question', name: 'question', label: 'السؤال', required: true, wide: true, control: h('textarea', { name: 'question', class: 'input', rows: '3', maxlength: '520', dir: 'auto' }) })),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'حفظ السؤال'),
        h('a', { href: back, class: 'btn btn--ghost' }, 'إلغاء')));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var res = A.addDecision(d, { indicatorId: f.indicatorId.value, question: f.question.value, askedTo: f.askedTo.value, askedOn: f.askedOn.value }, ctx.env());
      if (!U.handle(form, res, ctx)) return;
      ctx.save('حُفظ السؤال.');
      ctx.go('#/followups?tab=decisions');
    });
    return h('div', null, U.backLink(back, 'رجوع'), U.pageHeader('طرح سؤال على مسؤول', 'يُسجَّل السؤال مفتوحًا حتى يُسجَّل القرار.'), form);
  };

  B.views.decisionResolve = function (ctx) {
    var q = ctx.data.decisions.filter(function (x) { return x.id === ctx.params[0]; })[0];
    if (!q) return U.notFoundState('السؤال', '#/followups?tab=decisions', 'العودة إلى الأسئلة');
    var back = '#/followups?tab=decisions';
    if (q.status === 'resolved') {
      return h('div', null, U.backLink(back, 'الأسئلة'), U.pageHeader('السؤال محسوم', q.question),
        U.card(null, h('p', null, 'القرار (' + B.format.formatDate(q.decidedOn) + '): ', q.decision)));
    }
    var form = h('form', { class: 'form card', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('p', { class: 'strong' }, q.question),
      h('p', { class: 'muted small' }, 'موجه إلى: ' + q.askedTo + ' · طُرح في ' + B.format.formatDate(q.askedOn)),
      h('div', { class: 'form-grid' },
        U.field({ id: 'd-date', name: 'decidedOn', label: 'تاريخ القرار', required: true, control: h('input', { type: 'date', name: 'decidedOn', class: 'input', value: ctx.today, min: q.askedOn, max: ctx.today }) }),
        U.field({ id: 'd-text', name: 'decision', label: 'نص القرار', required: true, wide: true, control: h('textarea', { name: 'decision', class: 'input', rows: '3', maxlength: '1100', dir: 'auto' }) })),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'تسجيل القرار'),
        h('a', { href: back, class: 'btn btn--ghost' }, 'إلغاء')));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var res = A.resolveDecision(ctx.data, q.id, { decision: form.elements.decision.value, decidedOn: form.elements.decidedOn.value }, ctx.env());
      if (!U.handle(form, res, ctx)) return;
      ctx.save('سُجل القرار.');
      ctx.go(back);
    });
    return h('div', null, U.backLink(back, 'الأسئلة'), U.pageHeader('تسجيل القرار'), form);
  };
})(window);
