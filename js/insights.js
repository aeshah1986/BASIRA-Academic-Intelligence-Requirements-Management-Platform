/*
 * محرك التحليل التشغيلي — منصة «بصيرة»
 * ------------------------------------------------------------
 * قواعد حسابية مكتوبة وثابتة فقط (Rule-based automation)، وليس ذكاءً اصطناعيًا:
 * لا نموذج لغوي، ولا تعلم آلي، ولا اتصال بالإنترنت، ولا عشوائية. المدخلات نفسها تعطي النتيجة نفسها دائمًا،
 * وكل نتيجة تُعرض مع القاعدة التي أنتجتها. التوثيق الكامل والحدود في docs/design/09-operational-engine.md.
 * كل الدوال نقية: تقرأ البيانات وتاريخ اليوم ولا تعدّلها.
 * يعمل في المتصفح (window.Basira.insights) وفي Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./format.js'), require('./model.js'), require('./derive.js'));
  } else {
    root.Basira = root.Basira || {};
    root.Basira.insights = factory(root.Basira.format, root.Basira.model, root.Basira.derive);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, M, D) {
  'use strict';

  // ---------- الثوابت (قابلة للمراجعة في التوثيق) ----------
  var STALE_FOLLOWUP_DAYS = 7;   // «بانتظار الجهة» دون متابعة خلال 7 أيام
  var SUBMISSION_NEAR_DAYS = 14; // موعد تسليم التصنيف قريب
  var STALE_DECISION_DAYS = 7;   // سؤال مفتوح أكثر من 7 أيام
  var SOON_HIGH_DAYS = 3;        // أولوية عالية وموعدها خلال 3 أيام

  // سلّم التصعيد (docs/design/07 §3). offset بالنسبة لموعد المتطلب، وL0 مستحق دائمًا.
  var LEVELS = [
    { level: 0, code: 'L0', name: M.ESCALATION_NAMES[0], to: 'منسق البيانات في الجهة', offset: null },
    { level: 1, code: 'L1', name: M.ESCALATION_NAMES[1], to: 'منسق البيانات في الجهة', offset: -3 },
    { level: 2, code: 'L2', name: M.ESCALATION_NAMES[2], to: 'رئيس الجهة', offset: 1 },
    { level: 3, code: 'L3', name: M.ESCALATION_NAMES[3], to: 'الوكيل المشرف على الجهة', offset: 3 },
    { level: 4, code: 'L4', name: M.ESCALATION_NAMES[4], to: 'مكتب رئيس الجامعة / لجنة التصنيفات', offset: 7 }
  ];

  var PRIORITY_POINTS = { high: 20, medium: 10, low: 0 };

  function countPhrase(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return n + ' ' + few;
    return n + ' ' + many;
  }

  function index(list) {
    var o = {};
    (list || []).forEach(function (x) { o[x.id] = x; });
    return o;
  }

  // سياق مشترك يُبنى مرة لكل حساب.
  function context(data) {
    return {
      indicatorsById: index(data.indicators),
      entitiesById: index(data.entities),
      rankingsById: index(data.rankings)
    };
  }

  function rankingOf(req, cx) {
    var ind = cx.indicatorsById[req.indicatorId];
    return ind ? cx.rankingsById[ind.ranking] || null : null;
  }

  // ---------- 1. شروط الاكتمال والنواقص (R-COMPLETE-REQ + جودة البيانات) ----------
  /*
   * لكل متطلب مفتوح: قائمة شروط، لكل منها met: true | false.
   * blocking: شرطا الاكتمال الرسميان (لا نواقص، ورابط دليل). quality: شروط جودة البيانات.
   * شرط «تواصل موثق» يُطلب فقط إذا كان المتطلب «بانتظار الجهة» أو متأخرًا.
   */
  function requirementConditions(req, data, today, cx) {
    cx = cx || context(data);
    if (req.status === 'done') return { done: true, conditions: [], unmet: [], met: 0, total: 0, pct: 100, ready: true };
    var due = D.dueInfo(req, today);
    var rk = rankingOf(req, cx);
    var afterSubmission = !!(rk && rk.submissionDeadline && F.parseISO(req.deadline) !== null && req.deadline > rk.submissionDeadline);
    var list = [
      { key: 'missingData', group: 'blocking', met: !String(req.missingData || '').trim(), label: 'لا بيانات ناقصة مسجلة', fix: 'استلام البيانات الناقصة: ' + String(req.missingData || '').trim() },
      { key: 'evidenceLink', group: 'blocking', met: M.isHttpUrl(req.evidenceLink || ''), label: 'رابط دليل', fix: 'إضافة رابط الدليل' },
      { key: 'assignee', group: 'quality', met: !!String(req.assignee || '').trim(), label: 'مكلَّف محدد', fix: 'تحديد المكلَّف' },
      { key: 'deadline', group: 'quality', met: due.kind !== 'none' && !afterSubmission, label: 'موعد صالح قبل موعد تسليم التصنيف',
        fix: due.kind === 'none' ? 'تحديد موعد صالح' : 'تقديم الموعد قبل موعد تسليم التصنيف (' + (rk ? F.formatDate(rk.submissionDeadline) : '') + ')' }
    ];
    if (req.status === 'waiting' || due.kind === 'overdue') {
      list.push({ key: 'contact', group: 'quality', met: (req.followUps || []).length > 0, label: 'تواصل موثق مع الجهة', fix: 'تسجيل متابعة مع الجهة' });
    }
    var unmet = list.filter(function (c) { return !c.met; });
    var met = list.length - unmet.length;
    return {
      done: false,
      conditions: list,
      unmet: unmet,
      met: met,
      total: list.length,
      pct: Math.round(100 * met / list.length),
      ready: list.filter(function (c) { return c.group === 'blocking'; }).every(function (c) { return c.met; })
    };
  }

  // المتطلبات المفتوحة التي ينقصها شرط واحد على الأقل، الأكثر نقصًا أولًا.
  function incompleteRequirements(data, today) {
    var cx = context(data);
    return data.requirements.filter(D.isOpen).map(function (r) {
      return { requirement: r, check: requirementConditions(r, data, today, cx) };
    }).filter(function (x) { return x.check.unmet.length > 0; })
      .sort(function (a, b) { return b.check.unmet.length - a.check.unmet.length || D.urgencyComparator(today)(a.requirement, b.requirement); });
  }

  /*
   * مؤشرات مفعلة تحتاج انتباهًا:
   * - unattended: لا متطلب مفتوح عليه، ولم يُدخل، ولا قيمة حالية (لا أحد يعمل عليه).
   * - conflict: القيمة الحالية تخالف ملف التقدم.
   */
  function indicatorGaps(data) {
    var out = [];
    D.activeIndicators(data.indicators).forEach(function (i) {
      var open = data.requirements.filter(function (r) { return r.indicatorId === i.id && D.isOpen(r); }).length;
      var reasons = [];
      if (!open && i.workStatus !== 'entered' && !String(i.currentValue || '').trim()) reasons.push({ key: 'unattended', label: 'لا متطلب مفتوح ولا قيمة حالية ولم يُدخل' });
      if (D.hasValueConflict(i)) reasons.push({ key: 'conflict', label: 'القيمة الحالية تخالف ملف التقدم' });
      if (reasons.length) out.push({ indicator: i, reasons: reasons });
    });
    return out.sort(function (a, b) {
      return a.indicator.ranking < b.indicator.ranking ? -1 : a.indicator.ranking > b.indicator.ranking ? 1 : (a.indicator.order || 0) - (b.indicator.order || 0);
    });
  }

  // ---------- 2. نسب الإنجاز من البيانات الفعلية ----------
  var DUE_BUCKETS = [
    { key: 'overdue', label: 'متأخر' },
    { key: 'soon', label: 'خلال 7 أيام' },
    { key: 'month', label: 'من 8 إلى 30 يومًا' },
    { key: 'later', label: 'بعد أكثر من 30 يومًا' },
    { key: 'none', label: 'لا موعد صالح' },
    { key: 'done', label: 'مكتمل' }
  ];

  function dueBucket(req, today) {
    var info = D.dueInfo(req, today);
    if (info.kind === 'later') return info.days <= 30 ? 'month' : 'later';
    return info.kind;
  }

  function completion(data, today) {
    var reqs = data.requirements;
    var byStatus = {};
    Object.keys(M.STATUSES).forEach(function (s) { byStatus[s] = 0; });
    reqs.forEach(function (r) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
    var buckets = {};
    DUE_BUCKETS.forEach(function (b) { buckets[b.key] = 0; });
    reqs.forEach(function (r) { buckets[dueBucket(r, today)]++; });
    var byPriority = {};
    Object.keys(M.PRIORITIES).forEach(function (p) {
      byPriority[p] = D.requirementProgress(reqs.filter(function (r) { return r.priority === p; }));
    });
    var rankings = (data.rankings || []).map(function (rk) {
      var st = D.rankingStatus(data, rk.id, today);
      return { id: rk.id, name: rk.name, readiness: st.readiness, progress: st.progress, entered: st.entered, total: st.total, days: st.days, risk: st.risk, reasons: st.reasons };
    }).filter(function (x) { return x.total > 0 || x.progress.total > 0; });
    var ents = D.summaryByEntity(reqs, data.entities, today);
    var entities = data.entities.map(function (e) { var s = ents[e.id]; return { id: e.id, name: e.name, total: s.total, done: s.done, open: s.open, overdue: s.overdue, pct: s.pct }; })
      .filter(function (x) { return x.total > 0; });
    return {
      overall: D.requirementProgress(reqs),
      open: reqs.filter(D.isOpen).length,
      overdue: buckets.overdue,
      byStatus: byStatus,
      buckets: buckets,
      byPriority: byPriority,
      rankings: rankings,
      entities: entities
    };
  }

  // ---------- 3. درجة الأولوية مع شرحها ----------
  /*
   * الدرجة = مجموع نقاط القواعد التي تنطبق، وكل قاعدة تُعرض بنقاطها وسببها:
   *   الموعد: متأخر 50 + أيام التأخر (حتى 30) | خلال 0–7 أيام 30 + 2 × (7 − الأيام) | خلال 8–30 يومًا 10 | لا موعد صالح 20
   *   الأولوية: عالية 20 | متوسطة 10 | منخفضة 0
   *   «بانتظار الجهة» دون متابعة خلال 7 أيام: 10
   *   الموعد بعد موعد تسليم التصنيف: 15
   *   موعد تسليم التصنيف خلال 14 يومًا: 10
   *   حلّ موعد الإجراء التالي المسجل في آخر متابعة: 10
   */
  function priorityScore(req, data, today, cx) {
    cx = cx || context(data);
    if (req.status === 'done') return { score: 0, factors: [] };
    var factors = [];
    var due = D.dueInfo(req, today);
    if (due.kind === 'overdue') {
      var late = -due.days;
      factors.push({ key: 'overdue', points: 50 + Math.min(late, 30), label: 'متأخر منذ ' + F.dayCount(late) + ' (50 + ' + Math.min(late, 30) + ')' });
    } else if (due.kind === 'soon') {
      factors.push({ key: 'soon', points: 30 + 2 * (7 - due.days), label: (due.days === 0 ? 'اليوم آخر موعد' : 'الموعد بعد ' + F.dayCount(due.days)) + ' (30 + 2 × ' + (7 - due.days) + ')' });
    } else if (due.kind === 'later' && due.days <= 30) {
      factors.push({ key: 'month', points: 10, label: 'الموعد خلال 30 يومًا' });
    } else if (due.kind === 'none') {
      factors.push({ key: 'nodate', points: 20, label: 'لا موعد صالح' });
    }
    var pp = PRIORITY_POINTS[req.priority];
    if (pp) factors.push({ key: 'priority', points: pp, label: 'الأولوية ' + M.PRIORITIES[req.priority] });
    if (req.status === 'waiting') {
      var last = D.lastFollowUp(req);
      var since = last ? F.daysBetween(last.date, today) : null;
      if (!last) factors.push({ key: 'nofollowup', points: 10, label: 'بانتظار الجهة دون أي متابعة مسجلة' });
      else if (since !== null && since >= STALE_FOLLOWUP_DAYS) factors.push({ key: 'nofollowup', points: 10, label: 'بانتظار الجهة وآخر متابعة منذ ' + F.dayCount(since) });
    }
    var rk = rankingOf(req, cx);
    if (rk && rk.submissionDeadline) {
      if (F.parseISO(req.deadline) !== null && req.deadline > rk.submissionDeadline) {
        factors.push({ key: 'aftersubmission', points: 15, label: 'موعده بعد موعد تسليم التصنيف' });
      }
      var left = F.daysBetween(today, rk.submissionDeadline);
      if (left !== null && left >= 0 && left <= SUBMISSION_NEAR_DAYS) {
        factors.push({ key: 'submission', points: 10, label: 'موعد تسليم ' + rk.name + ' بعد ' + (left === 0 ? 'أقل من يوم' : F.dayCount(left)) });
      }
    }
    var lastFu = D.lastFollowUp(req);
    if (lastFu && lastFu.nextActionDate && lastFu.nextActionDate <= today) {
      factors.push({ key: 'nextaction', points: 10, label: 'حلّ موعد الإجراء التالي (' + F.formatDate(lastFu.nextActionDate) + ')' });
    }
    var score = factors.reduce(function (s, f) { return s + f.points; }, 0);
    return { score: score, factors: factors };
  }

  // ترتيب المتطلبات المفتوحة بالدرجة (الأعلى أولًا)، والتعادل يُحسم بقاعدة الإلحاح C-URGENCY.
  function rankRequirements(data, today) {
    var cx = context(data);
    var cmp = D.urgencyComparator(today);
    return data.requirements.filter(D.isOpen).map(function (r) {
      var s = priorityScore(r, data, today, cx);
      return { requirement: r, score: s.score, factors: s.factors };
    }).sort(function (a, b) { return b.score - a.score || cmp(a.requirement, b.requirement); })
      .map(function (x, i) { x.rank = i + 1; return x; });
  }

  // ---------- 4. سلّم التصعيد C-ESC والخطوة التالية ----------
  function levelDate(req, level) {
    var L = LEVELS[level];
    if (L.offset === null) return null;
    return F.addDays(req.deadline, L.offset);
  }

  // أعلى مستوى تصعيد مسجل في متابعات المتطلب، أو -1.
  function executedLevel(req) {
    return (req.followUps || []).reduce(function (m, f) {
      var l = f && f.escalationLevel;
      return typeof l === 'number' && l >= 0 && l <= 4 && l > m ? l : m;
    }, -1);
  }

  /*
   * C-ESC (docs/design/07 §3):
   * المستحق = أعلى مستوى حلّ تاريخه حتى اليوم (L0 دائمًا). المنفذ = أعلى escalationLevel مسجل.
   * kind: none (مكتمل) | action (المستحق > المنفذ) | wait (لا جديد اليوم) | max (نُفذ L4)
   */
  function escalation(req, today) {
    if (req.status === 'done') return { kind: 'none', due: null, executed: executedLevel(req), skipped: 0, next: null };
    var validDeadline = F.parseISO(req.deadline) !== null;
    var due = 0;
    if (validDeadline) {
      for (var l = 1; l <= 4; l++) if (levelDate(req, l) <= today) due = l;
    }
    var executed = executedLevel(req);
    var nextOf = function (from) {
      if (!validDeadline || from >= 4) return null;
      return { level: from + 1, date: levelDate(req, from + 1) };
    };
    if (due > executed) {
      return { kind: 'action', due: due, executed: executed, skipped: Math.max(0, due - executed - 1), next: nextOf(due) };
    }
    if (executed >= 4) return { kind: 'max', due: due, executed: executed, skipped: 0, next: null };
    return { kind: 'wait', due: due, executed: executed, skipped: 0, next: nextOf(executed) };
  }

  /*
   * الخطوة التالية لمتطلب، بقواعد مرتبة (أول قاعدة تنطبق):
   * 1) مكتمل ← لا إجراء. 2) شرطا الاكتمال متحققان ← تغيير الحالة إلى «مكتمل».
   * 3) لا مكلَّف ← تحديد المكلَّف. 4) لا موعد صالح ← تحديد موعد.
   * 5) C-ESC مستحق ← إعداد خطاب المستوى. 6) وإلا ← انتظار الرد حتى تاريخ المستوى التالي.
   */
  function nextStep(req, data, today, cx) {
    cx = cx || context(data);
    var esc = escalation(req, today);
    var base = { escalation: esc, level: null, rule: '' };
    if (req.status === 'done') return Object.assign(base, { kind: 'none', rule: 'S1', text: 'لا إجراء: المتطلب مكتمل.' });
    var check = requirementConditions(req, data, today, cx);
    if (check.ready) return Object.assign(base, { kind: 'complete', rule: 'S2', text: 'شرطا الاكتمال متحققان: يمكن تغيير الحالة إلى «مكتمل».' });
    if (!String(req.assignee || '').trim()) return Object.assign(base, { kind: 'assign', rule: 'S3', text: 'تحديد المكلَّف بالمتطلب.' });
    if (F.parseISO(req.deadline) === null) return Object.assign(base, { kind: 'deadline', rule: 'S4', text: 'تحديد موعد صالح للمتطلب.' });
    if (esc.kind === 'action') {
      var L = LEVELS[esc.due];
      var t = 'إعداد خطاب ' + L.code + ' (' + L.name + ') إلى ' + L.to + '.';
      if (esc.skipped) t += ' تنبيه: تُجووز ' + countPhrase(esc.skipped, 'مستوى واحد', 'مستويان', 'مستويات', 'مستوى') + ' دون توثيق، فيُستحسن تسجيل ما تم فعلًا من تواصل.';
      return Object.assign(base, { kind: 'letter', rule: 'S5', level: esc.due, text: t });
    }
    if (esc.kind === 'max') return Object.assign(base, { kind: 'decision', rule: 'S6', text: 'نُفذ أعلى مستوى تصعيد: يُطلب قرار بديل من اللجنة (تسليم جزئي، أو مصدر بديل، أو عدم تقديم).' });
    var nx = esc.next;
    return Object.assign(base, { kind: 'wait', rule: 'S6', text: nx ? 'انتظار رد الجهة. التالي: ' + LEVELS[nx.level].code + ' (' + LEVELS[nx.level].name + ') في ' + F.formatDate(nx.date) + '.' : 'انتظار رد الجهة.' });
  }

  // ---------- 5. التنبيهات العاجلة ----------
  /*
   * danger: متطلب متأخر، تصنيف في خطر (C-RISK).
   * warning: موعد إجراء تالٍ حلّ (C-FUP-DUE)، أولوية عالية وموعدها خلال 3 أيام، تعارض قيم، سؤال مفتوح أكثر من 7 أيام.
   */
  function alerts(data, today) {
    var out = [];
    var cx = context(data);
    data.requirements.filter(D.isOpen).forEach(function (r) {
      var info = D.dueInfo(r, today);
      var ent = cx.entitiesById[r.entityId];
      if (info.kind === 'overdue') {
        out.push({ level: 'danger', kind: 'overdue', title: r.title, detail: info.label + ' · ' + (ent ? ent.name : '—'), href: '#/requirements/' + encodeURIComponent(r.id), sort: info.days });
      } else if (info.kind === 'soon' && r.priority === 'high' && info.days <= SOON_HIGH_DAYS) {
        out.push({ level: 'warning', kind: 'soon_high', title: r.title, detail: 'أولوية عالية و' + info.label, href: '#/requirements/' + encodeURIComponent(r.id), sort: info.days });
      }
    });
    (data.rankings || []).forEach(function (rk) {
      var st = D.rankingStatus(data, rk.id, today);
      if (st.risk) out.push({ level: 'danger', kind: 'ranking_risk', title: rk.name + ' في خطر', detail: st.reasons.join(' · '), href: '#/rankings?ranking=' + encodeURIComponent(rk.id), sort: -1000 });
    });
    D.dueFollowUps(data.requirements, today).forEach(function (x) {
      out.push({ level: 'warning', kind: 'followup_due', title: x.requirement.title, detail: 'حلّ موعد الإجراء التالي ' + (x.daysLate ? 'منذ ' + F.dayCount(x.daysLate) : 'اليوم'), href: '#/requirements/' + encodeURIComponent(x.requirement.id), sort: -x.daysLate });
    });
    D.activeIndicators(data.indicators).filter(D.hasValueConflict).forEach(function (i) {
      out.push({ level: 'warning', kind: 'conflict', title: 'تعارض قيم في ' + i.code, detail: 'الحالية ' + i.currentValue + ' وملف التقدم ' + i.progressFileValue, href: '#/indicators/' + encodeURIComponent(i.id), sort: 0 });
    });
    (data.decisions || []).filter(function (q) { return q.status === 'open'; }).forEach(function (q) {
      var age = F.daysBetween(q.askedOn, today);
      if (age !== null && age > STALE_DECISION_DAYS) {
        out.push({ level: 'warning', kind: 'decision_stale', title: 'سؤال بلا قرار منذ ' + F.dayCount(age), detail: q.question, href: '#/followups?tab=decisions', sort: -age });
      }
    });
    var rank = { danger: 0, warning: 1 };
    return out.sort(function (a, b) { return rank[a.level] - rank[b.level] || a.sort - b.sort || String(a.title).localeCompare(String(b.title), 'ar'); });
  }

  // ---------- 6. استجابة الجهات (docs/design/07 §4.4) ----------
  function completionDate(r) {
    return String(r.completedAt || r.updatedAt || '').slice(0, 10);
  }

  function entityResponse(data, today) {
    return data.entities.map(function (e) {
      var reqs = data.requirements.filter(function (r) { return r.entityId === e.id; });
      var done = reqs.filter(function (r) { return r.status === 'done'; });
      var dated = done.filter(function (r) { return F.parseISO(completionDate(r)) !== null && F.parseISO(r.deadline) !== null; });
      var onTime = dated.filter(function (r) { return completionDate(r) <= r.deadline; });
      var late = dated.filter(function (r) { return completionDate(r) > r.deadline; });
      var lateDays = late.reduce(function (s, r) { return s + F.daysBetween(r.deadline, completionDate(r)); }, 0);
      var escalations = reqs.reduce(function (s, r) { return s + (r.followUps || []).filter(function (f) { return typeof f.escalationLevel === 'number' && f.escalationLevel >= 3; }).length; }, 0);
      var open = reqs.filter(D.isOpen);
      return {
        id: e.id, name: e.name, total: reqs.length, completed: done.length,
        onTime: onTime.length, onTimePct: F.percent(onTime.length, dated.length),
        avgLateDays: late.length ? Math.round(10 * lateDays / late.length) / 10 : null,
        escalations: escalations,
        open: open.length,
        overdue: open.filter(function (r) { return D.dueInfo(r, today).kind === 'overdue'; }).length
      };
    }).filter(function (x) { return x.total > 0; });
  }

  // ---------- 7. الخطابات من قوالب قابلة للتعديل ----------
  var PLACEHOLDERS = {
    'الجهة': 'اسم الجهة',
    'المستلم': 'المسمى الوظيفي للمستلم',
    'البنود': 'قائمة البنود المطلوبة (تُبنى من المتطلبات المفتوحة)',
    'الموعد': 'أقرب موعد بين البنود',
    'أيام_التأخر': 'أكبر تأخر بين البنود',
    'التصنيف': 'اسم التصنيف أو التصنيفات',
    'موعد_التسليم': 'أقرب موعد تسليم للتصنيفات المعنية',
    'التاريخ': 'تاريخ اليوم'
  };

  var DEFAULT_TEMPLATES = {
    L0: {
      subject: 'طلب استكمال بيانات {التصنيف}',
      body: 'سعادة {المستلم} في {الجهة} المحترم،\nالسلام عليكم ورحمة الله وبركاته،\n\nفي إطار استكمال بيانات {التصنيف}، نأمل التكرم بتزويدنا بالبنود التالية، مع تأكيد قيمة العام الماضي أو تحديثها وإرفاق الدليل معتمدًا:\n{البنود}\n\nآخر موعد للتسليم: {الموعد}، علمًا بأن موعد تسليم التصنيف هو {موعد_التسليم}.\n\nشاكرين تعاونكم،\nمنسق وحدة التصنيفات\n{التاريخ}'
    },
    L1: {
      subject: 'تذكير: بيانات {التصنيف}',
      body: 'سعادة {المستلم} في {الجهة} المحترم،\n\nتذكير ودي بأن موعد تسليم البنود التالية يحل في {الموعد}:\n{البنود}\n\nنقدر تعاونكم، ويسعدنا الإجابة عن أي استفسار.\nمنسق وحدة التصنيفات\n{التاريخ}'
    },
    L2: {
      subject: 'تذكير رسمي: تأخر بيانات {التصنيف}',
      body: 'سعادة {المستلم} المحترم،\n\nإشارة إلى طلبنا بشأن بيانات {التصنيف}، نفيدكم بأن موعد التسليم المحدد ({الموعد}) قد انقضى منذ {أيام_التأخر}، ولم تصلنا البنود التالية:\n{البنود}\n\nنأمل التكرم بتوجيه المختصين لاستكمالها في أقرب وقت، علمًا بأن موعد تسليم التصنيف هو {موعد_التسليم}.\nمنسق وحدة التصنيفات\n{التاريخ}'
    },
    L3: {
      subject: 'تصعيد: بيانات {التصنيف} المتأخرة لدى {الجهة}',
      body: 'سعادة {المستلم} المحترم،\n\nنحيطكم علمًا بأن البنود التالية المطلوبة من {الجهة} لم تصل رغم انقضاء موعدها ({الموعد}) منذ {أيام_التأخر} والتذكير بها:\n{البنود}\n\nنأمل التكرم بالتوجيه بما ترونه، فموعد تسليم {التصنيف} هو {موعد_التسليم}.\nمنسق وحدة التصنيفات\n{التاريخ}'
    },
    L4: {
      subject: 'طلب قرار: بيانات {التصنيف} غير المستلمة من {الجهة}',
      body: 'سعادة {المستلم} المحترم،\n\nلم تصل البنود التالية من {الجهة} رغم انقضاء موعدها ({الموعد}) منذ {أيام_التأخر} وتصعيدها:\n{البنود}\n\nنأمل اتخاذ قرار بديل قبل موعد تسليم {التصنيف} ({موعد_التسليم}): تسليم جزئي بالأدلة المتوفرة، أو اعتماد مصدر بديل، أو عدم تقديم المؤشر.\nمنسق وحدة التصنيفات\n{التاريخ}'
    }
  };

  function templateFor(data, code) {
    var custom = data && data.settings && data.settings.letterTemplates && data.settings.letterTemplates[code];
    return custom ? { subject: custom.subject, body: custom.body, custom: true } : { subject: DEFAULT_TEMPLATES[code].subject, body: DEFAULT_TEMPLATES[code].body, custom: false };
  }

  // المتغيرات غير المعروفة في نص قالب (مثل {الجهه} بخطأ إملائي).
  function unknownPlaceholders(text) {
    var out = [];
    String(text || '').replace(/\{([^{}\n]{1,40})\}/g, function (m, name) {
      if (!Object.prototype.hasOwnProperty.call(PLACEHOLDERS, name) && out.indexOf(name) === -1) out.push(name);
      return m;
    });
    return out;
  }

  // يستبدل المتغيرات المعروفة فقط، ويترك غيرها كما هو ليظهر للمستخدمة.
  function renderTemplate(text, vars) {
    return String(text || '').replace(/\{([^{}\n]{1,40})\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }

  function itemLine(r, cx) {
    var ind = cx.indicatorsById[r.indicatorId];
    var parts = ['• ' + r.title + (ind ? ' (المؤشر ' + ind.code + ')' : '')];
    var need = String(r.missingData || '').trim() || String(r.description || '').trim();
    if (need) parts.push('  المطلوب: ' + need);
    if (ind && String(ind.lastYearValue || '').trim()) parts.push('  قيمة العام الماضي للتأكيد أو التحديث: ' + ind.lastYearValue);
    parts.push('  آخر موعد: ' + F.formatDate(r.deadline));
    return parts.join('\n');
  }

  /*
   * خطاب لجهة بمستوى معين: البنود = كل متطلبات الجهة المفتوحة (مرتبة بالموعد).
   * لا يُرسل شيئًا ولا يخزن بريدًا: نص فقط تنسخه المستخدمة أو تطبعه.
   */
  function buildLetter(data, entityId, levelCode, today) {
    var cx = context(data);
    var ent = cx.entitiesById[entityId];
    if (!ent) return { ok: false, message: 'الجهة غير موجودة.' };
    var L = LEVELS.filter(function (x) { return x.code === levelCode; })[0];
    if (!L) return { ok: false, message: 'مستوى الخطاب غير معروف.' };
    var items = data.requirements.filter(function (r) { return r.entityId === entityId && D.isOpen(r); })
      .sort(function (a, b) { return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0; });
    if (!items.length) return { ok: false, message: 'لا توجد متطلبات مفتوحة لدى هذه الجهة، فلا حاجة إلى خطاب.' };
    var deadlines = items.map(function (r) { return r.deadline; }).filter(function (d) { return F.parseISO(d) !== null; }).sort();
    var maxLate = items.reduce(function (m, r) { var i = D.dueInfo(r, today); return i.kind === 'overdue' ? Math.max(m, -i.days) : m; }, 0);
    var rks = [];
    items.forEach(function (r) { var rk = rankingOf(r, cx); if (rk && rks.indexOf(rk) === -1) rks.push(rk); });
    var subs = rks.map(function (rk) { return rk.submissionDeadline; }).filter(Boolean).sort();
    // المستلم بالمسمى الوظيفي فقط (R-V-NO-CONTACT): جهة التواصل المسجلة أو «منسق البيانات»، ثم رئيس الجهة، ثم المشرف.
    var recipient = L.level <= 1 ? (String(ent.contactRole || '').trim() || 'منسق البيانات') : L.level === 2 ? 'رئيس ' + ent.name : L.to;
    var vars = {
      'الجهة': ent.name,
      'المستلم': recipient,
      'البنود': items.map(function (r) { return itemLine(r, cx); }).join('\n'),
      'الموعد': deadlines.length ? F.formatDate(deadlines[0]) : 'لم يُحدد',
      'أيام_التأخر': maxLate ? F.dayCount(maxLate) : 'لم يحل بعد',
      'التصنيف': rks.length ? rks.map(function (rk) { return rk.name; }).join(' و') : 'التصنيف',
      'موعد_التسليم': subs.length ? F.formatDate(subs[0]) : 'لم يُحدد بعد',
      'التاريخ': F.formatDate(today)
    };
    var tpl = templateFor(data, L.code);
    return {
      ok: true,
      entity: ent,
      level: L,
      items: items,
      vars: vars,
      custom: tpl.custom,
      subject: renderTemplate(tpl.subject, vars),
      body: renderTemplate(tpl.body, vars),
      unknown: unknownPlaceholders(tpl.subject + '\n' + tpl.body),
      // موعد الإجراء التالي لكل بند عند «تسجيل الإرسال»: تاريخ المستوى التالي، ولا يقل عن اليوم. L4 لا تالي له.
      plan: items.map(function (r) {
        var nd = L.level < 4 && F.parseISO(r.deadline) !== null ? levelDate(r, L.level + 1) : '';
        return { requirementId: r.id, nextActionDate: nd && nd < today ? today : nd };
      })
    };
  }

  // المستوى المقترح لخطاب جهة = أعلى مستوى C-ESC مستحق بين بنودها المفتوحة.
  function suggestedLevel(data, entityId, today) {
    var lvl = 0;
    data.requirements.forEach(function (r) {
      if (r.entityId !== entityId || !D.isOpen(r)) return;
      var e = escalation(r, today);
      if (e.kind === 'action' && e.due > lvl) lvl = e.due;
    });
    return LEVELS[lvl].code;
  }

  // ---------- 8. صفوف التصدير (CSV) ----------
  // filter اختياري على المتطلب (مثل المتأخر فقط). الترتيب يبقى ترتيبه بين كل المفتوح.
  function priorityRows(data, today, filter) {
    var cx = context(data);
    return rankRequirements(data, today).filter(function (x) { return !filter || filter(x.requirement); }).map(function (x) {
      var r = x.requirement;
      var ind = cx.indicatorsById[r.indicatorId];
      var ent = cx.entitiesById[r.entityId];
      var rk = rankingOf(r, cx);
      var check = requirementConditions(r, data, today, cx);
      return [x.rank, x.score, r.title, ind ? ind.code : '', rk ? rk.name : '', ent ? ent.name : '', r.assignee || '',
        M.STATUSES[r.status] || r.status, M.PRIORITIES[r.priority] || r.priority, r.deadline, D.dueInfo(r, today).label,
        check.unmet.map(function (c) { return c.label; }).join('؛ '), nextStep(r, data, today, cx).text,
        x.factors.map(function (f) { return f.label + ' = ' + f.points; }).join('؛ ')];
    });
  }

  var PRIORITY_HEADERS = ['الترتيب', 'الدرجة', 'المتطلب', 'رمز المؤشر', 'التصنيف', 'الجهة', 'المكلف', 'الحالة', 'الأولوية', 'الموعد', 'حالة الموعد', 'الشروط غير المحققة', 'الخطوة التالية', 'أسباب الدرجة'];

  function responseRows(data, today) {
    return entityResponse(data, today).map(function (x) {
      return [x.name, x.total, x.completed, x.onTimePct === null ? 'لا مكتمل بعد' : x.onTimePct + '%', x.avgLateDays === null ? '—' : x.avgLateDays, x.escalations, x.open, x.overdue];
    });
  }

  var RESPONSE_HEADERS = ['الجهة', 'المتطلبات', 'المكتمل', 'نسبة التسليم في الموعد', 'متوسط أيام التأخر', 'تصعيدات L3+', 'المفتوح', 'المتأخر الآن'];

  return {
    LEVELS: LEVELS,
    DUE_BUCKETS: DUE_BUCKETS,
    PLACEHOLDERS: PLACEHOLDERS,
    DEFAULT_TEMPLATES: DEFAULT_TEMPLATES,
    PRIORITY_HEADERS: PRIORITY_HEADERS,
    RESPONSE_HEADERS: RESPONSE_HEADERS,
    requirementConditions: requirementConditions,
    incompleteRequirements: incompleteRequirements,
    indicatorGaps: indicatorGaps,
    completion: completion,
    priorityScore: priorityScore,
    rankRequirements: rankRequirements,
    escalation: escalation,
    nextStep: nextStep,
    alerts: alerts,
    entityResponse: entityResponse,
    templateFor: templateFor,
    unknownPlaceholders: unknownPlaceholders,
    renderTemplate: renderTemplate,
    buildLetter: buildLetter,
    suggestedLevel: suggestedLevel,
    priorityRows: priorityRows,
    responseRows: responseRows
  };
});
