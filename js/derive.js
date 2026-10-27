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

  // المؤشرات المعطلة لا تدخل في الجاهزية ولا المُدخل ولا الخطر.
  function activeIndicators(list) {
    return list.filter(function (i) { return i.active !== false; });
  }

  function countPhrase(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return n + ' ' + few;
    return n + ' ' + many;
  }

  /*
   * حالة التصنيف (C-RANK-DAYS وC-RISK): الأيام المتبقية، والجاهزية، والإنجاز، والخطر بأسباب مكتوبة.
   */
  function rankingStatus(data, rankingId, today) {
    var rk = (data.rankings || []).filter(function (r) { return r.id === rankingId; })[0] || { id: rankingId, submissionDeadline: '' };
    var inds = activeIndicators(data.indicators.filter(function (i) { return i.ranking === rankingId; }));
    var ids = {};
    inds.forEach(function (i) { ids[i.id] = true; });
    var reqs = data.requirements.filter(function (r) { return ids[r.indicatorId]; });
    var open = reqs.filter(isOpen);
    var overdue = open.filter(function (r) { return dueInfo(r, today).kind === 'overdue'; }).length;
    var afterDeadline = rk.submissionDeadline ? open.filter(function (r) { return r.deadline > rk.submissionDeadline; }).length : 0;
    var days = rk.submissionDeadline ? format.daysBetween(today, rk.submissionDeadline) : null;
    var readiness = indicatorReadiness(inds);
    var reasons = [];
    if (overdue) reasons.push(countPhrase(overdue, 'متطلب واحد متأخر', 'متطلبان متأخران', 'متطلبات متأخرة', 'متطلبًا متأخرًا'));
    if (afterDeadline) reasons.push(countPhrase(afterDeadline, 'متطلب واحد', 'متطلبان', 'متطلبات', 'متطلبًا') + ' موعده بعد موعد التسليم');
    if (days !== null && days >= 0 && days <= 14 && readiness !== null && readiness < 50) {
      reasons.push('الجاهزية ' + readiness + '% مع بقاء ' + (days === 0 ? 'يوم التسليم' : format.dayCount(days)));
    }
    if (days !== null && days < 0) reasons.push('انتهى موعد التسليم منذ ' + format.dayCount(days));
    return {
      deadline: rk.submissionDeadline || '', days: days, readiness: readiness, progress: requirementProgress(reqs),
      entered: enteredCount(inds), total: inds.length, overdue: overdue, afterDeadline: afterDeadline,
      risk: reasons.length > 0, reasons: reasons
    };
  }

  /*
   * C-FUP-DUE: متطلبات غير مكتملة آخر متابعة لها فيها موعد إجراء تالٍ حلّ (≤ اليوم).
   * المتابعة الأحدث تُلغي موعد ما قبلها.
   */
  function dueFollowUps(requirements, today) {
    var out = [];
    requirements.forEach(function (r) {
      if (r.status === 'done') return;
      var last = lastFollowUp(r);
      if (last && last.nextActionDate && last.nextActionDate <= today) {
        out.push({ requirement: r, followUp: last, daysLate: format.daysBetween(last.nextActionDate, today) });
      }
    });
    return out.sort(function (a, b) { return b.daysLate - a.daysLate; });
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
    hasValueConflict: hasValueConflict,
    activeIndicators: activeIndicators,
    rankingStatus: rankingStatus,
    dueFollowUps: dueFollowUps
  };
});
