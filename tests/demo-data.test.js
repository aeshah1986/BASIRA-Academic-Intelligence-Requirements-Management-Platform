// فحوص بيانات العرض (data/demo-data.js): السلامة، والخصوصية، والأسماء، والتواريخ النسبية
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createDemoData } = require('../data/demo-data.js');
const { validateDataset } = require('../js/storage.js');
const derive = require('../js/derive.js');
const { hasValueConflict } = require('../js/model.js');

const FILE = path.join(__dirname, '..', 'data', 'demo-data.js');
const TODAY = '2026-11-01';
const data = createDemoData(TODAY);

// أسماء وأرقام وردت في ملفات المستخدمة الحقيقية: يجب ألا تظهر في بيانات العرض أبدًا.
const REAL_NAMES = ['آل معيد', 'القحطاني', 'مصلحي', 'مسفر', 'زهير', 'malhassen', 'kku.edu'];
const REAL_NUMBERS = ['2956', '48600', '2201', '4016', '569', '466', '325', '310', '3003', '3470', '4144', '4004', '32144', '1:16.4', '22.1:1', '1:12', '1:20'];

// يطابق الرقم كاملًا لا جزءًا من رقم أطول (‎1:20 لا تطابق 1:205، و466 لا تطابق 4660).
function containsNumber(text, num) {
  const escaped = num.replace(/[.:]/g, ch => '[' + ch + ']');
  return new RegExp('(^|[^0-9:.])' + escaped + '($|[^0-9:.])').test(text);
}

function textFields(d) {
  const out = [];
  d.entities.forEach(e => out.push(e.name));
  d.indicators.forEach(i => out.push(i.name, i.currentValue, i.progressFileValue, i.lastYearValue, i.valueSource, i.notes));
  d.requirements.forEach(r => {
    out.push(r.title, r.description, r.assignee, r.missingData);
    r.followUps.forEach(f => out.push(f.note));
  });
  d.decisions.forEach(q => out.push(q.question, q.askedTo, q.decision));
  return out.filter(Boolean);
}

test('بيانات العرض سليمة البنية وكل الروابط بين العناصر صحيحة', () => {
  assert.deepEqual(validateDataset(data).errors, []);
  assert.equal(data.isSample, true);
  assert.equal(data.requirements.length, 21);
  assert.equal(data.entities.length, 9);
  assert.equal(data.indicators.length, 14);
  assert.equal(data.decisions.length, 4);
});

test('رأس الملف يعلن أن البيانات وهمية (الإعلان في الملف والواجهة لا بجانب الأسماء)', () => {
  assert.match(fs.readFileSync(FILE, 'utf8').split('\n').slice(0, 5).join('\n'), /بيانات العرض التجريبية/);
  assert.match(fs.readFileSync(FILE, 'utf8'), /كل ما في هذا الملف وهمي/);
});

test('لا وسم «وهمي» أو «مكلف (أ)» أو «افتراضي» بجانب الأسماء والجهات', () => {
  const names = data.entities.map(e => e.name).concat(data.requirements.map(r => r.assignee), data.decisions.map(q => q.askedTo));
  for (const n of names) assert.doesNotMatch(n, /وهمي|مكلف \(|افتراضي/, n);
  for (const r of data.requirements) assert.match(r.assignee, /^د\. \S+ \S+$/, r.title);
});

test('الخصوصية: لا أسماء ولا أرقام من ملفات المستخدمة الحقيقية', () => {
  const all = textFields(data).join(' | ');
  for (const name of REAL_NAMES) assert.ok(!all.includes(name), 'اسم حقيقي: ' + name);
  const values = data.indicators.flatMap(i => [i.currentValue, i.progressFileValue, i.lastYearValue]).filter(Boolean);
  for (const v of values) assert.ok(!REAL_NUMBERS.includes(v), 'قيمة حقيقية: ' + v);
  for (const num of REAL_NUMBERS) assert.ok(!containsNumber(all, num), 'رقم حقيقي في النصوص: ' + num);
});

test('فحص الفحص: containsNumber يلتقط الرقم الحقيقي ولا يخلطه برقم مشابه', () => {
  assert.equal(containsNumber('روابط لـ 466 باحثًا', '466'), true);
  assert.equal(containsNumber('القيمة 1:20 تقريبًا', '1:20'), true);
  assert.equal(containsNumber('1:205', '1:20'), false);
  assert.equal(containsNumber('11:20', '1:20'), false);
  assert.equal(containsNumber('4660', '466'), false);
  assert.equal(containsNumber('نسبة 1:16.4', '1:16.4'), true);
  assert.equal(containsNumber('نسبة 1:1604', '1:16.4'), false);
});

test('الخصوصية: لا بريد ولا هاتف، والروابط على example.org فقط', () => {
  const text = fs.readFileSync(FILE, 'utf8');
  assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.]+/);
  const links = text.match(/https?:\/\/[^\s'"]+/g) || [];
  assert.ok(links.length > 0);
  for (const l of links) assert.match(l, /^https:\/\/example\.org\//, l);
});

test('التواريخ نسبية: توزيع المواعيد نفسه في أي يوم', () => {
  const dist = today => {
    const d = createDemoData(today);
    const c = { overdue: 0, soon: 0, later: 0, done: 0 };
    d.requirements.forEach(r => { c[derive.dueInfo(r, today).kind]++; });
    return c;
  };
  const expected = { overdue: 4, soon: 6, later: 8, done: 3 };
  assert.deepEqual(dist(TODAY), expected);
  assert.deepEqual(dist('2027-03-15'), expected);
  assert.deepEqual(dist('2026-02-28'), expected);
});

test('بيانات العرض فيها حالات متنوعة تستحق العرض', () => {
  const conflicts = data.indicators.filter(hasValueConflict).map(i => i.code);
  assert.deepEqual(conflicts, ['AR-EDU-1', 'AR-EDU-4', 'AR-EDU-7']);
  assert.equal(data.decisions.filter(q => q.status === 'open').length, 3);
  assert.ok(data.requirements.reduce((s, r) => s + r.followUps.length, 0) >= 8);
  const statuses = new Set(data.requirements.map(r => r.status));
  assert.deepEqual([...statuses].sort(), ['done', 'in_progress', 'new', 'waiting']);
});

test('النسخة حتمية لليوم نفسه ومستقلة في كل استدعاء', () => {
  assert.deepEqual(createDemoData(TODAY), createDemoData(TODAY));
  const a = createDemoData(TODAY); a.requirements[0].title = 'تعديل';
  assert.notEqual(createDemoData(TODAY).requirements[0].title, 'تعديل');
});
