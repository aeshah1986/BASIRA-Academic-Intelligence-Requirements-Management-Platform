/*
 * عمليات التغيير على البيانات — منصة «بصيرة»
 * كل عملية: تتحقق من المدخلات وقواعد العلاقات، ثم تعدّل البيانات وتضيف نشاطًا إلى السجل.
 * عند الفشل لا يتغير شيء ولا يُسجَّل نشاط (R-LOG). النتيجة دائمًا:
 *   { ok: true, id, info }  أو  { ok: false, errors: { حقل: رسالة }, message }
 * env = { today: 'YYYY-MM-DD', now: ISO، newId: function (prefix) }
 * يعمل في المتصفح (window.Basira.actions) وفي Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'), require('./normalize.js'));
  } else {
    root.Basira = root.Basira || {};
    root.Basira.actions = factory(root.Basira.model, root.Basira.normalize);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, N) {
  'use strict';

  var ACTIVITY_CAP = 500;

  // ---------- أدوات ----------
  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function text(v) { return String(v == null ? '' : v).trim(); }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function fail(errors, message) { return { ok: false, errors: errors || {}, message: message || firstError(errors) }; }
  function firstError(errors) { var k = Object.keys(errors || {}); return k.length ? errors[k[0]] : ''; }
  function hasErrors(errors) { return Object.keys(errors).length > 0; }
  function q(s) { return '«' + s + '»'; }
  function countWord(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return n + ' ' + few;
    return n + ' ' + many;
  }
  function len(errors, field, value, max, min, label) {
    if (min && value.length < min) errors[field] = (label || 'النص') + ' يجب أن يكون ' + min + ' أحرف على الأقل.';
    else if (value.length > max) errors[field] = 'النص أطول من الحد المسموح (' + max + ' حرفًا).';
  }

  // يضيف نشاطًا في أول السجل (الأحدث أولًا) ويحتفظ بآخر 500 فقط.
  function log(data, env, action, targetType, targetId, summary) {
    if (!Array.isArray(data.activities)) data.activities = [];
    data.activities.unshift({ id: env.newId('act'), at: env.now, action: action, targetType: targetType, targetId: targetId || '', summary: summary });
    if (data.activities.length > ACTIVITY_CAP) data.activities.length = ACTIVITY_CAP;
  }

  // ---------- المتطلبات ----------
  function validateRequirementInput(data, input, existing) {
    var res = M.validateRequirement(input, { indicators: data.indicators, entities: data.entities });
    var errors = res.errors;
    var v = res.value;
    v.evidenceLink = text(input.evidenceLink);
    if (!errors.title) len(errors, 'title', v.title, 150, 3, 'العنوان');
    len(errors, 'description', v.description, 2000);
    len(errors, 'missingData', v.missingData, 1000);
    len(errors, 'assignee', v.assignee, 80);
    if (v.evidenceLink && !M.isHttpUrl(v.evidenceLink)) errors.evidenceLink = 'الرابط يجب أن يبدأ بـ https:// أو http:// (يُرفض غير ذلك للأمان).';
    var ind = find(data.indicators, v.indicatorId);
    if (!errors.indicatorId && ind && ind.active === false && (!existing || existing.indicatorId !== v.indicatorId)) {
      errors.indicatorId = 'المؤشر المختار معطل، ولا يُربط به متطلب جديد.';
    }
    // R-COMPLETE-REQ عند الانتقال إلى «مكتمل» فقط.
    var becomingDone = v.status === 'done' && (!existing || existing.status !== 'done');
    if (becomingDone && !errors.status) {
      var missing = [];
      if (v.missingData) missing.push('حذف البيانات الناقصة أو تحديثها');
      if (!v.evidenceLink || errors.evidenceLink) missing.push('إضافة رابط الدليل');
      if (missing.length) errors.status = 'لا يمكن إكمال المتطلب: يلزم ' + missing.join('، و') + '.';
    }
    return { errors: errors, value: v, becomingDone: becomingDone };
  }

  function createRequirement(data, input, env) {
    var r = validateRequirementInput(data, input, null);
    if (hasErrors(r.errors)) return fail(r.errors);
    var req = Object.assign({ id: env.newId('req'), createdAt: env.now, updatedAt: env.now, followUps: [], completedAt: r.becomingDone ? env.now : '' }, r.value);
    data.requirements.push(req);
    log(data, env, 'create', 'requirement', req.id, 'أُضيف المتطلب ' + q(req.title) + '.');
    return { ok: true, id: req.id };
  }

  function updateRequirement(data, id, input, env) {
    var req = find(data.requirements, id);
    if (!req) return fail({}, 'المتطلب غير موجود.');
    var r = validateRequirementInput(data, input, req);
    if (hasErrors(r.errors)) return fail(r.errors);
    var oldStatus = req.status;
    Object.keys(r.value).forEach(function (k) { req[k] = r.value[k]; });
    req.updatedAt = env.now;
    if (r.becomingDone) req.completedAt = env.now;
    if (oldStatus === 'done' && req.status !== 'done') req.completedAt = '';
    if (oldStatus !== req.status) {
      log(data, env, 'status_change', 'requirement', id, 'غُيّرت حالة ' + q(req.title) + ' من ' + q(M.STATUSES[oldStatus]) + ' إلى ' + q(M.STATUSES[req.status]) + '.');
    } else {
      log(data, env, 'update', 'requirement', id, 'عُدّل المتطلب ' + q(req.title) + '.');
    }
    return { ok: true, id: id };
  }

  // تغيير الحالة وحدها مع بقية الحقول كما هي (تُطبق شروط الاكتمال).
  function setRequirementStatus(data, id, status, env) {
    var req = find(data.requirements, id);
    if (!req) return fail({}, 'المتطلب غير موجود.');
    if (req.status === status) return { ok: true, id: id, info: { unchanged: true } };
    return updateRequirement(data, id, Object.assign({}, req, { status: status }), env);
  }

  // يحذف المتطلب ومتابعاته، ويفك ارتباط أدلته (تبقى مرتبطة بالمؤشر).
  function deleteRequirement(data, id, env) {
    var idx = data.requirements.findIndex(function (r) { return r.id === id; });
    if (idx === -1) return fail({}, 'المتطلب غير موجود.');
    var req = data.requirements[idx];
    var followUps = (req.followUps || []).length;
    var unlinked = 0;
    (data.evidence || []).forEach(function (ev) { if (ev.requirementId === id) { ev.requirementId = ''; unlinked++; } });
    data.requirements.splice(idx, 1);
    log(data, env, 'delete', 'requirement', id, 'حُذف المتطلب ' + q(req.title) +
      (followUps ? ' ومتابعاته (' + followUps + ')' : '') + (unlinked ? '، وفُك ارتباط ' + countWord(unlinked, 'دليل واحد', 'دليلين', 'أدلة', 'دليلًا') + ' عنه' : '') + '.');
    return { ok: true, id: id, info: { followUps: followUps, unlinkedEvidence: unlinked } };
  }

  function requirementImpact(data, id) {
    var req = find(data.requirements, id);
    if (!req) return null;
    return { followUps: (req.followUps || []).length, evidence: (data.evidence || []).filter(function (e) { return e.requirementId === id; }).length };
  }

  // ---------- المتابعات والمراسلات ----------
  function addFollowUp(data, reqId, input, env) {
    var req = find(data.requirements, reqId);
    if (!req) return fail({}, 'المتطلب غير موجود.');
    var v = { date: clean(input.date), type: clean(input.type), outcome: clean(input.outcome), note: clean(input.note), nextActionDate: clean(input.nextActionDate) };
    var errors = {};
    if (!M.isValidDate(v.date)) errors.date = 'التاريخ غير صالح.';
    else if (v.date > env.today) errors.date = 'لا يمكن تسجيل تاريخ في المستقبل.';
    if (!M.isEnum(M.FOLLOWUP_TYPES, v.type)) errors.type = 'النوع غير معروف.';
    if (!M.isEnum(M.FOLLOWUP_OUTCOMES, v.outcome)) errors.outcome = 'يرجى اختيار نتيجة المتابعة.';
    len(errors, 'note', v.note, 1000, 3, 'الملاحظة');
    if (v.nextActionDate) {
      if (!M.isValidDate(v.nextActionDate)) errors.nextActionDate = 'تاريخ الإجراء التالي غير صالح.';
      else if (!errors.date && v.nextActionDate < v.date) errors.nextActionDate = 'تاريخ الإجراء التالي يجب أن يكون بعد تاريخ المتابعة.';
    }
    if (hasErrors(errors)) return fail(errors);
    if (!Array.isArray(req.followUps)) req.followUps = [];
    var fu = Object.assign({ id: env.newId('fu') }, v);
    req.followUps.push(fu);
    req.updatedAt = env.now;
    log(data, env, 'followup_add', 'requirement', reqId, 'سُجلت متابعة (' + M.FOLLOWUP_TYPES[v.type] + '، ' + M.FOLLOWUP_OUTCOMES[v.outcome] + ') على ' + q(req.title) + '.');
    return { ok: true, id: fu.id };
  }

  function deleteFollowUp(data, reqId, fuId, env) {
    var req = find(data.requirements, reqId);
    if (!req) return fail({}, 'المتطلب غير موجود.');
    var idx = (req.followUps || []).findIndex(function (f) { return f.id === fuId; });
    if (idx === -1) return fail({}, 'المتابعة غير موجودة.');
    var fu = req.followUps.splice(idx, 1)[0];
    req.updatedAt = env.now;
    log(data, env, 'followup_delete', 'requirement', reqId, 'حُذفت متابعة بتاريخ ' + fu.date + ' من ' + q(req.title) + '.');
    return { ok: true, id: fuId };
  }

  // ---------- المؤشرات ----------
  function normalizeCode(code) { return clean(code).toUpperCase(); }

  function createIndicator(data, input, env) {
    var v = { ranking: clean(input.ranking), domain: clean(input.domain), code: normalizeCode(input.code), name: clean(input.name), order: clean(input.order) };
    var errors = {};
    if (!find(data.rankings || [], v.ranking)) errors.ranking = 'يرجى اختيار التصنيف.';
    len(errors, 'domain', v.domain, 80, 2, 'المعيار');
    if (!/^[A-Z0-9-]{2,20}$/.test(v.code)) errors.code = 'الرمز من 2 إلى 20 حرفًا: أحرف إنجليزية كبيرة وأرقام وشرطة، مثل AR-EDU-10.';
    else if (data.indicators.some(function (i) { return String(i.code).toUpperCase() === v.code; })) errors.code = 'الرمز ' + v.code + ' مستخدم لمؤشر آخر.';
    len(errors, 'name', v.name, 250, 3, 'الاسم');
    var order;
    if (v.order === '') {
      order = data.indicators.filter(function (i) { return i.ranking === v.ranking; }).reduce(function (m, i) { return Math.max(m, i.order || 0); }, 0) + 1;
    } else if (!/^\d{1,4}$/.test(v.order) || +v.order < 1) {
      errors.order = 'الترتيب رقم صحيح من 1 فأكثر.';
    } else order = +v.order;
    if (hasErrors(errors)) return fail(errors);
    var id = 'ind-' + v.code.toLowerCase();
    if (find(data.indicators, id)) id = env.newId('ind');
    var ind = { id: id, code: v.code, ranking: v.ranking, domain: v.domain, order: order, name: v.name, active: true,
      workStatus: 'not_started', currentValue: '', progressFileValue: '', lastYearValue: '', valueSource: '', notes: '' };
    data.indicators.push(ind);
    log(data, env, 'create', 'indicator', id, 'أُضيف المؤشر ' + v.code + ' ' + q(v.name) + '.');
    return { ok: true, id: id };
  }

  function updateIndicator(data, id, input, env) {
    var ind = find(data.indicators, id);
    if (!ind) return fail({}, 'المؤشر غير موجود.');
    var v = {
      name: input.name === undefined ? ind.name : clean(input.name),
      domain: input.domain === undefined ? ind.domain : clean(input.domain),
      workStatus: clean(input.workStatus),
      currentValue: text(input.currentValue), progressFileValue: text(input.progressFileValue), lastYearValue: text(input.lastYearValue),
      valueSource: clean(input.valueSource), notes: text(input.notes)
    };
    var errors = {};
    len(errors, 'name', v.name, 250, 3, 'الاسم');
    len(errors, 'domain', v.domain, 80, 2, 'المعيار');
    if (!M.isEnum(M.WORK_STATUSES, v.workStatus)) errors.workStatus = 'الحالة غير معروفة.';
    ['currentValue', 'progressFileValue', 'lastYearValue'].forEach(function (k) { if (v[k].length > 30) errors[k] = 'القيمة أطول من 30 حرفًا.'; });
    if ((v.workStatus === 'evidenced' || v.workStatus === 'entered') && !errors.workStatus) {
      if (!v.currentValue && !errors.currentValue) errors.currentValue = 'لا يمكن اختيار ' + q(M.WORK_STATUSES[v.workStatus]) + ' دون قيمة حالية.';
      if (!v.valueSource) errors.valueSource = 'يرجى ذكر مصدر الرقم قبل اختيار ' + q(M.WORK_STATUSES[v.workStatus]) + '.';
    }
    if (v.valueSource.length > 200) errors.valueSource = 'النص أطول من 200 حرف.';
    len(errors, 'notes', v.notes, 1000);
    if (hasErrors(errors)) return fail(errors);
    var oldStatus = ind.workStatus;
    Object.keys(v).forEach(function (k) { ind[k] = v[k]; });
    log(data, env, oldStatus !== v.workStatus ? 'status_change' : 'update', 'indicator', id,
      oldStatus !== v.workStatus ? 'غُيّرت حالة المؤشر ' + ind.code + ' من ' + q(M.WORK_STATUSES[oldStatus]) + ' إلى ' + q(M.WORK_STATUSES[v.workStatus]) + '.'
        : 'عُدّلت قيم المؤشر ' + ind.code + '.');
    return { ok: true, id: id };
  }

  function indicatorImpact(data, id) {
    return {
      openRequirements: data.requirements.filter(function (r) { return r.indicatorId === id && r.status !== 'done'; }).length,
      requirements: data.requirements.filter(function (r) { return r.indicatorId === id; }).length,
      evidence: (data.evidence || []).filter(function (e) { return e.indicatorId === id; }).length
    };
  }

  // تعطيل المؤشر أو تفعيله. المعطل لا يُحذف: تبقى متطلباته وأدلته، ولا يُربط به جديد.
  function setIndicatorActive(data, id, active, env) {
    var ind = find(data.indicators, id);
    if (!ind) return fail({}, 'المؤشر غير موجود.');
    var current = ind.active !== false;
    if (current === !!active) return { ok: true, id: id, info: { unchanged: true } };
    ind.active = !!active;
    log(data, env, active ? 'indicator_enable' : 'indicator_disable', 'indicator', id, (active ? 'فُعّل' : 'عُطّل') + ' المؤشر ' + ind.code + ' ' + q(ind.name) + '.');
    return { ok: true, id: id, info: indicatorImpact(data, id) };
  }

  function updateRanking(data, id, input, env) {
    var rk = find(data.rankings || [], id);
    if (!rk) return fail({}, 'التصنيف غير موجود.');
    var v = { submissionDeadline: clean(input.submissionDeadline), cycleLabel: clean(input.cycleLabel) };
    var errors = {};
    if (v.submissionDeadline && !M.isValidDate(v.submissionDeadline)) errors.submissionDeadline = 'التاريخ غير صالح.';
    if (v.cycleLabel.length > 40) errors.cycleLabel = 'النص أطول من 40 حرفًا.';
    if (hasErrors(errors)) return fail(errors);
    rk.submissionDeadline = v.submissionDeadline;
    rk.cycleLabel = v.cycleLabel;
    log(data, env, 'update', 'ranking', id, 'عُدّل موعد تسليم ' + q(rk.name) + ' إلى ' + (v.submissionDeadline || 'غير محدد') + '.');
    return { ok: true, id: id };
  }

  // ---------- الجهات ----------
  function validateEntityInput(data, input, selfId) {
    var v = { name: clean(input.name), type: clean(input.type) || 'unit', contactRole: clean(input.contactRole), notes: text(input.notes) };
    var errors = {};
    len(errors, 'name', v.name, 100, 2, 'الاسم');
    if (!errors.name) {
      var key = N.normalizeText(v.name);
      var dup = data.entities.some(function (e) { return e.id !== selfId && N.normalizeText(e.name) === key; });
      if (dup) errors.name = 'توجد جهة بالاسم نفسه.';
    }
    if (!M.isEnum(M.ENTITY_TYPES, v.type)) errors.type = 'النوع غير معروف.';
    len(errors, 'contactRole', v.contactRole, 100);
    if (!errors.contactRole && M.hasContactInfo(v.contactRole)) errors.contactRole = 'يُكتب وصف وظيفي فقط، دون بريد أو هاتف.';
    len(errors, 'notes', v.notes, 500);
    if (!errors.notes && M.hasContactInfo(v.notes)) errors.notes = 'لا تُحفظ أرقام هواتف أو عناوين بريد في الملاحظات.';
    return { errors: errors, value: v };
  }

  function createEntity(data, input, env) {
    var r = validateEntityInput(data, input, null);
    if (hasErrors(r.errors)) return fail(r.errors);
    var ent = Object.assign({ id: env.newId('ent') }, r.value);
    data.entities.push(ent);
    log(data, env, 'create', 'entity', ent.id, 'أُضيفت الجهة ' + q(ent.name) + '.');
    return { ok: true, id: ent.id };
  }

  function updateEntity(data, id, input, env) {
    var ent = find(data.entities, id);
    if (!ent) return fail({}, 'الجهة غير موجودة.');
    var r = validateEntityInput(data, input, id);
    if (hasErrors(r.errors)) return fail(r.errors);
    Object.keys(r.value).forEach(function (k) { ent[k] = r.value[k]; });
    log(data, env, 'update', 'entity', id, 'عُدّلت الجهة ' + q(ent.name) + '.');
    return { ok: true, id: id };
  }

  function entityImpact(data, id) {
    return { requirements: data.requirements.filter(function (r) { return r.entityId === id; }).length };
  }

  // R-DEL-ENT: لا تُحذف جهة مرتبطة بمتطلبات.
  function deleteEntity(data, id, env) {
    var idx = data.entities.findIndex(function (e) { return e.id === id; });
    if (idx === -1) return fail({}, 'الجهة غير موجودة.');
    var n = entityImpact(data, id).requirements;
    if (n) return fail({}, 'لا يمكن حذف الجهة لأنها مرتبطة بـ ' + countWord(n, 'متطلب واحد', 'متطلبين', 'متطلبات', 'متطلبًا') + '. انقل المتطلبات إلى جهة أخرى أولًا.');
    var ent = data.entities.splice(idx, 1)[0];
    log(data, env, 'delete', 'entity', id, 'حُذفت الجهة ' + q(ent.name) + '.');
    return { ok: true, id: id };
  }

  // ---------- الأدلة ----------
  function validateEvidenceInput(data, input, existing) {
    var v = {
      indicatorId: clean(input.indicatorId), requirementId: clean(input.requirementId), title: clean(input.title),
      type: clean(input.type), reference: text(input.reference), notes: text(input.notes)
    };
    var errors = {};
    var ind = find(data.indicators, v.indicatorId);
    if (!v.indicatorId) errors.indicatorId = 'يرجى اختيار المؤشر.';
    else if (!ind) errors.indicatorId = 'المؤشر المحدد غير موجود.';
    else if (ind.active === false && (!existing || existing.indicatorId !== v.indicatorId)) errors.indicatorId = 'المؤشر المختار معطل.';
    if (v.requirementId) {
      var req = find(data.requirements, v.requirementId);
      if (!req) errors.requirementId = 'المتطلب المحدد غير موجود.';
      else if (!errors.indicatorId && req.indicatorId !== v.indicatorId) errors.requirementId = 'المتطلب المختار لا يتبع المؤشر نفسه.';
    }
    len(errors, 'title', v.title, 200, 3, 'العنوان');
    if (!M.isEnum(M.EVIDENCE_TYPES, v.type)) errors.type = 'يرجى اختيار نوع الدليل.';
    if (!v.reference) errors.reference = 'يرجى كتابة مكان الدليل أو رابطه.';
    else if (v.type === 'link' && !M.isHttpUrl(v.reference)) errors.reference = 'الرابط يجب أن يبدأ بـ https:// أو http://.';
    else if (/^\s*(javascript|data|vbscript):/i.test(v.reference)) errors.reference = 'هذا النوع من الروابط غير مسموح.';
    else len(errors, 'reference', v.reference, 300);
    len(errors, 'notes', v.notes, 1000);
    return { errors: errors, value: v };
  }

  function createEvidence(data, input, env) {
    var r = validateEvidenceInput(data, input, null);
    if (hasErrors(r.errors)) return fail(r.errors);
    var ev = Object.assign({ id: env.newId('ev'), status: 'pending', reviewNote: '', reviewedOn: '', createdAt: env.now, updatedAt: env.now }, r.value);
    data.evidence.push(ev);
    log(data, env, 'create', 'evidence', ev.id, 'سُجل الدليل ' + q(ev.title) + ' بانتظار التحقق.');
    return { ok: true, id: ev.id };
  }

  // تعديل محتوى دليل سبق التحقق منه يعيده إلى «بانتظار التحقق».
  function updateEvidence(data, id, input, env) {
    var ev = find(data.evidence, id);
    if (!ev) return fail({}, 'الدليل غير موجود.');
    var r = validateEvidenceInput(data, input, ev);
    if (hasErrors(r.errors)) return fail(r.errors);
    var contentChanged = ['indicatorId', 'requirementId', 'type', 'reference'].some(function (k) { return ev[k] !== r.value[k]; });
    var reset = contentChanged && ev.status !== 'pending';
    Object.keys(r.value).forEach(function (k) { ev[k] = r.value[k]; });
    ev.updatedAt = env.now;
    if (reset) { ev.status = 'pending'; ev.reviewNote = ''; ev.reviewedOn = ''; }
    log(data, env, 'update', 'evidence', id, 'عُدّل الدليل ' + q(ev.title) + (reset ? '، وعاد إلى «بانتظار التحقق» لتغير محتواه' : '') + '.');
    return { ok: true, id: id, info: { resetToPending: reset } };
  }

  // نتيجة التحقق: verified، أو rejected مع سبب إلزامي.
  function reviewEvidence(data, id, input, env) {
    var ev = find(data.evidence, id);
    if (!ev) return fail({}, 'الدليل غير موجود.');
    var result = clean(input.result);
    var note = clean(input.note);
    var errors = {};
    if (result !== 'verified' && result !== 'rejected') errors.result = 'يرجى اختيار نتيجة التحقق.';
    if (result === 'rejected' && note.length < 3) errors.note = 'يرجى ذكر سبب الرفض.';
    len(errors, 'note', note, 500);
    if (hasErrors(errors)) return fail(errors);
    ev.status = result;
    ev.reviewNote = note;
    ev.reviewedOn = env.today;
    ev.updatedAt = env.now;
    log(data, env, 'evidence_review', 'evidence', id, (result === 'verified' ? 'تُحقق من الدليل ' : 'رُفض الدليل ') + q(ev.title) + (note ? ': ' + note : '') + '.');
    return { ok: true, id: id };
  }

  function deleteEvidence(data, id, env) {
    var idx = data.evidence.findIndex(function (e) { return e.id === id; });
    if (idx === -1) return fail({}, 'الدليل غير موجود.');
    var ev = data.evidence.splice(idx, 1)[0];
    log(data, env, 'delete', 'evidence', id, 'حُذف الدليل ' + q(ev.title) + '.');
    return { ok: true, id: id };
  }

  // ---------- الأسئلة والقرارات ----------
  function addDecision(data, input, env) {
    var v = { indicatorId: clean(input.indicatorId), question: clean(input.question), askedTo: clean(input.askedTo), askedOn: clean(input.askedOn) };
    var errors = {};
    if (!v.indicatorId) errors.indicatorId = 'يرجى اختيار المؤشر.';
    else if (!find(data.indicators, v.indicatorId)) errors.indicatorId = 'المؤشر المحدد غير موجود.';
    len(errors, 'question', v.question, 500, 5, 'السؤال');
    len(errors, 'askedTo', v.askedTo, 100, 2, 'الموجه إليه');
    if (!errors.askedTo && M.hasContactInfo(v.askedTo)) errors.askedTo = 'يُكتب وصف وظيفي فقط، دون بريد أو هاتف.';
    if (!M.isValidDate(v.askedOn)) errors.askedOn = 'التاريخ غير صالح.';
    else if (v.askedOn > env.today) errors.askedOn = 'لا يمكن تسجيل تاريخ في المستقبل.';
    if (hasErrors(errors)) return fail(errors);
    var d = Object.assign({ id: env.newId('dec'), status: 'open', decision: '', decidedOn: '' }, v);
    data.decisions.push(d);
    log(data, env, 'create', 'decision', d.id, 'طُرح سؤال على ' + v.askedTo + ': ' + q(v.question) + '.');
    return { ok: true, id: d.id };
  }

  function resolveDecision(data, id, input, env) {
    var d = find(data.decisions, id);
    if (!d) return fail({}, 'السؤال غير موجود.');
    if (d.status === 'resolved') return fail({}, 'هذا السؤال محسوم سابقًا.');
    var v = { decision: clean(input.decision), decidedOn: clean(input.decidedOn) };
    var errors = {};
    len(errors, 'decision', v.decision, 1000, 3, 'نص القرار');
    if (!M.isValidDate(v.decidedOn)) errors.decidedOn = 'التاريخ غير صالح.';
    else if (v.decidedOn > env.today) errors.decidedOn = 'لا يمكن تسجيل تاريخ في المستقبل.';
    else if (v.decidedOn < d.askedOn) errors.decidedOn = 'تاريخ القرار يجب أن يكون بعد تاريخ طرح السؤال.';
    if (hasErrors(errors)) return fail(errors);
    d.status = 'resolved';
    d.decision = v.decision;
    d.decidedOn = v.decidedOn;
    log(data, env, 'decision_resolve', 'decision', id, 'حُسم السؤال ' + q(d.question) + ': ' + v.decision);
    return { ok: true, id: id };
  }

  // ---------- أحداث عامة (استيراد، تصدير، إعادة) ----------
  function logEvent(data, env, action, summary) {
    log(data, env, action, 'data', '', summary);
  }

  return {
    ACTIVITY_CAP: ACTIVITY_CAP,
    createRequirement: createRequirement,
    updateRequirement: updateRequirement,
    setRequirementStatus: setRequirementStatus,
    deleteRequirement: deleteRequirement,
    requirementImpact: requirementImpact,
    addFollowUp: addFollowUp,
    deleteFollowUp: deleteFollowUp,
    createIndicator: createIndicator,
    updateIndicator: updateIndicator,
    setIndicatorActive: setIndicatorActive,
    indicatorImpact: indicatorImpact,
    updateRanking: updateRanking,
    createEntity: createEntity,
    updateEntity: updateEntity,
    deleteEntity: deleteEntity,
    entityImpact: entityImpact,
    createEvidence: createEvidence,
    updateEvidence: updateEvidence,
    reviewEvidence: reviewEvidence,
    deleteEvidence: deleteEvidence,
    addDecision: addDecision,
    resolveDecision: resolveDecision,
    logEvent: logEvent
  };
});
