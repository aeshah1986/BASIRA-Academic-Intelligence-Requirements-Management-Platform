// فحوص التنسيق والقيم المشتقة (AC-DUE، AC-PRG، AC-ENT-03، AC-IND-03) بالتاريخ المرجعي 2026-11-01
const test = require('node:test');
const assert = require('node:assert/strict');

const format = require('../js/format.js');
const derive = require('../js/derive.js');
const { createSampleData } = require('../data/sample-data.js');

const TODAY = '2026-11-01';
const data = createSampleData();
const req = id => data.requirements.find(r => r.id === id);
const ids = list => list.map(r => r.id.replace('req-', '').toUpperCase());

test('format: الأيام وصياغة العدد العربية والتاريخ الميلادي', () => {
  assert.equal(format.daysBetween('2026-11-01', '2026-10-20'), -12);
  assert.equal(format.daysBetween('2026-11-01', '2026-12-27'), 56);
  assert.equal(format.daysBetween('2026-11-01', 'خطأ'), null);
  assert.equal(format.dayCount(1), 'يوم واحد');
  assert.equal(format.dayCount(2), 'يومان');
  assert.equal(format.dayCount(-7), '7 أيام');
  assert.equal(format.dayCount(12), '12 يومًا');
  assert.equal(format.formatDate('2026-11-01'), '1 نوفمبر 2026');
  assert.equal(format.addDays('2026-11-05', -3), '2026-11-02');
  assert.equal(format.percent(1, 3), 33);
  assert.equal(format.percent(0, 0), null);
});

test('AC-DUE-01/02: المتأخر F1 وF6 فقط، وF3 المكتمل ليس متأخرًا', () => {
  const overdue = data.requirements.filter(r => derive.dueInfo(r, TODAY).kind === 'overdue');
  assert.deepEqual(ids(overdue), ['F1', 'F6']);
  assert.equal(derive.dueInfo(req('req-f3'), TODAY).kind, 'done');
});

test('AC-DUE-03: قريب الموعد F2 وF5', () => {
  const soon = data.requirements.filter(r => derive.dueInfo(r, TODAY).kind === 'soon');
  assert.deepEqual(ids(soon), ['F2', 'F5']);
});

test('AC-DUE-04: الحدود: اليوم قريب، و+7 قريب، و+8 لاحق', () => {
  const at = deadline => derive.dueInfo({ status: 'new', deadline }, TODAY);
  assert.equal(at('2026-11-01').kind, 'soon');
  assert.equal(at('2026-11-01').label, 'اليوم آخر موعد');
  assert.equal(at('2026-11-08').kind, 'soon');
  assert.equal(at('2026-11-09').kind, 'later');
});

test('AC-DUE-07: نص الأيام', () => {
  assert.equal(derive.dueInfo(req('req-f1'), TODAY).label, 'متأخر منذ 12 يومًا');
  assert.equal(derive.dueInfo(req('req-f2'), TODAY).label, 'متبقٍ 4 أيام');
});

test('AC-PRG-01: إنجاز المتطلبات: العربي 0%، وQS 33%، والكل 17%', () => {
  const byId = Object.fromEntries(data.indicators.map(i => [i.id, i]));
  const of = k => data.requirements.filter(r => byId[r.indicatorId].ranking === k);
  assert.equal(derive.requirementProgress(of('ARAB')).pct, 0);
  assert.equal(derive.requirementProgress(of('QS')).pct, 33);
  assert.equal(derive.requirementProgress(data.requirements).pct, 17);
  assert.equal(derive.requirementProgress([]).pct, null);
});

test('AC-PRG-02 وAC-IND-03: الجاهزية 11% / 0%، والمُدخل 0 من 9', () => {
  const arab = data.indicators.filter(i => i.ranking === 'ARAB');
  const qs = data.indicators.filter(i => i.ranking === 'QS');
  assert.equal(derive.indicatorReadiness(arab), 11);
  assert.equal(derive.indicatorReadiness(qs), 0);
  assert.equal(derive.enteredCount(arab), 0);
  assert.equal(arab.length, 9);
});

test('AC-PRG-05: ترتيب الإلحاح F1 ← F6 ← F2 ← F5 ← F4 ← F3', () => {
  assert.deepEqual(ids(derive.sortByUrgency(data.requirements, TODAY)), ['F1', 'F6', 'F2', 'F5', 'F4', 'F3']);
});

test('AC-ENT-03 (المنطق): إنجاز الجهات', () => {
  const s = derive.summaryByEntity(data.requirements, data.entities, TODAY);
  assert.equal(s['ent-partnerships'].pct, 100);
  assert.equal(s['ent-research'].pct, 0);
  assert.equal(s['ent-research'].open, 2);
  assert.equal(s['ent-hr'].overdue, 1);
});

test('آخر متابعة', () => {
  assert.equal(derive.lastFollowUp(req('req-f1')).date, '2026-10-22');
  assert.equal(derive.lastFollowUp(req('req-f2')), null);
});
