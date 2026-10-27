// فحوص توحيد النص العربي (أساس حالات البحث AC-SRCH-04/06/07/08/09/10)
const test = require('node:test');
const assert = require('node:assert/strict');

const { collapseSpaces, normalizeText, tokenize } = require('../js/normalize.js');

test('أساس AC-SRCH-04: المسافات الزائدة لا تغيّر النص الموحد', () => {
  assert.equal(normalizeText('  الدوليين  '), normalizeText('الدوليين'));
  assert.equal(collapseSpaces('  بيانات   الطلاب  '), 'بيانات الطلاب');
});

test('أساس AC-SRCH-06: توحيد صور الألف والهمزة (أ إ آ ٱ ← ا)', () => {
  assert.equal(normalizeText('أعداد'), normalizeText('اعداد'));
  assert.equal(normalizeText('إحصاءات'), 'احصاءات');
  assert.equal(normalizeText('آخر'), 'اخر');
  assert.equal(normalizeText('ٱلعلم'), 'العلم');
});

test('أساس AC-SRCH-07: التاء المربوطة تُعامل كالهاء', () => {
  assert.equal(normalizeText('هيئة'), normalizeText('هيئه'));
});

test('توحيد الألف المقصورة (ى ← ي)', () => {
  assert.equal(normalizeText('مستوى'), normalizeText('مستوي'));
});

test('أساس AC-SRCH-08: التشكيل والتطويل لا يؤثران', () => {
  assert.equal(normalizeText('بَيَانَات'), 'بيانات');
  assert.equal(normalizeText('مُدْخَلٌ'), 'مدخل');
  assert.equal(normalizeText('بيـــانات'), 'بيانات');
});

test('أساس AC-SRCH-09: حالة الأحرف اللاتينية لا تؤثر', () => {
  assert.equal(normalizeText('QS'), normalizeText('qs'));
  assert.equal(normalizeText('SciVal'), 'scival');
});

test('أساس AC-SRCH-10: تقسيم البحث إلى كلمات موحدة', () => {
  assert.deepEqual(tokenize('  بيانات   الطلاب '), ['بيانات', 'الطلاب']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
});

test('القيم الفارغة لا تسبب خطأ', () => {
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
  assert.equal(collapseSpaces(null), '');
});
