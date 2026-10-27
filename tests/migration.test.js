// فحوص الترقية v1 ← v2 وسلامة الاستيراد وحالة التصنيف (AC-MIG، AC-PER-03، AC-PRG-03/04، AC-FUP-06)
const test = require('node:test');
const assert = require('node:assert/strict');

const { migrate, parseImport, validateDataset, summarize, exportJson } = require('../js/storage.js');
const { createSampleData } = require('../data/sample-data.js');
const derive = require('../js/derive.js');

// نسخة v1 كما كانت تُحفظ في المرحلتين 1 و3.
function v1() {
  const d = createSampleData();
  d.schemaVersion = 1;
  delete d.rankings; delete d.evidence; delete d.activities;
  d.indicators.forEach(i => { delete i.active; delete i.valueSource; });
  return d;
}

test('AC-MIG-01: ترقية بيانات v1 دون فقد أي حقل', () => {
  const old = v1();
  const m = migrate(old);
  assert.equal(m.schemaVersion, 2);
  assert.deepEqual(validateDataset(m).errors, []);
  assert.deepEqual(m.rankings.map(r => r.id), ['ARAB', 'QS']);
  assert.equal(m.rankings[0].submissionDeadline, '');
  assert.ok(m.indicators.every(i => i.active === true));
  assert.deepEqual(m.evidence, []);
  assert.deepEqual(m.activities, []);
  assert.equal(m.requirements.find(r => r.id === 'req-f3').completedAt, m.requirements.find(r => r.id === 'req-f3').updatedAt);
  assert.equal(m.requirements.find(r => r.id === 'req-f1').followUps[0].type, 'other');
  for (const r of old.requirements) {
    const n = m.requirements.find(x => x.id === r.id);
    for (const k of Object.keys(r)) if (k !== 'followUps') assert.deepEqual(n[k], r[k], r.id + '.' + k);
  }
  assert.equal(old.schemaVersion, 1, 'الترقية لا تعدّل المدخل');
});

test('AC-MIG-02: استيراد نسخة v1 يُقبل ويُرقّى، وإصدار أعلى يُرفض', () => {
  const res = parseImport(JSON.stringify(v1()));
  assert.equal(res.ok, true);
  assert.equal(res.migratedFrom, 1);
  assert.equal(res.data.schemaVersion, 2);
  const future = createSampleData(); future.schemaVersion = 3;
  assert.match(parseImport(JSON.stringify(future)).message, /إصدار البنية غير مدعوم/);
});

test('AC-PER-03: الاستيراد يرفض الملفات التالفة بأنواعها دون انهيار', () => {
  const broken = [];
  const a = createSampleData(); a.requirements[0].followUps.push({ id: 'x', date: 'أمس', note: 'ن' }); broken.push([a, /متابعة رقم 2/]);
  const b = createSampleData(); b.evidence.push({ id: 'ev1', indicatorId: 'ind-missing', title: 'د', status: 'pending' }); broken.push([b, /مؤشر غير موجود/]);
  const c = createSampleData(); c.evidence.push({ id: 'ev1', indicatorId: 'ind-ar-edu-1', requirementId: 'req-missing', title: 'د', status: 'pending' }); broken.push([c, /متطلب غير موجود/]);
  const d = createSampleData(); d.indicators[1].code = 'ar-edu-1'; broken.push([d, /مكرر/]);
  const e = createSampleData(); e.indicators[0].ranking = 'THE'; broken.push([e, /تصنيفًا غير موجود/]);
  const f = createSampleData(); f.requirements[0].deadline = '20/10/2026'; broken.push([f, /موعد المتطلب/]);
  const g = createSampleData(); g.rankings[0].submissionDeadline = 'غدًا'; broken.push([g, /موعد تسليم/]);
  const h = createSampleData(); delete h.activities; broken.push([h, /activities/]);
  const i = v1(); i.requirements = 'broken'; broken.push([i, /requirements/]);
  const j = v1(); j.indicators = null; broken.push([j, /indicators/]);
  for (const [data, re] of broken) {
    const res = parseImport(JSON.stringify(data));
    assert.equal(res.ok, false);
    assert.match(res.message, re);
  }
  assert.equal(parseImport('[1,2,3]').ok, false);
  assert.equal(parseImport('null').ok, false);
  assert.match(parseImport('x'.repeat(10 * 1024 * 1024 + 1)).message, /أكبر من الحد/);
});

test('ملخص الأعداد لحوار الاستيراد', () => {
  assert.deepEqual(summarize(createSampleData()), { requirements: 6, indicators: 12, entities: 5, evidence: 0, decisions: 1, activities: 0 });
});

test('التصدير ثم الاستيراد يحافظ على الأدلة والسجل', () => {
  const d = createSampleData();
  d.evidence.push({ id: 'ev1', indicatorId: 'ind-ar-edu-1', requirementId: 'req-f1', title: 'خطاب', type: 'letter', reference: 'صادر', notes: '', status: 'verified', reviewNote: '', reviewedOn: '2026-10-30' });
  d.activities.push({ id: 'act1', at: '2026-11-01T09:00:00.000Z', action: 'create', targetType: 'evidence', targetId: 'ev1', summary: 'سُجل' });
  const res = parseImport(exportJson(d, '2026-11-01').text);
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.evidence, d.evidence);
  assert.deepEqual(res.data.activities, d.activities);
});

test('AC-PRG-03/04: الأيام المتبقية وحالة الخطر بأسباب مكتوبة', () => {
  const data = createSampleData();
  const arab = derive.rankingStatus(data, 'ARAB', '2026-11-01');
  assert.equal(arab.days, 9);
  assert.equal(arab.readiness, 11);
  assert.equal(arab.entered, 0);
  assert.equal(arab.total, 9);
  assert.equal(arab.risk, true);
  assert.deepEqual(arab.reasons, ['متطلبان متأخران', 'الجاهزية 11% مع بقاء 9 أيام']);
  const qs = derive.rankingStatus(data, 'QS', '2026-11-01');
  assert.equal(qs.days, 56);
  assert.equal(qs.risk, false);
  assert.equal(qs.progress.pct, 33);
});

test('المؤشر المعطل لا يدخل في الجاهزية ولا في العدد', () => {
  const data = createSampleData();
  data.indicators.find(i => i.id === 'ind-ar-edu-1').active = false;
  const arab = derive.rankingStatus(data, 'ARAB', '2026-11-01');
  assert.equal(arab.total, 8);
  assert.equal(arab.readiness, 4); // ⅓ ÷ 8
  assert.equal(arab.overdue, 1); // F1 خرج مع مؤشره، وبقي F6
});

test('AC-FUP-06: المتابعة المستحقة، والأحدث تلغي ما قبلها', () => {
  const data = createSampleData();
  const f2 = data.requirements.find(r => r.id === 'req-f2');
  f2.followUps.push({ id: 'a', date: '2026-10-25', type: 'call', outcome: 'promised', note: 'وعد', nextActionDate: '2026-11-01' });
  assert.deepEqual(derive.dueFollowUps(data.requirements, '2026-11-01').map(x => x.requirement.id), ['req-f2']);
  f2.followUps.push({ id: 'b', date: '2026-10-31', type: 'call', outcome: 'promised', note: 'تأجيل', nextActionDate: '2026-11-04' });
  assert.deepEqual(derive.dueFollowUps(data.requirements, '2026-11-01'), []);
  f2.status = 'done';
  assert.deepEqual(derive.dueFollowUps(data.requirements, '2026-11-10'), []);
});
