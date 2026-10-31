/*
 * المتطلبات — #/requirements، و#/requirements/:id، و#/requirements/new، و#/requirements/:id/edit
 * (docs/design/01 §3). كل تغيير عبر js/actions.js.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;
  var M = B.model;
  var A = B.actions;
  var I = B.insights;

  var DUE_OPTIONS = [{ value: 'overdue', label: 'متأخر' }, { value: 'soon', label: 'قريب الموعد (7 أيام)' }];
  var STATUS_FILTER = [{ value: 'open', label: 'كل غير المكتمل' }].concat(U.optionsFromMap(M.STATUSES));
  var SORTS = [{ value: 'urgency', label: 'الأكثر إلحاحًا' }, { value: 'deadline', label: 'الموعد الأقرب' }, { value: 'updated', label: 'آخر تحديث' }];

  function sortList(list, sort, today) {
    if (sort === 'deadline') return list.slice().sort(function (a, b) { return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0; });
    if (sort === 'updated') return list.slice().sort(function (a, b) { return (b.updatedAt || '') < (a.updatedAt || '') ? -1 : 1; });
    return D.sortByUrgency(list, today);
  }

  // ---------- القائمة ----------
  B.views.requirements = function (ctx) {
    var d = ctx.data;
    var state = {};
    B.query.FILTER_KEYS.forEach(function (k) { state[k] = ctx.query.get(k) || ''; });
    state.sort = ctx.query.get('sort') || 'urgency';

    var results = h('div', { class: 'results' });
    var counter = h('p', { class: 'result-count', role: 'status', 'aria-live': 'polite' });
    var form;

    function currentList() {
      var list = B.query.filterRequirements(d.requirements, state, { indicatorsById: ctx.lookups.indicatorsById, today: ctx.today });
      return sortList(list, state.sort, ctx.today);
    }

    // يُصدَّر ما يظهر في النتائج فقط، بالترتيب نفسه (AC-RPT-07).
    function exportCsv() {
      var list = currentList();
      if (!list.length) { ctx.toast('لا توجد نتائج لتصديرها.', 'info'); return; }
      var name = 'basira-requirements' + (B.query.hasActiveFilters(state) ? '-filtered' : '') + '-' + ctx.today + '.csv';
      ctx.download(name, B.csv.toCSV(I.REQUIREMENT_HEADERS, I.requirementRows(list, d, ctx.today)), 'text/csv;charset=utf-8');
      ctx.toast('نُزّل الملف: ' + name + ' (عدد المتطلبات: ' + list.length + ' من ' + d.requirements.length + ')', 'success');
    }

    function refresh() {
      var list = currentList();
      counter.textContent = 'عدد النتائج: ' + list.length + ' من ' + d.requirements.length;
      B.dom.clear(results);
      if (!d.requirements.length) {
        results.appendChild(B.dom.emptyState('لا توجد متطلبات بعد', 'يمكن إضافة أول متطلب وربطه بمؤشر وجهة وموعد.',
          h('a', { href: '#/requirements/new', class: 'btn btn--primary' }, B.dom.icon('plus'), 'إضافة متطلب')));
      } else if (!list.length) {
        results.appendChild(B.dom.emptyState('لا توجد نتائج مطابقة', 'يمكن تجربة كلمة أخرى أو تخفيف التصفية.',
          h('button', { type: 'button', class: 'btn btn--secondary', onclick: clearAll }, 'مسح البحث والتصفية')));
      } else {
        results.appendChild(U.requirementsTable(ctx, list, 'نتائج المتطلبات'));
      }
      ctx.setQuery(Object.assign({}, state, { sort: state.sort === 'urgency' ? '' : state.sort }));
    }

    function control(name, el) {
      el.addEventListener(name === 'q' ? 'input' : 'change', function () {
        state[name] = el.value;
        if (name === 'ranking') {
          var indSel = form.querySelector('[name="indicator"]');
          var fresh = U.selectControl('indicator', U.indicatorOptions(d.indicators, state.ranking), '', 'كل المؤشرات');
          fresh.id = indSel.id;
          fresh.setAttribute('aria-describedby', indSel.getAttribute('aria-describedby'));
          indSel.replaceWith(fresh);
          state.indicator = '';
          control('indicator', fresh);
        }
        refresh();
      });
      return el;
    }

    var search = control('q', h('input', { type: 'search', name: 'q', class: 'input input--search', value: state.q, placeholder: 'بحث في العنوان والوصف والنواقص', autocomplete: 'off', dir: 'auto' }));
    search.id = 'q';
    form = h('form', { class: 'filters', role: 'search', onsubmit: function (e) { e.preventDefault(); } },
      h('div', { class: 'search-box' },
        h('label', { for: 'q', class: 'visually-hidden' }, 'بحث في المتطلبات'),
        B.dom.icon('search', 'search-box__icon'), search),
      h('div', { class: 'filters__grid' },
        U.field({ id: 'f-ranking', name: 'ranking', label: 'التصنيف', control: control('ranking', U.selectControl('ranking', (d.rankings || []).map(function (r) { return { value: r.id, label: r.name }; }), state.ranking, 'الكل')) }),
        U.field({ id: 'f-indicator', name: 'indicator', label: 'المؤشر', control: control('indicator', U.selectControl('indicator', U.indicatorOptions(d.indicators, state.ranking), state.indicator, 'كل المؤشرات')) }),
        U.field({ id: 'f-entity', name: 'entity', label: 'الجهة', control: control('entity', U.selectControl('entity', d.entities.map(function (e) { return { value: e.id, label: e.name }; }), state.entity, 'كل الجهات')) }),
        U.field({ id: 'f-status', name: 'status', label: 'الحالة', control: control('status', U.selectControl('status', STATUS_FILTER, state.status, 'الكل')) }),
        U.field({ id: 'f-priority', name: 'priority', label: 'الأولوية', control: control('priority', U.selectControl('priority', U.optionsFromMap(M.PRIORITIES), state.priority, 'الكل')) }),
        U.field({ id: 'f-due', name: 'due', label: 'الموعد', control: control('due', U.selectControl('due', DUE_OPTIONS, state.due, 'الكل')) }),
        U.field({ id: 'f-sort', name: 'sort', label: 'الترتيب', control: control('sort', U.selectControl('sort', SORTS, state.sort)) })),
      h('div', { class: 'filters__actions' },
        counter,
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: function () { clearAll(); } }, 'مسح الكل'),
        h('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'export-requirements', onclick: exportCsv }, B.dom.icon('download'), 'تصدير النتائج CSV')),
      h('p', { class: 'muted small' }, 'التصدير يشمل النتائج الظاهرة فقط بعد البحث والتصفية، وبالترتيب نفسه.'));

    function clearAll() {
      // replaceState لا يطلق hashchange، فلا يُعاد الرسم مرتين ولا يضيع التركيز.
      ctx.setQuery({});
      ctx.rerender();
      var q = document.getElementById('q');
      if (q) q.focus();
    }

    refresh();
    return h('div', null,
      U.pageHeader('المتطلبات', 'البيانات الناقصة والمهام المرتبطة بالمؤشرات.',
        h('a', { href: '#/requirements/new', class: 'btn btn--primary' }, B.dom.icon('plus'), 'إضافة متطلب')),
      form, results);
  };

  // ---------- التفاصيل ----------
  B.views.requirement = function (ctx) {
    var r = ctx.lookups.requirementsById[ctx.params[0]];
    if (!r) return U.notFoundState('المتطلب', '#/requirements', 'العودة إلى المتطلبات');
    var ind = ctx.lookups.indicatorsById[r.indicatorId];
    var ent = ctx.lookups.entitiesById[r.entityId];
    var link = r.evidenceLink && M.isHttpUrl(r.evidenceLink) ? r.evidenceLink : '';
    var evidence = (ctx.data.evidence || []).filter(function (e) { return e.requirementId === r.id; });

    function remove() {
      var impact = A.requirementImpact(ctx.data, r.id);
      ctx.confirm({
        title: 'حذف المتطلب؟',
        body: 'سيُحذف المتطلب «' + r.title + '» نهائيًا' + (impact.followUps ? ' ومعه متابعاته (' + impact.followUps + ')' : '') + '.' +
          (impact.evidence ? ' الأدلة المرتبطة به (' + impact.evidence + ') لن تُحذف، وتبقى على المؤشر دون ربط بمتطلب.' : ''),
        confirmLabel: 'تأكيد الحذف',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        var res = A.deleteRequirement(ctx.data, r.id, ctx.env());
        if (!res.ok) { ctx.toast(res.message, 'error'); return; }
        ctx.save('حُذف المتطلب «' + r.title + '».');
        ctx.go('#/requirements');
      });
    }

    // تغيير الحالة السريع (تُطبق شروط الاكتمال).
    var statusForm = h('form', { class: 'inline-form', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      U.field({ id: 'q-status', name: 'status', label: 'تغيير الحالة', control: U.selectControl('status', U.optionsFromMap(M.STATUSES), r.status) }),
      h('button', { type: 'submit', class: 'btn btn--secondary' }, 'تطبيق'));
    statusForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var res = A.setRequirementStatus(ctx.data, r.id, statusForm.elements.status.value, ctx.env());
      if (!U.handle(statusForm, res, ctx)) return;
      if (res.info && res.info.unchanged) { ctx.toast('الحالة كما هي.', 'info'); return; }
      ctx.save('غُيّرت الحالة إلى «' + M.STATUSES[r.status] + '».');
      ctx.rerender();
    });

    // شروط الاكتمال وجودة البيانات من محرك التحليل (js/insights.js).
    var check = I.requirementConditions(r, ctx.data, ctx.today);
    // المكتمل القديم قد يكون دون دليل (AC-CMP-02)، فيُعرض شرطا الاكتمال كما هما.
    var checklist = r.status === 'done'
      ? h('ul', { class: 'checklist', id: 'conditions' },
        h('li', { class: r.missingData ? 'is-no' : 'is-yes' }, B.dom.icon(r.missingData ? 'close' : 'check'), r.missingData ? 'توجد بيانات ناقصة مسجلة' : 'لا نواقص مسجلة'),
        h('li', { class: link ? 'is-yes' : 'is-no' }, B.dom.icon(link ? 'check' : 'close'), link ? 'يوجد رابط دليل' : 'لا يوجد رابط دليل'))
      : h('ul', { class: 'checklist', id: 'conditions' }, check.conditions.map(function (c) {
        return h('li', { class: c.met ? 'is-yes' : 'is-no' }, B.dom.icon(c.met ? 'check' : 'close'), c.label,
          c.group === 'blocking' ? h('span', { class: 'muted small' }, ' (شرط اكتمال)') : null);
      }));

    var info = h('dl', { class: 'details' },
      h('div', null, h('dt', null, 'الوصف'), h('dd', null, r.description || h('span', { class: 'muted' }, 'لا وصف'))),
      h('div', null, h('dt', null, 'المؤشر'), h('dd', null, ind ? [h('a', { href: '#/indicators/' + encodeURIComponent(ind.id) }, B.dom.ltr(ind.code), ' · ', ind.name), ind.active === false ? [' ', B.dom.badge('المؤشر معطل', 'neutral')] : null] : '—')),
      h('div', null, h('dt', null, 'الجهة المسؤولة'), h('dd', null, ent ? h('a', { href: '#/entities/' + encodeURIComponent(ent.id) }, ent.name) : '—')),
      h('div', null, h('dt', null, 'المكلَّف'), h('dd', null, U.person(r.assignee))),
      h('div', null, h('dt', null, 'الموعد النهائي'), h('dd', null, B.format.formatDate(r.deadline), ' ', U.dueBadge(r, ctx.today))),
      h('div', null, h('dt', null, 'البيانات الناقصة'), h('dd', null, r.missingData || h('span', { class: 'muted' }, 'لا شيء'))),
      h('div', null, h('dt', null, 'رابط الدليل'), h('dd', null, link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, B.dom.ltr(link)) : h('span', { class: 'muted' }, 'لا يوجد'))));

    return h('div', null,
      U.backLink('#/requirements', 'المتطلبات'),
      U.pageHeader(r.title, null, [
        h('a', { href: '#/requirements/' + encodeURIComponent(r.id) + '/edit', class: 'btn btn--primary' }, 'تعديل'),
        h('button', { type: 'button', class: 'btn btn--ghost-danger', onclick: remove }, 'حذف')
      ]),
      h('p', { class: 'meta-line' }, U.statusBadge(r.status), ' ', U.priorityBadge(r.priority), r.status === 'done' ? null : [' ', U.dueBadge(r, ctx.today)]),
      h('div', { class: 'grid grid--main-side' },
        U.card('البيانات', info),
        h('div', { class: 'stack' },
          U.card('الحالة', statusForm),
          U.card('شروط الاكتمال', h('div', null, checklist, h('p', { class: 'muted small' }, r.status === 'done' ? 'المتطلب مكتمل.' : 'مستوفٍ ' + check.met + ' من ' + check.total + '. لاكتمال المتطلب يلزم الشرطان الأولان.'))))),
      analysisCard(ctx, r),
      U.card('الأدلة (' + evidence.length + ')', h('div', { class: 'stack' },
        evidence.length ? U.evidenceList(ctx, evidence) : h('p', { class: 'muted' }, 'لا أدلة مسجلة لهذا المتطلب.'),
        ind && ind.active !== false ? h('a', { href: '#/evidence/new?requirement=' + encodeURIComponent(r.id), class: 'btn btn--secondary' }, B.dom.icon('plus'), 'تسجيل دليل لهذا المتطلب') : null)),
      followUpsCard(ctx, r));
  };

  // الخطوة التالية ودرجة الأولوية وسلّم التصعيد، كلها قواعد حسابية تُعرض بأسبابها.
  function analysisCard(ctx, r) {
    if (r.status === 'done') return null;
    var step = I.nextStep(r, ctx.data, ctx.today);
    var score = I.priorityScore(r, ctx.data, ctx.today);
    var esc = step.escalation;
    var escLine = h('p', { class: 'small' }, 'سلّم التصعيد: المستحق اليوم ', h('strong', null, 'L' + esc.due), ' · المسجل ',
      esc.executed >= 0 ? U.escalationBadge(esc.executed) : h('span', { class: 'muted' }, 'لا مستوى مسجل'),
      esc.next ? ' · التالي L' + esc.next.level + ' في ' + B.format.formatDate(esc.next.date) : '');
    return U.card('التحليل والخطوة التالية', h('div', { class: 'stack' },
      h('p', { class: 'ranked__next', id: 'next-step' }, h('strong', null, 'الخطوة التالية: '), step.text, ' ',
        step.kind === 'letter' ? h('a', { href: '#/letters?entity=' + encodeURIComponent(r.entityId) + '&level=L' + step.level, class: 'btn btn--secondary btn--small' }, B.dom.icon('mail'), 'إعداد الخطاب') : null),
      escLine,
      h('details', { class: 'details-toggle' },
        h('summary', null, 'درجة الأولوية: ', h('strong', { id: 'score' }, String(score.score)), ' — لماذا؟'),
        score.factors.length ? h('ul', { class: 'factors' }, score.factors.map(function (f) { return h('li', null, h('span', null, f.label), h('span', { class: 'factors__pts' }, '+' + f.points)); }))
          : h('p', { class: 'muted small' }, 'لم تنطبق أي قاعدة.')),
      h('p', { class: 'muted small' }, 'محسوبة بقواعد مكتوبة من بيانات المتطلب، لا ذكاء اصطناعي. ', h('a', { href: '#/insights' }, 'التحليل التشغيلي الكامل'))), { id: 'analysis-title' });
  }

  function followUpsCard(ctx, r) {
    var list = U.sortedFollowUps(r);
    var form = h('form', { class: 'form form--compact', novalidate: true },
      h('h3', { class: 'card__subtitle' }, 'تسجيل مراسلة أو متابعة'),
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('div', { class: 'form-grid' },
        U.field({ id: 'fu-date', name: 'date', label: 'التاريخ', required: true, control: h('input', { type: 'date', name: 'date', class: 'input', value: ctx.today, max: ctx.today }) }),
        U.field({ id: 'fu-type', name: 'type', label: 'النوع', required: true, control: U.selectControl('type', U.optionsFromMap(M.FOLLOWUP_TYPES), 'call') }),
        U.field({ id: 'fu-outcome', name: 'outcome', label: 'النتيجة', required: true, control: U.selectControl('outcome', U.optionsFromMap(M.FOLLOWUP_OUTCOMES), '', 'اختيار النتيجة') }),
        U.field({ id: 'fu-level', name: 'escalationLevel', label: 'مستوى التصعيد', hint: 'اختياري: إذا كانت المتابعة خطابًا من سلّم التصعيد.', control: U.selectControl('escalationLevel', B.model.ESCALATION_NAMES.map(function (n, i) { return { value: String(i), label: 'L' + i + ' — ' + n }; }), '', 'متابعة عادية دون مستوى') }),
        U.field({ id: 'fu-next', name: 'nextActionDate', label: 'موعد الإجراء التالي', hint: 'اختياري: يظهر المتطلب في «مستحقة الآن» عند حلوله.', control: h('input', { type: 'date', name: 'nextActionDate', class: 'input' }) }),
        U.field({ id: 'fu-note', name: 'note', label: 'الملاحظة', required: true, wide: true, control: h('textarea', { name: 'note', class: 'input', rows: '2', maxlength: '1100', dir: 'auto' }) })),
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn--secondary' }, 'إضافة المتابعة')));

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var res = A.addFollowUp(ctx.data, r.id, { date: f.date.value, type: f.type.value, outcome: f.outcome.value, note: f.note.value, nextActionDate: f.nextActionDate.value, escalationLevel: f.escalationLevel.value }, ctx.env());
      if (!U.handle(form, res, ctx)) return;
      ctx.save('أُضيفت المتابعة.');
      ctx.rerender();
    });

    function removeFollowUp(fu) {
      ctx.confirm({ title: 'حذف المتابعة؟', body: 'ستُحذف متابعة ' + B.format.formatDate(fu.date) + ' («' + fu.note + '»).', confirmLabel: 'تأكيد الحذف', danger: true })
        .then(function (ok) {
          if (!ok) return;
          var res = A.deleteFollowUp(ctx.data, r.id, fu.id, ctx.env());
          if (!res.ok) { ctx.toast(res.message, 'error'); return; }
          ctx.save('حُذفت المتابعة.');
          ctx.rerender();
        });
    }

    return U.card('سجل المراسلات والمتابعات (' + list.length + ')', h('div', { class: 'stack' },
      list.length ? h('ol', { class: 'timeline' }, list.map(function (f) {
        return h('li', null,
          h('p', { class: 'timeline__head' }, h('span', { class: 'strong' }, B.format.formatDate(f.date)),
            f.type ? B.dom.badge(M.FOLLOWUP_TYPES[f.type] || f.type, 'neutral') : null, U.outcomeBadge(f.outcome), U.escalationBadge(f.escalationLevel)),
          h('p', null, f.note),
          f.nextActionDate ? h('p', { class: 'muted small' }, 'الإجراء التالي: ' + B.format.formatDate(f.nextActionDate)) : null,
          h('button', { type: 'button', class: 'link-button link-button--danger small', onclick: function () { removeFollowUp(f); } }, 'حذف المتابعة'));
      })) : h('p', { class: 'muted' }, 'لا متابعات بعد. يمكن تسجيل أول تواصل مع الجهة من النموذج أدناه.'),
      form), { id: 'followups-title' });
  }

  // ---------- نموذج الإضافة والتعديل ----------
  B.views.requirementForm = function (ctx) {
    var d = ctx.data;
    var editing = ctx.params.length ? ctx.lookups.requirementsById[ctx.params[0]] : null;
    if (ctx.params.length && !editing) return U.notFoundState('المتطلب', '#/requirements', 'العودة إلى المتطلبات');
    var r = editing || {
      title: '', description: '', indicatorId: ctx.query.get('indicator') || '', entityId: '', assignee: '',
      deadline: '', status: 'new', priority: 'medium', missingData: '', evidenceLink: ''
    };
    var preInd = ctx.lookups.indicatorsById[r.indicatorId];
    var ranking = preInd ? preInd.ranking : '';
    var keepId = editing ? editing.indicatorId : null;
    var backHref = editing ? '#/requirements/' + encodeURIComponent(editing.id) : (preInd ? '#/indicators/' + encodeURIComponent(preInd.id) : '#/requirements');

    var rankingSel = U.selectControl('ranking', (d.rankings || []).map(function (x) { return { value: x.id, label: x.name }; }), ranking, 'كل التصنيفات');
    var indicatorSel = U.selectControl('indicatorId', U.indicatorOptions(d.indicators, ranking, { activeOnly: true, keepId: keepId }), r.indicatorId, 'اختيار المؤشر');
    rankingSel.addEventListener('change', function () {
      var fresh = U.selectControl('indicatorId', U.indicatorOptions(d.indicators, rankingSel.value, { activeOnly: true, keepId: keepId }), '', 'اختيار المؤشر');
      fresh.id = indicatorSel.id;
      fresh.setAttribute('aria-describedby', indicatorSel.getAttribute('aria-describedby'));
      fresh.setAttribute('aria-required', 'true');
      indicatorSel.replaceWith(fresh);
      indicatorSel = fresh;
    });

    var priorityRadios = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'الأولوية' },
      Object.keys(M.PRIORITIES).map(function (p) {
        return h('label', { class: 'segmented__item' },
          h('input', { type: 'radio', name: 'priority', value: p, checked: r.priority === p }), h('span', null, M.PRIORITIES[p]));
      }));

    var form = h('form', { class: 'form card', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('div', { class: 'form-grid' },
        U.field({ id: 'r-title', name: 'title', label: 'العنوان', required: true, wide: true, hint: 'من 3 إلى 150 حرفًا.', control: h('input', { type: 'text', name: 'title', class: 'input', maxlength: '160', value: r.title, dir: 'auto' }) }),
        U.field({ id: 'r-ranking', name: 'ranking', label: 'التصنيف', hint: 'لتصفية قائمة المؤشرات فقط.', control: rankingSel }),
        U.field({ id: 'r-indicator', name: 'indicatorId', label: 'المؤشر', required: true, hint: 'المؤشرات المعطلة لا تظهر هنا.', control: indicatorSel }),
        U.field({ id: 'r-entity', name: 'entityId', label: 'الجهة المسؤولة', required: true, control: U.selectControl('entityId', d.entities.map(function (e) { return { value: e.id, label: e.name }; }), r.entityId, 'اختيار الجهة') }),
        U.field({ id: 'r-assignee', name: 'assignee', label: 'المكلَّف', control: h('input', { type: 'text', name: 'assignee', class: 'input', maxlength: '90', value: r.assignee || '', dir: 'auto' }) }),
        U.field({ id: 'r-deadline', name: 'deadline', label: 'الموعد النهائي', required: true, control: h('input', { type: 'date', name: 'deadline', class: 'input', value: r.deadline }) }),
        U.field({ id: 'r-status', name: 'status', label: 'الحالة', required: true, control: U.selectControl('status', U.optionsFromMap(M.STATUSES), r.status) }),
        h('div', { class: 'field', dataset: { field: 'priority' } },
          h('span', { class: 'field__label', id: 'r-priority-label' }, 'الأولوية ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')),
          priorityRadios,
          h('p', { class: 'field__error', id: 'r-priority-error', 'aria-live': 'polite' })),
        U.field({ id: 'r-description', name: 'description', label: 'الوصف', wide: true, control: h('textarea', { name: 'description', class: 'input', rows: '3', maxlength: '2100', dir: 'auto' }, r.description || '') }),
        U.field({ id: 'r-missing', name: 'missingData', label: 'البيانات الناقصة', wide: true, hint: 'يُترك فارغًا إذا لم تبقَ نواقص.', control: h('textarea', { name: 'missingData', class: 'input', rows: '2', maxlength: '1100', dir: 'auto' }, r.missingData || '') }),
        U.field({ id: 'r-link', name: 'evidenceLink', label: 'رابط الدليل', wide: true, hint: 'يبدأ بـ https://', control: h('input', { type: 'url', name: 'evidenceLink', class: 'input', dir: 'ltr', maxlength: '500', value: r.evidenceLink || '', placeholder: 'https://' }) })),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, editing ? 'حفظ التعديلات' : 'حفظ المتطلب'),
        h('a', { href: backHref, class: 'btn btn--ghost' }, 'إلغاء')));

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var checked = form.querySelector('input[name="priority"]:checked');
      var input = {
        title: f.title.value, description: f.description.value, indicatorId: indicatorSel.value,
        entityId: f.entityId.value, assignee: f.assignee.value, deadline: f.deadline.value,
        status: f.status.value, priority: checked ? checked.value : '', missingData: f.missingData.value, evidenceLink: f.evidenceLink.value
      };
      var res = editing ? A.updateRequirement(d, editing.id, input, ctx.env()) : A.createRequirement(d, input, ctx.env());
      if (!U.handle(form, res, ctx)) return;
      ctx.save(editing ? 'حُفظت التعديلات.' : 'أُضيف المتطلب «' + input.title.replace(/\s+/g, ' ').trim() + '».');
      ctx.go('#/requirements/' + encodeURIComponent(res.id));
    });

    return h('div', null,
      U.backLink(backHref, editing ? 'المتطلب' : 'رجوع'),
      U.pageHeader(editing ? 'تعديل المتطلب' : 'إضافة متطلب', 'الحقول المعلَّمة بـ * إلزامية.'),
      form);
  };
})(window);
