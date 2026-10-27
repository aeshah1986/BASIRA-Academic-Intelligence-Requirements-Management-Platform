/*
 * عناصر مشتركة بين الصفحات — منصة «بصيرة» (للمتصفح فقط)
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var M = B.model;

  var RANKING_NAMES = { ARAB: 'التصنيف العربي للجامعات', QS: 'QS' };
  var WORK_TONE = { not_started: 'neutral', draft: 'warning', evidenced: 'info', entered: 'success' };
  var DUE_TONE = { overdue: 'danger', soon: 'warning', later: 'neutral', done: 'success', none: 'neutral' };

  function rankingName(code) { return RANKING_NAMES[code] || code; }
  // اسم الشخص في سطر واحد (لا ينفصل «د.» عن الاسم عند التفاف السطر).
  function person(name) { return name ? h('span', { class: 'nowrap' }, name) : '—'; }
  function statusBadge(status) { return B.dom.badge(M.STATUSES[status] || status, status === 'done' ? 'success' : 'neutral'); }
  function priorityBadge(p) { return B.dom.badge(M.PRIORITIES[p] || p, p === 'high' ? 'strong' : 'neutral'); }
  function workBadge(ws) { return B.dom.badge(M.WORK_STATUSES[ws] || ws, WORK_TONE[ws] || 'neutral'); }
  function dueBadge(req, today) {
    var info = B.derive.dueInfo(req, today);
    return B.dom.badge(info.kind === 'later' || info.kind === 'done' ? info.label : info.short, DUE_TONE[info.kind]);
  }

  function pageHeader(title, subtitle, actions) {
    return h('div', { class: 'page-head' },
      h('div', null, h('h1', { class: 'page-title' }, title), subtitle ? h('p', { class: 'page-sub' }, subtitle) : null),
      actions ? h('div', { class: 'page-actions' }, actions) : null);
  }

  function backLink(href, label) {
    return h('a', { href: href, class: 'back-link' }, B.dom.icon('chevron', 'flip'), label);
  }

  function card(title, body, extra) {
    return h('section', { class: 'card' + (extra && extra.cls ? ' ' + extra.cls : ''), 'aria-labelledby': extra && extra.id ? extra.id : null },
      title ? h('h2', { class: 'card__title', id: extra && extra.id ? extra.id : null }, title) : null,
      body);
  }

  function notFoundState(what, backHref, backLabel) {
    return h('div', null,
      pageHeader(what + ' غير موجود'),
      B.dom.emptyState('لم يُعثر على العنصر المطلوب', 'ربما حُذف، أو الرابط غير صحيح.',
        h('a', { href: backHref, class: 'btn btn--secondary' }, backLabel)));
  }

  /*
   * جدول متجاوب: جدول على الحاسوب، وبطاقات على الجوال (CSS عبر data-label).
   * columns: [{ label, cell(row) → عقدة/نص, cls }]
   */
  function responsiveTable(caption, columns, rows, rowKey) {
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'rtable' },
        h('caption', { class: 'visually-hidden' }, caption),
        h('thead', null, h('tr', null, columns.map(function (c) { return h('th', { scope: 'col', class: c.cls || null }, c.label); }))),
        h('tbody', null, rows.map(function (row) {
          return h('tr', { dataset: rowKey ? { key: rowKey(row) } : {} }, columns.map(function (c) {
            return h('td', { 'data-label': c.label, class: c.cls || null }, c.cell(row));
          }));
        }))));
  }

  // قائمة المتطلبات (تُستخدم في القائمة الرئيسية وصفحات المؤشر والجهة).
  function requirementsTable(ctx, list, caption) {
    var L = ctx.lookups;
    return responsiveTable(caption, [
      { label: 'المتطلب', cls: 'col-main', cell: function (r) {
        return h('a', { href: '#/requirements/' + encodeURIComponent(r.id), class: 'row-link' }, r.title);
      } },
      { label: 'المؤشر', cell: function (r) { var i = L.indicatorsById[r.indicatorId]; return i ? B.dom.ltr(i.code) : '—'; } },
      { label: 'الجهة', cell: function (r) { var e = L.entitiesById[r.entityId]; return e ? e.name : '—'; } },
      { label: 'المكلَّف', cls: 'col-secondary', cell: function (r) { return person(r.assignee); } },
      { label: 'الموعد', cell: function (r) { return h('span', { class: 'stack-xs' }, B.format.formatDate(r.deadline), dueBadge(r, ctx.today)); } },
      { label: 'الحالة', cell: function (r) { return statusBadge(r.status); } },
      { label: 'الأولوية', cell: function (r) { return priorityBadge(r.priority); } },
      { label: 'آخر متابعة', cls: 'col-secondary', cell: function (r) { var f = B.derive.lastFollowUp(r); return f ? B.format.formatDate(f.date) : 'لا متابعات'; } }
    ], list, function (r) { return r.id; });
  }

  // ---------- النماذج ----------
  /*
   * حقل نموذج بتسمية ورسالة خطأ مرتبطة (aria-describedby).
   * spec: { id, label, required, hint, control }
   */
  function field(spec) {
    var errorId = spec.id + '-error';
    var hintId = spec.hint ? spec.id + '-hint' : null;
    var control = spec.control;
    control.id = spec.id;
    control.setAttribute('aria-describedby', [hintId, errorId].filter(Boolean).join(' '));
    if (spec.required) control.setAttribute('aria-required', 'true');
    return h('div', { class: 'field' + (spec.wide ? ' field--wide' : ''), dataset: { field: spec.name || spec.id } },
      h('label', { for: spec.id, class: 'field__label' }, spec.label, spec.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
      spec.hint ? h('p', { class: 'field__hint', id: hintId }, spec.hint) : null,
      control,
      h('p', { class: 'field__error', id: errorId, 'aria-live': 'polite' }));
  }

  function selectControl(name, options, value, placeholder) {
    var sel = h('select', { name: name, class: 'input' });
    if (placeholder !== undefined) sel.appendChild(h('option', { value: '' }, placeholder));
    options.forEach(function (o) {
      if (o.group) {
        sel.appendChild(h('optgroup', { label: o.group }, o.options.map(function (x) { return h('option', { value: x.value, selected: x.value === value }, x.label); })));
      } else {
        sel.appendChild(h('option', { value: o.value, selected: o.value === value }, o.label));
      }
    });
    return sel;
  }

  // يعرض الأخطاء بجانب الحقول ويركز على أولها. errors: { name: message }
  function showErrors(form, errors) {
    form.querySelectorAll('.field').forEach(function (f) {
      var name = f.dataset.field;
      var input = f.querySelector('input, select, textarea');
      var msg = f.querySelector('.field__error');
      var text = errors[name] || '';
      msg.textContent = text ? '⚠ ' + text : '';
      if (input) {
        if (text) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    });
    var first = form.querySelector('[aria-invalid="true"]');
    if (first) first.focus();
    var summary = form.querySelector('.form-summary');
    var count = Object.keys(errors).length;
    if (summary) {
      summary.textContent = count ? 'لم يُحفظ: يرجى تصحيح ' + (count === 1 ? 'حقل واحد' : count === 2 ? 'حقلين' : count + ' حقول') + '.' : '';
      summary.hidden = !count;
    }
    return count === 0;
  }

  /*
   * نتيجة عملية من js/actions.js على نموذج: عند الفشل تُعرض أخطاء الحقول، أو الرسالة العامة
   * إن لم يكن الخطأ في حقل بعينه (مثل «غير موجود»). يعيد true عند النجاح فقط.
   */
  function handle(form, res, ctx) {
    if (res && res.ok) { showErrors(form, {}); return true; }
    var errors = (res && res.errors) || {};
    showErrors(form, errors);
    if (!Object.keys(errors).length) {
      var summary = form.querySelector('.form-summary');
      var msg = (res && res.message) || 'تعذر الحفظ.';
      if (summary) { summary.textContent = msg; summary.hidden = false; }
      if (ctx) ctx.toast(msg, 'error');
    }
    return false;
  }

  var EVIDENCE_TONE = { pending: 'warning', verified: 'success', rejected: 'danger' };
  function evidenceBadge(status) { return B.dom.badge(M.EVIDENCE_STATUSES[status] || status, EVIDENCE_TONE[status] || 'neutral'); }
  function outcomeBadge(outcome) {
    if (!outcome) return null;
    var tone = outcome === 'delivered' ? 'success' : outcome === 'declined' ? 'danger' : outcome === 'no_reply' ? 'warning' : 'info';
    return B.dom.badge(M.FOLLOWUP_OUTCOMES[outcome] || outcome, tone);
  }

  // قائمة أدلة مختصرة (صفحات المؤشر والمتطلب والأدلة).
  function evidenceList(ctx, list) {
    return h('ul', { class: 'plain-list' }, list.map(function (ev) {
      var req = ev.requirementId ? ctx.lookups.requirementsById[ev.requirementId] : null;
      return h('li', { class: 'evidence-item' },
        h('p', { class: 'evidence-item__head' },
          h('a', { href: '#/evidence/' + encodeURIComponent(ev.id), class: 'strong' }, ev.title), ' ',
          evidenceBadge(ev.status), ' ', B.dom.badge(M.EVIDENCE_TYPES[ev.type] || ev.type, 'neutral')),
        h('p', { class: 'muted small' }, req ? ['المتطلب: ', h('a', { href: '#/requirements/' + encodeURIComponent(req.id) }, req.title)] : 'غير مرتبط بمتطلب',
          ev.reviewNote ? ' · ' + ev.reviewNote : ''));
    }));
  }

  // سؤال أو قرار، مع رابط الحسم إن كان مفتوحًا.
  function decisionItem(ctx, q, showIndicator) {
    var ind = ctx.lookups.indicatorsById[q.indicatorId];
    var age = B.format.daysBetween(q.askedOn, ctx.today);
    return h('li', { class: 'decision-item' },
      h('p', { class: 'strong' }, q.question),
      h('p', { class: 'muted small' },
        showIndicator && ind ? [h('a', { href: '#/indicators/' + encodeURIComponent(ind.id) }, B.dom.ltr(ind.code)), ' · '] : null,
        'موجه إلى: ', q.askedTo, ' · ', B.format.formatDate(q.askedOn), ' · ',
        q.status === 'open' ? B.dom.badge('مفتوح' + (age > 0 ? ' منذ ' + B.format.dayCount(age) : ''), 'warning') : B.dom.badge('محسوم', 'success')),
      q.status === 'resolved' ? h('p', null, 'القرار (' + B.format.formatDate(q.decidedOn) + '): ', q.decision)
        : h('a', { href: '#/decisions/' + encodeURIComponent(q.id) + '/resolve', class: 'btn btn--secondary btn--small' }, 'تسجيل القرار'));
  }

  function optionsFromMap(map) {
    return Object.keys(map).map(function (k) { return { value: k, label: map[k] }; });
  }

  // خيارات المؤشرات مجمعة حسب التصنيف والمعيار، مع تصفية اختيارية بالتصنيف.
  // opts.activeOnly: يستبعد المؤشرات المعطلة إلا opts.keepId (المؤشر الحالي عند التعديل).
  function indicatorOptions(indicators, ranking, opts) {
    var groups = {};
    var order = [];
    opts = opts || {};
    indicators.filter(function (i) { return (!ranking || i.ranking === ranking) && (!opts.activeOnly || i.active !== false || i.id === opts.keepId); })
      .slice().sort(function (a, b) { return a.ranking === b.ranking ? (a.order || 0) - (b.order || 0) : a.ranking < b.ranking ? -1 : 1; })
      .forEach(function (i) {
        var g = rankingName(i.ranking) + ' — ' + i.domain;
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push({ value: i.id, label: i.code + ' · ' + i.name });
      });
    return order.map(function (g) { return { group: g, options: groups[g] }; });
  }

  // متابعات مرتبة من الأحدث إلى الأقدم (AC-FUP-02).
  function sortedFollowUps(req) {
    return (req.followUps || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }

  B.ui = {
    RANKING_NAMES: RANKING_NAMES,
    rankingName: rankingName,
    person: person,
    statusBadge: statusBadge,
    priorityBadge: priorityBadge,
    workBadge: workBadge,
    dueBadge: dueBadge,
    pageHeader: pageHeader,
    backLink: backLink,
    card: card,
    notFoundState: notFoundState,
    responsiveTable: responsiveTable,
    requirementsTable: requirementsTable,
    field: field,
    selectControl: selectControl,
    showErrors: showErrors,
    handle: handle,
    evidenceBadge: evidenceBadge,
    outcomeBadge: outcomeBadge,
    evidenceList: evidenceList,
    decisionItem: decisionItem,
    optionsFromMap: optionsFromMap,
    indicatorOptions: indicatorOptions,
    sortedFollowUps: sortedFollowUps
  };
})(window);
