/*
 * التحليل التشغيلي — #/insights
 * كل ما في الصفحة يُحسب عند الرسم من ctx.data عبر js/insights.js (قواعد حسابية، لا ذكاء اصطناعي)،
 * فيتحدث تلقائيًا بعد أي تعديل محفوظ. الطريقة والحدود: docs/design/09-operational-engine.md.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var I = B.insights;
  var D = B.derive;
  var F = B.format;

  function alertsList(list) {
    if (!list.length) return h('p', { class: 'muted' }, 'لا توجد تنبيهات عاجلة اليوم.');
    return h('ul', { class: 'alerts' }, list.map(function (a) {
      return h('li', { class: 'alert alert--' + a.level },
        h('a', { href: a.href, class: 'alert__link' },
          B.dom.icon('alert'),
          h('span', { class: 'alert__main' },
            h('span', { class: 'alert__title' }, B.dom.badge(a.level === 'danger' ? 'عاجل' : 'تنبيه', a.level), ' ', a.title),
            h('span', { class: 'muted small' }, a.detail))));
    }));
  }

  function charts(ctx, c) {
    var statusRows = Object.keys(B.model.STATUSES).map(function (s) {
      return { label: B.model.STATUSES[s], value: c.byStatus[s] || 0, href: '#/requirements?status=' + s };
    });
    var dueHref = { overdue: '#/requirements?due=overdue', soon: '#/requirements?due=soon', done: '#/requirements?status=done' };
    var bucketRows = I.DUE_BUCKETS.map(function (b) {
      return { label: b.label, value: c.buckets[b.key], tone: b.key === 'overdue' ? 'danger' : b.key === 'done' ? 'success' : null, href: dueHref[b.key] };
    });
    var pctRow = function (label, p, href) { return { label: label, value: p.pct, text: p.pct === null ? 'لا متطلبات' : p.pct + '% (' + p.done + ' من ' + p.total + ')', href: href }; };
    return h('div', { class: 'grid grid--2 charts' },
      U.barChart('جاهزية المؤشرات حسب التصنيف', c.rankings.map(function (r) {
        return { label: r.name, value: r.readiness, text: r.readiness === null ? 'لا مؤشرات' : r.readiness + '% (مُدخل ' + r.entered + ' من ' + r.total + ')', href: '#/rankings?ranking=' + encodeURIComponent(r.id) };
      }), { max: 100, note: 'متوسط أوزان حالات العمل: لم يبدأ 0، مسودة ⅓، محسوب بالأدلة ⅔، مُدخل 1.' }),
      U.barChart('إنجاز المتطلبات حسب التصنيف', c.rankings.map(function (r) { return pctRow(r.name, r.progress, '#/requirements?ranking=' + encodeURIComponent(r.id)); }), { max: 100, note: 'المكتمل ÷ كل متطلبات المؤشرات المفعلة في التصنيف.' }),
      U.barChart('المتطلبات حسب الموعد', bucketRows, { note: 'العدد في كل فئة، من تاريخ اليوم ' + F.formatDate(ctx.today) + '.' }),
      U.barChart('المتطلبات حسب الحالة', statusRows),
      U.barChart('الإنجاز حسب الجهة', c.entities.map(function (e) {
        return pctRow(e.name, { pct: e.pct, done: e.done, total: e.total }, '#/entities/' + encodeURIComponent(e.id));
      }), { max: 100 }),
      U.barChart('الإنجاز حسب الأولوية', Object.keys(B.model.PRIORITIES).map(function (p) { return pctRow(B.model.PRIORITIES[p], c.byPriority[p], '#/requirements?priority=' + p); }), { max: 100 }));
  }

  function nextStepLink(ctx, r, step) {
    if (step.kind === 'letter') {
      return h('a', { href: '#/letters?entity=' + encodeURIComponent(r.entityId) + '&level=L' + step.level, class: 'btn btn--secondary btn--small' }, B.dom.icon('mail'), 'إعداد الخطاب');
    }
    if (step.kind === 'complete' || step.kind === 'assign' || step.kind === 'deadline') {
      return h('a', { href: '#/requirements/' + encodeURIComponent(r.id) + (step.kind === 'complete' ? '' : '/edit'), class: 'btn btn--secondary btn--small' }, 'فتح المتطلب');
    }
    if (step.kind === 'decision') return h('a', { href: '#/decisions/new?indicator=' + encodeURIComponent(r.indicatorId), class: 'btn btn--secondary btn--small' }, 'تسجيل سؤال القرار');
    return null;
  }

  function priorityList(ctx, ranked) {
    if (!ranked.length) return B.dom.emptyState('لا متطلبات مفتوحة', 'كل المتطلبات مكتملة، فلا ترتيب للأولويات.');
    return h('ol', { class: 'ranked' }, ranked.map(function (x) {
      var r = x.requirement;
      var ind = ctx.lookups.indicatorsById[r.indicatorId];
      var ent = ctx.lookups.entitiesById[r.entityId];
      var step = I.nextStep(r, ctx.data, ctx.today);
      return h('li', { class: 'ranked__item', 'data-req': r.id },
        h('div', { class: 'ranked__head' },
          h('span', { class: 'ranked__rank', 'aria-label': 'الترتيب ' + x.rank }, String(x.rank)),
          h('a', { href: '#/requirements/' + encodeURIComponent(r.id), class: 'ranked__title' }, r.title),
          h('span', { class: 'ranked__score', title: 'مجموع نقاط القواعد' }, 'الدرجة ', h('strong', null, String(x.score)))),
        h('p', { class: 'muted small' }, ind ? B.dom.ltr(ind.code) : '—', ' · ', ent ? ent.name : '—', ' · ', U.dueBadge(r, ctx.today), ' ', U.priorityBadge(r.priority)),
        h('p', { class: 'ranked__next' }, h('strong', null, 'الخطوة التالية: '), step.text, ' ', nextStepLink(ctx, r, step)),
        h('details', { class: 'details-toggle' },
          h('summary', null, 'لماذا هذه الدرجة؟'),
          x.factors.length ? h('ul', { class: 'factors' }, x.factors.map(function (f) {
            return h('li', null, h('span', null, f.label), h('span', { class: 'factors__pts' }, '+' + f.points));
          }), h('li', { class: 'factors__total' }, h('span', null, 'المجموع'), h('span', { class: 'factors__pts' }, String(x.score))))
            : h('p', { class: 'muted small' }, 'لم تنطبق أي قاعدة: موعده بعيد وأولويته منخفضة.')));
    }));
  }

  function incompleteList(ctx, list) {
    if (!list.length) return h('p', { class: 'muted' }, 'كل المتطلبات المفتوحة مستوفية لشروطها.');
    return h('ul', { class: 'plain-list' }, list.map(function (x) {
      var r = x.requirement;
      return h('li', null,
        h('a', { href: '#/requirements/' + encodeURIComponent(r.id), class: 'strong' }, r.title),
        h('span', { class: 'muted small' }, ' — مستوفٍ ' + x.check.met + ' من ' + x.check.total + ' شروط'),
        h('ul', { class: 'compact-list' }, x.check.unmet.map(function (c) {
          return h('li', null, B.dom.badge(c.group === 'blocking' ? 'يمنع الاكتمال' : 'جودة البيانات', c.group === 'blocking' ? 'danger' : 'warning'), ' ', c.fix);
        })));
    }));
  }

  function indicatorGapList(list) {
    if (!list.length) return h('p', { class: 'muted' }, 'لا مؤشرات تحتاج انتباهًا.');
    return h('ul', { class: 'plain-list' }, list.map(function (x) {
      return h('li', null,
        h('a', { href: '#/indicators/' + encodeURIComponent(x.indicator.id) }, B.dom.ltr(x.indicator.code, 'strong'), ' ', x.indicator.name),
        h('span', { class: 'muted small' }, ' — ', x.reasons.map(function (r) { return r.label; }).join('؛ ')));
    }));
  }

  // نتائج الحساب من الملفات المصدرية (أحدث نتيجة محفوظة من صفحة «مصادر البيانات والحساب»).
  function calcCard(ctx) {
    var fd = B.engine.findings(ctx.data);
    if (!fd) {
      return U.card('نتائج الحساب من الملفات', h('p', { class: 'muted' }, 'لم تُرفع ملفات مصدر بعد. ',
        h('a', { href: '#/calculate' }, 'مصادر البيانات والحساب'), ': رفع ملفات العمادات وحساب قيم المؤشرات منها.'), { id: 'calc-findings-title' });
    }
    var c = fd.counts;
    return U.card('نتائج الحساب من الملفات', h('div', { class: 'stack' },
      h('p', { class: 'small', id: 'calc-findings-summary' }, 'حُسب ' + c.computed + ' من ' + U.countIndicators(c.total) + ' · بانتظار الاعتماد ' + c.pending + ' · تعارض مع ملف التقدم ' + c.conflicts +
        ' · الملفات: ' + (fd.sources.map(function (s) { return s.fileName; }).join('، ') || '—') + ' · ' + B.format.formatDate(fd.at)),
      U.responsiveTable('نتائج الحساب', [
        { label: 'المؤشر', cls: 'col-main', cell: function (x) { return x.indicator ? h('a', { href: '#/indicators/' + encodeURIComponent(x.indicator.id) }, B.dom.ltr(x.code, 'strong'), ' ', x.indicator.name) : B.dom.ltr(x.code); } },
        { label: 'المحسوبة', cell: function (x) { return x.value === null ? h('span', { class: 'muted small' }, x.error) : B.dom.ltr(x.value, 'strong'); } },
        { label: 'الحالية', cell: function (x) { return B.dom.ltr(x.current || '—'); } },
        { label: 'ملف التقدم', cell: function (x) { return h('span', null, B.dom.ltr(x.progressFileValue || '—'), x.conflict ? [' ', B.dom.badge('تعارض', 'danger')] : null); } },
        { label: 'التقدم عن العام الماضي', cell: function (x) {
          return h('span', { class: 'stack-xs' }, h('span', null, x.yoy.label),
            x.lastYearValue ? h('span', { class: 'muted small' }, B.dom.ltr(x.lastYearValue), x.lastYearSource === 'file' ? ' · من ملف العام الماضي' : ' · مكتوبة في المؤشر') : null);
        } },
        { label: 'الحالة', cell: function (x) { return U.calcStatusBadge(x.status); } }
      ], fd.items, function (x) { return x.code; }),
      h('a', { href: '#/calculate', class: 'more-link' }, 'فتح مصادر البيانات والحساب', B.dom.icon('chevron'))), { id: 'calc-findings-title' });
  }

  function method() {
    var rows = [
      ['النواقص', 'لكل متطلب مفتوح: شرطا الاكتمال الرسميان (لا بيانات ناقصة، ورابط دليل)، وشروط جودة البيانات (مكلَّف، وموعد صالح قبل موعد تسليم التصنيف، وتواصل موثق إذا كان بانتظار الجهة أو متأخرًا).'],
      ['المتأخر', 'موعد المتطلب قبل تاريخ اليوم وحالته ليست «مكتمل».'],
      ['نسب الإنجاز', 'المكتمل ÷ الكل، مقربة لأقرب عدد صحيح. وجاهزية المؤشرات = متوسط أوزان حالات العمل.'],
      ['درجة الأولوية', 'متأخر 50 + أيام التأخر (حتى 30)؛ خلال 7 أيام 30 + 2 × الأيام الباقية حتى السابع؛ خلال 30 يومًا 10؛ لا موعد 20. الأولوية: عالية 20، متوسطة 10. بانتظار الجهة دون متابعة خلال 7 أيام 10. موعده بعد موعد التسليم 15. موعد تسليم التصنيف خلال 14 يومًا 10. حلّ موعد الإجراء التالي 10. التعادل يُحسم بقاعدة الإلحاح.'],
      ['التنبيهات', 'عاجل: متطلب متأخر، وتصنيف في خطر. تنبيه: موعد إجراء تالٍ حلّ، وأولوية عالية خلال 3 أيام، وتعارض قيم، وسؤال بلا قرار أكثر من 7 أيام.'],
      ['الخطوة التالية', 'أول قاعدة تنطبق: مكتمل ← لا شيء؛ الشرطان متحققان ← الإكمال؛ لا مكلَّف؛ لا موعد؛ مستوى تصعيد مستحق ← خطابه؛ وإلا انتظار المستوى التالي.'],
      ['سلّم التصعيد', 'L0 طلب رسمي دائمًا؛ L1 قبل الموعد بـ 3 أيام؛ L2 بعده بيوم؛ L3 بعده بـ 3 أيام؛ L4 بعده بـ 7 أيام. المنفذ = أعلى مستوى مسجل في المتابعات.']
    ];
    return h('details', { class: 'details-toggle method' },
      h('summary', null, 'طريقة الحساب وحدودها'),
      h('dl', { class: 'details' }, rows.map(function (r) { return h('div', null, h('dt', null, r[0]), h('dd', null, r[1])); })),
      h('p', { class: 'muted small' }, 'الحدود: القواعد لا تفهم نص الملاحظات ولا تتحقق من صحة القيم نفسها أو من محتوى روابط الأدلة؛ تعتمد كليًا على دقة ما يُسجَّل وعلى تاريخ اليوم. الأوزان والعتبات اختيار تشغيلي موثق وقابل للمراجعة، وليست من منهجية التصنيف.'));
  }

  B.views.insights = function (ctx) {
    var d = ctx.data;
    var al = I.alerts(d, ctx.today);
    var c = I.completion(d, ctx.today);
    var ranked = I.rankRequirements(d, ctx.today);
    var incomplete = I.incompleteRequirements(d, ctx.today);
    var gaps = I.indicatorGaps(d);
    var danger = al.filter(function (a) { return a.level === 'danger'; }).length;

    function exportCsv() {
      var text = B.csv.toCSV(I.PRIORITY_HEADERS, I.priorityRows(d, ctx.today));
      var name = 'basira-priorities-' + ctx.today + '.csv';
      ctx.download(name, text, 'text/csv;charset=utf-8');
      ctx.toast('نُزّل الملف: ' + name, 'success');
    }

    return h('div', { class: 'insights' },
      U.pageHeader('التحليل التشغيلي', 'يُحسب من بياناتك الحالية عند كل فتح للصفحة وبعد كل تعديل.', [
        h('button', { type: 'button', class: 'btn btn--secondary', onclick: exportCsv }, B.dom.icon('download'), 'تصدير الأولويات CSV'),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { root.print(); } }, B.dom.icon('printer'), 'طباعة')
      ]),
      U.rulesNotice(),
      d.isSample ? h('p', { class: 'muted small print-only' }, 'بيانات تجريبية وهمية · التاريخ: ' + F.formatDate(ctx.today)) : null,
      h('div', { class: 'kpis kpis--small', 'aria-label': 'ملخص' },
        h('div', { class: 'kpi kpi--danger', id: 'kpi-danger' }, h('span', { class: 'kpi__value' }, String(danger)), h('span', { class: 'kpi__label' }, 'تنبيهات عاجلة')),
        h('div', { class: 'kpi kpi--warning' }, h('span', { class: 'kpi__value' }, String(al.length - danger)), h('span', { class: 'kpi__label' }, 'تنبيهات أخرى')),
        h('div', { class: 'kpi', id: 'kpi-incomplete' }, h('span', { class: 'kpi__value' }, String(incomplete.length)), h('span', { class: 'kpi__label' }, 'متطلبات غير مستوفية')),
        h('div', { class: 'kpi', id: 'kpi-overall' }, h('span', { class: 'kpi__value' }, c.overall.pct === null ? '—' : c.overall.pct + '%'), h('span', { class: 'kpi__label' }, 'الإنجاز الكلي (' + c.overall.done + ' من ' + c.overall.total + ')'))),
      U.card('التنبيهات العاجلة (' + al.length + ')', alertsList(al), { id: 'alerts-title' }),
      calcCard(ctx),
      U.card('نسب الإنجاز من البيانات الفعلية', charts(ctx, c), { id: 'charts-title' }),
      U.card('ترتيب الأولويات مع التفسير', h('div', null,
        h('p', { class: 'muted small' }, 'الترتيب بمجموع نقاط القواعد المنطبقة، والأعلى أولًا. افتح «لماذا هذه الدرجة؟» لترى كل قاعدة ونقاطها.'),
        priorityList(ctx, ranked)), { id: 'priorities-title' }),
      h('div', { class: 'grid grid--2' },
        U.card('متطلبات غير مستوفية لشروطها (' + incomplete.length + ')', incompleteList(ctx, incomplete), { id: 'incomplete-title' }),
        U.card('مؤشرات تحتاج انتباهًا (' + gaps.length + ')', indicatorGapList(gaps), { id: 'gaps-title' })),
      U.card('طريقة الحساب', method(), { id: 'method-title' }));
  };
})(window);
