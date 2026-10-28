// فحوص محرك التحليل التشغيلي (js/insights.js) بحالات محسوبة مسبقًا يدويًا.
// البيانات: data/sample-data.js (F1–F6)، واليوم المرجعي 2026-11-01. الحسابات اليدوية في docs/design/09 §6.
const test = require('node:test');
const assert = require('node:assert/strict');

const I = require('../js/insights.js');
const A = require('../js/actions.js');
const F = require('../js/format.js');
const { createSampleData } = require('../data/sample-data.js');
const { createDemoData } = require('../data/demo-data.js');
const { validateDataset } = require('../js/storage.js');

const T = '2026-11-01';
function setup() {
  let n = 0;
  const env = { today: T, now: '2026-11-01T09:00:00.000Z', newId: p => p + '-t' + (++n) };
  return { data: createSampleData(), env };
}
const req = (data, id) => data.requirements.find(r => r.id === id);

// ---------- درجة الأولوية وترتيبها ----------
test('INT-01 ترتيب الأولويات ودرجاتها مطابقة للحساب اليدوي', () => {
  const { data } = setup();
  const ranked = I.rankRequirements(data, T);
  assert.deepEqual(ranked.map(x => [x.rank, x.requirement.id, x.score]), [
    [1, 'req-f6', 97], [2, 'req-f1', 92], [3, 'req-f2', 66], [4, 'req-f5', 40], [5, 'req-f4', 10]
  ]);
  assert.ok(!ranked.some(x => x.requirement.id === 'req-f3'), 'المكتمل لا يدخل الترتيب');
});

test('INT-02 كل درجة مفسرة: نقاط كل قاعدة ومجموعها يساوي الدرجة', () => {
  const { data } = setup();
  const pts = id => Object.fromEntries(I.priorityScore(req(data, id), data, T).factors.map(f => [f.key, f.points]));
  // F6: متأخر 7 أيام (50+7) + عالية 20 + بانتظار الجهة دون متابعة 10 + موعد العربي بعد 9 أيام 10 = 97
  assert.deepEqual(pts('req-f6'), { overdue: 57, priority: 20, nofollowup: 10, submission: 10 });
  // F1: متأخر 12 (62) + عالية 20 + العربي 10 = 92 (قيد التنفيذ، فلا قاعدة «بانتظار الجهة»)
  assert.deepEqual(pts('req-f1'), { overdue: 62, priority: 20, submission: 10 });
  // F2: بعد 4 أيام 30 + 2×3 = 36، وعالية 20، وبانتظار الجهة دون متابعة 10. وQS بعد 56 يومًا فلا نقاط
  assert.deepEqual(pts('req-f2'), { soon: 36, priority: 20, nofollowup: 10 });
  // F5: بعد 7 أيام 30 + 0، ومنخفضة 0 (لا تُعرض)، والعربي 10
  assert.deepEqual(pts('req-f5'), { soon: 30, submission: 10 });
  // F4: بعد 44 يومًا لا نقاط موعد، ومتوسطة 10
  assert.deepEqual(pts('req-f4'), { priority: 10 });
  for (const r of data.requirements) {
    const s = I.priorityScore(r, data, T);
    assert.equal(s.score, s.factors.reduce((a, f) => a + f.points, 0));
    s.factors.forEach(f => assert.ok(f.label.length > 3, 'كل قاعدة لها سبب مكتوب'));
  }
});

test('INT-03 الحتمية: النتيجة نفسها في كل تشغيل، ولا تعديل للبيانات', () => {
  const { data } = setup();
  const before = JSON.stringify(data);
  const a = JSON.stringify([I.rankRequirements(data, T), I.alerts(data, T), I.completion(data, T), I.incompleteRequirements(data, T)]);
  const b = JSON.stringify([I.rankRequirements(data, T), I.alerts(data, T), I.completion(data, T), I.incompleteRequirements(data, T)]);
  assert.equal(a, b);
  assert.equal(JSON.stringify(data), before);
});

test('INT-04 حدود قواعد الموعد: اليوم، والسابع، والثامن، والثلاثون، والحادي والثلاثون، ولا موعد', () => {
  const { data } = setup();
  const base = Object.assign({}, req(data, 'req-f4'), { priority: 'low', status: 'new' });
  const score = deadline => I.priorityScore(Object.assign({}, base, { deadline }), data, T).score;
  assert.equal(score('2026-11-01'), 44); // اليوم: 30 + 2×7
  assert.equal(score('2026-11-08'), 30); // السابع
  assert.equal(score('2026-11-09'), 10); // الثامن: خلال 30 يومًا
  assert.equal(score('2026-12-01'), 10); // الثلاثون
  assert.equal(score('2026-12-02'), 0);  // الحادي والثلاثون
  assert.equal(score('2026-10-31'), 51); // متأخر يوم واحد
  assert.equal(score('2026-08-01'), 80); // متأخر 92 يومًا: التأخر يُحسب حتى 30 فقط
  assert.equal(score(''), 20);           // لا موعد صالح
});

// ---------- سلّم التصعيد C-ESC والخطوة التالية ----------
test('INT-05 C-ESC على بيانات الفحص مطابق لجدول docs/design/07 §3 (AC-COM-04، AC-COM-05)', () => {
  const { data } = setup();
  const e = id => { const x = I.escalation(req(data, id), T); return [x.kind, x.due, x.skipped, x.next && x.next.date]; };
  assert.deepEqual(e('req-f1'), ['action', 4, 4, null]);
  assert.deepEqual(e('req-f6'), ['action', 4, 4, null]);
  assert.deepEqual(e('req-f2'), ['action', 0, 0, '2026-11-02']);
  assert.deepEqual(e('req-f5'), ['action', 0, 0, '2026-11-05']);
  assert.deepEqual(e('req-f4'), ['action', 0, 0, '2026-12-12']);
  assert.deepEqual(e('req-f3'), ['none', null, 0, null]);
  assert.match(I.nextStep(req(data, 'req-f1'), data, T).text, /L4.*تُجووز 4 مستويات دون توثيق/);
  assert.doesNotMatch(I.nextStep(req(data, 'req-f2'), data, T).text, /تُجووز/);
});

test('INT-06 C-ESC بعد تسجيل مستويات: المنفذ يمنع التكرار، والتجاوز يُحسب من آخر منفذ', () => {
  const { data } = setup();
  const f6 = req(data, 'req-f6');
  f6.followUps.push({ id: 'x1', date: '2026-10-27', type: 'letter', outcome: 'no_reply', note: 'خطاب', nextActionDate: '', escalationLevel: 2 });
  const e6 = I.escalation(f6, T);
  assert.deepEqual([e6.kind, e6.due, e6.executed, e6.skipped], ['action', 4, 2, 1]);
  const f2 = req(data, 'req-f2');
  f2.followUps.push({ id: 'x2', date: T, type: 'letter', outcome: 'no_reply', note: 'خطاب', nextActionDate: '', escalationLevel: 0 });
  const e2 = I.escalation(f2, T);
  assert.deepEqual([e2.kind, e2.next.level, e2.next.date], ['wait', 1, '2026-11-02']);
  assert.ok(/انتظار رد الجهة.*L1/.test(I.nextStep(f2, data, T).text) && I.nextStep(f2, data, T).text.includes(F.formatDate('2026-11-02')));
  // في 2026-11-02 يحل L1
  assert.deepEqual([I.escalation(f2, '2026-11-02').kind, I.escalation(f2, '2026-11-02').due], ['action', 1]);
  const f1 = req(data, 'req-f1');
  f1.followUps.push({ id: 'x3', date: T, type: 'letter', outcome: 'no_reply', note: 'خطاب', nextActionDate: '', escalationLevel: 4 });
  assert.equal(I.escalation(f1, T).kind, 'max');
  assert.equal(I.nextStep(f1, data, T).kind, 'decision');
});

test('INT-07 ترتيب قواعد الخطوة التالية: مكتمل، ثم جاهز للإكمال، ثم المكلف، ثم الموعد', () => {
  const { data } = setup();
  const f5 = req(data, 'req-f5');
  assert.equal(I.nextStep(req(data, 'req-f3'), data, T).rule, 'S1');
  assert.equal(I.nextStep(Object.assign({}, f5, { missingData: '', evidenceLink: 'https://example.org/e' }), data, T).rule, 'S2');
  assert.equal(I.nextStep(Object.assign({}, f5, { assignee: '' }), data, T).rule, 'S3');
  assert.equal(I.nextStep(Object.assign({}, f5, { deadline: '2026-02-30' }), data, T).rule, 'S4');
  assert.equal(I.nextStep(f5, data, T).rule, 'S5');
});

// ---------- النواقص وشروط الاكتمال ----------
test('INT-08 المتطلبات غير المستوفية وشروطها الناقصة', () => {
  const { data } = setup();
  const list = I.incompleteRequirements(data, T);
  assert.deepEqual(list.map(x => [x.requirement.id, x.check.unmet.map(c => c.key).join(',')]), [
    ['req-f6', 'missingData,evidenceLink,contact'],
    ['req-f2', 'missingData,evidenceLink,contact'],
    ['req-f1', 'missingData,evidenceLink'],
    ['req-f5', 'missingData,evidenceLink'],
    ['req-f4', 'missingData,evidenceLink']
  ]);
  const f1 = I.requirementConditions(req(data, 'req-f1'), data, T);
  assert.deepEqual([f1.met, f1.total, f1.pct, f1.ready], [3, 5, 60, false]); // F1 متأخر وله متابعة، فشرط التواصل متحقق
  const f4 = I.requirementConditions(req(data, 'req-f4'), data, T);
  assert.equal(f4.total, 4, 'شرط التواصل لا يُطلب لمتطلب جديد غير متأخر');
  // موعد بعد موعد تسليم التصنيف يُعد نقصًا في جودة البيانات
  const late = I.requirementConditions(Object.assign({}, req(data, 'req-f5'), { deadline: '2026-11-20' }), data, T);
  assert.equal(late.unmet.some(c => c.key === 'deadline'), true);
});

test('INT-09 مؤشرات تحتاج انتباهًا: بلا عمل، وتعارض قيم، والمعطل مستبعد', () => {
  const { data } = setup();
  const keys = () => I.indicatorGaps(data).map(x => x.indicator.code + ':' + x.reasons.map(r => r.key).join('+'));
  assert.deepEqual(keys(), ['AR-EDU-1:conflict', 'AR-EDU-2:unattended', 'AR-EDU-3:unattended', 'AR-EDU-4:unattended', 'AR-EDU-5:unattended',
    'AR-EDU-7:unattended', 'AR-EDU-9:unattended', 'QS-IRN:unattended']);
  data.indicators.find(i => i.code === 'AR-EDU-2').active = false;
  assert.ok(!keys().some(k => k.startsWith('AR-EDU-2')));
});

// ---------- نسب الإنجاز ----------
test('INT-10 نسب الإنجاز من البيانات الفعلية', () => {
  const { data } = setup();
  const c = I.completion(data, T);
  assert.deepEqual(c.overall, { done: 1, total: 6, pct: 17 });
  assert.deepEqual(c.byStatus, { new: 2, in_progress: 1, waiting: 2, done: 1 });
  assert.deepEqual(c.buckets, { overdue: 2, soon: 2, month: 0, later: 1, none: 0, done: 1 });
  assert.deepEqual(c.rankings.map(r => [r.id, r.readiness, r.progress.pct, r.entered, r.total]), [['ARAB', 11, 0, 0, 9], ['QS', 0, 33, 0, 3]]);
  assert.deepEqual(c.byPriority.high, { done: 0, total: 3, pct: 0 });
  assert.deepEqual(c.byPriority.medium, { done: 1, total: 2, pct: 50 });
  assert.equal(c.entities.find(e => e.id === 'ent-partnerships').pct, 100);
});

// ---------- التنبيهات ----------
test('INT-11 التنبيهات العاجلة: النوع والمستوى والترتيب', () => {
  const { data } = setup();
  const al = I.alerts(data, T);
  assert.deepEqual(al.map(a => a.level + ':' + a.kind), ['danger:ranking_risk', 'danger:overdue', 'danger:overdue', 'warning:decision_stale', 'warning:conflict']);
  assert.equal(al[1].title, 'تحديث أعداد أعضاء هيئة التدريس', 'الأكثر تأخرًا (F1، 12 يومًا) قبل F6');
  assert.match(al[0].detail, /متطلبان متأخران/);
});

test('INT-12 تنبيهات إضافية: موعد إجراء تالٍ حلّ، وأولوية عالية خلال 3 أيام', () => {
  const { data } = setup();
  req(data, 'req-f2').deadline = '2026-11-03';
  req(data, 'req-f5').followUps.push({ id: 'z', date: '2026-10-28', type: 'call', outcome: 'promised', note: 'وعد', nextActionDate: '2026-10-31' });
  const kinds = I.alerts(data, T).map(a => a.kind);
  assert.ok(kinds.includes('soon_high'));
  assert.ok(kinds.includes('followup_due'));
  // ودرجة F5 تزيد 10 بسبب الإجراء التالي المستحق
  assert.equal(I.priorityScore(req(data, 'req-f5'), data, T).score, 50);
});

test('INT-13 التحليلات تتحدث عند تغيير البيانات (عبر العمليات الفعلية)', () => {
  const { data, env } = setup();
  // إكمال F1 بعد استيفاء شرطيه
  let res = A.updateRequirement(data, 'req-f1', Object.assign({}, req(data, 'req-f1'), { missingData: '', evidenceLink: 'https://example.org/f1', status: 'done' }), env);
  assert.equal(res.ok, true);
  assert.deepEqual(I.completion(data, T).overall, { done: 2, total: 6, pct: 33 });
  assert.deepEqual(I.rankRequirements(data, T).map(x => x.requirement.id), ['req-f6', 'req-f2', 'req-f5', 'req-f4']);
  assert.equal(I.alerts(data, T).filter(a => a.kind === 'overdue').length, 1);
  // متابعة على F6 تُسقط قاعدة «دون متابعة» وتُحقق شرط التواصل
  res = A.addFollowUp(data, 'req-f6', { date: T, type: 'call', outcome: 'promised', note: 'وعدت الجهة بالتسليم', nextActionDate: '' }, env);
  assert.equal(res.ok, true);
  assert.equal(I.priorityScore(req(data, 'req-f6'), data, T).score, 87);
  assert.ok(!I.incompleteRequirements(data, T).find(x => x.requirement.id === 'req-f6').check.unmet.some(c => c.key === 'contact'));
});

// ---------- استجابة الجهات ----------
test('INT-14 استجابة الجهات (AC-COM-07) وحساب التأخر', () => {
  const { data } = setup();
  let r = I.entityResponse(data, T);
  const p = r.find(x => x.id === 'ent-partnerships');
  assert.deepEqual([p.completed, p.onTime, p.onTimePct, p.avgLateDays], [1, 1, 100, null]);
  r.filter(x => x.id !== 'ent-partnerships').forEach(x => assert.equal(x.onTimePct, null));
  // إكمال F1 متأخرًا 5 أيام، ومتابعة L3
  Object.assign(req(data, 'req-f1'), { status: 'done', completedAt: '2026-10-25T10:00:00.000Z' });
  req(data, 'req-f1').followUps.push({ id: 'e3', date: '2026-10-24', type: 'letter', outcome: 'no_reply', note: 'تصعيد', nextActionDate: '', escalationLevel: 3 });
  r = I.entityResponse(data, T);
  const hr = r.find(x => x.id === 'ent-hr');
  assert.deepEqual([hr.completed, hr.onTime, hr.onTimePct, hr.avgLateDays, hr.escalations, hr.open], [1, 0, 0, 5, 1, 0]);
});

// ---------- الخطابات ----------
test('INT-15 خطاب طلب لجهة البحث العلمي (AC-COM-01): البنود المفتوحة فقط، وقيمة العام الماضي، والمواعيد', () => {
  const { data } = setup();
  const L = I.buildLetter(data, 'ent-research', 'L0', T);
  assert.equal(L.ok, true);
  assert.deepEqual(L.items.map(r => r.id), ['req-f5', 'req-f4']);
  assert.match(L.body, /قيمة العام الماضي للتأكيد أو التحديث: 90/);
  assert.match(L.body, /روابط Scopus لبعض الأبحاث/);
  assert.ok(L.body.includes('آخر موعد للتسليم: ' + F.formatDate('2026-11-08')));
  assert.ok(L.body.includes('موعد تسليم التصنيف هو ' + F.formatDate('2026-11-10')));
  assert.equal(L.subject, 'طلب استكمال بيانات التصنيف العربي للجامعات وQS');
  assert.deepEqual(L.plan, [{ requirementId: 'req-f5', nextActionDate: '2026-11-05' }, { requirementId: 'req-f4', nextActionDate: '2026-12-12' }]);
  assert.deepEqual(L.unknown, []);
  assert.doesNotMatch(L.body, /\{[^}]+\}/, 'لا متغير غير مستبدل');
});

test('INT-16 الخطاب: المستلم بالمسمى الوظيفي، وأيام التأخر، ولا بريد ولا هاتف (AC-COM-08)', () => {
  const { data } = setup();
  const l2 = I.buildLetter(data, 'ent-hr', 'L2', T);
  assert.match(l2.body, /^سعادة رئيس وحدة الموارد البشرية المحترم/);
  assert.match(l2.body, /منذ 12 يومًا/);
  assert.equal(I.buildLetter(data, 'ent-hr', 'L4', T).vars['المستلم'], 'مكتب رئيس الجامعة / لجنة التصنيفات');
  for (const e of data.entities) for (const code of ['L0', 'L1', 'L2', 'L3', 'L4']) {
    const l = I.buildLetter(data, e.id, code, T);
    if (l.ok) assert.equal(require('../js/model.js').hasContactInfo(l.subject + l.body), false);
  }
  // L4 لا مستوى بعده
  assert.deepEqual(I.buildLetter(data, 'ent-hr', 'L4', T).plan, [{ requirementId: 'req-f1', nextActionDate: '' }]);
  // L0 لمتطلب متأخر: موعد L1 مضى، فالإجراء التالي = اليوم
  assert.deepEqual(I.buildLetter(data, 'ent-hr', 'L0', T).plan, [{ requirementId: 'req-f1', nextActionDate: T }]);
});

test('INT-17 الخطاب: حالات الرفض، والمستوى المقترح', () => {
  const { data } = setup();
  assert.equal(I.buildLetter(data, 'ent-partnerships', 'L0', T).ok, false); // لا مفتوح
  assert.equal(I.buildLetter(data, 'ent-x', 'L0', T).ok, false);
  assert.equal(I.buildLetter(data, 'ent-hr', 'L9', T).ok, false);
  assert.equal(I.suggestedLevel(data, 'ent-hr', T), 'L4');
  assert.equal(I.suggestedLevel(data, 'ent-research', T), 'L0');
});

test('INT-18 القوالب: الاستبدال، والمتغير غير المعروف يبقى ويُكشف، والقالب المعدّل يُستخدم', () => {
  assert.equal(I.renderTemplate('إلى {الجهة} و{غير_معروف}', { 'الجهة': 'س' }), 'إلى س و{غير_معروف}');
  assert.deepEqual(I.unknownPlaceholders('{الجهة} {الجهه} {البنود} {الجهه}'), ['الجهه']);
  const { data, env } = setup();
  const res = A.updateLetterTemplate(data, 'L1', { subject: 'تذكير {التصنيف}', body: 'إلى {الجهة}: نذكّركم بالبنود:\n{البنود}' }, env, I.unknownPlaceholders);
  assert.equal(res.ok, true);
  const l = I.buildLetter(data, 'ent-research', 'L1', T);
  assert.equal(l.custom, true);
  assert.match(l.body, /^إلى وحدة البحث العلمي: نذكّركم بالبنود:\n• أعداد البحوث/);
  assert.equal(I.buildLetter(data, 'ent-research', 'L0', T).custom, false, 'القوالب الأخرى بلا تغيير');
});

// ---------- التصدير ----------
test('INT-19 صفوف تصدير الأولويات واستجابة الجهات', () => {
  const { data } = setup();
  const rows = I.priorityRows(data, T);
  assert.equal(rows.length, 5);
  rows.forEach(r => assert.equal(r.length, I.PRIORITY_HEADERS.length));
  assert.deepEqual(rows[0].slice(0, 4), [1, 97, 'بيانات الخبراء المنتدبين من خارج الجامعة', 'AR-EDU-6']);
  const overdue = I.priorityRows(data, T, r => r.deadline < T);
  assert.deepEqual(overdue.map(r => r[0]), [1, 2]);
  const resp = I.responseRows(data, T);
  resp.forEach(r => assert.equal(r.length, I.RESPONSE_HEADERS.length));
  assert.deepEqual(resp.find(r => r[0] === 'وحدة الشراكات الدولية'), ['وحدة الشراكات الدولية', 1, 1, '100%', '—', 0, 0, 0]);
});

// ---------- المتانة على بيانات العرض ----------
test('INT-20 المحرك يعمل على بيانات العرض في تواريخ مختلفة دون أخطاء', () => {
  for (const day of ['2026-01-01', '2026-11-01', '2027-06-30']) {
    const data = createDemoData(day);
    const ranked = I.rankRequirements(data, day);
    for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score);
    ranked.forEach(x => assert.ok(x.score >= 0));
    I.alerts(data, day);
    I.completion(data, day);
    data.entities.forEach(e => { const l = I.buildLetter(data, e.id, I.suggestedLevel(data, e.id, day), day); if (l.ok) assert.deepEqual(l.unknown, []); });
    assert.equal(validateDataset(data).ok, true);
  }
});
