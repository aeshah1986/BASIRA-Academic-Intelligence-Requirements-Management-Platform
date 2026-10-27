// فحوص التحقق من المدخلات (AC-VAL) وكشف تعارض القيم (AC-IND-02)
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRequirement, hasValueConflict, isValidDate, MESSAGES } = require('../js/model.js');
const { createSampleData } = require('../data/sample-data.js');

const data = createSampleData();
const context = { indicators: data.indicators, entities: data.entities };

function validInput(overrides) {
  return Object.assign({
    title: 'متطلب تجريبي',
    indicatorId: 'ind-ar-edu-2',
    entityId: 'ent-hr',
    deadline: '2026-11-20'
  }, overrides);
}

test('متطلب صالح يُقبل وتُضبط القيم الافتراضية (الحالة جديد، الأولوية متوسطة)', () => {
  const result = validateRequirement(validInput(), context);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, {});
  assert.equal(result.value.status, 'new');
  assert.equal(result.value.priority, 'medium');
});

test('AC-VAL-01: عنوان من مسافات فقط يُرفض برسالة عربية', () => {
  const result = validateRequirement(validInput({ title: '   ' }), context);
  assert.equal(result.ok, false);
  assert.equal(result.errors.title, 'العنوان مطلوب.');
});

test('AC-VAL-02: ترك المؤشر أو الجهة فارغًا يُرفض برسالة للحقل المعني', () => {
  const noIndicator = validateRequirement(validInput({ indicatorId: '' }), context);
  assert.equal(noIndicator.ok, false);
  assert.equal(noIndicator.errors.indicatorId, MESSAGES.indicatorRequired);

  const noEntity = validateRequirement(validInput({ entityId: '' }), context);
  assert.equal(noEntity.ok, false);
  assert.equal(noEntity.errors.entityId, MESSAGES.entityRequired);
});

test('AC-VAL-02 (امتداد): مؤشر أو جهة غير موجودين يُرفضان', () => {
  const result = validateRequirement(validInput({ indicatorId: 'ind-x', entityId: 'ent-x' }), context);
  assert.equal(result.errors.indicatorId, MESSAGES.indicatorUnknown);
  assert.equal(result.errors.entityId, MESSAGES.entityUnknown);
});

test('AC-VAL-03: موعد فارغ أو غير موجود في التقويم يُرفض', () => {
  for (const deadline of ['', '2026-02-30', '2026-13-01', '2026-2-3', '30/10/2026']) {
    const result = validateRequirement(validInput({ deadline }), context);
    assert.equal(result.ok, false, deadline);
    assert.equal(result.errors.deadline, 'الموعد النهائي غير صالح.', deadline);
  }
});

test('isValidDate يقبل تاريخًا صحيحًا ومنه 29 فبراير في سنة كبيسة', () => {
  assert.equal(isValidDate('2026-10-30'), true);
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('2026-02-29'), false);
});

test('AC-VAL-04: تنظيف المسافات في العنوان', () => {
  const result = validateRequirement(validInput({ title: '  بيانات   الطلاب  ' }), context);
  assert.equal(result.ok, true);
  assert.equal(result.value.title, 'بيانات الطلاب');
});

test('AC-VAL-05: الحالة أو الأولوية خارج القائمة تُرفض', () => {
  const result = validateRequirement(validInput({ status: 'late', priority: 'urgent' }), context);
  assert.equal(result.ok, false);
  assert.equal(result.errors.status, MESSAGES.statusUnknown);
  assert.equal(result.errors.priority, MESSAGES.priorityUnknown);
});

test('AC-VAL-05: «toString» ليست حالة مقبولة (لا تُقبل خصائص الكائن الموروثة)', () => {
  const result = validateRequirement(validInput({ status: 'toString' }), context);
  assert.equal(result.errors.status, MESSAGES.statusUnknown);
});

test('AC-IND-02 (المنطق): I1 بتعارض، وI6 وI8 وIQ بلا تعارض', () => {
  const byId = Object.fromEntries(data.indicators.map(i => [i.id, i]));
  assert.equal(hasValueConflict(byId['ind-ar-edu-1']), true);  // I1: 1:15 مقابل 1:11
  assert.equal(hasValueConflict(byId['ind-ar-edu-6']), false); // I6: لا قيمة حالية
  assert.equal(hasValueConflict(byId['ind-ar-edu-8']), false); // I8: 120 = 120
  assert.equal(hasValueConflict(byId['ind-qs-isr']), false);   // IQ: لا قيم
});

test('أساس AC-IND-04: تعديل القيمة الحالية لـ I1 إلى «1:11» يزيل التعارض، والمسافات لا تُحتسب فرقًا', () => {
  const i1 = Object.assign({}, data.indicators.find(i => i.id === 'ind-ar-edu-1'), { currentValue: '1:11' });
  assert.equal(hasValueConflict(i1), false);
  assert.equal(hasValueConflict({ currentValue: '1 : 11', progressFileValue: '1:11' }), false);
});
