/*
 * لوحة القيادة — #/dashboard  (docs/design/01 §1)
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;

  function rankingCard(ctx, code) {
    var st = D.rankingStatus(ctx.data, code, ctx.today);
    return h('a', { href: '#/rankings?ranking=' + code, class: 'card card--link rank-card' },
      h('div', { class: 'rank-card__head' },
        h('h2', { class: 'card__title' }, U.rankingName(code)),
        st.risk ? B.dom.badge('في خطر', 'danger') : st.deadline ? B.dom.badge('على المسار', 'success') : null),
      h('p', { class: 'muted small' }, 'موعد التسليم: ' + (st.deadline ? B.format.formatDate(st.deadline) : 'لم يُحدد بعد')),
      st.days !== null ? h('p', { class: 'big' }, st.days >= 0 ? 'متبقٍ ' + B.format.dayCount(st.days) : 'انتهى الموعد') : null,
      h('p', { class: 'rank-card__entered' }, 'مُدخل في المنصة: ' + st.entered + ' من ' + st.total),
      B.dom.progress('جاهزية المؤشرات', st.readiness),
      B.dom.progress('إنجاز المتطلبات', st.progress.pct),
      st.risk ? h('p', { class: 'rank-card__reason' }, B.dom.icon('alert'), st.reasons.join(' · ')) : null);
  }

  function kpi(value, label, href, tone) {
    return h('a', { href: href, class: 'kpi' + (tone ? ' kpi--' + tone : '') },
      h('span', { class: 'kpi__value' }, String(value)),
      h('span', { class: 'kpi__label' }, label));
  }

  function attentionList(ctx) {
    var open = ctx.data.requirements.filter(D.isOpen);
    var top = D.sortByUrgency(open, ctx.today).slice(0, 5);
    if (!top.length) return B.dom.emptyState('لا يوجد ما يحتاج انتباهك', 'كل المتطلبات مكتملة.');
    return h('ul', { class: 'attention' }, top.map(function (r) {
      var ind = ctx.lookups.indicatorsById[r.indicatorId];
      var ent = ctx.lookups.entitiesById[r.entityId];
      return h('li', null, h('a', { href: '#/requirements/' + encodeURIComponent(r.id), class: 'attention__item' },
        h('span', { class: 'attention__main' },
          h('span', { class: 'attention__title' }, r.title),
          h('span', { class: 'muted small' }, ind ? B.dom.ltr(ind.code) : '—', ' · ', ent ? ent.name : '—', r.assignee ? [' · ', U.person(r.assignee)] : null)),
        h('span', { class: 'attention__badges' }, U.dueBadge(r, ctx.today), U.priorityBadge(r.priority))));
    }));
  }

  function conflictsList(ctx) {
    var list = ctx.data.indicators.filter(D.hasValueConflict);
    if (!list.length) return h('p', { class: 'muted' }, 'لا توجد تعارضات بين القيم الحالية وملف التقدم.');
    return h('ul', { class: 'plain-list' }, list.map(function (i) {
      return h('li', null, h('a', { href: '#/indicators/' + encodeURIComponent(i.id), class: 'conflict' },
        h('span', { class: 'conflict__head' }, B.dom.ltr(i.code, 'strong'), B.dom.badge('تعارض', 'danger')),
        h('span', { class: 'muted small' }, i.name),
        h('span', { class: 'conflict__values' },
          'الحالية ', B.dom.ltr(i.currentValue, 'strong'), ' · ملف التقدم ', B.dom.ltr(i.progressFileValue, 'strong'),
          i.lastYearValue ? h('span', { class: 'muted' }, ' · العام الماضي ', B.dom.ltr(i.lastYearValue)) : null)));
    }));
  }

  function questionsList(ctx) {
    var open = ctx.data.decisions.filter(function (q) { return q.status === 'open'; });
    if (!open.length) return h('p', { class: 'muted' }, 'لا توجد أسئلة مفتوحة.');
    return h('ul', { class: 'plain-list' }, open.slice(0, 3).map(function (q) {
      var ind = ctx.lookups.indicatorsById[q.indicatorId];
      var age = B.format.daysBetween(q.askedOn, ctx.today);
      return h('li', null,
        h('p', { class: 'strong' }, q.question),
        h('p', { class: 'muted small' }, ind ? B.dom.ltr(ind.code) : '—', ' · ', q.askedTo, age !== null && age > 0 ? ' · مفتوح منذ ' + B.format.dayCount(age) : ''));
    }));
  }

  function byEntity(ctx) {
    var summary = D.summaryByEntity(ctx.data.requirements, ctx.data.entities, ctx.today);
    var rows = ctx.data.entities.filter(function (e) { return summary[e.id].open > 0; })
      .sort(function (a, b) { return summary[b.id].overdue - summary[a.id].overdue || summary[b.id].open - summary[a.id].open; });
    if (!rows.length) return h('p', { class: 'muted' }, 'لا توجد متطلبات مفتوحة لدى أي جهة.');
    var max = Math.max.apply(null, rows.map(function (e) { return summary[e.id].open; }));
    return h('ul', { class: 'entity-bars' }, rows.map(function (e) {
      var s = summary[e.id];
      return h('li', null, h('a', { href: '#/entities/' + encodeURIComponent(e.id), class: 'entity-bars__row' },
        h('span', { class: 'entity-bars__name' }, e.name),
        h('span', { class: 'entity-bars__track', 'aria-hidden': 'true' },
          h('span', { class: 'entity-bars__open', style: 'inline-size:' + Math.round(100 * s.open / max) + '%' },
            s.overdue ? h('span', { class: 'entity-bars__overdue', style: 'inline-size:' + Math.round(100 * s.overdue / s.open) + '%' }) : null)),
        h('span', { class: 'entity-bars__text small' }, s.open + ' مفتوح · ' + s.overdue + ' متأخر')));
    }), h('li', { class: 'muted small' }, 'طول الشريط = المفتوح، والجزء الأحمر = المتأخر'));
  }

  // أهم التنبيهات العاجلة من محرك التحليل (قواعد حسابية)، مع رابط إلى التحليل الكامل.
  function alertsCard(ctx) {
    var list = B.insights.alerts(ctx.data, ctx.today);
    if (!list.length) return null;
    var danger = list.filter(function (a) { return a.level === 'danger'; }).length;
    return h('section', { class: 'card alerts-card', 'aria-labelledby': 'dash-alerts-title' },
      h('div', { class: 'alerts-card__head' },
        h('h2', { id: 'dash-alerts-title', class: 'card__title' }, B.dom.icon('alert'), 'تنبيهات عاجلة: ' + danger + ' عاجل، و' + (list.length - danger) + ' للمتابعة'),
        h('a', { href: '#/insights', class: 'more-link' }, 'التحليل التشغيلي', B.dom.icon('chevron'))),
      h('ul', { class: 'alerts alerts--compact' }, list.slice(0, 3).map(function (a) {
        return h('li', { class: 'alert alert--' + a.level }, h('a', { href: a.href, class: 'alert__link' },
          h('span', { class: 'alert__main' }, h('span', { class: 'alert__title' }, B.dom.badge(a.level === 'danger' ? 'عاجل' : 'تنبيه', a.level), ' ', a.title), h('span', { class: 'muted small' }, a.detail))));
      })));
  }

  // ملخص ملفات المصدر والحساب منها (أحدث نتيجة محفوظة).
  function sourcesCard(ctx) {
    var fd = B.engine.findings(ctx.data);
    if (!fd) {
      return h('section', { class: 'card sources-card', 'aria-labelledby': 'dash-sources-title' },
        h('h2', { id: 'dash-sources-title', class: 'card__title' }, B.dom.icon('database'), 'ملفات المصدر'),
        h('p', { class: 'muted small' }, 'لم تُرفع ملفات بعد. ', h('a', { href: '#/calculate' }, 'رفع ملفات العمادات وحساب المؤشرات منها')));
    }
    var c = fd.counts;
    return h('section', { class: 'card sources-card', 'aria-labelledby': 'dash-sources-title' },
      h('h2', { id: 'dash-sources-title', class: 'card__title' }, B.dom.icon('database'), 'ملفات المصدر'),
      h('p', { class: 'small', id: 'dash-sources-summary' }, fd.sources.length + ' ملفات · حُسب ' + c.computed + ' من ' + U.countIndicators(c.total) + ' · ',
        c.pending ? B.dom.badge('بانتظار الاعتماد ' + c.pending, 'warning') : B.dom.badge('لا قيم بانتظار الاعتماد', 'success'), ' ',
        c.conflicts ? B.dom.badge('تعارض ' + c.conflicts, 'danger') : null, c.quality ? [' ', B.dom.badge('ملاحظات جودة ' + c.quality, 'warning')] : null),
      h('a', { href: '#/calculate', class: 'more-link' }, 'مصادر البيانات والحساب', B.dom.icon('chevron')));
  }

  B.views.dashboard = function (ctx) {
    var d = ctx.data;
    var open = d.requirements.filter(D.isOpen);
    var overdue = open.filter(function (r) { return D.dueInfo(r, ctx.today).kind === 'overdue'; }).length;
    var soon = open.filter(function (r) { return D.dueInfo(r, ctx.today).kind === 'soon'; }).length;
    var conflicts = d.indicators.filter(D.hasValueConflict).length;
    var questions = d.decisions.filter(function (q) { return q.status === 'open'; }).length;
    var rankings = ['ARAB', 'QS'].filter(function (code) { return d.indicators.some(function (i) { return i.ranking === code; }); });

    if (!d.requirements.length && !d.indicators.length) {
      return h('div', null, U.pageHeader('لوحة القيادة'),
        B.dom.emptyState('لا توجد بيانات بعد', 'يمكن البدء بإضافة متطلب، أو استيراد نسخة احتياطية من زر «البيانات».',
          h('a', { href: '#/requirements/new', class: 'btn btn--primary' }, B.dom.icon('plus'), 'إضافة متطلب')));
    }

    return h('div', { class: 'dashboard' },
      U.pageHeader('لوحة القيادة', 'ما الذي يحتاج انتباهك اليوم؟',
        h('a', { href: '#/requirements/new', class: 'btn btn--primary' }, B.dom.icon('plus'), 'إضافة متطلب')),
      alertsCard(ctx),
      h('div', { class: 'grid grid--2' }, rankings.map(function (code) { return rankingCard(ctx, code); })),
      h('nav', { class: 'kpis', 'aria-label': 'مؤشرات رقمية' },
        kpi(open.length, 'متطلبات مفتوحة', '#/requirements?status=open', null),
        kpi(overdue, 'متأخرة', '#/requirements?due=overdue', 'danger'),
        kpi(soon, 'قريبة الموعد (7 أيام)', '#/requirements?due=soon', 'warning'),
        kpi(conflicts, 'تعارضات قيم', '#/rankings?conflict=1', null),
        kpi(questions, 'أسئلة مفتوحة', '#/followups?tab=decisions', null)),
      h('div', { class: 'grid grid--main-side' },
        U.card('يحتاج انتباهك', h('div', null,
          h('p', { class: 'muted small' }, 'مرتبة بالإلحاح: المتأخر أولًا، ثم القريب، ثم الأولوية.'),
          attentionList(ctx),
          h('a', { href: '#/requirements', class: 'more-link' }, 'عرض كل المتطلبات', B.dom.icon('chevron'))), { id: 'attention-title' }),
        h('div', { class: 'stack' },
          sourcesCard(ctx),
          U.card('تعارضات القيم', conflictsList(ctx), { id: 'conflicts-title' }),
          U.card('أسئلة تنتظر قرارًا', questionsList(ctx), { id: 'questions-title' }),
          U.card('حسب الجهة', byEntity(ctx), { id: 'entities-title' }))));
  };
})(window);
