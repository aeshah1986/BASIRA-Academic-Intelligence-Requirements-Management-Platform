/*
 * المتطلبات — #/requirements، و#/requirements/:id، و#/requirements/new، و#/requirements/:id/edit
 * (docs/design/01 §3)
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;
  var M = B.model;

  var DUE_OPTIONS = [{ value: 'overdue', label: 'متأخر' }, { value: 'soon', label: 'قريب الموعد (7 أيام)' }];
  var STATUS_FILTER = [{ value: 'open', label: 'كل غير المكتمل' }].concat(U.optionsFromMap(M.STATUSES));
  var SORTS = [{ value: 'urgency', label: 'الأكثر إلحاحًا' }, { value: 'deadline', label: 'الموعد الأقرب' }, { value: 'updated', label: 'آخر تحديث' }];
  var FOLLOWUP_TYPES = { call: 'اتصال', letter: 'خطاب', meeting: 'اجتماع', email: 'بريد', other: 'أخرى' };

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

    function refresh() {
      var list = B.query.filterRequirements(d.requirements, state, { indicatorsById: ctx.lookups.indicatorsById, today: ctx.today });
      list = sortList(list, state.sort, ctx.today);
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
          // تصفية المؤشرات حسب التصنيف المختار
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
    var form = h('form', { class: 'filters', role: 'search', onsubmit: function (e) { e.preventDefault(); } },
      h('div', { class: 'search-box' },
        h('label', { for: 'q', class: 'visually-hidden' }, 'بحث في المتطلبات'),
        B.dom.icon('search', 'search-box__icon'), search),
      h('div', { class: 'filters__grid' },
        U.field({ id: 'f-ranking', name: 'ranking', label: 'التصنيف', control: control('ranking', U.selectControl('ranking', [{ value: 'ARAB', label: U.rankingName('ARAB') }, { value: 'QS', label: 'QS' }], state.ranking, 'الكل')) }),
        U.field({ id: 'f-indicator', name: 'indicator', label: 'المؤشر', control: control('indicator', U.selectControl('indicator', U.indicatorOptions(d.indicators, state.ranking), state.indicator, 'كل المؤشرات')) }),
        U.field({ id: 'f-entity', name: 'entity', label: 'الجهة', control: control('entity', U.selectControl('entity', d.entities.map(function (e) { return { value: e.id, label: e.name }; }), state.entity, 'كل الجهات')) }),
        U.field({ id: 'f-status', name: 'status', label: 'الحالة', control: control('status', U.selectControl('status', STATUS_FILTER, state.status, 'الكل')) }),
        U.field({ id: 'f-priority', name: 'priority', label: 'الأولوية', control: control('priority', U.selectControl('priority', U.optionsFromMap(M.PRIORITIES), state.priority, 'الكل')) }),
        U.field({ id: 'f-due', name: 'due', label: 'الموعد', control: control('due', U.selectControl('due', DUE_OPTIONS, state.due, 'الكل')) }),
        U.field({ id: 'f-sort', name: 'sort', label: 'الترتيب', control: control('sort', U.selectControl('sort', SORTS, state.sort)) })),
      h('div', { class: 'filters__actions' },
        counter,
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: function () { clearAll(); } }, 'مسح الكل')));
    search.id = 'q';

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
    var link = r.evidenceLink && /^https?:\/\//i.test(r.evidenceLink) ? r.evidenceLink : '';

    function remove() {
      var n = (r.followUps || []).length;
      ctx.confirm({
        title: 'حذف المتطلب؟',
        body: 'سيُحذف المتطلب «' + r.title + '»' + (n ? ' ومتابعاته (' + n + ')' : '') + ' نهائيًا من هذا المتصفح.',
        confirmLabel: 'تأكيد الحذف',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        var idx = ctx.data.requirements.indexOf(r);
        if (idx !== -1) ctx.data.requirements.splice(idx, 1);
        ctx.save('حُذف المتطلب «' + r.title + '».');
        ctx.go('#/requirements');
      });
    }

    var checklist = h('ul', { class: 'checklist' },
      h('li', { class: r.missingData ? 'is-no' : 'is-yes' }, B.dom.icon(r.missingData ? 'close' : 'check'), r.missingData ? 'توجد بيانات ناقصة مسجلة' : 'لا نواقص مسجلة'),
      h('li', { class: link ? 'is-yes' : 'is-no' }, B.dom.icon(link ? 'check' : 'close'), link ? 'يوجد رابط دليل' : 'لا يوجد رابط دليل'));

    var info = h('dl', { class: 'details' },
      h('div', null, h('dt', null, 'الوصف'), h('dd', null, r.description || h('span', { class: 'muted' }, 'لا وصف'))),
      h('div', null, h('dt', null, 'المؤشر'), h('dd', null, ind ? h('a', { href: '#/indicators/' + encodeURIComponent(ind.id) }, B.dom.ltr(ind.code), ' · ', ind.name) : '—')),
      h('div', null, h('dt', null, 'الجهة المسؤولة'), h('dd', null, ent ? h('a', { href: '#/entities/' + encodeURIComponent(ent.id) }, ent.name) : '—')),
      h('div', null, h('dt', null, 'المكلَّف'), h('dd', null, r.assignee || '—')),
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
        U.card('شروط الاكتمال', h('div', null, checklist,
          h('p', { class: 'muted small' }, 'لاكتمال المتطلب: لا نواقص، ورابط دليل.')))),
      followUpsCard(ctx, r));
  };

  function followUpsCard(ctx, r) {
    var list = U.sortedFollowUps(r);
    var form = h('form', { class: 'form form--compact', novalidate: true },
      h('h3', { class: 'card__subtitle' }, 'إضافة متابعة'),
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('div', { class: 'form-grid' },
        U.field({ id: 'fu-date', name: 'date', label: 'التاريخ', required: true, control: h('input', { type: 'date', name: 'date', class: 'input', value: ctx.today, max: ctx.today }) }),
        U.field({ id: 'fu-type', name: 'type', label: 'النوع', required: true, control: U.selectControl('type', U.optionsFromMap(FOLLOWUP_TYPES), 'call') }),
        U.field({ id: 'fu-note', name: 'note', label: 'الملاحظة', required: true, wide: true, control: h('textarea', { name: 'note', class: 'input', rows: '2', maxlength: '1100', dir: 'auto' }) })),
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn--secondary' }, 'إضافة المتابعة')));

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var date = form.elements.date.value;
      var type = form.elements.type.value;
      var note = form.elements.note.value.replace(/\s+/g, ' ').trim();
      var errors = {};
      if (!M.isValidDate(date)) errors.date = 'التاريخ غير صالح.';
      else if (date > ctx.today) errors.date = 'لا يمكن تسجيل تاريخ في المستقبل.';
      if (!Object.prototype.hasOwnProperty.call(FOLLOWUP_TYPES, type)) errors.type = 'النوع غير معروف.';
      if (note.length < 3) errors.note = 'يرجى كتابة ملاحظة من 3 أحرف على الأقل.';
      else if (note.length > 1000) errors.note = 'النص أطول من 1000 حرف.';
      if (!U.showErrors(form, errors)) return;
      r.followUps = r.followUps || [];
      r.followUps.push({ id: ctx.newId('fu'), date: date, type: type, note: note });
      r.updatedAt = new Date().toISOString();
      ctx.save('أُضيفت المتابعة.');
      ctx.rerender();
    });

    return U.card('سجل المتابعات (' + list.length + ')', h('div', { class: 'stack' },
      list.length ? h('ol', { class: 'timeline' }, list.map(function (f) {
        return h('li', null,
          h('p', { class: 'timeline__head' }, h('span', { class: 'strong' }, B.format.formatDate(f.date)), f.type ? B.dom.badge(FOLLOWUP_TYPES[f.type] || f.type, 'neutral') : null),
          h('p', null, f.note));
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
    var backHref = editing ? '#/requirements/' + encodeURIComponent(editing.id) : (preInd ? '#/indicators/' + encodeURIComponent(preInd.id) : '#/requirements');

    var rankingSel = U.selectControl('ranking', [{ value: 'ARAB', label: U.rankingName('ARAB') }, { value: 'QS', label: 'QS' }], ranking, 'كل التصنيفات');
    var indicatorSel = U.selectControl('indicatorId', U.indicatorOptions(d.indicators, ranking), r.indicatorId, 'اختيار المؤشر');
    rankingSel.addEventListener('change', function () {
      var fresh = U.selectControl('indicatorId', U.indicatorOptions(d.indicators, rankingSel.value), '', 'اختيار المؤشر');
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
        U.field({ id: 'r-indicator', name: 'indicatorId', label: 'المؤشر', required: true, control: indicatorSel }),
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
        status: f.status.value, priority: checked ? checked.value : '', missingData: f.missingData.value
      };
      var result = M.validateRequirement(input, { indicators: d.indicators, entities: d.entities });
      var errors = result.errors;
      var v = result.value;
      if (!errors.title && (v.title.length < 3 || v.title.length > 150)) errors.title = 'العنوان يجب أن يكون بين 3 و150 حرفًا.';
      if (v.description.length > 2000) errors.description = 'النص أطول من 2000 حرف.';
      if (v.missingData.length > 1000) errors.missingData = 'النص أطول من 1000 حرف.';
      if (v.assignee.length > 80) errors.assignee = 'النص أطول من 80 حرفًا.';
      var link = f.evidenceLink.value.trim();
      if (link && !/^https?:\/\/[^\s]+$/i.test(link)) errors.evidenceLink = 'الرابط يجب أن يبدأ بـ https:// أو http:// (يُرفض غير ذلك للأمان).';
      // شرط الاكتمال R-COMPLETE-REQ يُطبق عند الانتقال إلى «مكتمل» فقط.
      var becomingDone = v.status === 'done' && (!editing || editing.status !== 'done');
      if (becomingDone && !errors.status) {
        var missing = [];
        if (v.missingData) missing.push('حذف البيانات الناقصة أو تحديثها');
        if (!link || errors.evidenceLink) missing.push('إضافة رابط الدليل');
        if (missing.length) errors.status = 'لا يمكن إكمال المتطلب: يلزم ' + missing.join('، و') + '.';
      }
      if (!U.showErrors(form, errors)) return;

      var now = new Date().toISOString();
      var target = editing || { id: ctx.newId('req'), createdAt: now, followUps: [] };
      Object.keys(v).forEach(function (k) { target[k] = v[k]; });
      target.evidenceLink = link;
      target.updatedAt = now;
      if (becomingDone) target.completedAt = now;
      if (!editing) d.requirements.push(target);
      ctx.save(editing ? 'حُفظت التعديلات.' : 'أُضيف المتطلب «' + target.title + '».');
      ctx.go('#/requirements/' + encodeURIComponent(target.id));
    });

    return h('div', null,
      U.backLink(backHref, editing ? 'المتطلب' : 'رجوع'),
      U.pageHeader(editing ? 'تعديل المتطلب' : 'إضافة متطلب', 'الحقول المعلَّمة بـ * إلزامية.'),
      form);
  };

  B.ui.FOLLOWUP_TYPES = FOLLOWUP_TYPES;
})(window);
