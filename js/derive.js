/*
 * القيم المشتقة للعرض (لا تُخزن): المواعيد، والإنجاز، والجاهزية، والإلحاح — منصة «بصيرة»
 * التعريفات في docs/design/04-rules-and-calculations.md (C-OVERDUE، C-DUESOON، C-REQ-PROGRESS،
 * C-IND-PROGRESS، C-ENTERED، C-URGENCY).
 * يعمل في المتصفح (window.Basira.derive) وفي Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./format.js'), require('./model.js'));
  } else {
    root.Basira = root.Basira || {};
    root.Basira.derive = factory(root.Basira.format, root.Basira.model);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (format, model) {
  'use strict';

  var DUE_SOON_DAYS = 7;
  var READINESS_WEIGHTS = { not_started: 0, draft: 1 / 3, evidenced: 2 / 3, entered: 1 };
  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  var GROUP = { overdue: 1, soon: 2, later: 3, none: 3, done: 4 };

  /*
   * حالة الموعد لمتطلب في تاريخ معين.
   * kind: done | overdue | soon | later | none (موعد غير صالح)
   */
  function dueInfo(req, today) {
    if (req.status === 'done') return { kind: 'done', days: null, label: 'مكتمل', short: 'مكتمل' };
    var days = format.daysBetween(today, req.deadline);
    if (days === null) return { kind: 'none', days: null, label: 'لا موعد صالح', short: 'لا موعد' };
    if (days < 0) {
      return { kind: 'overdue', days: days, label: 'متأخر منذ ' + format.dayCount(days), short: 'متأخر ' + format.dayCount(days) };
    }
    if (days === 0) return { kind: 'soon', days: 0, label: 'اليوم آخر موعد', short: 'اليوم آخر موعد' };
    if (days <= DUE_SOON_DAYS) {
      return { kind: 'soon', days: days, label: 'متبقٍ ' + format.dayCount(days), short: 'قريب: ' + format.dayCount(days) };
    }
    return { kind: 'later', days: days, label: 'متبقٍ ' + format.dayCount(days), short: 'متبقٍ ' + format.dayCount(days) };
  }

  function isOpen(req) {
    return req.status !== 'done';
  }

  // C-REQ-PROGRESS: { done, total, pct } و pct = null إذا لم توجد متطلبات.
  function requirementProgress(list) {
    var done = list.filter(function (r) { return r.status === 'done'; }).length;
    return { done: done, total: list.length, pct: format.percent(done, list.length) };
  }

  // C-IND-PROGRESS: متوسط أوزان حالات العمل × 100.
  function indicatorReadiness(indicators) {
    if (!indicators.length) return null;
    var sum = indicators.reduce(function (s, i) { return s + (READINESS_WEIGHTS[i.workStatus] || 0); }, 0);
    return Math.round((sum / indicators.length) * 100);
  }

  // C-ENTERED
  function enteredCount(indicators) {
    return indicators.filter(function (i) { return i.workStatus === 'entered'; }).length;
  }

  // C-URGENCY: دالة مقارنة للترتيب بالإلحاح.
  function urgencyComparator(today) {
    return function (a, b) {
      var da = dueInfo(a, today);
      var db = dueInfo(b, today);
      var g = GROUP[da.kind] - GROUP[db.kind];
      if (g) return g;
      var pa = PRIORITY_RANK[a.priority] === undefined ? 1 : PRIORITY_RANK[a.priority];
      var pb = PRIORITY_RANK[b.priority] === undefined ? 1 : PRIORITY_RANK[b.priority];
      if (da.kind === 'overdue' || da.kind === 'soon') {
        if (da.days !== db.days) return da.days - db.days;
        if (pa !== pb) return pa - pb;
      } else if (da.kind !== 'done') {
        if (pa !== pb) return pa - pb;
        if (da.days !== db.days) return (da.days === null ? Infinity : da.days) - (db.days === null ? Infinity : db.days);
      }
      return String(a.title).localeCompare(String(b.title), 'ar');
    };
  }

  function sortByUrgency(list, today) {
    return list.slice().sort(urgencyComparator(today));
  }

  // آخر متابعة (الأحدث تاريخًا) أو null.
  function lastFollowUp(req) {
    var list = (req.followUps || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return list[0] || null;
  }

  // ملخص لكل جهة: { entityId: { total, open, overdue, done, pct, assignees[] } }
  function summaryByEntity(requirements, entities, today) {
    var out = {};
    entities.forEach(function (e) { out[e.id] = { total: 0, open: 0, overdue: 0, done: 0, pct: null, assignees: [] }; });
    requirements.forEach(function (r) {
      var s = out[r.entityId];
      if (!s) return;
      s.total++;
      if (r.status === 'done') s.done++;
      else {
        s.open++;
        if (dueInfo(r, today).kind === 'overdue') s.overdue++;
      }
      if (r.assignee && s.assignees.indexOf(r.assignee) === -1) s.assignees.push(r.assignee);
    });
    Object.keys(out).forEach(function (k) { out[k].pct = format.percent(out[k].done, out[k].total); });
    return out;
  }

  function hasValueConflict(indicator) {
    return model.hasValueConflict(indicator);
  }

  return {
    DUE_SOON_DAYS: DUE_SOON_DAYS,
    dueInfo: dueInfo,
    isOpen: isOpen,
    requirementProgress: requirementProgress,
    indicatorReadiness: indicatorReadiness,
    enteredCount: enteredCount,
    urgencyComparator: urgencyComparator,
    sortByUrgency: sortByUrgency,
    lastFollowUp: lastFollowUp,
    summaryByEntity: summaryByEntity,
    hasValueConflict: hasValueConflict
  };
});
