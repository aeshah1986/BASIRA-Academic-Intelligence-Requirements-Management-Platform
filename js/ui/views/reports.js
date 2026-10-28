/*
 * التقارير — #/reports (docs/design/01 §6): تقرير ما قبل الاجتماع وتقرير المتأخرات، مع الطباعة.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;
  var I = B.insights;

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

  function reportHead(ctx, title) {
    return [h('h2', { class: 'report__title' }, title),
      h('p', { class: 'muted small' }, 'التاريخ: ' + B.format.formatDate(ctx.today) + (ctx.data.isSample ? ' · بيانات تجريبية وهمية' : '') + ' · محسوب بقواعد مكتوبة (لا ذكاء اصطناعي)')];
  }

  // تقرير الأولويات والخطوات التالية (js/insights.js).
  function prioritiesReport(ctx) {
    var ranked = I.rankRequirements(ctx.data, ctx.today);
    return h('div', { class: 'report' }, reportHead(ctx, 'تقرير الأولويات والخطوات التالية'),
      ranked.length ? U.responsiveTable('الأولويات', [
        { label: '#', cell: function (x) { return String(x.rank); } },
        { label: 'المتطلب', cls: 'col-main', cell: function (x) { return h('a', { href: '#/requirements/' + encodeURIComponent(x.requirement.id) }, x.requirement.title); } },
        { label: 'الجهة', cell: function (x) { var e = ctx.lookups.entitiesById[x.requirement.entityId]; return e ? e.name : '—'; } },
        { label: 'الموعد', cell: function (x) { return U.dueBadge(x.requirement, ctx.today); } },
        { label: 'الدرجة', cell: function (x) { return h('strong', null, String(x.score)); } },
        { label: 'أسباب الدرجة', cell: function (x) { return x.factors.length ? h('ul', { class: 'compact-list' }, x.factors.map(function (f) { return h('li', null, f.label + ' (+' + f.points + ')'); })) : '—'; } },
        { label: 'الخطوة التالية', cell: function (x) { return I.nextStep(x.requirement, ctx.data, ctx.today).text; } }
      ], ranked, function (x) { return x.requirement.id; }) : B.dom.emptyState('لا متطلبات مفتوحة', null));
  }

  // تقرير استجابة الجهات (docs/design/07 §4.4): أرقام محايدة دون ترتيب.
  function responseReport(ctx) {
    var rows = I.entityResponse(ctx.data, ctx.today);
    return h('div', { class: 'report' }, reportHead(ctx, 'تقرير استجابة الجهات'),
      h('p', { class: 'muted small' }, 'التسليم في الموعد = المكتمل في موعده أو قبله ÷ المكتمل. تاريخ الاكتمال = تاريخ آخر تحديث عند الإكمال. الجهات بترتيبها في القائمة دون مفاضلة.'),
      rows.length ? U.responsiveTable('استجابة الجهات', [
        { label: 'الجهة', cls: 'col-main', cell: function (x) { return h('a', { href: '#/entities/' + encodeURIComponent(x.id) }, x.name); } },
        { label: 'المتطلبات', cell: function (x) { return String(x.total); } },
        { label: 'المكتمل', cell: function (x) { return String(x.completed); } },
        { label: 'في الموعد', cell: function (x) { return x.onTimePct === null ? h('span', { class: 'muted' }, 'لا مكتمل بعد') : x.onTimePct + '% (' + x.onTime + ' من ' + x.completed + ')'; } },
        { label: 'متوسط أيام التأخر', cell: function (x) { return x.avgLateDays === null ? '—' : String(x.avgLateDays); } },
        { label: 'تصعيدات L3+', cell: function (x) { return String(x.escalations); } },
        { label: 'المفتوح / المتأخر الآن', cell: function (x) { return x.open + ' / ' + x.overdue; } }
      ], rows, function (x) { return x.id; }) : B.dom.emptyState('لا متطلبات لدى أي جهة', null));
  }

  // صفوف CSV لكل نوع تقرير (القيم نفسها المعروضة).
  function csvFor(ctx, type, ranking) {
    var d = ctx.data;
    if (type === 'priorities') return { headers: I.PRIORITY_HEADERS, rows: I.priorityRows(d, ctx.today) };
    if (type === 'response') return { headers: I.RESPONSE_HEADERS, rows: I.responseRows(d, ctx.today) };
    if (type === 'overdue') {
      return { headers: I.PRIORITY_HEADERS, rows: I.priorityRows(d, ctx.today, function (r) { return D.dueInfo(r, ctx.today).kind === 'overdue'; }) };
    }
    var inds = D.activeIndicators(d.indicators.filter(function (i) { return i.ranking === ranking; })).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    return {
      headers: ['رمز المؤشر', 'المؤشر', 'حالة العمل', 'القيمة الحالية', 'ملف التقدم', 'العام الماضي', 'تعارض', 'المتطلبات المفتوحة', 'أسئلة مفتوحة'],
      rows: inds.map(function (i) {
        return [i.code, i.name, B.model.WORK_STATUSES[i.workStatus] || i.workStatus, i.currentValue, i.progressFileValue, i.lastYearValue, D.hasValueConflict(i) ? 'نعم' : 'لا',
          d.requirements.filter(function (r) { return r.indicatorId === i.id && r.status !== 'done'; }).length,
          d.decisions.filter(function (q) { return q.indicatorId === i.id && q.status === 'open'; }).length];
      })
    };
  }

  var TYPES = [
    { value: 'meeting', label: 'تقرير ما قبل الاجتماع' },
    { value: 'overdue', label: 'تقرير المتأخرات' },
    { value: 'priorities', label: 'تقرير الأولويات والخطوات التالية' },
    { value: 'response', label: 'تقرير استجابة الجهات' }
  ];

  B.views.reports = function (ctx) {
    var type = ctx.query.get('type');
    if (!TYPES.some(function (t) { return t.value === type; })) type = 'meeting';
    var ranking = ctx.query.get('ranking') === 'QS' ? 'QS' : 'ARAB';
    var typeSel = U.selectControl('type', TYPES, type);
    var rankSel = U.selectControl('ranking', [{ value: 'ARAB', label: U.rankingName('ARAB') }, { value: 'QS', label: 'QS' }], ranking);
    var apply = function () { ctx.go(B.app.buildHash('/reports', { type: typeSel.value, ranking: typeSel.value === 'meeting' ? rankSel.value : '' })); };
    typeSel.addEventListener('change', apply);
    rankSel.addEventListener('change', apply);

    function exportCsv() {
      var c = csvFor(ctx, type, ranking);
      var name = 'basira-' + type + (type === 'meeting' ? '-' + ranking.toLowerCase() : '') + '-' + ctx.today + '.csv';
      ctx.download(name, B.csv.toCSV(c.headers, c.rows), 'text/csv;charset=utf-8');
      ctx.toast('نُزّل الملف: ' + name + ' (' + c.rows.length + ' صفًا)', 'success');
    }

    var body = type === 'meeting' ? meetingReport(ctx, ranking) : type === 'overdue' ? overdueReport(ctx) : type === 'priorities' ? prioritiesReport(ctx) : responseReport(ctx);
    return h('div', null,
      U.pageHeader('التقارير', 'معاينة قابلة للطباعة والتصدير.', [
        h('button', { type: 'button', class: 'btn btn--secondary', id: 'export-csv', onclick: exportCsv }, B.dom.icon('download'), 'تصدير CSV'),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { root.print(); } }, B.dom.icon('printer'), 'طباعة')]),
      h('div', { class: 'filters filters--inline no-print' },
        U.field({ id: 'rep-type', name: 'type', label: 'نوع التقرير', control: typeSel }),
        type === 'meeting' ? U.field({ id: 'rep-ranking', name: 'ranking', label: 'التصنيف', control: rankSel }) : null),
      h('p', { class: 'muted small no-print' }, 'المؤشرات المعطلة لا تظهر في التقرير. ملف CSV بترميز UTF-8 يفتح في Excel، والخلايا التي تبدأ بـ = أو + أو - أو @ تُسبق بعلامة \' للحماية من تنفيذها كصيغ.'),
      U.card(null, body));
  };

})(window);
