/*
 * مولّد TEST_REPORT.md من نتائج تشغيل فعلية — منصة «بصيرة»
 * ------------------------------------------------------------
 * 1) ينسخ ملفات المشروع (المتتبعة وغير المتتبعة، دون .git) إلى مجلد مؤقت نظيف.
 * 2) يشغّل هناك أوامر README حرفيًا: `node --test` ثم `node tests/e2e/browser-check.js`.
 * 3) يربط كل حالة في ACCEPTANCE_CRITERIA.md بالفحوص التي نُفذت (tests/report/ac-map.js + الربط التلقائي بالمعرّف).
 * 4) يكتب TEST_REPORT.md، ويحفظ المخرجات الخام في tests/report/output/ كدليل.
 * لا يكتب «ناجح» لحالة إلا إذا نجح فعلًا فحص مرتبط بها في هذا التشغيل.
 *
 * التشغيل من مجلد BASIRA:  node tests/report/build-report.js
 * لإعادة بناء التقرير من آخر مخرجات محفوظة دون تشغيل:  node tests/report/build-report.js --reuse
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'output');
const REUSE = process.argv.includes('--reuse');
const MAP = require('./ac-map.js');
fs.mkdirSync(OUT, { recursive: true });

// ---------- 1–2: نسخة نظيفة وتشغيل أوامر README ----------
const readme = fs.existsSync(path.join(ROOT, 'README.md')) ? fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8') : '';
const readmeCommands = [...readme.matchAll(/```bash\s*\n([\s\S]*?)```/g)].map(m => m[1].trim());
let meta;
if (REUSE) {
  meta = JSON.parse(fs.readFileSync(path.join(OUT, 'run-meta.json'), 'utf8'));
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'basira-clean-'));
  const copy = path.join(tmp, 'BASIRA');
  const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
    .filter(f => !f.startsWith('tests/report/output/') && fs.existsSync(path.join(ROOT, f)));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(copy, f));
  }
  console.log('نسخة نظيفة: ' + files.length + ' ملفًا في ' + copy);
  const t0 = Date.now();
  // README: `node --test` — نضيف منسق TAP فقط لقراءة النتائج آليًا، والأمر نفسه دون تغيير.
  const unit = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: copy, encoding: 'utf8', timeout: 300000 });
  fs.writeFileSync(path.join(OUT, 'unit-tap.txt'), unit.stdout + (unit.stderr ? '\n# stderr\n' + unit.stderr : ''));
  const t1 = Date.now();
  console.log('node --test: رمز الخروج ' + unit.status);
  const e2eJson = path.join(tmp, 'e2e.json');
  const e2e = spawnSync(process.execPath, ['tests/e2e/browser-check.js'], { cwd: copy, encoding: 'utf8', timeout: 900000, env: Object.assign({}, process.env, { BASIRA_E2E_JSON: e2eJson }) });
  fs.writeFileSync(path.join(OUT, 'e2e-output.txt'), e2e.stdout + (e2e.stderr ? '\n# stderr\n' + e2e.stderr : ''));
  const t2 = Date.now();
  console.log('browser-check: رمز الخروج ' + e2e.status);
  const e2eData = fs.existsSync(e2eJson) ? JSON.parse(fs.readFileSync(e2eJson, 'utf8')) : { results: [], browser: '' };
  fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(e2eData, null, 2));
  meta = {
    ranAt: new Date().toISOString(), node: process.version, platform: os.platform() + ' ' + os.release(), browser: e2eData.browser,
    cleanCopyFiles: files.length, unitExit: unit.status, e2eExit: e2e.status, unitSeconds: Math.round((t1 - t0) / 1000), e2eSeconds: Math.round((t2 - t1) / 1000)
  };
  fs.writeFileSync(path.join(OUT, 'run-meta.json'), JSON.stringify(meta, null, 2));
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { console.log('تنبيه: تعذر حذف ' + tmp); }
}

// ---------- قراءة النتائج ----------
const tap = fs.readFileSync(path.join(OUT, 'unit-tap.txt'), 'utf8');
const unitTests = [...tap.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map(m => ({ ok: m[1] === 'ok', name: m[2].trim() }));
const e2eResults = JSON.parse(fs.readFileSync(path.join(OUT, 'e2e-results.json'), 'utf8')).results;

// فحوص README والتسليم (R-…)
const R = [];
const rcheck = (id, name, ok, detail) => R.push({ id, name, ok: !!ok, detail });
const hasCmd = c => readmeCommands.some(x => x.split('\n').some(l => l.trim() === c));
rcheck('R-01', 'README موجود ويشرح التشغيل والفحص والبنية والحدود، وفيه أوامر الفحص', readme && /## 1\. التشغيل/.test(readme) && /## 3\. الفحص/.test(readme) && /## 4\. البنية/.test(readme) && /## 5\. الحدود/.test(readme) && hasCmd('node --test') && hasCmd('node tests/e2e/browser-check.js'),
  'الأوامر في README: ' + readmeCommands.join(' | '));
rcheck('R-02', 'اتباع README على نسخة نظيفة: `node --test` ينتهي دون إخفاق', meta.unitExit === 0 && unitTests.length > 0 && unitTests.every(t => t.ok),
  unitTests.filter(t => t.ok).length + ' ناجح من ' + unitTests.length + ' · رمز الخروج ' + meta.unitExit + ' · ' + meta.unitSeconds + ' ث');
rcheck('R-03', 'اتباع README على نسخة نظيفة: `node tests/e2e/browser-check.js` يفتح index.html عبر file:// وينجح', meta.e2eExit === 0 && e2eResults.length > 0 && e2eResults.every(r => r.ok) && e2eResults.some(r => r.id === 'E-01' && /"proto":"file:"/.test(r.detail)),
  e2eResults.filter(r => r.ok).length + ' ناجح من ' + e2eResults.length + ' · رمز الخروج ' + meta.e2eExit + ' · ' + meta.e2eSeconds + ' ث · ' + meta.browser);

// ---------- 3: حالات القبول ----------
const acText = fs.readFileSync(path.join(ROOT, 'ACCEPTANCE_CRITERIA.md'), 'utf8');
const cases = [];
let header = null;
let section = '';
for (const line of acText.split(/\r?\n/)) {
  if (/^#{2,3} /.test(line)) section = line.replace(/^#+ /, '');
  if (!line.startsWith('|')) { header = line.startsWith('|') ? header : header; continue; }
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  if (cells[0] === 'المعرّف') { header = cells; continue; }
  if (!/^AC-[A-Z]+-\d+$/.test(cells[0]) || !header) continue;
  const get = name => { const i = header.indexOf(name); return i === -1 ? '' : cells[i]; };
  let steps = get('الخطوات') || get('المدخل') || (get('ما نكتبه') ? 'البحث عن ' + get('ما نكتبه') : '');
  if (header.includes('البحث') && header.includes('التصفية')) steps = 'البحث: ' + get('البحث') + ' · التصفية: ' + get('التصفية');
  cases.push({ id: cells[0], section, title: get('الحالة') || get('المعرّف'), steps, expected: get('المتوقع'), method: get('الفحص') });
}

// ربط تلقائي: معرّفات AC في أسماء الفحوص، مع توسيع «/02/03» و«01..04»
function acRefs(text) {
  const out = [];
  for (const m of text.matchAll(/AC-([A-Z]+)-(\d+)((?:\/\d+)*)(?:\.\.(\d+))?/g)) {
    const nums = [m[2]].concat(m[3] ? m[3].split('/').filter(Boolean) : []);
    if (m[4]) for (let n = Number(m[2]) + 1; n <= Number(m[4]); n++) nums.push(String(n));
    nums.forEach(n => out.push('AC-' + m[1] + '-' + String(n).padStart(2, '0')));
  }
  return out;
}
const byAc = {};
const link = (ac, ref) => { (byAc[ac] = byAc[ac] || new Set()).add(ref); };
unitTests.forEach(t => acRefs(t.name).forEach(ac => link(ac, 'U:' + t.name)));
e2eResults.forEach(r => acRefs(r.name).forEach(ac => link(ac, 'E:' + r.id)));

function resolve(ref) {
  if (/^(E|P4|P5|Q)-[\w]+$/.test(ref)) { const r = e2eResults.find(x => x.id === ref); return r ? { kind: 'متصفح', id: r.id, ok: r.ok, text: r.name + (r.detail ? ' ← ' + r.detail : '') } : null; }
  if (/^R-\d+$/.test(ref)) { const r = R.find(x => x.id === ref); return r ? { kind: 'README/تسليم', id: r.id, ok: r.ok, text: r.name + ' ← ' + r.detail } : { pending: ref }; }
  const t = unitTests.find(x => x.name === ref || x.name.startsWith(ref));
  return t ? { kind: 'آلي', id: t.name.split(' ')[0].match(/^(INT|LET|CSV)-\d+$/) ? t.name.split(' ')[0] : 'node --test', ok: t.ok, text: t.name } : null;
}

const rows = cases.map(c => {
  const m = MAP[c.id] || {};
  const refs = new Set(byAc[c.id] || []);
  (m.tests || []).forEach(t => refs.add(t));
  // معرّفات الفحوص المكتوبة في عمود «الفحص» (حالات AC-INT)
  (c.method.match(/\b(INT|LET|CSV|P5|P4|E|Q)-\d+(?:\.\.\d+)?\b/g) || []).forEach(tok => {
    const mm = tok.match(/^([A-Z0-9]+)-(\d+)(?:\.\.(\d+))?$/);
    for (let n = Number(mm[2]); n <= Number(mm[3] || mm[2]); n++) refs.add(mm[1] + '-' + String(n).padStart(2, '0'));
  });
  const resolved = [];
  const missing = [];
  for (const ref of refs) {
    const x = ref.startsWith('U:') ? resolve(ref.slice(2)) : ref.startsWith('E:') ? resolve(ref.slice(2)) : resolve(ref);
    if (x && !x.pending) resolved.push(x); else missing.push(ref.replace(/^[UE]:/, ''));
  }
  let status;
  if (m.status === 'not_implemented') status = 'غير منفذ';
  else if (!resolved.length) status = 'لم يُختبر';
  else if (resolved.some(x => !x.ok)) status = 'فاشل';
  else status = m.partial ? 'ناجح جزئيًا' : 'ناجح';
  return Object.assign({}, c, { status, resolved, missing, note: m.note || m.partial || '' });
});

// R-04..06 بعد بناء الصفوف
// الحالات التي تنتظر فحوص R- نفسها تُحسم بعد هذا الحساب، فلا تُعد بلا نتيجة.
const untestedNoReason = rows.filter(r => r.status === 'لم يُختبر' && !r.note && !r.missing.every(id => /^R-\d+$/.test(id)));
rcheck('R-04', 'كل حالة قبول لها نتيجة فعلية، أو سبب صريح لعدم تنفيذها (AC-DOC-02)', !untestedNoReason.length, untestedNoReason.map(r => r.id).join('، ') || rows.length + ' حالة: لكل منها نتيجة أو سبب');
const work = fs.readFileSync(path.join(ROOT, 'WORK_LOG.md'), 'utf8');
const phases = [0, 1, 2, 3, 4, 5].filter(n => new RegExp('^## المرحلة ' + n + '\\b', 'm').test(work));
rcheck('R-05', 'كل مرحلة منفذة (0–5) موثقة في WORK_LOG.md (AC-DOC-03)', phases.length === 6, 'المراحل الموثقة: ' + phases.join('، '));
const pkg = ['index.html', 'README.md', 'CLAUDE.md', '.claude/skills/basira-review/SKILL.md', 'TEST_LOG.md'];
const missingPkg = pkg.filter(f => !fs.existsSync(path.join(ROOT, f)));
rcheck('R-06', 'حزمة التسليم: index.html وREADME وCLAUDE.md ومهارة المراجعة وسجل الاختبار (AC-DOC-04)', !missingPkg.length, missingPkg.length ? 'ناقص: ' + missingPkg.join('، ') : 'كلها موجودة');
// إعادة حل الحالات المرتبطة بـ R-04..06
rows.forEach(r => {
  r.resolved = r.resolved.concat(r.missing.map(id => resolve(id)).filter(x => x && !x.pending));
  r.missing = r.missing.filter(id => !resolve(id) || resolve(id).pending);
  if (r.status === 'لم يُختبر' && r.resolved.length) r.status = r.resolved.some(x => !x.ok) ? 'فاشل' : (MAP[r.id] && MAP[r.id].partial ? 'ناجح جزئيًا' : 'ناجح');
  if (r.status !== 'غير منفذ' && r.resolved.some(x => !x.ok)) r.status = 'فاشل';
});

// ---------- 4: الكتابة ----------
const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const cut = (s, n) => { s = esc(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const count = st => rows.filter(r => r.status === st).length;
const priorities = {};
const prioLine = acText.match(/\| MUST \| ([^\n]+)\|/);
const isCould = id => /COULD \| ([^\n]+)\|/.test(acText) && acText.match(/\| COULD \| ([^\n]+)\|/)[1].split(/[·،]/).some(tok => {
  const t = tok.trim(); const m = t.match(/^([A-Z]+)-(\d+)$/); return m && id === 'AC-' + m[1] + '-' + m[2];
});
rows.forEach(r => { r.priority = isCould(r.id) ? 'COULD' : 'MUST'; });
const notes = fs.existsSync(path.join(__dirname, 'notes.md')) ? fs.readFileSync(path.join(__dirname, 'notes.md'), 'utf8').trim() : '';
const AREAS = [
  ['كل زر ورابط ونموذج', ['Q-01', 'Q-02', 'Q-04', 'P4-01', 'P4-04', 'P4-05', 'P4-07', 'P5-11']],
  ['إضافة البيانات وتعديلها وحذفها', ['E-10', 'Q-04', 'Q-06', 'Q-07', 'P4-01', 'P4-04', 'P4-05', 'P4-08', 'P4-09']],
  ['حالات الإدخال غير الصحيح', ['P4-01', 'P4-04', 'P4-05', 'P4-06', 'P4-07', 'P4-08', 'P5-11', 'Q-04', 'Q-09', 'E-15']],
  ['العلاقات بين السجلات', ['P4-03', 'P4-04', 'P4-09', 'P4-05']],
  ['دقة الإحصاءات ونسب الإنجاز', ['Q-03', 'Q-05', 'P5-02', 'P5-04', 'P5-06', 'E-01']],
  ['حالات التأخير واكتشاف النواقص', ['E-12', 'P5-02', 'P5-06', 'Q-10']],
  ['البحث والتصفية', ['E-09', 'Q-08']],
  ['الحفظ والاسترجاع', ['E-11', 'P4-11', 'Q-09']],
  ['الاستيراد والتصدير', ['E-14', 'E-15', 'E-16', 'P4-12', 'P5-12']],
  ['الاستجابة على الجوال والحاسوب', ['E-04', 'E-05', 'E-06', 'E-22', 'E-23', 'Q-12']],
  ['اتجاه RTL والنصوص العربية', ['E-02', 'Q-11']],
  ['الوصول باستخدام لوحة المفاتيح', ['E-07', 'E-08', 'E-08b', 'E-13', 'Q-04', 'Q-06']],
  ['تشغيل المشروع باتباع تعليمات README', ['R-01', 'R-02', 'R-03']]
];
const allChecks = e2eResults.concat(R);
const areaRow = ([name, ids]) => {
  const rs = ids.map(id => allChecks.find(x => x.id === id)).filter(Boolean);
  const ok = rs.length === ids.length && rs.every(x => x.ok);
  return '| ' + name + ' | ' + ids.join('، ') + ' | ' + (ok ? 'ناجح' : 'فاشل: ' + rs.filter(x => !x.ok).map(x => x.id).join('، ') + (rs.length < ids.length ? ' (فحوص مفقودة)' : '')) + ' |';
};

const L = [];
L.push('# تقرير الاختبار — منصة «بصيرة» (BASIRA)', '');
L.push('> **مُولَّد آليًا** بالأمر `node tests/report/build-report.js` من نتائج تشغيل فعلية، ولا يُحرر يدويًا. القسم «المشكلات والملاحظات» وحده مكتوب يدويًا في `tests/report/notes.md`.');
L.push('> لا تُكتب «ناجح» لحالة إلا إذا نجح في هذا التشغيل فحص مرتبط بها. الحالات غير المنفذة لا تُعد ناجحة.', '');
L.push('## 1. بيئة التشغيل', '');
L.push('| البند | القيمة |', '|---|---|');
L.push('| وقت التشغيل | ' + meta.ranAt + ' |');
L.push('| النظام | ' + meta.platform + ' |');
L.push('| Node.js | ' + meta.node + ' |');
L.push('| المتصفح | ' + (meta.browser || '—') + ' (بلا واجهة، عبر CDP) |');
L.push('| طريقة التشغيل | نسخة نظيفة من ' + meta.cleanCopyFiles + ' ملفًا في مجلد مؤقت، ثم أوامر README كما هي: `node --test` و`node tests/e2e/browser-check.js` |');
L.push('| التاريخ المرجعي للحالات | 2026-11-01 وبيانات الفحص F1–F6 (`?today=2026-11-01&dataset=fixtures`) |');
L.push('| المخرجات الخام | `tests/report/output/` (unit-tap.txt، وe2e-output.txt، وe2e-results.json، وrun-meta.json) |', '');

L.push('## 2. الملخص', '');
L.push('| المقياس | النتيجة |', '|---|---|');
L.push('| الفحوص الآلية (`node --test`) | **' + unitTests.filter(t => t.ok).length + ' ناجح / ' + unitTests.filter(t => !t.ok).length + ' فاشل** من ' + unitTests.length + ' |');
L.push('| فحوص المتصفح (`browser-check.js`) | **' + e2eResults.filter(r => r.ok).length + ' ناجح / ' + e2eResults.filter(r => !r.ok).length + ' فاشل** من ' + e2eResults.length + ' |');
L.push('| فحوص README والتسليم (R-01..06) | **' + R.filter(r => r.ok).length + ' ناجح / ' + R.filter(r => !r.ok).length + ' فاشل** من ' + R.length + ' |');
L.push('| حالات القبول | ' + rows.length + ' حالة: **ناجح ' + count('ناجح') + '**، وناجح جزئيًا ' + count('ناجح جزئيًا') + '، وفاشل ' + count('فاشل') + '، وغير منفذ ' + count('غير منفذ') + '، ولم يُختبر ' + count('لم يُختبر') + ' |');
const mustNI = rows.filter(r => r.priority === 'MUST' && r.status === 'غير منفذ');
L.push('| حالات MUST غير المنفذة | **' + mustNI.length + '**: ' + mustNI.map(r => r.id.replace('AC-', '')).join('، ') + ' |', '');

L.push('## 3. المجالات المطلوب اختبارها', '');
L.push('| المجال | الفحوص | النتيجة |', '|---|---|---|');
AREAS.forEach(a => L.push(areaRow(a)));
L.push('');

if (notes) L.push(notes, '');

L.push('## 5. نتيجة كل حالة قبول', '');
L.push('الأعمدة: المعرّف، وخطوات الاختبار، والنتيجة المتوقعة، والنتيجة الفعلية، والحالة، والدليل. «الفعلي» منقول من مخرجات الفحص نفسه.', '');
let lastSection = '';
for (const r of rows) {
  if (r.section !== lastSection) {
    L.push('', '### ' + r.section, '');
    L.push('| المعرّف | خطوات الاختبار | المتوقع | الفعلي | الحالة | الدليل |', '|---|---|---|---|---|---|');
    lastSection = r.section;
  }
  const steps = [r.title, r.steps || (r.resolved.length ? 'تُنفذ خطوات الفحص المرتبط في الدليل' : '')].filter(Boolean).join(': ');
  let actual;
  if (r.status === 'غير منفذ') actual = 'لا توجد الوظيفة. ' + r.note;
  else if (!r.resolved.length) actual = 'لم يُنفذ فحص. ' + r.note;
  else actual = r.resolved.map(x => (x.ok ? '' : '✗ ') + x.text).join(' ؛ ') + (r.note && r.status === 'ناجح جزئيًا' ? ' — **لم يُغطَّ:** ' + r.note : '');
  const evidence = r.resolved.map(x => x.kind + ' ' + x.id).filter((v, i, a) => a.indexOf(v) === i).join('، ') || '—';
  const badge = { 'ناجح': '✅ ناجح', 'ناجح جزئيًا': '🟡 ناجح جزئيًا', 'فاشل': '❌ فاشل', 'غير منفذ': '⛔ غير منفذ', 'لم يُختبر': '⚪ لم يُختبر' }[r.status];
  L.push('| ' + r.id + (r.priority === 'COULD' ? ' (COULD)' : '') + ' | ' + cut(steps, 160) + ' | ' + cut(r.expected, 220) + ' | ' + cut(actual, 420) + ' | ' + badge + ' | ' + cut(evidence, 160) + ' |');
}
L.push('');

L.push('## 6. كل فحوص المتصفح في هذا التشغيل', '');
L.push('| المعرّف | الفحص | الحالة | التفاصيل |', '|---|---|---|---|');
e2eResults.forEach(r => L.push('| ' + r.id + ' | ' + esc(r.name) + ' | ' + (r.ok ? 'ناجح' : '**فاشل**') + ' | ' + cut(r.detail, 300) + ' |'));
R.forEach(r => L.push('| ' + r.id + ' | ' + esc(r.name) + ' | ' + (r.ok ? 'ناجح' : '**فاشل**') + ' | ' + cut(r.detail, 300) + ' |'));
L.push('');
L.push('## 7. كل الفحوص الآلية في هذا التشغيل', '');
L.push('| # | الفحص | الحالة |', '|---|---|---|');
unitTests.forEach((t, i) => L.push('| ' + (i + 1) + ' | ' + esc(t.name) + ' | ' + (t.ok ? 'ناجح' : '**فاشل**') + ' |'));
L.push('');

fs.writeFileSync(path.join(ROOT, 'TEST_REPORT.md'), L.join('\n'));
console.log('كُتب TEST_REPORT.md: حالات ' + rows.length + ' · ناجح ' + count('ناجح') + ' · جزئي ' + count('ناجح جزئيًا') + ' · فاشل ' + count('فاشل') + ' · غير منفذ ' + count('غير منفذ') + ' · لم يُختبر ' + count('لم يُختبر'));
console.log('فحوص README/التسليم: ' + R.map(r => r.id + (r.ok ? '✓' : '✗')).join(' '));
const failingRows = rows.filter(r => r.status === 'فاشل');
if (failingRows.length) console.log('حالات فاشلة: ' + failingRows.map(r => r.id).join('، '));
process.exit(0);
