/*
 * الجهات والمسؤوليات — #/entities، و#/entities/new، و#/entities/:id، و#/entities/:id/edit
 * (docs/design/01 §4). كل تغيير عبر js/actions.js.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var D = B.derive;
  var M = B.model;
  var A = B.actions;

  B.views.entities = function (ctx) {
    var d = ctx.data;
    var s = D.summaryByEntity(d.requirements, d.entities, ctx.today);
    var body = d.entities.length ? U.responsiveTable('الجهات', [
      { label: 'الجهة', cls: 'col-main', cell: function (e) { return h('a', { href: '#/entities/' + encodeURIComponent(e.id), class: 'row-link' }, e.name); } },
      { label: 'النوع', cls: 'col-secondary', cell: function (e) { return M.ENTITY_TYPES[e.type] || '—'; } },
      { label: 'مفتوح', cell: function (e) { return String(s[e.id].open); } },
      { label: 'متأخر', cell: function (e) { return s[e.id].overdue ? B.dom.badge(String(s[e.id].overdue), 'danger') : '0'; } },
      { label: 'مكتمل', cell: function (e) { return String(s[e.id].done); } },
      { label: 'نسبة الإنجاز', cell: function (e) { return B.dom.ltr(s[e.id].pct === null ? '—' : s[e.id].pct + '%'); } },
      { label: 'المكلفون', cls: 'col-secondary', cell: function (e) {
        return s[e.id].assignees.length ? s[e.id].assignees.map(function (a, i) { return [i ? '، ' : null, U.person(a)]; }) : '—';
      } }
    ], d.entities, function (e) { return e.id; }) : B.dom.emptyState('لا توجد جهات', 'يمكن إضافة أول جهة من زر «إضافة جهة».');

    return h('div', null,
      U.pageHeader('الجهات والمسؤوليات', 'عبء كل جهة ومكلَّفيها وتأخرها.',
        h('a', { href: '#/entities/new', class: 'btn btn--primary' }, B.dom.icon('plus'), 'إضافة جهة')),
      U.card(null, body));
  };

  B.views.entity = function (ctx) {
    var e = ctx.lookups.entitiesById[ctx.params[0]];
    if (!e) return U.notFoundState('الجهة', '#/entities', 'العودة إلى الجهات');
    var reqs = D.sortByUrgency(ctx.data.requirements.filter(function (r) { return r.entityId === e.id; }), ctx.today);
    var s = D.summaryByEntity(ctx.data.requirements, [e], ctx.today)[e.id];
    var linked = A.entityImpact(ctx.data, e.id).requirements;

    function remove() {
      ctx.confirm({ title: 'حذف الجهة؟', body: 'ستُحذف الجهة «' + e.name + '» نهائيًا.', confirmLabel: 'تأكيد الحذف', danger: true }).then(function (ok) {
        if (!ok) return;
        var res = A.deleteEntity(ctx.data, e.id, ctx.env());
        if (!res.ok) { ctx.toast(res.message, 'error'); return; }
        ctx.save('حُذفت الجهة «' + e.name + '».');
        ctx.go('#/entities');
      });
    }

    // R-DEL-ENT: زر الحذف معطل مع السبب ما دامت الجهة مرتبطة بمتطلبات.
    var deleteControl = linked
      ? h('div', { class: 'stack-xs' },
        h('button', { type: 'button', class: 'btn btn--ghost-danger', disabled: true, 'aria-describedby': 'del-reason' }, 'حذف'),
        h('span', { id: 'del-reason', class: 'muted small' }, 'لا يمكن الحذف: مرتبطة بـ ' + linked + ' متطلبات.'))
      : h('button', { type: 'button', class: 'btn btn--ghost-danger', onclick: remove }, 'حذف');

    return h('div', null,
      U.backLink('#/entities', 'الجهات'),
      U.pageHeader(e.name, null, [
        h('a', { href: '#/entities/' + encodeURIComponent(e.id) + '/edit', class: 'btn btn--primary' }, 'تعديل'),
        h('a', { href: '#/requirements?entity=' + encodeURIComponent(e.id), class: 'btn btn--secondary' }, 'عرض متطلباتها في القائمة'),
        deleteControl
      ]),
      h('p', { class: 'meta-line' }, M.ENTITY_TYPES[e.type] || 'جهة', e.contactRole ? ' · جهة التواصل: ' + e.contactRole : ''),
      e.notes ? h('p', { class: 'muted' }, e.notes) : null,
      h('div', { class: 'kpis kpis--small' },
        h('div', { class: 'kpi' }, h('span', { class: 'kpi__value' }, String(s.open)), h('span', { class: 'kpi__label' }, 'مفتوح')),
        h('div', { class: 'kpi kpi--danger' }, h('span', { class: 'kpi__value' }, String(s.overdue)), h('span', { class: 'kpi__label' }, 'متأخر')),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi__value' }, String(s.done)), h('span', { class: 'kpi__label' }, 'مكتمل')),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi__value' }, B.dom.ltr(s.pct === null ? '—' : s.pct + '%')), h('span', { class: 'kpi__label' }, 'نسبة الإنجاز'))),
      U.card('متطلبات الجهة (' + reqs.length + ')', reqs.length ? U.requirementsTable(ctx, reqs, 'متطلبات الجهة') : B.dom.emptyState('لا توجد متطلبات لهذه الجهة', null)));
  };

  B.views.entityForm = function (ctx) {
    var editing = ctx.params.length ? ctx.lookups.entitiesById[ctx.params[0]] : null;
    if (ctx.params.length && !editing) return U.notFoundState('الجهة', '#/entities', 'العودة إلى الجهات');
    var e = editing || { name: '', type: 'unit', contactRole: '', notes: '' };
    var back = editing ? '#/entities/' + encodeURIComponent(editing.id) : '#/entities';
    var form = h('form', { class: 'form card', novalidate: true },
      h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
      h('div', { class: 'form-grid' },
        U.field({ id: 'e-name', name: 'name', label: 'اسم الجهة', required: true, control: h('input', { type: 'text', name: 'name', class: 'input', maxlength: '110', value: e.name, dir: 'auto' }) }),
        U.field({ id: 'e-type', name: 'type', label: 'النوع', required: true, control: U.selectControl('type', U.optionsFromMap(M.ENTITY_TYPES), e.type || 'unit') }),
        U.field({ id: 'e-contact', name: 'contactRole', label: 'جهة التواصل (وصف وظيفي)', wide: true, hint: 'مثل «مدير وحدة البيانات». دون بريد أو هاتف.', control: h('input', { type: 'text', name: 'contactRole', class: 'input', maxlength: '110', value: e.contactRole || '', dir: 'auto' }) }),
        U.field({ id: 'e-notes', name: 'notes', label: 'ملاحظات', wide: true, control: h('textarea', { name: 'notes', class: 'input', rows: '3', maxlength: '550', dir: 'auto' }, e.notes || '') })),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, editing ? 'حفظ التعديلات' : 'حفظ الجهة'),
        h('a', { href: back, class: 'btn btn--ghost' }, 'إلغاء')));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = form.elements;
      var input = { name: f.name.value, type: f.type.value, contactRole: f.contactRole.value, notes: f.notes.value };
      var res = editing ? A.updateEntity(ctx.data, editing.id, input, ctx.env()) : A.createEntity(ctx.data, input, ctx.env());
      if (!U.handle(form, res, ctx)) return;
      ctx.save(editing ? 'حُفظت بيانات الجهة.' : 'أُضيفت الجهة.');
      ctx.go('#/entities/' + encodeURIComponent(res.id));
    });
    return h('div', null, U.backLink(back, editing ? editing.name : 'الجهات'),
      U.pageHeader(editing ? 'تعديل الجهة' : 'إضافة جهة', 'الحقول المعلَّمة بـ * إلزامية.'), form);
  };
})(window);
