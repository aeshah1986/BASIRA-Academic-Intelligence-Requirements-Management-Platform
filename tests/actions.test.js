// فحوص عمليات التغيير (js/actions.js): النجاح، والمدخلات الخاطئة، والحذف، والعلاقات، وسجل الأنشطة
const test = require('node:test');
const assert = require('node:assert/strict');

const A = require('../js/actions.js');
const { createSampleData } = require('../data/sample-data.js');
const { validateDataset } = require('../js/storage.js');

function setup() {
  let n = 0;
  const env = { today: '2026-11-01', now: '2026-11-01T09:00:00.000Z', newId: p => p + '-t' + (++n) };
  return { data: createSampleData(), env };
}
const validReq = extra => Object.assign({ title: 'متطلب اختبار', indicatorId: 'ind-ar-edu-2', entityId: 'ent-hr', deadline: '2026-11-20', status: 'new', priority: 'medium' }, extra);

// كل فشل: لا تغيير في البيانات ولا نشاط جديد.
function assertNoChange(data, fn) {
  const before = JSON.stringify(data);
  const res = fn();
  assert.equal(res.ok, false, 'كان يُتوقع الفشل');
  assert.equal(JSON.stringify(data), before, 'تغيرت البيانات رغم الفشل');
  return res;
}

// ---------- المتطلبات ----------
test('متطلب: إضافة صحيحة تُحفظ وتُسجَّل نشاطًا واحدًا (AC-CRUD-01، AC-LOG-01)', () => {
  const { data, env } = setup();
  const res = A.createRequirement(data, validReq(), env);
  assert.equal(res.ok, true);
  assert.equal(data.requirements.length, 7);
  assert.equal(data.activities.length, 1);
  assert.equal(data.activities[0].action, 'create');
  assert.match(data.activities[0].summary, /أُضيف المتطلب «متطلب اختبار»/);
});

test('متطلب: مدخلات خاطئة تُرفض دون تغيير (AC-VAL، AC-LOG-02)', () => {
  const { data, env } = setup();
  const cases = [
    [{ title: '  ' }, 'title'], [{ title: 'اب' }, 'title'], [{ title: 'ع'.repeat(151) }, 'title'],
    [{ indicatorId: '' }, 'indicatorId'], [{ indicatorId: 'ind-x' }, 'indicatorId'],
    [{ entityId: '' }, 'entityId'], [{ entityId: 'ent-x' }, 'entityId'],
    [{ deadline: '2026-02-30' }, 'deadline'], [{ status: 'late' }, 'status'], [{ priority: 'urgent' }, 'priority'],
    [{ evidenceLink: 'javascript:alert(1)' }, 'evidenceLink'], [{ assignee: 'أ'.repeat(81) }, 'assignee']
  ];
  for (const [patch, field] of cases) {
    const res = assertNoChange(data, () => A.createRequirement(data, validReq(patch), env));
    assert.ok(res.errors[field], 'الحقل ' + field + ' مع ' + JSON.stringify(patch));
  }
});

test('متطلب: لا يُربط متطلب جديد بمؤشر معطل، ويبقى المتطلب القديم صالحًا للتعديل', () => {
  const { data, env } = setup();
  A.setIndicatorActive(data, 'ind-ar-edu-1', false, env);
  const res = assertNoChange(data, () => A.createRequirement(data, validReq({ indicatorId: 'ind-ar-edu-1' }), env));
  assert.match(res.errors.indicatorId, /معطل/);
  // F1 مرتبط بالمؤشر المعطل: تعديل عنوانه مسموح
  const f1 = data.requirements.find(r => r.id === 'req-f1');
  assert.equal(A.updateRequirement(data, 'req-f1', Object.assign({}, f1, { title: 'عنوان معدل' }), env).ok, true);
  // لكن لا يُنقل متطلب آخر إلى المؤشر المعطل
  const f2 = data.requirements.find(r => r.id === 'req-f2');
  const moved = assertNoChange(data, () => A.updateRequirement(data, 'req-f2', Object.assign({}, f2, { indicatorId: 'ind-ar-edu-1' }), env));
  assert.match(moved.errors.indicatorId, /معطل/);
});

test('متطلب: شرط الاكتمال (AC-CMP-01) وعدم كسر المكتمل القديم (AC-CMP-02)', () => {
  const { data, env } = setup();
  const f2 = data.requirements.find(r => r.id === 'req-f2');
  const blocked = assertNoChange(data, () => A.setRequirementStatus(data, 'req-f2', 'done', env));
  assert.match(blocked.errors.status, /حذف البيانات الناقصة.*إضافة رابط الدليل/);
  const ok = A.updateRequirement(data, 'req-f2', Object.assign({}, f2, { status: 'done', missingData: '', evidenceLink: 'https://example.org/e' }), env);
  assert.equal(ok.ok, true);
  assert.equal(f2.completedAt, env.now);
  assert.equal(data.activities[0].action, 'status_change');
  // F3 مكتمل سابقًا دون دليل: تعديل حقل آخر مقبول
  const f3 = data.requirements.find(r => r.id === 'req-f3');
  assert.equal(A.updateRequirement(data, 'req-f3', Object.assign({}, f3, { assignee: 'د. اسم آخر' }), env).ok, true);
  // إعادة فتح مكتمل تمسح completedAt
  assert.equal(A.setRequirementStatus(data, 'req-f2', 'in_progress', env).ok, true);
  assert.equal(f2.completedAt, '');
});

test('متطلب: الحذف يزيل المتابعات ويفك ارتباط الأدلة ويبقيها على المؤشر', () => {
  const { data, env } = setup();
  A.createEvidence(data, { indicatorId: 'ind-ar-edu-1', requirementId: 'req-f1', title: 'خطاب الأعداد', type: 'letter', reference: 'صادر 12' }, env);
  assert.deepEqual(A.requirementImpact(data, 'req-f1'), { followUps: 1, evidence: 1 });
  const res = A.deleteRequirement(data, 'req-f1', env);
  assert.equal(res.ok, true);
  assert.deepEqual(res.info, { followUps: 1, unlinkedEvidence: 1 });
  assert.equal(data.requirements.some(r => r.id === 'req-f1'), false);
  assert.equal(data.evidence[0].requirementId, '');
  assert.equal(data.evidence[0].indicatorId, 'ind-ar-edu-1');
  assert.match(data.activities[0].summary, /ومتابعاته \(1\)، وفُك ارتباط دليل واحد/);
  assert.deepEqual(validateDataset(data).errors, []);
  assertNoChange(data, () => A.deleteRequirement(data, 'req-f1', env)); // محذوف سابقًا
});

// ---------- المتابعات ----------
test('متابعة: إضافة بنتيجة وموعد تالٍ، ورفض المدخلات الخاطئة (AC-FUP)', () => {
  const { data, env } = setup();
  const good = { date: '2026-10-30', type: 'letter', outcome: 'promised', note: 'أُرسل خطاب', nextActionDate: '2026-11-03' };
  const bad = [
    [{ date: '2026-11-05' }, 'date'], [{ date: 'x' }, 'date'], [{ type: 'fax' }, 'type'], [{ outcome: '' }, 'outcome'],
    [{ note: 'اب' }, 'note'], [{ nextActionDate: '2026-10-29' }, 'nextActionDate'], [{ nextActionDate: '2026-13-01' }, 'nextActionDate']
  ];
  for (const [patch, field] of bad) {
    const res = assertNoChange(data, () => A.addFollowUp(data, 'req-f2', Object.assign({}, good, patch), env));
    assert.ok(res.errors[field], field);
  }
  assertNoChange(data, () => A.addFollowUp(data, 'req-x', good, env));
  const res = A.addFollowUp(data, 'req-f2', good, env);
  assert.equal(res.ok, true);
  const f2 = data.requirements.find(r => r.id === 'req-f2');
  assert.equal(f2.followUps.length, 1);
  assert.equal(f2.followUps[0].outcome, 'promised');
  assert.match(data.activities[0].summary, /خطاب، وعد بالتسليم/);
  assert.equal(A.deleteFollowUp(data, 'req-f2', res.id, env).ok, true);
  assert.equal(f2.followUps.length, 0);
  assertNoChange(data, () => A.deleteFollowUp(data, 'req-f2', res.id, env));
});

// ---------- المؤشرات ----------
test('مؤشر: إنشاء برمز فريد، ورفض الرمز المكرر أو غير الصالح', () => {
  const { data, env } = setup();
  const res = A.createIndicator(data, { ranking: 'ARAB', domain: 'البحث العلمي', code: 'ar-res-1', name: 'عدد البحوث المنشورة', order: '' }, env);
  assert.equal(res.ok, true);
  const ind = data.indicators.find(i => i.id === res.id);
  assert.equal(ind.code, 'AR-RES-1');
  assert.equal(ind.active, true);
  assert.equal(ind.order, 10);
  const bad = [
    [{ code: 'AR-RES-1' }, 'code', /مستخدم/], [{ code: 'ar-edu-1' }, 'code', /مستخدم/], [{ code: 'رمز' }, 'code', /الرمز/],
    [{ ranking: 'THE' }, 'ranking'], [{ domain: '' }, 'domain'], [{ name: 'اب' }, 'name'], [{ order: '0' }, 'order'], [{ order: 'abc' }, 'order']
  ];
  for (const [patch, field, re] of bad) {
    const r = assertNoChange(data, () => A.createIndicator(data, Object.assign({ ranking: 'ARAB', domain: 'معيار', code: 'AR-NEW-1', name: 'مؤشر جديد' }, patch), env));
    assert.ok(r.errors[field], field);
    if (re) assert.match(r.errors[field], re);
  }
});

test('مؤشر: تعديل القيم وشرطا «محسوب بالأدلة» (AC-CMP-03، G1، AC-IND-04)', () => {
  const { data, env } = setup();
  const i1 = data.indicators.find(i => i.id === 'ind-ar-edu-1');
  const base = { workStatus: i1.workStatus, currentValue: i1.currentValue, progressFileValue: i1.progressFileValue, lastYearValue: i1.lastYearValue, valueSource: 'نظام الموارد', notes: '' };
  assert.equal(A.updateIndicator(data, 'ind-ar-edu-1', Object.assign({}, base, { currentValue: '1:11' }), env).ok, true);
  assert.equal(i1.currentValue, '1:11');
  const noValue = assertNoChange(data, () => A.updateIndicator(data, 'ind-ar-edu-2', { workStatus: 'evidenced', currentValue: '', valueSource: 'س' }, env));
  assert.ok(noValue.errors.currentValue);
  const noSource = assertNoChange(data, () => A.updateIndicator(data, 'ind-ar-edu-2', { workStatus: 'entered', currentValue: '5', valueSource: '' }, env));
  assert.ok(noSource.errors.valueSource);
  assertNoChange(data, () => A.updateIndicator(data, 'ind-ar-edu-2', { workStatus: 'done' }, env));
  assertNoChange(data, () => A.updateIndicator(data, 'ind-ar-edu-2', { workStatus: 'draft', currentValue: '1'.repeat(31) }, env));
});

test('مؤشر: التعطيل والتفعيل يُسجلان، ولا يحذفان المتطلبات', () => {
  const { data, env } = setup();
  const res = A.setIndicatorActive(data, 'ind-ar-edu-1', false, env);
  assert.equal(res.ok, true);
  assert.deepEqual(res.info, { openRequirements: 1, requirements: 1, evidence: 0 });
  assert.equal(data.requirements.length, 6);
  assert.equal(data.activities[0].action, 'indicator_disable');
  assert.equal(A.setIndicatorActive(data, 'ind-ar-edu-1', false, env).info.unchanged, true);
  assert.equal(data.activities.length, 1, 'لا نشاط عند عدم التغيير');
  assert.equal(A.setIndicatorActive(data, 'ind-ar-edu-1', true, env).ok, true);
  assert.equal(data.activities[0].action, 'indicator_enable');
});

test('تصنيف: تعديل موعد التسليم ورفض التاريخ غير الصالح', () => {
  const { data, env } = setup();
  assert.equal(A.updateRanking(data, 'ARAB', { submissionDeadline: '2026-11-15', cycleLabel: 'دورة 2026' }, env).ok, true);
  assert.equal(data.rankings[0].submissionDeadline, '2026-11-15');
  assertNoChange(data, () => A.updateRanking(data, 'ARAB', { submissionDeadline: '2026-02-30' }, env));
  assertNoChange(data, () => A.updateRanking(data, 'THE', { submissionDeadline: '' }, env));
});

// ---------- الجهات ----------
test('جهة: إضافة وتعديل، ورفض المكرر بعد التوحيد والبيانات الشخصية (AC-ENT-01/04)', () => {
  const { data, env } = setup();
  const res = A.createEntity(data, { name: 'عمادة الجودة', type: 'deanship', contactRole: 'مدير وحدة البيانات' }, env);
  assert.equal(res.ok, true);
  for (const name of ['وحدة البحث العلمي', '  وحده   البحث العلمي ', 'وحدة البحث العلمى']) {
    const r = assertNoChange(data, () => A.createEntity(data, { name, type: 'unit' }, env));
    assert.match(r.errors.name, /بالاسم نفسه/, name);
  }
  assert.match(assertNoChange(data, () => A.createEntity(data, { name: 'جهة أ', type: 'unit', contactRole: 'name@uni.edu' }, env)).errors.contactRole, /دون بريد أو هاتف/);
  assert.match(assertNoChange(data, () => A.createEntity(data, { name: 'جهة ب', type: 'unit', contactRole: '0551234567' }, env)).errors.contactRole, /دون بريد أو هاتف/);
  assert.ok(assertNoChange(data, () => A.createEntity(data, { name: 'جهة ج', type: 'company' }, env)).errors.type);
  assert.ok(assertNoChange(data, () => A.createEntity(data, { name: 'ب', type: 'unit' }, env)).errors.name);
  // التعديل لا يعدّ الاسم نفسه مكررًا
  assert.equal(A.updateEntity(data, 'ent-hr', { name: 'وحدة الموارد البشرية', type: 'unit', contactRole: 'مديرة الوحدة' }, env).ok, true);
  assert.ok(assertNoChange(data, () => A.updateEntity(data, 'ent-hr', { name: 'وحدة البحث العلمي', type: 'unit' }, env)).errors.name);
});

test('جهة: لا تُحذف وهي مرتبطة بمتطلبات (AC-ENT-02)، وتُحذف بعد فك الارتباط', () => {
  const { data, env } = setup();
  const r = assertNoChange(data, () => A.deleteEntity(data, 'ent-research', env));
  assert.match(r.message, /مرتبطة بـ متطلبين/);
  const created = A.createEntity(data, { name: 'جهة مؤقتة', type: 'other' }, env);
  assert.equal(A.deleteEntity(data, created.id, env).ok, true);
  assert.equal(data.entities.some(e => e.id === created.id), false);
  assert.equal(data.activities[0].action, 'delete');
});

// ---------- الأدلة ----------
test('دليل: تسجيل وصفي، والعلاقة بالمؤشر والمتطلب، ورفض الروابط الخطرة', () => {
  const { data, env } = setup();
  const res = A.createEvidence(data, { indicatorId: 'ind-ar-edu-8', requirementId: 'req-f5', title: 'قائمة الأبحاث', type: 'link', reference: 'https://example.org/list' }, env);
  assert.equal(res.ok, true);
  assert.equal(data.evidence[0].status, 'pending');
  const bad = [
    [{ indicatorId: '' }, 'indicatorId'], [{ indicatorId: 'ind-x' }, 'indicatorId'],
    [{ requirementId: 'req-f2' }, 'requirementId'], // F2 يتبع مؤشرًا آخر
    [{ requirementId: 'req-x' }, 'requirementId'], [{ title: 'اب' }, 'title'], [{ type: 'video' }, 'type'],
    [{ reference: '' }, 'reference'], [{ type: 'link', reference: 'not a url' }, 'reference'], [{ type: 'file', reference: 'javascript:alert(1)' }, 'reference']
  ];
  for (const [patch, field] of bad) {
    const r = assertNoChange(data, () => A.createEvidence(data, Object.assign({ indicatorId: 'ind-ar-edu-8', title: 'دليل', type: 'file', reference: 'مجلد' }, patch), env));
    assert.ok(r.errors[field], field + ' ' + JSON.stringify(patch));
  }
});

test('دليل: التحقق والرفض بسبب إلزامي، وتعديل المحتوى يعيده للانتظار', () => {
  const { data, env } = setup();
  const { id } = A.createEvidence(data, { indicatorId: 'ind-ar-edu-1', title: 'خطاب', type: 'letter', reference: 'صادر 1' }, env);
  assert.ok(assertNoChange(data, () => A.reviewEvidence(data, id, { result: 'rejected', note: '' }, env)).errors.note);
  assert.ok(assertNoChange(data, () => A.reviewEvidence(data, id, { result: 'maybe' }, env)).errors.result);
  assert.equal(A.reviewEvidence(data, id, { result: 'verified', note: '' }, env).ok, true);
  const ev = data.evidence.find(e => e.id === id);
  assert.equal(ev.status, 'verified');
  assert.equal(ev.reviewedOn, '2026-11-01');
  // تعديل العنوان فقط لا يعيد التحقق، وتعديل المرجع يعيده
  assert.equal(A.updateEvidence(data, id, Object.assign({}, ev, { title: 'خطاب الأعداد' }), env).info.resetToPending, false);
  assert.equal(ev.status, 'verified');
  assert.equal(A.updateEvidence(data, id, Object.assign({}, ev, { reference: 'صادر 2' }), env).info.resetToPending, true);
  assert.equal(ev.status, 'pending');
  assert.equal(A.reviewEvidence(data, id, { result: 'rejected', note: 'الخطاب غير موقع' }, env).ok, true);
  assert.match(data.activities[0].summary, /رُفض الدليل «خطاب الأعداد»: الخطاب غير موقع/);
  assert.equal(A.deleteEvidence(data, id, env).ok, true);
  assert.equal(data.evidence.length, 0);
});

// ---------- الأسئلة والقرارات ----------
test('سؤال وقرار: الإضافة والحسم وقيود التواريخ (AC-DEC-01/02)', () => {
  const { data, env } = setup();
  const res = A.addDecision(data, { indicatorId: 'ind-ar-edu-7', question: 'هل تُحتسب الاعتمادات المحلية؟', askedTo: 'لجنة التصنيفات', askedOn: '2026-10-29' }, env);
  assert.equal(res.ok, true);
  assert.ok(assertNoChange(data, () => A.addDecision(data, { indicatorId: 'ind-ar-edu-7', question: 'سؤال؟', askedTo: 'x@y.com', askedOn: '2026-10-29' }, env)).errors.askedTo);
  assert.ok(assertNoChange(data, () => A.addDecision(data, { indicatorId: 'ind-ar-edu-7', question: 'سؤال طويل كاف', askedTo: 'لجنة', askedOn: '2026-11-09' }, env)).errors.askedOn);
  assert.ok(assertNoChange(data, () => A.resolveDecision(data, res.id, { decision: '', decidedOn: '2026-10-30' }, env)).errors.decision);
  assert.ok(assertNoChange(data, () => A.resolveDecision(data, res.id, { decision: 'تُحتسب', decidedOn: '2026-10-20' }, env)).errors.decidedOn);
  assert.equal(A.resolveDecision(data, res.id, { decision: 'الإقليمية والدولية فقط', decidedOn: '2026-10-31' }, env).ok, true);
  assert.equal(data.decisions.find(d => d.id === res.id).status, 'resolved');
  assert.match(assertNoChange(data, () => A.resolveDecision(data, res.id, { decision: 'مرة ثانية', decidedOn: '2026-10-31' }, env)).message, /محسوم سابقًا/);
});

// ---------- السجل ----------
test('سجل الأنشطة: الأحدث أولًا وبحد أقصى 500 (AC-LOG-03)', () => {
  const { data, env } = setup();
  for (let i = 0; i < 520; i++) A.logEvent(data, env, 'export', 'تصدير رقم ' + i);
  assert.equal(data.activities.length, 500);
  assert.equal(data.activities[0].summary, 'تصدير رقم 519');
  assert.equal(data.activities[499].summary, 'تصدير رقم 20');
});

test('سلامة البيانات بعد سلسلة عمليات متنوعة', () => {
  const { data, env } = setup();
  const e = A.createEntity(data, { name: 'جهة جديدة', type: 'unit' }, env);
  const i = A.createIndicator(data, { ranking: 'QS', domain: 'مؤشرات QS', code: 'QS-NEW', name: 'مؤشر تجريبي جديد' }, env);
  const r = A.createRequirement(data, validReq({ indicatorId: i.id, entityId: e.id }), env);
  A.addFollowUp(data, r.id, { date: '2026-11-01', type: 'call', outcome: 'no_reply', note: 'اتصال أول' }, env);
  A.createEvidence(data, { indicatorId: i.id, requirementId: r.id, title: 'دليل أول', type: 'file', reference: 'مجلد' }, env);
  A.setIndicatorActive(data, i.id, false, env);
  A.deleteRequirement(data, r.id, env);
  assert.equal(A.deleteEntity(data, e.id, env).ok, true);
  assert.deepEqual(validateDataset(data).errors, []);
  assert.equal(data.activities.length, 8);
});
