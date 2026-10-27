// فحوص البيانات التجريبية الوهمية (AC-DATA، AC-SEC-03، وبيانات الفحص الثابتة)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSampleData } = require('../data/sample-data.js');
const { validateDataset } = require('../js/storage.js');

const SAMPLE_PATH = path.join(__dirname, '..', 'data', 'sample-data.js');

test('AC-DATA-02: البيانات التجريبية سليمة البنية وكل متطلب يشير إلى مؤشر وجهة موجودين', () => {
  const data = createSampleData();
  const result = validateDataset(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('بيانات الفحص F1–F6 مطابقة لجدول ACCEPTANCE_CRITERIA.md', () => {
  const data = createSampleData();
  const byId = Object.fromEntries(data.requirements.map(r => [r.id, r]));
  const expected = [
    ['req-f1', 'تحديث أعداد أعضاء هيئة التدريس', 'ind-ar-edu-1', 'ent-hr', '2026-10-20', 'in_progress', 'high'],
    ['req-f2', 'بيانات الطلاب الدوليين', 'ind-qs-isr', 'ent-students', '2026-11-05', 'waiting', 'high'],
    ['req-f3', 'قائمة الشراكات البحثية الدولية', 'ind-qs-irn', 'ent-partnerships', '2026-10-15', 'done', 'medium'],
    ['req-f4', 'إحصاءات الاستشهادات للأبحاث المنشورة', 'ind-qs-cpf', 'ent-research', '2026-12-15', 'new', 'medium'],
    ['req-f5', 'أعداد البحوث المنشورة بمشاركة طلبة البكالوريوس', 'ind-ar-edu-8', 'ent-research', '2026-11-08', 'new', 'low'],
    ['req-f6', 'بيانات الخبراء المنتدبين من خارج الجامعة', 'ind-ar-edu-6', 'ent-academic', '2026-10-25', 'waiting', 'high']
  ];
  assert.equal(data.requirements.length, 6);
  for (const [id, title, indicatorId, entityId, deadline, status, priority] of expected) {
    const r = byId[id];
    assert.ok(r, id + ' موجود');
    assert.deepEqual(
      { title: r.title, indicatorId: r.indicatorId, entityId: r.entityId, deadline: r.deadline, status: r.status, priority: r.priority },
      { title, indicatorId, entityId, deadline, status, priority },
      id
    );
  }
});

test('المؤشرات: 9 للتعليم والتعلم (العربي) و3 لـ QS، وقيم I1/I6/I8/IQ كما في الجدول، ولا مؤشر «مُدخل في المنصة»', () => {
  const data = createSampleData();
  const arab = data.indicators.filter(i => i.ranking === 'ARAB' && i.domain === 'التعليم والتعلم');
  const qs = data.indicators.filter(i => i.ranking === 'QS');
  assert.equal(arab.length, 9);
  assert.equal(qs.length, 3);
  const byId = Object.fromEntries(data.indicators.map(i => [i.id, i]));
  const pick = i => ({ workStatus: i.workStatus, currentValue: i.currentValue, progressFileValue: i.progressFileValue, lastYearValue: i.lastYearValue });
  assert.deepEqual(pick(byId['ind-ar-edu-1']), { workStatus: 'evidenced', currentValue: '1:15', progressFileValue: '1:11', lastYearValue: '1:19' }); // I1
  assert.deepEqual(pick(byId['ind-ar-edu-6']), { workStatus: 'not_started', currentValue: '', progressFileValue: '40', lastYearValue: '35' }); // I6
  assert.deepEqual(pick(byId['ind-ar-edu-8']), { workStatus: 'draft', currentValue: '120', progressFileValue: '120', lastYearValue: '90' }); // I8
  assert.deepEqual(pick(byId['ind-qs-isr']), { workStatus: 'not_started', currentValue: '', progressFileValue: '', lastYearValue: '' }); // IQ
  assert.equal(data.indicators.filter(i => i.workStatus === 'entered').length, 0);
});

test('القرار D1 هو السؤال الوحيد، مفتوح ومرتبط بـ I1', () => {
  const data = createSampleData();
  assert.equal(data.decisions.length, 1);
  assert.equal(data.decisions[0].id, 'dec-1');
  assert.equal(data.decisions[0].status, 'open');
  assert.equal(data.decisions[0].indicatorId, 'ind-ar-edu-1');
});

test('createSampleData تعيد نسخة مستقلة في كل استدعاء', () => {
  const a = createSampleData();
  a.requirements[0].title = 'تعديل تجريبي';
  const b = createSampleData();
  assert.equal(b.requirements[0].title, 'تحديث أعداد أعضاء هيئة التدريس');
});

test('AC-DATA-03: رأس ملف البيانات يعلن أنها وهمية', () => {
  const head = fs.readFileSync(SAMPLE_PATH, 'utf8').split('\n').slice(0, 5).join('\n');
  assert.match(head, /بيانات تجريبية وهمية/);
});

test('AC-SEC-03 (جزء آلي): لا بريد إلكتروني ولا أرقام هواتف ولا روابط في ملف البيانات', () => {
  const text = fs.readFileSync(SAMPLE_PATH, 'utf8');
  assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.]+/, 'بريد إلكتروني');
  // التواريخ (2026-10-20 و2026-10-10T08:00:00.000Z) تُحذف أولًا حتى لا تُحسب أرقام هواتف.
  const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, '');
  assert.doesNotMatch(withoutDates, /\+?\d[\d\s-]{7,}\d/, 'رقم هاتف');
  assert.doesNotMatch(text, /https?:\/\//, 'رابط');
});
