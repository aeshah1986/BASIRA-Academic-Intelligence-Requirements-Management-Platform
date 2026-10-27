// فحوص البحث والتصفية (AC-SRCH وAC-FLT) على بيانات الفحص F1–F6
const test = require('node:test');
const assert = require('node:assert/strict');

const { filterRequirements, hasActiveFilters } = require('../js/query.js');
const { createSampleData } = require('../data/sample-data.js');

const data = createSampleData();
const context = { indicatorsById: Object.fromEntries(data.indicators.map(i => [i.id, i])), today: '2026-11-01' };
const run = filters => filterRequirements(data.requirements, filters, context).map(r => r.id.replace('req-', '').toUpperCase());

test('AC-SRCH-01: بحث فارغ يعرض الكل', () => {
  assert.equal(run({ q: '' }).length, 6);
  assert.equal(run({ q: '   ' }).length, 6);
});

test('AC-SRCH-02/04: «الدوليين» مع المسافات أو دونها ← F2 فقط', () => {
  assert.deepEqual(run({ q: 'الدوليين' }), ['F2']);
  assert.deepEqual(run({ q: '  الدوليين  ' }), ['F2']);
});

test('AC-SRCH-03: كلمة غير موجودة ← لا نتائج', () => {
  assert.deepEqual(run({ q: 'براكين' }), []);
});

test('AC-SRCH-05: كلمة في الوصف أو النواقص فقط', () => {
  assert.deepEqual(run({ q: 'SciVal' }), ['F4']);
});

test('AC-SRCH-06/07/08/09: الهمزة والتاء والتشكيل وحالة الأحرف', () => {
  assert.deepEqual(run({ q: 'اعداد' }), ['F1', 'F5']);
  assert.deepEqual(run({ q: 'هيئه' }), ['F1']);
  assert.deepEqual(run({ q: 'بَيَانَات' }), run({ q: 'بيانات' }));
  assert.deepEqual(run({ q: 'qs' }), run({ q: 'QS' }));
  assert.deepEqual(run({ q: 'qs' }), ['F2']);
});

test('AC-SRCH-10: أكثر من كلمة (AND)', () => {
  assert.deepEqual(run({ q: 'بيانات الطلاب' }), ['F2']);
});

test('AC-FLT-01..04: التصفية المنفردة', () => {
  assert.equal(run({ ranking: '' }).length, 6);
  assert.deepEqual(run({ ranking: 'ARAB' }), ['F1', 'F5', 'F6']);
  assert.deepEqual(run({ entity: 'ent-research' }), ['F4', 'F5']);
  assert.deepEqual(run({ status: 'waiting' }), ['F2', 'F6']);
});

test('AC-FLT-05/06: البحث مع التصنيف (الشرطان معًا)', () => {
  assert.deepEqual(run({ q: 'الدوليين', ranking: 'ARAB' }), []);
  assert.deepEqual(run({ q: 'الدوليين', ranking: 'QS' }), ['F2']);
});

test('AC-FLT-07: الجهة + الأولوية', () => {
  assert.deepEqual(run({ entity: 'ent-students', priority: 'high' }), ['F2']);
});

test('AC-DUE-06 / AC-NAV-01 (المنطق): تصفية «متأخر» و«قريب»', () => {
  assert.deepEqual(run({ due: 'overdue' }), ['F1', 'F6']);
  assert.deepEqual(run({ due: 'soon' }), ['F2', 'F5']);
});

test('الحالة «open» تعني كل ما لم يكتمل', () => {
  assert.deepEqual(run({ status: 'open' }), ['F1', 'F2', 'F4', 'F5', 'F6']);
});

test('hasActiveFilters', () => {
  assert.equal(hasActiveFilters({ q: '', ranking: '' }), false);
  assert.equal(hasActiveFilters({ due: 'overdue' }), true);
});
