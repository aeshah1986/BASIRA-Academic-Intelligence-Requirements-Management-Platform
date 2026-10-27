/*
 * الجهات والمسؤوليات، والمتابعات، والتقارير، وسجل الأنشطة  (docs/design/01 §4–§7)
 * ما يعتمد على مراحل لاحقة لا يُعرض كزر بلا أثر، بل يُذكر صراحة في الصفحة.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;

  // ---------- الجهات ----------
  B.views.entities = function (ctx) {
    var d = ctx.data;
    var s = D.summaryByEntity(d.requirements, d.entities, ctx.today);
    var body = d.entities.length ? U.responsiveTable('الجهات', [
      { label: 'الجهة', cls: 'col-main', cell: function (e) { return h('a', { href: '#/entities/' + encodeURIComponent(e.id), class: 'row-link' }, e.name); } },
      { label: 'مفتوح', cell: function (e) { return String(s[e.id].open); } },
      { label: 'متأخر', cell: function (e) { return s[e.id].overdue ? B.dom.badge(String(s[e.id].overdue), 'danger') : '0'; } },
      { label: 'مكتمل', cell: function (e) { return String(s[e.id].done); } },
      { label: 'نسبة الإنجاز', cell: function (e) { return B.dom.ltr(s[e.id].pct === null ? '—' : s[e.id].pct + '%'); } },
      { label: 'المكلفون', cls: 'col-secondary', cell: function (e) { return s[e.id].assignees.length ? s[e.id].assignees.map(function (a, i) { return [i ? '، ' : null, U.person(a)]; }) : '—'; } }
    ], d.entities, function (e) { return e.id; }) : B.dom.emptyState('لا توجد جهات', 'تُضاف الجهات من البيانات التجريبية أو النسخة الاحتياطية حاليًا.');

    return h('div', null,
      U.pageHeader('الجهات والمسؤوليات', 'عبء كل جهة ومكلَّفيها وتأخرها.'),
      h('p', { class: 'note' }, 'إضافة الجهات وتعديلها تُفعَّل في المرحلة 4، والقائمة الآن للعرض.'),
      U.card(null, body));
  };

  B.views.entity = function (ctx) {
    var e = ctx.lookups.entitiesById[ctx.params[0]];
    if (!e) return U.notFoundState('الجهة', '#/entities', 'العودة إلى الجهات');
    var reqs = D.sortByUrgency(ctx.data.requirements.filter(function (r) { return r.entityId === e.id; }), ctx.today);
    var s = D.summaryByEntity(ctx.data.requirements, [e], ctx.today)[e.id];
    return h('div', null,
      U.backLink('#/entities', 'الجهات'),
      U.pageHeader(e.name, null, h('a', { href: '#/requirements?entity=' + encodeURIComponent(e.id), class: 'btn btn--secondary' }, 'عرض متطلباتها في القائمة')),
      h('div', { class: 'kpis kpis--small' },
        h('div', { class: 'kpi' }, h('span', { class: 'kpi__value' }, String(s.open)), h('span', { class: 'kpi__label' }, 'مفتوح')),
        h('div', { class: 'kpi kpi--danger' }, h('span', { class: 'kpi__value' }, String(s.overdue)), h('span', { class: 'kpi__label' }, 'متأخر')),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi__value' }, String(s.done)), h('span', { class: 'kpi__label' }, 'مكتمل')),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi__value' }, B.dom.ltr(s.pct === null ? '—' : s.pct + '%')), h('span', { class: 'kpi__label' }, 'نسبة الإنجاز'))),
      U.card('متطلبات الجهة (' + reqs.length + ')', reqs.length ? U.requirementsTable(ctx, reqs, 'متطلبات الجهة') : B.dom.emptyState('لا توجد متطلبات لهذه الجهة', null)));
  };

  // ---------- المتابعات ----------
  B.views.followups = function (ctx) {
    var tab = ctx.query.get('tab') === 'decisions' ? 'decisions' : 'all';
    var tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'أقسام المتابعات' },
      h('a', { href: '#/followups', role: 'tab', class: 'tab', 'aria-selected': String(tab === 'all') }, 'كل المتابعات'),
      h('a', { href: '#/followups?tab=decisions', role: 'tab', class: 'tab', 'aria-selected': String(tab === 'decisions') }, 'الأسئلة والقرارات'));

    var content;
    if (tab === 'all') {
      var items = [];
      ctx.data.requirements.forEach(function (r) { (r.followUps || []).forEach(function (f) { items.push({ f: f, r: r }); }); });
      items.sort(function (a, b) { return a.f.date < b.f.date ? 1 : a.f.date > b.f.date ? -1 : 0; });
      content = items.length ? h('ol', { class: 'timeline' }, items.map(function (x) {
        var ent = ctx.lookups.entitiesById[x.r.entityId];
        return h('li', null,
          h('p', { class: 'timeline__head' }, h('span', { class: 'strong' }, B.format.formatDate(x.f.date)),
            x.f.type ? B.dom.badge((U.FOLLOWUP_TYPES || {})[x.f.type] || x.f.type, 'neutral') : null),
          h('p', null, x.f.note),
          h('p', { class: 'muted small' }, h('a', { href: '#/requirements/' + encodeURIComponent(x.r.id) }, x.r.title), ent ? ' · ' + ent.name : ''));
      })) : B.dom.emptyState('لا توجد متابعات بعد', 'تُضاف المتابعة من صفحة المتطلب.', h('a', { href: '#/requirements', class: 'btn btn--secondary' }, 'فتح المتطلبات'));
      content = h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'تُضاف المتابعة من صفحة المتطلب المعني. تبويب «مستحقة الآن» وسلّم التصعيد يُفعَّلان في المرحلة 6.'), U.card(null, content));
    } else {
      var list = ctx.data.decisions.slice().sort(function (a, b) { return a.status === b.status ? (a.askedOn < b.askedOn ? 1 : -1) : a.status === 'open' ? -1 : 1; });
      content = list.length ? U.responsiveTable('الأسئلة والقرارات', [
        { label: 'السؤال', cls: 'col-main', cell: function (q) { return h('span', { class: 'strong' }, q.question); } },
        { label: 'المؤشر', cell: function (q) { var i = ctx.lookups.indicatorsById[q.indicatorId]; return i ? h('a', { href: '#/indicators/' + encodeURIComponent(i.id) }, B.dom.ltr(i.code)) : '—'; } },
        { label: 'موجه إلى', cell: function (q) { return q.askedTo; } },
        { label: 'تاريخ الطرح', cell: function (q) { return B.format.formatDate(q.askedOn); } },
        { label: 'الحالة', cell: function (q) {
          if (q.status !== 'open') return B.dom.badge('محسوم', 'success');
          var age = B.format.daysBetween(q.askedOn, ctx.today);
          return h('span', { class: 'stack-xs' }, B.dom.badge('مفتوح', 'warning'), age > 0 ? h('span', { class: 'muted small' }, 'منذ ' + B.format.dayCount(age)) : null);
        } },
        { label: 'القرار', cell: function (q) { return q.decision || h('span', { class: 'muted' }, '—'); } }
      ], list, function (q) { return q.id; }) : B.dom.emptyState('لا توجد أسئلة', null);
      content = h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'إضافة الأسئلة وتسجيل القرارات تُفعَّل في المرحلة 4، والقائمة الآن للعرض.'), U.card(null, content));
    }
    return h('div', null, U.pageHeader('المتابعات', 'ماذا طُلب ومتى، وما ينتظر قرارًا.'), tabs, content);
  };

  // ---------- التقارير ----------
  function meetingReport(ctx, ranking) {
    var d = ctx.data;
    var indicators = d.indicators.filter(function (i) { return i.ranking === ranking; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
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
      h('p', { class: 'muted small no-print' }, 'تصدير CSV والتقرير الأسبوعي وحسب الجهة تُفعَّل في المرحلة 6.'),
      U.card(null, type === 'meeting' ? meetingReport(ctx, ranking) : overdueReport(ctx)));
  };

  // ---------- سجل الأنشطة ----------
  B.views.activity = function (ctx) {
    var list = ctx.data.activities || [];
    return h('div', null,
      U.pageHeader('سجل الأنشطة', 'ماذا تغيّر ومتى.'),
      list.length ? U.card(null, h('ol', { class: 'timeline' }, list.map(function (a) {
        return h('li', null, h('p', { class: 'muted small' }, a.at), h('p', null, a.summary));
      }))) : B.dom.emptyState('لا توجد أنشطة مسجلة بعد',
        'التسجيل التلقائي للأنشطة (الإضافة، والتعديل، والحذف، والاستيراد) يُفعَّل في المرحلة 4، فالصفحة فارغة الآن عمدًا وليست معطلة.'));
  };
})(window);
