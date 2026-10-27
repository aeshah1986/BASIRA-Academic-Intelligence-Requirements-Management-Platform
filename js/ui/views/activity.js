/*
 * سجل الأنشطة — #/activity (docs/design/01 §7، R-LOG). للقراءة فقط: يُملأ تلقائيًا من js/actions.js.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;

  var ACTIONS = {
    create: 'إضافة', update: 'تعديل', delete: 'حذف', status_change: 'تغيير حالة',
    followup_add: 'متابعة', followup_delete: 'حذف متابعة', evidence_review: 'تحقق من دليل',
    decision_resolve: 'حسم قرار', indicator_disable: 'تعطيل مؤشر', indicator_enable: 'تفعيل مؤشر',
    import: 'استيراد', export: 'تصدير', reset: 'إعادة ضبط'
  };
  var TARGETS = { requirement: 'متطلب', indicator: 'مؤشر', entity: 'جهة', evidence: 'دليل', decision: 'سؤال', ranking: 'تصنيف', data: 'البيانات' };
  var TONE = { delete: 'danger', followup_delete: 'danger', indicator_disable: 'warning', import: 'info', reset: 'warning' };

  // رابط العنصر إن كان موجودًا، وإلا «(محذوف)» دون رابط (AC-LOG-04).
  function targetLink(ctx, a) {
    if (a.targetType === 'data' || !a.targetId) return null;
    var exists = {
      requirement: function () { return ctx.lookups.requirementsById[a.targetId] && '#/requirements/'; },
      indicator: function () { return ctx.lookups.indicatorsById[a.targetId] && '#/indicators/'; },
      entity: function () { return ctx.lookups.entitiesById[a.targetId] && '#/entities/'; },
      evidence: function () { return (ctx.data.evidence || []).some(function (e) { return e.id === a.targetId; }) && '#/evidence/'; },
      decision: function () { return ctx.data.decisions.some(function (q) { return q.id === a.targetId; }) && '#/followups?tab=decisions'; },
      ranking: function () { return '#/rankings?ranking=' + a.targetId; }
    }[a.targetType];
    var href = exists && exists();
    if (!href) return h('span', { class: 'muted small' }, '(محذوف)');
    var full = href.indexOf('?') >= 0 ? href : href + encodeURIComponent(a.targetId);
    return h('a', { href: full, class: 'small' }, 'فتح ' + (TARGETS[a.targetType] || 'العنصر'));
  }

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    var date = B.format.formatDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    return date + '، ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  B.views.activity = function (ctx) {
    var all = ctx.data.activities || [];
    var type = ctx.query.get('type') || '';
    var list = all.filter(function (a) { return !type || a.targetType === type; });
    var typeSel = U.selectControl('type', Object.keys(TARGETS).map(function (k) { return { value: k, label: TARGETS[k] }; }), type, 'كل الأنواع');
    typeSel.addEventListener('change', function () { ctx.go(B.app.buildHash('/activity', { type: typeSel.value })); });

    var body = list.length ? h('ol', { class: 'timeline' }, list.map(function (a) {
      return h('li', null,
        h('p', { class: 'timeline__head' }, h('span', { class: 'muted small' }, B.dom.ltr(when(a.at))), B.dom.badge(ACTIONS[a.action] || a.action, TONE[a.action] || 'neutral'),
          h('span', { class: 'muted small' }, TARGETS[a.targetType] || '')),
        h('p', null, a.summary),
        targetLink(ctx, a));
    })) : all.length ? B.dom.emptyState('لا أنشطة من هذا النوع', null)
      : B.dom.emptyState('لا توجد أنشطة مسجلة بعد', 'كل إضافة أو تعديل أو حذف أو تحقق أو استيراد يُسجَّل هنا تلقائيًا.');

    return h('div', null,
      U.pageHeader('سجل الأنشطة', 'ماذا تغيّر ومتى. يُسجَّل تلقائيًا، ويُحتفظ بآخر 500 نشاط.'),
      h('div', { class: 'filters filters--inline' }, U.field({ id: 'act-type', name: 'type', label: 'نوع العنصر', control: typeSel }),
        h('p', { class: 'result-count', role: 'status' }, 'عدد الأنشطة: ' + list.length + (type ? ' من ' + all.length : ''))),
      U.card(null, body));
  };
})(window);
