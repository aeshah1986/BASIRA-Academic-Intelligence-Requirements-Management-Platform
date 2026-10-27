/*
 * التقارير — #/reports (docs/design/01 §6): تقرير ما قبل الاجتماع وتقرير المتأخرات، مع الطباعة.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;

  // ---------- التقارير ----------
  function meetingReport(ctx, ranking) {
    var d = ctx.data;
    var indicators = D.activeIndicators(d.indicators.filter(function (i) { return i.ranking === ranking; })).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var rows = indicators.map(function (i) {
      var open = d.requirements.filter(function (r) { return r.indicatorId === i.id && r.status !== 'done'; });
      var questions = d.decisions.filter(function (q) { return q.indicatorId === i.id && q.status === 'open'; });
      return { i: i, open: open, questions: questions };
    });
    if (!rows.length) {
      return B.dom.emptyState('لا توجد مؤشرات لهذا التصنيف', 'لا يمكن إعداد تقرير الاجتماع قبل وجود مؤشرات.');
    }
    var pending = [];
    rows.forEach(function (x) { x.questions.forEach(function (q) { pending.push({ q: q, i: x.i }); }); });
    return h('div', { class: 'report' },
      h('h2', { class: 'report__title' }, 'تقرير ما قبل الاجتماع — ' + U.rankingName(ranking)),
      h('p', { class: 'muted small' }, 'التاريخ: ' + B.format.formatDate(ctx.today) + (d.isSample ? ' · بيانات تجريبية وهمية' : '')),
      U.responsiveTable('تقرير المؤشرات', [
        { label: 'المؤشر', cls: 'col-main', cell: function (x) { return h('span', null, B.dom.ltr(x.i.code, 'strong'), ' ', x.i.name); } },
        { label: 'حالة العمل', cell: function (x) { return U.workBadge(x.i.workStatus); } },
        { label: 'الحالية / ملف التقدم', cell: function (x) {
          return h('span', null, B.dom.ltr(x.i.currentValue), ' / ', B.dom.ltr(x.i.progressFileValue), D.hasValueConflict(x.i) ? h('span', null, ' ', B.dom.badge('تعارض', 'danger')) : null);
        } },
        { label: 'العام الماضي', cell: function (x) { return B.dom.ltr(x.i.lastYearValue); } },
        { label: 'المتطلبات المفتوحة', cell: function (x) {
          if (!x.open.length) return h('span', { class: 'muted' }, 'لا شيء');
          return h('ul', { class: 'compact-list' }, x.open.map(function (r) {
            var e = ctx.lookups.entitiesById[r.entityId];
            var info = D.dueInfo(r, ctx.today);
            return h('li', null, r.title, h('span', { class: 'muted small' }, ' (' + (e ? e.name : '—'), r.assignee ? ['، ', U.person(r.assignee)] : null, ')'), ' ', info.kind === 'overdue' ? B.dom.badge(info.short, 'danger') : null);
          }));
        } },
        { label: 'أسئلة مفتوحة', cell: function (x) { return String(x.questions.length); } }
      ], rows, function (x) { return x.i.id; }),
      h('h3', { class: 'report__subtitle' }, 'قرارات مطلوبة من المسؤولين'),
      pending.length ? h('ol', null, pending.map(function (x) { return h('li', null, B.dom.ltr(x.i.code, 'strong'), ': ', x.q.question, h('span', { class: 'muted small' }, ' (موجه إلى ' + x.q.askedTo + ')')); }))
        : h('p', { class: 'muted' }, 'لا توجد قرارات معلقة.'));
  }

  function overdueReport(ctx) {
    var list = ctx.data.requirements.filter(function (r) { return D.dueInfo(r, ctx.today).kind === 'overdue'; });
    list = D.sortByUrgency(list, ctx.today);
    return h('div', { class: 'report' },
      h('h2', { class: 'report__title' }, 'تقرير المتأخرات'),
      h('p', { class: 'muted small' }, 'التاريخ: ' + B.format.formatDate(ctx.today) + (ctx.data.isSample ? ' · بيانات تجريبية وهمية' : '')),
      list.length ? U.requirementsTable(ctx, list, 'المتطلبات المتأخرة') : B.dom.emptyState('لا توجد متطلبات متأخرة', null));
  }

  B.views.reports = function (ctx) {
    var type = ctx.query.get('type') === 'overdue' ? 'overdue' : 'meeting';
    var ranking = ctx.query.get('ranking') === 'QS' ? 'QS' : 'ARAB';
    var typeSel = U.selectControl('type', [{ value: 'meeting', label: 'تقرير ما قبل الاجتماع' }, { value: 'overdue', label: 'تقرير المتأخرات' }], type);
    var rankSel = U.selectControl('ranking', [{ value: 'ARAB', label: U.rankingName('ARAB') }, { value: 'QS', label: 'QS' }], ranking);
    var apply = function () { ctx.go(B.app.buildHash('/reports', { type: typeSel.value, ranking: typeSel.value === 'meeting' ? rankSel.value : '' })); };
    typeSel.addEventListener('change', apply);
    rankSel.addEventListener('change', apply);

    return h('div', null,
      U.pageHeader('التقارير', 'معاينة قابلة للطباعة.', h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { root.print(); } }, B.dom.icon('printer'), 'طباعة')),
      h('div', { class: 'filters filters--inline no-print' },
        U.field({ id: 'rep-type', name: 'type', label: 'نوع التقرير', control: typeSel }),
        type === 'meeting' ? U.field({ id: 'rep-ranking', name: 'ranking', label: 'التصنيف', control: rankSel }) : null),
      h('p', { class: 'muted small no-print' }, 'المؤشرات المعطلة لا تظهر في التقرير. تصدير CSV والتقرير الأسبوعي يُفعَّلان في المرحلة 6.'),
      U.card(null, type === 'meeting' ? meetingReport(ctx, ranking) : overdueReport(ctx)));
  };

})(window);
