// فحوص محرك الحساب من الملفات المصدرية (docs/design/06) بملفات وهمية في tests/fixtures/ وقيم محسوبة مسبقًا.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SRC = require('../js/sources.js');
const X = require('../js/xlsx.js');
const E = require('../js/engine.js');
const A = require('../js/actions.js');
const ST = require('../js/storage.js');
const { createSampleData } = require('../data/sample-data.js');

const FIX = path.join(__dirname, 'fixtures');
const T = '2026-11-01';
const read = f => fs.readFileSync(path.join(FIX, f), 'utf8');
function table(file, headerRow) {
  const t = SRC.tableFromCSV(read(file), headerRow);
  assert.equal(t.ok, true, file + ': ' + t.message);
  t.fileName = file;
  return t;
}
function env() { let n = 0; return { today: T, now: '2026-11-01T09:00:00.000Z', newId: p => p + '-e' + (++n) }; }
// دورة مضبوطة كما ستضبطها المستخدمة من الواجهة: البنود والرتب المختارة.
function configured() {
  const c = E.defaultCycle();
  const set = (key, args) => Object.assign(c.inputs.find(i => i.key === key).args, args);
  set('admissionStudents', { items: ['طلبة الدبلوم', 'طلبة البكالوريوس'] });
  set('graduateStudents', { items: ['طلبة الدبلوم العالي', 'طلبة الماجستير', 'طلبة الدكتوراه'] });
  set('facultyFull', { values: ['أستاذ', 'أستاذ مشارك', 'أستاذ مساعد', 'محاضر', 'معيد'] });
  set('phdHolders', { values: ['أستاذ', 'أستاذ مشارك', 'أستاذ مساعد'] });
  return c;
}
function tables() {
  return { admission: table('admission.csv'), graduate: table('graduate.csv'), faculty: table('faculty.csv'), top500: table('top500.csv') };
}
const byCode = (out, code) => out.results.find(r => r.indicatorCode === code);

// ---------- القراءة ----------
test('ENG-01 CSV: BOM والفاصل المنقوطة والتنصيص بفاصلة وسطر جديد والأرقام العربية', () => {
  const rows = SRC.parseCSV('﻿أ;ب;ج\r\n"نص; فيه فاصلة";"سطر\nثانٍ";"قال ""نعم"""\r\n');
  assert.deepEqual(rows, [['أ', 'ب', 'ج'], ['نص; فيه فاصلة', 'سطر\nثانٍ', 'قال "نعم"']]);
  assert.equal(SRC.detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(SRC.detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(SRC.toNumber('١٢٣'), 123);
  assert.equal(SRC.toNumber('1,250'), 1250);
  assert.equal(SRC.toNumber('١٢٫٥'), 12.5);
  assert.equal(SRC.toNumber('N/A'), null);
});

test('ENG-02 سطر العناوين في الصف 13 يُكتشف ويمكن تغييره يدويًا (AC-CALC-01)', () => {
  const rows = SRC.parseCSV(read('top500.csv'));
  assert.equal(SRC.detectHeaderRow(rows), 13);
  const t = SRC.toTable(rows);
  assert.equal(t.headerRow, 13);
  assert.deepEqual(t.columns, ['Rank', 'Name', 'Scopus author ID', 'Scholarly Output', 'Citations', 'h-index']);
  assert.equal(t.records.length, 15);
  assert.equal(t.rowNumbers[0], 14);
  const manual = SRC.toTable(rows, 1);
  assert.equal(manual.headerRow, 1);
  assert.equal(manual.columns[0], 'Top authors by h-index');
  assert.equal(SRC.toTable(rows, 999).ok, false);
  assert.equal(SRC.detectHeaderRow(SRC.parseCSV(read('faculty.csv'))), 1);
});

test('ENG-03 فحوص الجودة: 3 صفوف فارغة في آخره، ومكرران، و«N/A» واحد بأرقام الصفوف (AC-CALC-14)', () => {
  const t = table('quality.csv');
  const q = SRC.quality(t, { keyColumn: 'ID', naColumn: 'LINK', columns: ['TITLE'] });
  assert.equal(q.trailingEmpty, 3);
  assert.equal(q.trailingFrom, 10);
  assert.deepEqual(q.duplicates, { column: 'ID', count: 2, rows: [6, 9] });
  assert.deepEqual(q.na, { column: 'LINK', count: 1, rows: [8] });
  assert.deepEqual(q.emptyInside, []);
  const text = SRC.qualitySummary(q).join(' | ');
  assert.match(text, /3 صفوف فارغة في آخر الملف \(من الصف 10\)/);
  assert.match(text, /2 مكرر في «ID» \(الصفوف 6، 9\)/);
  const h = SRC.quality(table('top500.csv'), { numericColumns: ['h-index'] });
  assert.equal(h.nonNumeric['h-index'].count, 0);
});

test('ENG-04 ملف .xls القديم يُرفض برسالة إرشادية، وكذلك توقيعه بامتداد آخر (AC-CALC-15)', () => {
  const r = SRC.checkFile('المحاضرون الفعالون 2026.xls', 1000);
  assert.equal(r.ok, false);
  assert.match(r.message, /حفظ باسم/);
  assert.equal(SRC.fileKind('x.csv', new Uint8Array([0xD0, 0xCF, 0x11, 0xE0])), 'xls');
  assert.equal(SRC.checkFile('a.pdf', 10).ok, false);
  assert.equal(SRC.checkFile('a.csv', 61 * 1024 * 1024).ok, false);
  assert.equal(SRC.checkFile('a.xlsx', 1000).ok, true);
});

// ---------- العمليات ----------
test('ENG-05 countWhere: الأعضاء = 8 وبيان «10 صفوف · استُبعد 2» (AC-CALC-02)', () => {
  const c = configured();
  const r = E.runInput(c.inputs.find(i => i.key === 'facultyFull'), tables(), c.params);
  assert.equal(r.value, 8);
  assert.match(r.audit, /^10 صفوف · استُبعد 2 · «RANK_DESC» ضمن/);
  assert.doesNotMatch(r.audit, /اسم-وهمي/, 'بيان الحساب لا يذكر أسماء');
});

test('ENG-06 pick: مجموع البنود المختارة، والبند غير الموجود يُرفض برسالة (AC-CALC-03)', () => {
  const c = configured();
  const inp = c.inputs.find(i => i.key === 'admissionStudents');
  const r = E.runInput(inp, tables(), c.params);
  assert.equal(r.value, 120);
  assert.match(r.audit, /«طلبة الدبلوم» 20 \+ «طلبة البكالوريوس» 100 = 120/);
  const bad = E.runInput(Object.assign({}, inp, { args: { items: ['طلبة الدبلوم', 'بند غير موجود'], column: 'B' } }), tables(), c.params);
  assert.equal(bad.value, null);
  assert.match(bad.error, /البند «بند غير موجود» غير موجود في ملف «عمادة القبول والتسجيل»/);
  const total = E.runInput(Object.assign({}, inp, { args: { items: ['طلبة البكالوريوس'], column: 'المجموع' } }), tables(), c.params);
  assert.equal(total.value, 100);
  assert.match(E.runInput(Object.assign({}, inp, { args: { items: [], column: 'B' } }), tables(), c.params).error, /لم تُختر بنود/);
});

test('ENG-07 ratio: 150 ÷ 10 ← «1:15»، والتقريب لخانة واحدة (AC-CALC-04)', () => {
  assert.equal(E.ratio(150, 10), '1:15');
  assert.equal(E.ratio(150, 8), '1:18.8');
  assert.equal(E.ratio(150, 0), null);
});

test('ENG-08 عتبة هيرش من معاملات الدورة: 10 ← 11، و20 ← 3 (AC-CALC-05)', () => {
  const c = configured();
  assert.equal(byCode(E.run(c, tables(), T), 'AR-EDU-5').value, '11');
  c.params.hIndexThreshold = 20;
  const out = E.run(c, tables(), T);
  assert.equal(byCode(out, 'AR-EDU-5').value, '3');
  assert.match(byCode(out, 'AR-EDU-5').warnings.map(w => w.text).join(), /العتبة المستخدمة 20/);
});

test('ENG-09 تنبيه القطع: أدنى h = 12 والعتبة 10 ← يظهر، وأدنى h = 5 ← لا يظهر (AC-CALC-06)', () => {
  const c = configured();
  const keys = out => byCode(out, 'AR-EDU-5').warnings.map(w => w.key);
  assert.ok(!keys(E.run(c, tables(), T)).includes('hCutoff'));
  const cut = Object.assign(tables(), { top500: table('top500-cut.csv') });
  const out = E.run(c, cut, T);
  assert.equal(byCode(out, 'AR-EDU-5').value, '7');
  assert.ok(keys(out).includes('hCutoff'));
  assert.match(byCode(out, 'AR-EDU-5').warnings.find(w => w.key === 'hCutoff').text, /\(12\) ≥ العتبة \(10\)/);
});

test('ENG-10 المؤشر 1 كاملًا: «1:18.8» مع تنبيه FTE، ومع غير المتفرغين 3 ← «1:16.7» دون التنبيه (AC-CALC-07)', () => {
  const c = configured();
  let r = byCode(E.run(c, tables(), T), 'AR-EDU-1');
  assert.equal(r.value, '1:18.8'); // 150 ÷ 8
  assert.ok(r.warnings.some(w => w.key === 'fte' && /س10/.test(w.text)));
  assert.ok(!r.warnings.some(w => w.key === 'phdItem'));
  assert.equal(byCode(E.run(c, tables(), T), 'AR-EDU-2').value, '1:25'); // 150 ÷ 6
  Object.assign(c.inputs.find(i => i.key === 'facultyPart').args, { value: '3', reason: 'كشف الموارد البشرية (وهمي)' });
  r = byCode(E.run(c, tables(), T), 'AR-EDU-1');
  assert.equal(r.value, '1:16.7'); // 150 ÷ (8 + 3/3)
  assert.ok(!r.warnings.some(w => w.key === 'fte'));
  // دون بند الدكتوراه: 140 طالبًا وتنبيه س5
  c.inputs.find(i => i.key === 'graduateStudents').args.items = ['طلبة الدبلوم العالي', 'طلبة الماجستير'];
  r = byCode(E.run(c, tables(), T), 'AR-EDU-1');
  assert.equal(r.value, '1:15.6'); // 140 ÷ 9
  assert.ok(r.warnings.some(w => w.key === 'phdItem'));
  // الإدخال اليدوي دون سبب يُرفض
  Object.assign(c.inputs.find(i => i.key === 'facultyPart').args, { value: '3', reason: '' });
  assert.match(byCode(E.run(c, tables(), T), 'AR-EDU-1').error, /سبب للإدخال اليدوي/);
});

test('ENG-11 التقدم عن العام الماضي: 21% و33% و«لا يمكن حساب التقدم» (AC-CALC-08)', () => {
  assert.deepEqual(E.yoy('1:15', '1:19', 'lower_better'), { pct: 21, label: 'تحسّن 21%' });
  assert.deepEqual(E.yoy('120', '90', 'higher_better'), { pct: 33, label: 'تحسّن 33%' });
  assert.deepEqual(E.yoy('', '90', 'higher_better'), { pct: null, label: 'لا يمكن حساب التقدم' });
  assert.deepEqual(E.yoy('10', '0', 'higher_better'), { pct: null, label: 'لا يمكن حساب التقدم' });
  assert.deepEqual(E.yoy('80', '90', 'higher_better'), { pct: -11, label: 'تراجع 11%' });
  assert.deepEqual(E.yoy('1:20', '1:19', 'lower_better'), { pct: -5, label: 'تراجع 5%' });
  assert.deepEqual(E.yoy('90', '90', 'higher_better'), { pct: 0, label: 'ثابت' });
});

test('ENG-12 تعارض المحسوبة مع ملف التقدم، ومقارنة I1 (AC-CALC-09)', () => {
  const data = createSampleData();
  const i1 = data.indicators.find(i => i.code === 'AR-EDU-1'); // ملف التقدم 1:11، العام الماضي 1:19
  const r = byCode(E.run(configured(), tables(), T), 'AR-EDU-1');
  const cmp = E.compare(r, i1);
  assert.equal(cmp.conflict, true);
  assert.equal(cmp.progressFileValue, '1:11');
  assert.deepEqual(cmp.yoy, { pct: 1, label: 'تحسّن 1%' }); // (19 − 18.8) ÷ 19
  assert.equal(E.conflicts('1:18.8', '1:18.8'), false);
  assert.equal(E.conflicts('120', '120.0'), false);
  assert.equal(E.conflicts('120', ''), false);
});

test('ENG-13 عمود مطلوب غير موجود: رسالة تسمي العمود ولا حساب (AC-CALC-12)', () => {
  const c = configured();
  c.inputs.find(i => i.key === 'facultyFull').args.column = 'ACADEMIC_RANK';
  const out = E.run(c, tables(), T);
  const r = byCode(out, 'AR-EDU-1');
  assert.equal(r.value, null);
  assert.match(r.error, /العمود «ACADEMIC_RANK» غير موجود في ملف «المحاضرون الفعالون»\. الأعمدة الموجودة: RANK_CODE/);
  assert.equal(byCode(out, 'AR-EDU-5').value, '11', 'المؤشرات الأخرى تُحسب');
});

test('ENG-14 الصيغ: دالة غير معروفة تُرفض ولا يُنفذ أي نص (AC-CALC-13)', () => {
  const keys = ['a', 'b'];
  assert.equal(E.parseFormula('ratio(add(a, b), 2)', keys).ok, true);
  assert.match(E.parseFormula('alert(1)', keys).message, /الدالة «alert» غير معروفة/);
  assert.match(E.parseFormula('constructor', keys).message, /المدخل «constructor» غير معرّف/);
  assert.match(E.parseFormula('add(a, b); process.exit()', keys).message, /رمز غير مسموح/);
  assert.match(E.parseFormula('add(a, b) b', keys).message, /نص زائد/);
  assert.match(E.parseFormula('add(ratio(a, b), 1)', keys).message, /المستوى الأعلى/);
  assert.match(E.parseFormula('divide(a)', keys).message, /عدد معاملات/);
  globalThis.__basiraPwned = false;
  const c = configured();
  c.recipes[0].formula = 'globalThis.__basiraPwned = true';
  assert.match(byCode(E.run(c, tables(), T), 'AR-EDU-1').error, /رمز غير مسموح|غير معرّف/);
  assert.equal(globalThis.__basiraPwned, false);
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'engine.js'), 'utf8');
  assert.doesNotMatch(src, /\beval\s*\(|new Function\s*\(/, 'لا eval ولا Function في المحرك');
});

test('ENG-15 ملف ناقص: «ينقصه» باسم الخانة، ولا تتوقف بقية المؤشرات', () => {
  const t = tables(); delete t.faculty;
  const out = E.run(configured(), t, T);
  assert.equal(byCode(out, 'AR-EDU-1').error, 'ينقصه: المحاضرون الفعالون.');
  assert.deepEqual(byCode(out, 'AR-EDU-1').missing, ['المحاضرون الفعالون']);
  assert.equal(byCode(out, 'AR-EDU-5').value, '11');
  assert.match(byCode(out, 'AR-EDU-3').error, /ينقصه: نموذج المؤشر 3/);
});

// ---------- الاعتماد والخصوصية والتخزين ----------
test('ENG-16 «اعتماد القيمة» يحدّث القيمة ومصدرها فقط، ويُسجَّل، والمرفوض لا يغيّر شيئًا (AC-CALC-10، AC-GAP-01)', () => {
  const data = createSampleData();
  const e = env();
  const c = configured();
  c.sources = [{ slot: 'faculty', fileName: 'faculty.csv' }];
  const r = byCode(E.run(c, tables(), T), 'AR-EDU-1');
  const before = JSON.stringify(data);
  for (const bad of [{ value: '', source: 'س' }, { value: '1:18.8', source: '' }, { value: '1'.repeat(31), source: 'س' }]) {
    const res = A.approveCalculatedValue(data, 'ind-ar-edu-1', bad, e);
    assert.equal(res.ok, false);
  }
  assert.equal(A.approveCalculatedValue(data, 'ind-x', { value: '1', source: 'س' }, e).ok, false);
  assert.equal(JSON.stringify(data), before, 'الرفض لا يغيّر شيئًا');
  const res = A.approveCalculatedValue(data, 'ind-ar-edu-1', { value: r.value, source: E.sourceText(r, c, T) }, e);
  assert.equal(res.ok, true);
  const i1 = data.indicators.find(i => i.id === 'ind-ar-edu-1');
  assert.equal(i1.currentValue, '1:18.8');
  assert.match(i1.valueSource, /^محسوب في بصيرة \(التصنيف العربي 2026\): ratio\(.*الملفات: faculty\.csv · 2026-11-01$/);
  assert.equal(i1.workStatus, 'evidenced', 'حالة العمل لا تتغير');
  assert.equal(data.activities[0].action, 'calc_approve');
  assert.match(data.activities[0].summary, /AR-EDU-1: 1:18\.8 \(كانت 1:15\)/);
  data.indicators.find(i => i.id === 'ind-ar-edu-2').active = false;
  assert.match(A.approveCalculatedValue(data, 'ind-ar-edu-2', { value: '1:25', source: 'س' }, e).message, /معطل/);
});

test('ENG-17 الخصوصية: بعد الحساب والحفظ لا يوجد أي اسم أو معرّف من الملفات في البيانات المحفوظة (AC-CALC-11)', () => {
  const data = createSampleData();
  const t = tables();
  const c = configured();
  const out = E.run(c, t, T);
  const meta = Object.keys(t).map(slot => Object.assign({ slot }, SRC.describe(t[slot], t[slot].fileName, T)));
  assert.equal(A.recordCalcRun(data, c, E.storableRun(out), meta, env()).ok, true);
  const json = ST.exportJson(data, T).text;
  const secrets = [];
  for (const f of ['faculty.csv', 'top500.csv']) {
    const tb = table(f);
    for (const col of ['NAME', 'Name', 'EMPLOYEE_ID', 'Scopus author ID']) {
      const vals = SRC.column(tb, col);
      if (vals) secrets.push(...vals);
    }
  }
  assert.ok(secrets.length >= 50);
  const leaked = secrets.filter(s => json.includes(s));
  assert.deepEqual(leaked, [], 'لا اسم ولا معرّف شخصي في الملف المحفوظ');
  assert.equal(ST.validateDataset(JSON.parse(json)).ok, true);
  // التحقق يرفض وصف ملف يحمل محتوى
  const bad = JSON.parse(json);
  bad.calc.cycles[0].sources[0].records = [['اسم-وهمي-01']];
  const parsed = ST.parseImport(JSON.stringify(bad));
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /لا يُخزن محتوى الملفات/);
});

test('ENG-18 سجل التشغيلات: آخر 10 فقط، والإعداد والوصف يُحفظان، والتحقق يرفض الإعداد التالف', () => {
  const data = createSampleData();
  const c = configured();
  const out = E.storableRun(E.run(c, tables(), T));
  const e = env();
  for (let i = 0; i < 12; i++) A.recordCalcRun(data, c, out, [], e);
  assert.equal(data.calc.cycles.length, 1);
  assert.equal(data.calc.cycles[0].runs.length, 10);
  assert.match(data.activities[0].summary, /شُغّل محرك الحساب \(التصنيف العربي 2026\): 3 من 8 مؤشرات بنتيجة/);
  const ok = ST.validateDataset(data);
  assert.equal(ok.ok, true, ok.errors.join(' | '));
  const cases = [
    d => { d.calc = 'x'; },
    d => { d.calc.cycles[0].ranking = 'NOPE'; },
    d => { d.calc.cycles[0].params.hIndexThreshold = 0; },
    d => { d.calc.cycles[0].inputs[0].op = 'eval'; },
    d => { d.calc.cycles[0].recipes[0].direction = 'up'; },
    d => { d.calc.cycles[0].runs = new Array(11).fill({ results: [] }); }
  ];
  for (const mutate of cases) {
    const d = JSON.parse(JSON.stringify(data));
    mutate(d);
    assert.equal(ST.validateDataset(d).ok, false, mutate.toString());
  }
});

// ---------- سد الفجوات ----------
test('ENG-19 متطلب من تنبيه FTE: مُعبأ للموارد البشرية، ولا يتكرر عند الضغط مرة ثانية (AC-GAP-02)', () => {
  const data = createSampleData();
  const e = env();
  const r = byCode(E.run(configured(), tables(), T), 'AR-EDU-1');
  const w = r.warnings.find(x => x.key === 'fte');
  const i1 = data.indicators.find(i => i.code === 'AR-EDU-1');
  const s = E.suggestRequirement(w, i1, data, T);
  assert.equal(s.input.entityId, 'ent-hr');
  assert.equal(s.input.indicatorId, 'ind-ar-edu-1');
  assert.equal(s.input.deadline, '2026-11-08'); // اليوم + 7، وقبل موعد التسليم بيومين (2026-11-08)
  assert.equal(s.existingId, null);
  const n = data.requirements.length;
  assert.equal(A.createRequirementFromWarning(data, s, e).ok, true);
  assert.equal(data.requirements.length, n + 1);
  const again = E.suggestRequirement(w, i1, data, T);
  assert.ok(again.existingId);
  const before = JSON.stringify(data);
  const res = A.createRequirementFromWarning(data, again, e);
  assert.equal(res.ok, false);
  assert.match(res.message, /لم يُنشأ متطلب مكرر/);
  assert.equal(JSON.stringify(data), before);
});

test('ENG-20 ملف ربط المفاتيح: 8 و6 مع 4 مشتركين ← 10، ودون الربط ← «بين 8 و14» مع تنبيه (AC-GAP-03)', () => {
  const t = { heqs: table('staff-a.csv'), faculty: table('staff-b.csv'), keymap: table('keymap.csv') };
  const inp = { key: 'union', label: 'الأعضاء الموحد', slot: 'heqs', op: 'countDistinctAcross',
    args: { columnA: 'EMPLOYEE_ID', slotB: 'faculty', columnB: 'رقم الهوية', mapSlot: 'keymap', mapColA: 'EMPLOYEE_ID', mapColB: 'رقم الهوية' } };
  const withMap = E.runInput(inp, t, {});
  assert.equal(withMap.value, 10);
  assert.match(withMap.audit, /المشتركون 4/);
  delete t.keymap;
  const noMap = E.runInput(Object.assign({}, inp, { args: Object.assign({}, inp.args, { mapSlot: 'keymap' }) }), t, {});
  assert.equal(noMap.value, null);
  assert.deepEqual(noMap.range, { min: 8, max: 14 });
  assert.match(noMap.warning, /بين 8 و14/);
});

test('ENG-21 فحص نطاق الروابط: 5 روابط و«2 مخالفة» بصفيهما (AC-GAP-04)', () => {
  const lc = E.linkDomainCheck(table('links.csv'), 'LINK', 'scopus.com');
  assert.equal(lc.total, 5);
  assert.equal(lc.matching, 3);
  assert.deepEqual(lc.violations, { count: 2, rows: [3, 5] });
  assert.deepEqual(lc.invalid, { count: 0, rows: [] });
  const q = E.linkDomainCheck(table('quality.csv'), 'LINK', 'scopus.com');
  assert.deepEqual(q.invalid.rows, [8], '«N/A» رابط غير صالح');
  // داخل الوصفة: تنبيه في المؤشر 8
  const c = configured();
  c.inputs.find(i => i.key === 'form8Rows').args.column = 'LINK';
  c.recipes.find(r => r.indicatorCode === 'AR-EDU-8').linkCheck.column = 'LINK';
  const r = byCode(E.run(c, Object.assign(tables(), { form8: table('links.csv') }), T), 'AR-EDU-8');
  assert.equal(r.value, '5');
  assert.match(r.warnings.find(w => w.key === 'linkDomain').text, /2 مخالفة للنطاق scopus\.com \(الصفوف 3، 5\)/);
});

// ---------- xlsx دون مكتبات ----------
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
// أرشيف ZIP صغير صحيح (ضغط deflate أو تخزين) لبناء xlsx وهمي داخل الفحص، فلا ملفات ثنائية في المستودع.
function zip(files, stored) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8');
    const data = stored ? raw : zlib.deflateRawSync(raw);
    const nm = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(stored ? 0 : 8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(stored ? 0 : 8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, data);
    centrals.push(ch, nm);
    offset += lh.length + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
function xlsxFromRows(rows, opts = {}) {
  const shared = [];
  const si = s => { let i = shared.indexOf(s); if (i === -1) { shared.push(s); i = shared.length - 1; } return i; };
  const col = i => String.fromCharCode(65 + i);
  let xmlRows = rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
    if (v === '') return '';
    const ref = col(ci) + (ri + 1);
    if (/^-?\d+(\.\d+)?$/.test(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
    if (opts.inline && ci === 0) return '<c r="' + ref + '" t="inlineStr"><is><t>' + v.replace(/&/g, '&amp;') + '</t></is></c>';
    return '<c r="' + ref + '" t="s"><v>' + si(v) + '</v></c>';
  }).join('') + '</row>').join('');
  for (let k = 0; k < (opts.emptyRows || 0); k++) {
    const rn = rows.length + 1 + k;
    xmlRows += k % 2 ? '<row r="' + rn + '" spans="1:3" s="1" customFormat="1"/>' : '<row r="' + rn + '"><c r="A' + rn + '" s="2"/><c r="B' + rn + '" s="2"/></row>';
  }
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types/>'],
    ['xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="ورقة البيانات" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst>' + shared.map(s => '<si><t>' + s.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</t></si>').join('') + '</sst>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData>' + xmlRows + '</sheetData></worksheet>']
  ], opts.stored);
}

test('ENG-22 xlsx دون مكتبات: 1000 صف فارغ منسق في آخره تُتجاوز، والنتيجة مطابقة لـ CSV (AC-GAP-07)', async () => {
  const csvRows = SRC.parseCSV(read('faculty.csv'));
  const bytes = xlsxFromRows(csvRows, { emptyRows: 1000 });
  const out = await X.readXlsx(bytes);
  assert.deepEqual(out.sheets, ['ورقة البيانات']);
  assert.equal(out.rows.length, 11, 'الصفوف الفارغة المنسقة لا تُنشأ');
  const t = SRC.toTable(out.rows);
  assert.equal(t.trailingEmpty, 0);
  assert.deepEqual(t.columns, SRC.toTable(csvRows).columns);
  assert.deepEqual(t.records, SRC.toTable(csvRows).records);
  t.fileName = 'faculty.xlsx';
  const c = configured();
  assert.equal(E.runInput(c.inputs.find(i => i.key === 'facultyFull'), { faculty: t }, c.params).value, 8);
});

test('ENG-23 xlsx: سطر عناوين في الصف 13، ونص مضمّن وكيانات XML، وأرشيف غير مضغوط، وملف تالف', async () => {
  const rows = SRC.parseCSV(read('top500.csv'));
  const out = await X.readXlsx(xlsxFromRows(rows, { stored: true, inline: true }));
  const t = SRC.toTable(out.rows);
  assert.equal(t.headerRow, 13);
  assert.equal(t.records.length, 15);
  const amp = await X.readXlsx(xlsxFromRows([['البند', 'القيمة'], ['بحث & تطوير', '7']]));
  assert.equal(amp.rows[1][0], 'بحث & تطوير');
  await assert.rejects(X.readXlsx(new Uint8Array([1, 2, 3, 4, 5])), /ليس بصيغة xlsx صالحة/);
  assert.equal(X.colIndex('AA1'), 26);
});
