// فحوص عمليات المرحلة 5: تسجيل إرسال الخطاب، والقوالب، ومستوى التصعيد في المتابعة، والتحقق في الحفظ والاستيراد.
const test = require('node:test');
const assert = require('node:assert/strict');

const A = require('../js/actions.js');
const I = require('../js/insights.js');
const S = require('../js/storage.js');
const { createSampleData } = require('../data/sample-data.js');

const T = '2026-11-01';
function setup() {
  let n = 0;
  const env = { today: T, now: '2026-11-01T09:00:00.000Z', newId: p => p + '-t' + (++n) };
  return { data: createSampleData(), env };
}
function assertNoChange(data, fn) {
  const before = JSON.stringify(data);
  const res = fn();
  assert.equal(res.ok, false, 'كان يُتوقع الفشل');
  assert.equal(JSON.stringify(data), before, 'تغيرت البيانات رغم الفشل');
  return res;
}
const req = (data, id) => data.requirements.find(r => r.id === id);

test('LET-01 «تسجيل الإرسال» ينشئ متابعة L0 لكل بند بموعدها التالي، ونشاطًا واحدًا (AC-COM-03)', () => {
  const { data, env } = setup();
  const L = I.buildLetter(data, 'ent-research', 'L0', T);
  const res = A.recordLetterSent(data, 'ent-research', 0, L.plan, env);
  assert.equal(res.ok, true);
  assert.equal(res.info.count, 2);
  const f5 = req(data, 'req-f5').followUps.at(-1);
  assert.deepEqual([f5.date, f5.type, f5.outcome, f5.escalationLevel, f5.nextActionDate], [T, 'letter', 'no_reply', 0, '2026-11-05']);
  assert.equal(req(data, 'req-f4').followUps.at(-1).nextActionDate, '2026-12-12');
  assert.equal(data.activities.length, 1);
  assert.equal(data.activities[0].action, 'letter_sent');
  assert.match(data.activities[0].summary, /L0 \(طلب رسمي\) إلى «وحدة البحث العلمي» يضم متطلبين/);
  // بعد التسجيل: لا إجراء جديد اليوم، والتالي L1 في 2026-11-05
  const e = I.escalation(req(data, 'req-f5'), T);
  assert.deepEqual([e.kind, e.next.level, e.next.date], ['wait', 1, '2026-11-05']);
  assert.equal(I.suggestedLevel(data, 'ent-research', '2026-11-05'), 'L1');
  assert.equal(S.validateDataset(data).ok, true);
});

test('LET-02 «تسجيل الإرسال» يرفض دون أي تغيير', () => {
  const { data, env } = setup();
  const plan = I.buildLetter(data, 'ent-research', 'L0', T).plan;
  assertNoChange(data, () => A.recordLetterSent(data, 'ent-x', 0, plan, env));
  assertNoChange(data, () => A.recordLetterSent(data, 'ent-research', 5, plan, env));
  assertNoChange(data, () => A.recordLetterSent(data, 'ent-research', 0, [], env));
  assertNoChange(data, () => A.recordLetterSent(data, 'ent-hr', 0, plan, env)); // بنود جهة أخرى
  assertNoChange(data, () => A.recordLetterSent(data, 'ent-partnerships', 0, [{ requirementId: 'req-f3', nextActionDate: '' }], env)); // مكتمل
  assertNoChange(data, () => A.recordLetterSent(data, 'ent-research', 0, [{ requirementId: 'req-f5', nextActionDate: '2026-10-01' }], env)); // موعد ماضٍ
  // بند صالح وآخر غير صالح: الكل أو لا شيء
  assertNoChange(data, () => A.recordLetterSent(data, 'ent-research', 0, [plan[0], { requirementId: 'req-f1', nextActionDate: '' }], env));
});

test('LET-03 قالب الخطاب: الحفظ والاستعادة ونشاطهما', () => {
  const { data, env } = setup();
  const res = A.updateLetterTemplate(data, 'L2', { subject: 'تذكير رسمي {التصنيف}', body: 'سعادة {المستلم}،\r\nالبنود المتأخرة منذ {أيام_التأخر}:\n{البنود}' }, env, I.unknownPlaceholders);
  assert.equal(res.ok, true);
  assert.equal(data.settings.letterTemplates.L2.body, 'سعادة {المستلم}،\nالبنود المتأخرة منذ {أيام_التأخر}:\n{البنود}', 'CRLF يُوحَّد');
  assert.equal(I.templateFor(data, 'L2').custom, true);
  assert.equal(S.validateDataset(data).ok, true);
  assert.equal(A.resetLetterTemplate(data, 'L2', env).ok, true);
  assert.equal(I.templateFor(data, 'L2').custom, false);
  assert.deepEqual(data.activities.map(a => a.action), ['template_reset', 'template_update']);
  // الاستعادة دون تعديل سابق: لا نشاط
  assert.equal(A.resetLetterTemplate(data, 'L2', env).info.unchanged, true);
  assert.equal(data.activities.length, 2);
});

test('LET-04 قالب الخطاب: مدخلات خاطئة تُرفض دون تغيير (AC-COM-08)', () => {
  const { data, env } = setup();
  const ok = { subject: 'موضوع صالح', body: 'نص قالب صالح يتجاوز عشرين حرفًا {الجهة}' };
  const cases = [
    [{ subject: 'اب' }, 'subject'],
    [{ body: 'قصير' }, 'body'],
    [{ body: 'ع'.repeat(4001) }, 'body'],
    [{ body: 'للتواصل: coordinator@example.org مع البنود {البنود}' }, 'body'],
    [{ body: 'اتصل على 0551234567 بخصوص البنود {البنود}' }, 'body'],
    [{ body: 'نص طويل بما يكفي مع متغير خاطئ {الجهه}' }, 'body'],
    [{ subject: 'موضوع {غير_موجود}' }, 'subject']
  ];
  for (const [patch, field] of cases) {
    const res = assertNoChange(data, () => A.updateLetterTemplate(data, 'L0', Object.assign({}, ok, patch), env, I.unknownPlaceholders));
    assert.ok(res.errors[field], JSON.stringify(patch));
  }
  assertNoChange(data, () => A.updateLetterTemplate(data, 'L7', ok, env, I.unknownPlaceholders));
  assertNoChange(data, () => A.resetLetterTemplate(data, 'X', env));
});

test('LET-05 مستوى التصعيد في المتابعة اليدوية: اختياري، ويُخزن رقمًا، ويُرفض غير المعروف', () => {
  const { data, env } = setup();
  const base = { date: T, type: 'letter', outcome: 'no_reply', note: 'أُرسل تذكير رسمي', nextActionDate: '' };
  assertNoChange(data, () => A.addFollowUp(data, 'req-f6', Object.assign({}, base, { escalationLevel: '5' }), env));
  assertNoChange(data, () => A.addFollowUp(data, 'req-f6', Object.assign({}, base, { escalationLevel: 'L2' }), env));
  assert.equal(A.addFollowUp(data, 'req-f6', Object.assign({}, base, { escalationLevel: '2' }), env).ok, true);
  assert.equal(req(data, 'req-f6').followUps.at(-1).escalationLevel, 2);
  assert.match(data.activities[0].summary, /، L2\)/);
  assert.equal(A.addFollowUp(data, 'req-f6', Object.assign({}, base, { escalationLevel: '' }), env).ok, true);
  assert.equal('escalationLevel' in req(data, 'req-f6').followUps.at(-1), false);
  // المستوى المسجل يدخل في C-ESC
  assert.equal(I.escalation(req(data, 'req-f6'), T).executed, 2);
});

test('LET-06 التحقق عند الاستيراد: مستوى تصعيد وإعدادات غير صالحة تُرفض، والصالحة تُحفظ بعد التصدير والاستيراد', () => {
  const bad = (mutate) => { const d = createSampleData(); mutate(d); return S.parseImport(JSON.stringify(d)); };
  assert.equal(bad(d => { d.requirements[0].followUps[0].escalationLevel = 7; }).ok, false);
  assert.equal(bad(d => { d.requirements[0].followUps[0].escalationLevel = '2'; }).ok, false);
  assert.equal(bad(d => { d.settings = 'x'; }).ok, false);
  assert.equal(bad(d => { d.settings = { letterTemplates: [] }; }).ok, false);
  assert.equal(bad(d => { d.settings = { letterTemplates: { L5: { subject: 'س', body: 'ن' } } }; }).ok, false);
  assert.equal(bad(d => { d.settings = { letterTemplates: { L1: { subject: '', body: 'ن' } } }; }).ok, false);
  assert.equal(bad(d => { d.requirements[0].followUps[0].escalationLevel = null; }).ok, true, 'null = متابعة عادية');
  const { data, env } = setup();
  A.updateLetterTemplate(data, 'L3', { subject: 'تصعيد {الجهة}', body: 'سعادة {المستلم}، البنود: {البنود} منذ {أيام_التأخر}' }, env, I.unknownPlaceholders);
  A.recordLetterSent(data, 'ent-hr', 3, I.buildLetter(data, 'ent-hr', 'L3', T).plan, env);
  const back = S.parseImport(S.exportJson(data, T).text);
  assert.equal(back.ok, true);
  assert.equal(back.data.settings.letterTemplates.L3.subject, 'تصعيد {الجهة}');
  assert.equal(back.data.requirements.find(r => r.id === 'req-f1').followUps.at(-1).escalationLevel, 3);
});
