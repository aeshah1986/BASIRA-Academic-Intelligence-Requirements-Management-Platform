/*
 * فحص شامل في متصفح حقيقي — منصة «بصيرة»
 * ---------------------------------------------------------------
 * يفتح index.html مباشرة عبر file:// (كما تستخدمه المستخدمة) في Edge أو Chrome دون واجهة،
 * ويقوده عبر بروتوكول أدوات المطور (CDP) بوحدات Node المدمجة فقط (WebSocket، fetch). لا حزم npm.
 *
 * التشغيل (من مجلد BASIRA):   node tests/e2e/browser-check.js
 * متصفح مختلف:               BASIRA_BROWSER="C:\path\to\chrome.exe" node tests/e2e/browser-check.js
 *
 * لا يُشغَّل مع `node --test` (اسمه لا ينتهي بـ .test.js) لأنه يحتاج متصفحًا.
 * يستخدم ملف تعريف مؤقتًا ومجلد تنزيل مؤقتًا، ويحذفهما في النهاية. لا يلمس بيانات متصفح المستخدمة.
 */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const TODAY = '2026-11-01';
// حالات القبول مبنية على بيانات الفحص الثابتة F1–F6، فيُطلب مصدرها صراحة.
const APP = pathToFileURL(path.join(ROOT, 'index.html')).href + '?today=' + TODAY + '&dataset=fixtures';
const DEMO = pathToFileURL(path.join(ROOT, 'index.html')).href; // الوضع الافتراضي: بيانات العرض وتاريخ الجهاز
const CANDIDATES = [
  process.env.BASIRA_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const ARTIFACTS = process.env.BASIRA_E2E_ARTIFACTS || ''; // مجلد اختياري لحفظ PDF الطباعة

const sleep = ms => new Promise(r => setTimeout(r, ms));
// كل انتظار له مهلة، فيظهر الفشل بدل التعليق.
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('انتهت المهلة: ' + label)), ms); })])
    .finally(() => clearTimeout(timer));
}
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? 'PASS ' : 'FAIL ') + id.padEnd(9) + ' ' + name + (detail !== undefined ? '  ← ' + detail : ''));
}

// ---------- CDP ----------
function createClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    } else listeners.forEach(fn => fn(msg));
  };
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return {
    opened,
    send(method, params = {}, sessionId) {
      const id = ++seq;
      return withTimeout(new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      }), 20000, method);
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { ws.close(); }
  };
}

async function openPage(cdp, { beforeLoadScript } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  cdp.on(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || msg.params.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map(a => a.value || a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('log: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  });
  await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable'); await s('DOM.enable');
  if (beforeLoadScript) await s('Page.addScriptToEvaluateOnNewDocument', { source: beforeLoadScript });
  const page = {
    targetId, sessionId, errors, send: s,
    async eval(expr) {
      const r = await s('Runtime.evaluate', { expression: '(async () => { ' + expr + ' })()', awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      return r.result.value;
    },
    // تحميل كامل للصفحة دائمًا (تغيير # وحده لا يطلق حدث التحميل، فنمر عبر about:blank).
    async goto(url) {
      const load = target => {
        const loaded = new Promise(res => { const off = cdp.on(m => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { off(); res(); } }); });
        return s('Page.navigate', { url: target }).then(() => withTimeout(loaded, 15000, 'تحميل ' + target));
      };
      await load('about:blank');
      await load(url);
      await sleep(250);
    },
    async route(hash) { await page.eval('location.hash = ' + JSON.stringify(hash)); await sleep(180); },
    async viewport(width, height, mobile) {
      await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: !!mobile });
      await sleep(120);
    },
    async key(key, code, vk, shift) {
      const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
      await s('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
      await s('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
      await sleep(60);
    },
    async clickSelector(selector, textMatch) {
      // نقرة فأرة حقيقية في منتصف العنصر.
      const box = await page.eval(`
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.offsetParent || e.closest('dialog[open]'));
        const el = ${textMatch ? `els.find(e => e.textContent.trim() === ${JSON.stringify(textMatch)})` : 'els[0]'};
        if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
      if (!box) throw new Error('element not found: ' + selector + (textMatch ? ' «' + textMatch + '»' : ''));
      for (const type of ['mousePressed', 'mouseReleased']) {
        await s('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      }
      await sleep(200);
    },
    async typeText(text) { await s('Input.insertText', { text }); await sleep(150); }
  };
  return page;
}

// ---------- السيناريوهات ----------
const ROUTES = ['#/dashboard', '#/rankings', '#/rankings?ranking=QS', '#/indicators/ind-ar-edu-1', '#/indicators/ind-ar-edu-1/edit',
  '#/requirements', '#/requirements?due=overdue', '#/requirements/new', '#/requirements/req-f1', '#/requirements/req-f1/edit',
  '#/entities', '#/entities/ent-research', '#/followups', '#/followups?tab=decisions', '#/reports', '#/reports?type=overdue',
  '#/activity', '#/requirements/missing', '#/indicators/new', '#/entities/new', '#/entities/ent-hr/edit', '#/evidence', '#/evidence/new',
  '#/followups?tab=all', '#/decisions/new', '#/decisions/dec-1/resolve',
  // المرحلة 5
  '#/insights', '#/letters', '#/letters?entity=ent-hr&level=L2', '#/letters/templates', '#/reports?type=priorities', '#/reports?type=response'];

async function sweep(page, label) {
  const problems = [];
  for (const r of ROUTES) {
    await page.route(r);
    const st = await page.eval(`const m = document.getElementById('main');
      return { h1: !!m.querySelector('h1'), crash: /تعذر عرض هذه الصفحة/.test(m.textContent), over: document.documentElement.scrollWidth - innerWidth };`);
    if (!st.h1 || st.crash || st.over > 0) problems.push(r + JSON.stringify(st));
  }
  return problems;
}

async function run(cdp, tmp) {
  const page = await openPage(cdp);

  // E-01 الإقلاع من file://
  await page.viewport(1280, 900, false);
  await page.goto(APP + '#/dashboard');
  const boot = await page.eval(`return { proto: location.protocol, h1: (document.querySelector('#main h1')||{}).textContent,
    dir: document.documentElement.dir, lang: document.documentElement.lang,
    kpis: [...document.querySelectorAll('.kpi__value')].map(e => e.textContent).join(','),
    storageWarning: /الحفظ غير متاح/.test(document.body.textContent), sample: /بيانات تجريبية وهمية/.test(document.body.textContent) };`);
  check('E-01', 'الإقلاع من file:// دون خادم (AC-UI-01)', boot.proto === 'file:' && boot.h1 === 'لوحة القيادة' && boot.kpis === '5,2,2,1,1', JSON.stringify(boot));
  check('E-02', 'RTL واللغة العربية (AC-UI-02)', boot.dir === 'rtl' && boot.lang === 'ar');
  check('E-03', 'الحفظ متاح عبر file:// وشريط البيانات الوهمية ظاهر (AC-UI-06)', !boot.storageWarning && boot.sample);

  // E-04..06 كل المسارات في ثلاثة مقاسات
  check('E-04', 'كل المسارات على الحاسوب 1280 (عنوان، لا انهيار، لا تمرير أفقي)', !(await sweep(page)).length, ROUTES.length + ' مسارًا');
  await page.viewport(800, 1024, false);
  const tablet = await sweep(page);
  await page.route('#/dashboard');
  const tabLayout = await page.eval(`return { sidebar: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
    labelHidden: getComputedStyle(document.querySelector('.nav__label')).display === 'none',
    kpiCols: getComputedStyle(document.querySelector('.kpis')).gridTemplateColumns.split(' ').length,
    bottom: getComputedStyle(document.querySelector('.bottom-nav')).display };`);
  check('E-05', 'اللوح 800px: كل المسارات + شريط أيقونات 72px و3 أعمدة KPI', !tablet.length && tabLayout.sidebar === 72 && tabLayout.labelHidden && tabLayout.kpiCols === 3 && tabLayout.bottom === 'none', JSON.stringify(tabLayout) + (tablet.length ? ' ' + tablet.join(' ') : ''));
  await page.viewport(375, 812, true);
  const mobile = await sweep(page);
  check('E-06', 'الجوال 375: كل المسارات دون تمرير أفقي (AC-UI-04)', !mobile.length, mobile.join(' ') || ROUTES.length + ' مسارًا');

  // E-07 لوحة المفاتيح (حاسوب)
  await page.viewport(1280, 900, false);
  await page.goto(APP + '#/dashboard');
  await page.eval('document.activeElement.blur(); window.scrollTo(0,0);');
  const order = [];
  for (let i = 0; i < 12; i++) {
    await page.key('Tab', 'Tab', 9);
    order.push(await page.eval(`const a = document.activeElement; const cs = getComputedStyle(a);
      return (a.textContent || a.getAttribute('aria-label') || a.tagName).trim().replace(/\\s+/g,' ').slice(0, 28) + (cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px' ? ' [إطار]' : ' [بلا إطار]');`));
  }
  check('E-07', 'Tab: أول عنصر «انتقل إلى المحتوى» ثم الشعار ثم «البيانات» ثم القائمة، مع إطار تركيز ظاهر (AC-UI-05)',
    /انتقل إلى المحتوى/.test(order[0]) && /بصيرة/.test(order[1]) && /البيانات/.test(order[2]) && /لوحة القيادة/.test(order[3]) && order.every(o => o.includes('[إطار]')), order.join(' → '));
  await page.goto(APP + '#/dashboard');
  await page.key('Tab', 'Tab', 9);
  await page.key('Enter', 'Enter', 13);
  const skip = await page.eval(`return { hash: location.hash, focus: document.activeElement.id, toast: document.querySelectorAll('.toast').length };`);
  check('E-08', 'رابط «انتقل إلى المحتوى» ينقل التركيز إلى المحتوى دون تغيير الصفحة', skip.focus === 'main' && skip.hash === '#/dashboard' && skip.toast === 0, JSON.stringify(skip));
  await page.route('#/requirements');
  const focusAfterNav = await page.eval(`return document.activeElement.tagName + ':' + document.activeElement.textContent;`);
  check('E-08b', 'عند الانتقال لصفحة أخرى ينتقل التركيز إلى عنوانها', focusAfterNav === 'H1:المتطلبات', focusAfterNav);

  // E-09 كتابة حقيقية: بحث + حقن HTML في نموذج
  await page.route('#/requirements');
  await page.clickSelector('#q');
  await page.typeText('الدوليين');
  const srch = await page.eval(`return document.querySelector('.result-count').textContent;`);
  check('E-09', 'البحث بالكتابة الحقيقية «الدوليين» (AC-SRCH-02/11)', srch === 'عدد النتائج: 1 من 6', srch);

  await page.route('#/requirements/new');
  await page.clickSelector('#r-title');
  await page.typeText('<img src=x onerror=alert(1)> اختبار e2e');
  await page.eval(`const f = document.querySelector('form');
    f.querySelector('[name=indicatorId]').value = 'ind-ar-edu-4'; f.querySelector('[name=entityId]').value = 'ent-academic';
    f.querySelector('[name=deadline]').value = '2026-11-25';`);
  await page.clickSelector('form button[type=submit]');
  const created = await page.eval(`return { hash: location.hash, h1: document.querySelector('#main h1').textContent, imgs: document.querySelectorAll('#main img').length,
    stored: JSON.parse(localStorage.getItem('basira.v1')).requirements.length };`);
  check('E-10', 'إضافة متطلب بعنوان فيه HTML: يُحفظ ويظهر نصًا (AC-CRUD-01، AC-SEC-01)', created.imgs === 0 && created.h1.startsWith('<img') && created.stored === 7, JSON.stringify(created));

  // E-11 الاستمرار بعد إعادة التحميل عبر file://
  await page.goto(APP + created.hash);
  const persisted = await page.eval(`return { h1: (document.querySelector('#main h1')||{}).textContent, stored: JSON.parse(localStorage.getItem('basira.v1')).requirements.length };`);
  check('E-11', 'الحفظ يبقى بعد إعادة التحميل عبر file:// (AC-CRUD-05)', persisted.stored === 7 && persisted.h1 === created.h1, JSON.stringify(persisted));

  // E-12 زر الرجوع في المتصفح
  await page.route('#/dashboard');
  await page.route('#/requirements?due=overdue');
  const overdue = await page.eval(`return [...document.querySelectorAll('.row-link')].map(a => a.textContent).length;`);
  await page.eval('history.back();'); await sleep(250);
  const back = await page.eval(`return { hash: location.hash, h1: document.querySelector('#main h1').textContent };`);
  check('E-12', 'رابط «متأخرة» ثم زر الرجوع (AC-NAV-01)', overdue === 2 && back.hash === '#/dashboard' && back.h1 === 'لوحة القيادة', 'متأخرة=' + overdue + ' ثم ' + JSON.stringify(back));

  // E-13 Esc يغلق الحوار ويعيد التركيز
  await page.clickSelector('#data-button');
  const dlgOpen = await page.eval(`return document.getElementById('dialog').open;`);
  await page.key('Escape', 'Escape', 27);
  const dlgAfter = await page.eval(`return { open: document.getElementById('dialog').open, focus: document.activeElement.id };`);
  check('E-13', 'حوار «البيانات»: Esc يغلقه ويعيد التركيز إلى الزر', dlgOpen && !dlgAfter.open && dlgAfter.focus === 'data-button', JSON.stringify(dlgAfter));

  // E-14 التصدير الفعلي (تنزيل حقيقي إلى مجلد مؤقت)
  const dlDir = path.join(tmp, 'downloads');
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });
  await page.clickSelector('#data-button');
  await page.clickSelector('.dialog button', 'تصدير نسخة احتياطية (JSON)');
  let files = [];
  for (let i = 0; i < 40 && !files.length; i++) { await sleep(150); files = fs.readdirSync(dlDir).filter(f => f.endsWith('.json')); }
  let exported = null;
  if (files.length) exported = JSON.parse(fs.readFileSync(path.join(dlDir, files[0]), 'utf8'));
  check('E-14', 'التصدير ينزّل basira-backup-YYYY-MM-DD.json صالحًا (AC-PER-01)',
    files[0] === 'basira-backup-' + TODAY + '.json' && exported && exported.schemaVersion === 2 && exported.requirements.length === 7, files.join(',') || 'لم يُنزَّل ملف');

  // E-15 الاستيراد عبر حقل الملف الحقيقي (DOM.setFileInputFiles) — ملف تالف ثم سليم
  async function importFile(filePath) {
    await page.clickSelector('#data-button');
    const { root } = await page.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
    await page.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
    await sleep(400);
  }
  const before = await page.eval(`return localStorage.getItem('basira.v1');`);
  const badPath = path.join(tmp, 'broken.json');
  fs.writeFileSync(badPath, '{ ليس JSON');
  await importFile(badPath);
  const bad = await page.eval(`return { toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).pop(), same: localStorage.getItem('basira.v1') === ${JSON.stringify(before)} };`);
  check('E-15', 'استيراد ملف تالف من حقل الملف: يُرفض ولا تتغير البيانات (AC-PER-03)', bad.same && /لم يُستورد الملف/.test(bad.toast), bad.toast);

  const goodData = JSON.parse(JSON.stringify(exported)); goodData.requirements = goodData.requirements.slice(0, 3);
  const goodPath = path.join(tmp, 'good.json'); fs.writeFileSync(goodPath, JSON.stringify(goodData));
  await importFile(goodPath);
  const confirmText = await page.eval(`return document.getElementById('dialog').open ? document.querySelector('.dialog__body').textContent : '';`);
  await page.clickSelector('.dialog button', 'استبدال البيانات');
  const imported = await page.eval(`return JSON.parse(localStorage.getItem('basira.v1')).requirements.length;`);
  check('E-16', 'استيراد ملف سليم: تأكيد ثم استبدال (AC-PER-04)', /متطلبات/.test(confirmText) && imported === 3, 'التأكيد: «' + confirmText.slice(0, 60) + '…» ← ' + imported);

  // E-17 إعادة البيانات التجريبية من حوار «البيانات» (الخلل B1 سابقًا)
  await page.clickSelector('#data-button');
  await page.clickSelector('.dialog button', 'إعادة البيانات التجريبية');
  await page.clickSelector('.dialog button', 'إعادة البيانات التجريبية');
  const reset = await page.eval(`const d = JSON.parse(localStorage.getItem('basira.v1')); return { n: d.requirements.length, sample: d.isSample };`);
  check('E-17', 'إعادة البيانات التجريبية من الحوار (AC-PER-05، إعادة اختبار B1)', reset.n === 6 && reset.sample === true, JSON.stringify(reset));

  // E-18 الطباعة: PDF لتقرير ما قبل الاجتماع
  await page.route('#/reports');
  const pdf = await page.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  const pdfPath = path.join(ARTIFACTS || tmp, 'phase3-print-meeting-report.pdf');
  fs.writeFileSync(pdfPath, Buffer.from(pdf.data, 'base64'));
  await page.send('Emulation.setEmulatedMedia', { media: 'print' });
  const printCss = await page.eval(`const vis = s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
    return { sidebar: vis('.sidebar'), topbar: vis('.topbar'), printBtn: vis('.page-actions'), report: vis('.report') };`);
  await page.send('Emulation.setEmulatedMedia', { media: '' });
  check('E-18', 'نسق الطباعة يخفي التنقل والأزرار ويُبقي التقرير (AC-RPT-04)', !printCss.sidebar && !printCss.topbar && !printCss.printBtn && printCss.report, JSON.stringify(printCss) + ' · PDF: ' + Math.round(fs.statSync(pdfPath).size / 1024) + 'KB');

  check('E-19', 'لا أخطاء في وحدة التحكم طوال السيناريوهات', !page.errors.length, page.errors.join(' | ') || 'صفر');
  await cdp.send('Target.closeTarget', { targetId: page.targetId });

  // E-20 تعذر التخزين في متصفح حقيقي (localStorage يرمي خطأ)
  const blocked = await openPage(cdp, { beforeLoadScript: "Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });" });
  await blocked.viewport(1280, 900, false);
  await blocked.goto(APP + '#/dashboard');
  const st = await blocked.eval(`return { warn: /الحفظ غير متاح/.test(document.body.textContent), h1: document.querySelector('#main h1').textContent, kpis: [...document.querySelectorAll('.kpi__value')].map(e => e.textContent).join(',') };`);
  check('E-20', 'تعذر التخزين: رسالة عربية والصفحة تعمل (AC-PER-06)', st.warn && st.h1 === 'لوحة القيادة' && st.kpis === '5,2,2,1,1', JSON.stringify(st));
  await cdp.send('Target.closeTarget', { targetId: blocked.targetId });

  // E-21..23 الوضع الافتراضي: بيانات العرض بتاريخ الجهاز
  const demo = await openPage(cdp);
  await demo.viewport(1280, 900, false);
  await demo.goto(DEMO + '#/dashboard');
  await demo.eval(`localStorage.removeItem('basira.v1');`); // ملف التعريف مشترك مع السيناريوهات السابقة
  await demo.goto(DEMO + '#/dashboard');
  // تُقرأ النتيجة من الواجهة المعروضة (بيانات العرض لا تُحفظ في التخزين قبل أول تعديل).
  const info = await demo.eval(`
    const kpis = [...document.querySelectorAll('.kpi')].map(k => k.querySelector('.kpi__label').textContent + '=' + k.querySelector('.kpi__value').textContent).join('، ');
    const banner = /بيانات تجريبية وهمية/.test(document.getElementById('banners').textContent);
    const visit = async h => { location.hash = h; await new Promise(r => setTimeout(r, 200)); return document.getElementById('main'); };
    let m = await visit('#/requirements');
    const reqCount = m.querySelector('.result-count').textContent;
    const assignees = [...m.querySelectorAll('td[data-label="المكلَّف"]')].map(td => td.textContent);
    const labels = [];
    for (const h of ['#/dashboard', '#/requirements', '#/entities', '#/followups', '#/followups?tab=decisions', '#/rankings']) {
      m = await visit(h); const hit = m.textContent.match(/وهمي|مكلف \\(|افتراضي/); if (hit) labels.push(h + ':' + hit[0]);
    }
    m = await visit('#/entities');
    const entities = m.querySelectorAll('tbody tr').length;
    m = await visit('#/rankings'); const arab = m.querySelectorAll('tbody tr').length;
    m = await visit('#/rankings?ranking=QS'); const qs = m.querySelectorAll('tbody tr').length;
    m = await visit('#/followups?tab=all'); const followUps = m.querySelectorAll('.timeline li').length;
    m = await visit('#/followups?tab=decisions'); const decisions = m.querySelectorAll('.decision-item').length;
    return { kpis, banner, reqCount, entities, indicators: arab + qs, followUps, decisions, labels, sampleAssignees: [...new Set(assignees)].slice(0, 4) };`);
  check('E-21', 'بيانات العرض تُحمَّل افتراضيًا بأسماء دون وسم «وهمي»، ويبقى الشريط العام',
    info.reqCount === 'عدد النتائج: 21 من 21' && info.entities === 9 && info.indicators === 14 && info.decisions === 4 && !info.labels.length && info.banner,
    info.reqCount + ' · جهات ' + info.entities + ' · مؤشرات ' + info.indicators + ' · متابعات ' + info.followUps + ' · أسئلة ' + info.decisions + ' · ' + info.kpis + ' · أمثلة: ' + info.sampleAssignees.join('، ') + (info.labels.length ? ' · وسوم: ' + info.labels.join(' ') : ''));
  check('E-22', 'بيانات العرض: كل المسارات على الحاسوب دون مشكلات', !(await sweep(demo)).length);
  await demo.viewport(375, 812, true);
  const demoMobile = await sweep(demo);
  check('E-23', 'بيانات العرض: كل المسارات على الجوال دون تمرير أفقي', !demoMobile.length, demoMobile.join(' ') || 'سليم');
  check('E-24', 'بيانات العرض: لا أخطاء في وحدة التحكم', !demo.errors.length, demo.errors.join(' | ') || 'صفر');
  await cdp.send('Target.closeTarget', { targetId: demo.targetId });
  return pdfPath;
}


// ---------- المرحلة 4: كل وظيفة بمدخلات صحيحة وخاطئة وحذف وعلاقات ----------
async function runPhase4(cdp) {
  const p = await openPage(cdp);
  await p.viewport(1280, 900, false);
  await p.goto(APP + '#/dashboard');
  await p.eval("localStorage.removeItem('basira.v1');");
  await p.goto(APP + '#/dashboard');
  const setv = (sel, v) => p.eval('const el = document.querySelector(' + JSON.stringify(sel) + '); el.value = ' + JSON.stringify(v) + '; el.dispatchEvent(new Event("change", { bubbles: true })); return true;');
  const err = id => p.eval('return (document.getElementById(' + JSON.stringify(id) + ') || {}).textContent || "";');
  const stored = () => p.eval("return JSON.parse(localStorage.getItem('basira.v1') || 'null');");
  const confirmDialog = label => p.clickSelector('.dialog button', label);

  // P4-01 إنشاء مؤشر، ورفض الرمز المكرر
  await p.route('#/indicators/new?ranking=ARAB');
  await setv('[name=domain]', 'البحث العلمي'); await setv('[name=code]', 'ar-res-1'); await setv('[name=name]', 'عدد البحوث المنشورة في Scopus');
  await p.clickSelector('form button[type=submit]');
  const created = await p.eval('return { hash: location.hash, h1: document.querySelector("#main h1").textContent };');
  await p.route('#/indicators/new?ranking=ARAB');
  await setv('[name=domain]', 'البحث العلمي'); await setv('[name=code]', 'AR-RES-1'); await setv('[name=name]', 'مؤشر مكرر الرمز');
  await p.clickSelector('form button[type=submit]');
  const dupErr = await err('n-code-error');
  check('P4-01', 'إنشاء مؤشر من النموذج، ورفض الرمز المكرر', created.hash === '#/indicators/ind-ar-res-1' && /مستخدم/.test(dupErr), created.hash + ' · ' + dupErr);

  // P4-02 موعد التسليم
  await p.route('#/rankings?ranking=ARAB');
  const before = await p.eval('return document.querySelector(".summary-row").textContent;');
  await p.eval('document.querySelector(".details-toggle").open = true;');
  await setv('[name=submissionDeadline]', '2026-11-15');
  await p.clickSelector('.details-toggle button[type=submit]');
  const after = await p.eval('return document.querySelector(".summary-row").textContent;');
  // حقل التاريخ في المتصفح لا يقبل تاريخًا غير موجود (يفرغه)، فرفض «2026-02-30» مفحوص في الفحوص الآلية.
  await p.eval('document.querySelector(".details-toggle").open = true;');
  await setv('[name=submissionDeadline]', '');
  await p.clickSelector('.details-toggle button[type=submit]');
  const cleared = await p.eval('return document.querySelector(".summary-row").textContent;');
  await p.eval('document.querySelector(".details-toggle").open = true;');
  await setv('[name=submissionDeadline]', '2026-11-10');
  await p.clickSelector('.details-toggle button[type=submit]');
  check('P4-02', 'تعديل موعد التسليم يحدّث الأيام المتبقية، وإفراغه يُظهر «لم يُحدد بعد»', /متبقٍ 9 أيام/.test(before) && /متبقٍ 14 يومًا/.test(after) && /لم يُحدد بعد/.test(cleared), 'قبل: 9 أيام ← بعد: 14 يومًا ← بعد الإفراغ: لم يُحدد');

  // P4-03 تعطيل مؤشر وأثره على العلاقات
  await p.route('#/indicators/ind-ar-edu-1');
  await p.clickSelector('#main .page-actions button', 'تعطيل المؤشر');
  const dlg = await p.eval('return document.querySelector(".dialog__body").textContent;');
  await confirmDialog('تعطيل المؤشر');
  const disabledBadge = await p.eval('return /معطل/.test(document.querySelector(".meta-line").textContent);');
  await p.route('#/requirements/new');
  const inNewForm = await p.eval('return !!document.querySelector("[name=indicatorId] option[value=\'ind-ar-edu-1\']");');
  await p.route('#/requirements/req-f1/edit');
  const inEditForm = await p.eval('return !!document.querySelector("[name=indicatorId] option[value=\'ind-ar-edu-1\']");');
  await p.route('#/rankings?ranking=ARAB');
  const listText = await p.eval('return document.querySelector("#main p.muted.small[aria-live]").textContent;');
  const arab = await p.eval('return document.querySelector(".summary-row").textContent;');
  check('P4-03', 'تعطيل المؤشر: تأكيد بالأثر، ويختفي من نموذج المتطلب الجديد ويبقى في تعديل متطلبه، ويخرج من الحسابات',
    /لن يُحذف/.test(dlg) && disabledBadge && !inNewForm && inEditForm && /منها 1 معطل/.test(listText) && /0 من 9/.test(arab), listText + ' · ' + arab.replace(/\s+/g, ' ').slice(0, 60));
  await p.route('#/indicators/ind-ar-edu-1');
  await p.clickSelector('#main .page-actions button', 'تفعيل المؤشر');
  await confirmDialog('تفعيل المؤشر');

  // P4-04 الجهات: مدخلات خاطئة، وإضافة، ومنع حذف المرتبطة، وحذف غير المرتبطة
  await p.route('#/entities/new');
  await setv('[name=name]', 'عمادة التقويم'); await setv('[name=contactRole]', 'data@uni.edu');
  await p.clickSelector('form button[type=submit]');
  const contactErr = await err('e-contact-error');
  await setv('[name=name]', '  وحده   البحث العلمي '); await setv('[name=contactRole]', '');
  await p.clickSelector('form button[type=submit]');
  const dupName = await err('e-name-error');
  await setv('[name=name]', 'عمادة التقويم'); await setv('[name=type]', 'deanship'); await setv('[name=contactRole]', 'مدير وحدة البيانات');
  await p.clickSelector('form button[type=submit]');
  const entHash = await p.eval('return location.hash;');
  await p.route('#/entities/ent-research');
  const blocked = await p.eval('const b = [...document.querySelectorAll("#main .page-actions button")].find(x => x.textContent === "حذف"); return { disabled: b.disabled, reason: document.getElementById("del-reason").textContent };');
  await p.route(entHash.replace('#', '#'));
  await p.clickSelector('#main .page-actions button', 'حذف');
  await confirmDialog('تأكيد الحذف');
  const afterDel = await p.eval('return { hash: location.hash, count: document.querySelectorAll("#main tbody tr").length };');
  check('P4-04', 'الجهات: رفض البريد والاسم المكرر، وإضافة، ومنع حذف المرتبطة، وحذف غير المرتبطة',
    /دون بريد أو هاتف/.test(contactErr) && /بالاسم نفسه/.test(dupName) && /^#\/entities\/ent-/.test(entHash) && blocked.disabled && /مرتبطة بـ 2/.test(blocked.reason) && afterDel.hash === '#/entities' && afterDel.count === 5,
    JSON.stringify(blocked) + ' · ' + JSON.stringify(afterDel));

  // P4-05 الأدلة: العلاقة بالمتطلب، والرابط الخاطئ، والرفض دون سبب، والتعديل يعيد التحقق
  await p.route('#/evidence/new?requirement=req-f5');
  const pre = await p.eval('return { ind: document.querySelector("[name=indicatorId]").value, req: document.querySelector("[name=requirementId]").value };');
  await setv('[name=title]', 'قائمة الأبحاث بروابط Scopus'); await setv('[name=type]', 'link'); await setv('[name=reference]', 'scopus list');
  await p.clickSelector('form button[type=submit]');
  const badLink = await err('v-reference-error');
  await setv('[name=reference]', 'https://example.org/scopus-list');
  await p.clickSelector('form button[type=submit]');
  const evHash = await p.eval('return location.hash;');
  const pending = await p.eval('return document.querySelector(".meta-line").textContent;');
  await p.clickSelector('form input[value=rejected]');
  await p.clickSelector('form button[type=submit]');
  const noReason = await err('rv-note-error');
  await setv('[name=note]', 'روابط DOI وليست Scopus');
  await p.clickSelector('form button[type=submit]');
  const rejected = await p.eval('return document.querySelector("#main .banner--danger") ? document.querySelector("#main .banner--danger").textContent : "";');
  await p.route(evHash + '/edit');
  await setv('[name=reference]', 'https://example.org/scopus-list-v2');
  await p.clickSelector('form button[type=submit]');
  const reset = await p.eval('return { status: document.querySelector(".meta-line").textContent, toast: [...document.querySelectorAll(".toast")].map(t => t.textContent).pop() };');
  check('P4-05', 'الأدلة: تعبئة المؤشر والمتطلب من الرابط، ورفض الرابط الخاطئ والرفض دون سبب، والتعديل يعيد «بانتظار التحقق»',
    pre.ind === 'ind-ar-edu-8' && pre.req === 'req-f5' && /https/.test(badLink) && /بانتظار التحقق/.test(pending) && /سبب الرفض/.test(noReason) && /روابط DOI/.test(rejected) && /بانتظار التحقق/.test(reset.status) && /عاد الدليل/.test(reset.toast),
    reset.toast);

  // P4-06 المتابعة بنتيجة وموعد تالٍ، والمستحقة الآن
  await p.route('#/requirements/req-f2');
  await setv('[name=note]', 'اتصال بالوحدة'); await setv('[name=outcome]', '');
  await p.clickSelector('#followups-title ~ div form button[type=submit]');
  const noOutcome = await err('fu-outcome-error');
  await setv('[name=outcome]', 'promised'); await setv('[name=nextActionDate]', TODAY); await setv('[name=date]', '2026-10-31');
  await p.clickSelector('#followups-title ~ div form button[type=submit]');
  const fuDiag = await p.eval('const f = [...document.querySelectorAll("form")].pop(); return { summary: (f.querySelector(".form-summary") || {}).textContent, errors: [...f.querySelectorAll(".field__error")].map(e => e.id + "=" + e.textContent).filter(x => !/=$/.test(x)), vals: { date: f.date.value, outcome: f.outcome.value, next: f.nextActionDate.value, note: f.note.value }, hash: location.hash };');
  const fuText = await p.eval('const li = document.querySelector(".timeline li"); return li ? li.textContent : "";');
  if (!fuText) console.log('تشخيص P4-06: ' + JSON.stringify(fuDiag));
  await p.route('#/followups?tab=due');
  const due = await p.eval('return { tab: document.querySelector(".tab[aria-selected=true]").textContent, rows: [...document.querySelectorAll(".timeline li a")].map(a => a.textContent) };');
  check('P4-06', 'متابعة: رفض غياب النتيجة، وتسجيل «وعد بالتسليم» بموعد تالٍ، وظهورها في «مستحقة الآن»',
    /نتيجة المتابعة/.test(noOutcome) && /وعد بالتسليم/.test(fuText) && /مستحقة الآن \(1\)/.test(due.tab) && due.rows.includes('بيانات الطلاب الدوليين'), due.tab + ' · ' + due.rows.join('/'));

  // P4-07 الأسئلة والقرارات
  await p.route('#/decisions/new?indicator=ind-ar-edu-7');
  await setv('[name=askedTo]', 'لجنة التصنيفات'); await setv('[name=question]', 'هل تُحتسب الاعتمادات المحلية؟'); await setv('[name=askedOn]', '2026-11-09');
  await p.clickSelector('form button[type=submit]');
  const futureQ = await err('q-asked-on-error');
  await setv('[name=askedOn]', '2026-10-29');
  await p.clickSelector('form button[type=submit]');
  const openCount = await p.eval('return document.querySelector(".tab[aria-selected=true]").textContent;');
  const resolveHref = await p.eval('const items = [...document.querySelectorAll(".decision-item")].filter(li => /الاعتمادات المحلية/.test(li.textContent)); return items[0].querySelector("a.btn").getAttribute("href");');
  await p.route(resolveHref);
  await setv('[name=decision]', 'الإقليمية والدولية فقط'); await setv('[name=decidedOn]', '2026-10-20');
  await p.clickSelector('form button[type=submit]');
  const earlyErr = await err('d-date-error');
  await setv('[name=decidedOn]', '2026-10-31');
  await p.clickSelector('form button[type=submit]');
  const resolved = await p.eval('return [...document.querySelectorAll(".decision-item")].filter(li => /الاعتمادات المحلية/.test(li.textContent))[0].textContent;');
  check('P4-07', 'سؤال: رفض التاريخ المستقبلي، والإضافة، ورفض قرار قبل تاريخ الطرح، ثم الحسم',
    /المستقبل/.test(futureQ) && /\(2 مفتوحة\)/.test(openCount) && /بعد تاريخ طرح/.test(earlyErr) && /محسوم/.test(resolved) && /الإقليمية والدولية فقط/.test(resolved), openCount);

  // P4-08 تغيير الحالة السريع وشرط الاكتمال
  await p.route('#/requirements/req-f6');
  await setv('#q-status', 'done');
  await p.clickSelector('.inline-form button[type=submit]');
  const blockedDone = await err('q-status-error');
  await setv('#q-status', 'in_progress');
  await p.clickSelector('.inline-form button[type=submit]');
  const changed = await p.eval('return document.querySelector(".meta-line").textContent;');
  check('P4-08', 'تغيير الحالة السريع: «مكتمل» مرفوض بسبب النواقص، و«قيد التنفيذ» مقبول', /لا يمكن إكمال المتطلب/.test(blockedDone) && /قيد التنفيذ/.test(changed), blockedDone);

  // P4-09 حذف متطلب له دليل: الدليل يبقى على المؤشر
  await p.route('#/requirements/req-f5');
  await p.clickSelector('#main .page-actions button', 'حذف');
  const delBody = await p.eval('return document.querySelector(".dialog__body").textContent;');
  await confirmDialog('تأكيد الحذف');
  const d9 = await stored();
  const ev = d9.evidence.find(e => e.title === 'قائمة الأبحاث بروابط Scopus');
  check('P4-09', 'حذف متطلب له دليل: التأكيد يذكر الدليل، والدليل يبقى على المؤشر دون ربط',
    /لن تُحذف/.test(delBody) && !d9.requirements.some(r => r.id === 'req-f5') && ev && ev.requirementId === '' && ev.indicatorId === 'ind-ar-edu-8', delBody.slice(0, 90));

  // P4-10 سجل الأنشطة
  await p.route('#/activity');
  const log = await p.eval('return { count: document.querySelector(".result-count").textContent, first: document.querySelector(".timeline li p:nth-child(2)").textContent, deleted: [...document.querySelectorAll(".timeline li")].some(li => /حُذف المتطلب/.test(li.textContent) && /\\(محذوف\\)/.test(li.textContent)) };');
  await setv('[name=type]', 'entity'); await sleep(200);
  const entLog = await p.eval('return [...document.querySelectorAll(".timeline li p:nth-child(2)")].map(x => x.textContent);');
  const n = +((log.count.match(/\d+/) || [0])[0]);
  check('P4-10', 'سجل الأنشطة: كل العمليات الناجحة مسجلة، والمحذوف «(محذوف)»، والتصفية حسب النوع',
    // 16 عملية ناجحة بالضبط في السيناريوهات P4-01..09، و9 محاولات فاشلة متعمدة لم تُسجَّل (AC-LOG-02)
    n === 16 && log.deleted && entLog.length === 2 && entLog.every(t => /الجهة/.test(t)), log.count + ' · آخر نشاط: ' + log.first);

  // P4-11 الاستمرار بعد التحديث
  const snapshot = await stored();
  await p.goto(APP + '#/evidence');
  const again = await stored();
  const evRows = await p.eval('return document.querySelectorAll("#main tbody tr").length;');
  check('P4-11', 'كل التغييرات باقية بعد إعادة التحميل', JSON.stringify(again) === JSON.stringify(snapshot) && evRows === 1 && again.schemaVersion === 2, 'أدلة: ' + evRows + ' · أنشطة: ' + again.activities.length);

  // P4-12 استيراد نسخة v1 عبر حقل الملف
  const v1 = JSON.parse(JSON.stringify(again));
  v1.schemaVersion = 1; delete v1.rankings; delete v1.evidence; delete v1.activities;
  const v1Path = require('path').join(require('os').tmpdir(), 'basira-v1-' + Date.now() + '.json');
  fs.writeFileSync(v1Path, JSON.stringify(v1));
  await p.clickSelector('#data-button');
  const { root } = await p.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
  await p.send('DOM.setFileInputFiles', { nodeId, files: [v1Path] });
  await sleep(400);
  const v1Body = await p.eval('return document.querySelector(".dialog__body").textContent;');
  await confirmDialog('استبدال البيانات');
  const migrated = await stored();
  fs.rmSync(v1Path, { force: true });
  check('P4-12', 'استيراد نسخة بالإصدار 1: التأكيد يذكر الترقية، وتُحفظ بالإصدار 2 ويُسجَّل الاستيراد',
    /الإصدار 1 وسيُرقّى/.test(v1Body) && migrated.schemaVersion === 2 && migrated.rankings.length === 2 && /رُقّيت من الإصدار 1/.test(migrated.activities[0].summary), migrated.activities[0].summary);

  check('P4-13', 'لا أخطاء في وحدة التحكم طوال سيناريوهات المرحلة 4', !p.errors.length, p.errors.join(' | ') || 'صفر');
  await cdp.send('Target.closeTarget', { targetId: p.targetId });
}

// ---------- المرحلة 5: محرك التحليل التشغيلي والخطابات والتصدير ----------
// القيم المتوقعة محسوبة مسبقًا يدويًا (docs/design/09 §6) على بيانات الفحص في 2026-11-01.
async function runPhase5(cdp, tmp) {
  const p = await openPage(cdp);
  await p.viewport(1280, 900, false);
  // كل طلبات الشبكة تُرصد: المتوقع ألا يخرج أي طلب عن file:// وblob: وdata: (AC-COM-09)
  const requests = [];
  cdp.on(m => { if (m.sessionId === p.sessionId && m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url); });
  await p.send('Network.enable');
  await p.goto(APP + '#/dashboard');
  await p.eval("localStorage.removeItem('basira.v1');");
  await p.goto(APP + '#/dashboard');
  const setv = (sel, v) => p.eval('const el = document.querySelector(' + JSON.stringify(sel) + '); el.value = ' + JSON.stringify(v) + '; el.dispatchEvent(new Event("change", { bubbles: true })); return true;');
  const stored = () => p.eval("return JSON.parse(localStorage.getItem('basira.v1') || 'null');");
  const confirmDialog = label => p.clickSelector('.dialog button', label);
  const ranking = () => p.eval('return [...document.querySelectorAll(".ranked__item")].map(li => li.dataset.req.replace("req-", "") + ":" + li.querySelector(".ranked__score strong").textContent).join(" ");');
  const kpis = () => p.eval('return [...document.querySelectorAll(".insights .kpi__value")].map(e => e.textContent).join(" ");');
  const dlDir = path.join(tmp, 'downloads');
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });
  async function waitFile(name) {
    for (let i = 0; i < 40; i++) { if (fs.existsSync(path.join(dlDir, name))) { await sleep(150); return fs.readFileSync(path.join(dlDir, name), 'utf8'); } await sleep(150); }
    return null;
  }

  // P5-01 لوحة القيادة: بطاقة التنبيهات من المحرك
  const dash = await p.eval('const c = document.querySelector(".alerts-card"); return c ? c.querySelector("h2").textContent + " | " + c.querySelectorAll("li").length : "";');
  check('P5-01', 'لوحة القيادة: «3 عاجل و2 للمتابعة» وأهم 3 تنبيهات', /3 عاجل، و2 للمتابعة/.test(dash) && / \| 3$/.test(dash), dash);

  // P5-02 صفحة التحليل: الأرقام والترتيب المحسوبان مسبقًا، وتمييز القواعد عن الذكاء الاصطناعي
  await p.clickSelector('.alerts-card a.more-link');
  const ins = await p.eval('return { hash: location.hash, notice: document.querySelector(".rules-notice").textContent };');
  const r0 = await ranking();
  const k0 = await kpis();
  check('P5-02', 'التحليل التشغيلي: الملخص 3/2/5/17% والترتيب F6:97 F1:92 F2:66 F5:40 F4:10، مع تنبيه «قواعد حسابية، لا ذكاء اصطناعي»',
    ins.hash === '#/insights' && k0 === '3 2 5 17%' && r0 === 'f6:97 f1:92 f2:66 f5:40 f4:10' && /لا ذكاء اصطناعي/.test(ins.notice) && /لا يُستخدم نموذج لغوي/.test(ins.notice), k0 + ' · ' + r0);

  // P5-03 تفسير الدرجة: نقرة على «لماذا هذه الدرجة؟»
  await p.clickSelector('.ranked__item summary');
  const why = await p.eval('const d = document.querySelector(".ranked__item details"); return { open: d.open, pts: [...d.querySelectorAll(".factors__pts")].map(e => e.textContent).join(" ") };');
  check('P5-03', 'تفسير درجة F6: +57 +20 +10 +10 = 97', why.open && why.pts === '+57 +20 +10 +10 97', why.pts);

  // P5-04 الرسوم مرتبطة بالبيانات (القيم مكتوبة نصًا)
  const chartText = await p.eval('return [...document.querySelectorAll(".chart")].map(c => c.querySelector(".chart__title").textContent + "=" + [...c.querySelectorAll(".chart__value")].map(v => v.textContent).join("/")).join(" | ");');
  check('P5-04', 'الرسوم تعرض قيم البيانات: جاهزية العربي 11%، والموعد 2/2/0/1/0/1، والحالة 2/1/2/1',
    /جاهزية المؤشرات حسب التصنيف=11% \(مُدخل 0 من 9\)\/0%/.test(chartText) && /المتطلبات حسب الموعد=2\/2\/0\/1\/0\/1/.test(chartText) && /المتطلبات حسب الحالة=2\/1\/2\/1/.test(chartText), chartText.slice(0, 160));

  // P5-05 التحديث عند تغيير البيانات: متابعة على F6 من نموذجها الحقيقي
  await p.route('#/requirements/req-f6');
  await setv('#followups-title ~ div form [name=outcome]', 'promised');
  await p.clickSelector('#followups-title ~ div form [name=note]');
  await p.typeText('وعدت الجهة بإرسال الردود');
  await p.clickSelector('#followups-title ~ div form button[type=submit]');
  const nextF6 = await p.eval('return document.getElementById("score").textContent;');
  await p.route('#/insights');
  const r1 = await ranking();
  check('P5-05', 'بعد متابعة على F6: درجتها 87 فورًا في صفحتها، وF1 يصعد إلى الأول في التحليل', nextF6 === '87' && r1 === 'f1:92 f6:87 f2:66 f5:40 f4:10', 'F6=' + nextF6 + ' · ' + r1);

  // P5-06 إكمال F1 من نموذج التعديل: تتغير النسب والتنبيهات والرسوم
  await p.route('#/requirements/req-f1/edit');
  await setv('[name=missingData]', '');
  await setv('[name=evidenceLink]', 'https://example.org/basira/f1');
  await setv('[name=status]', 'done');
  await p.clickSelector('form button[type=submit]');
  await p.route('#/insights');
  const k2 = await kpis();
  const r2 = await ranking();
  const overdueBar = await p.eval('return [...document.querySelectorAll(".chart")].find(c => /حسب الموعد/.test(c.textContent)).querySelector(".chart__value").textContent;');
  check('P5-06', 'بعد إكمال F1: الإنجاز 33%، وتنبيهان عاجلان، وعمود «متأخر» = 1، وF1 خارج الترتيب', k2 === '2 2 4 33%' && r2 === 'f6:87 f2:66 f5:40 f4:10' && overdueBar === '1', k2 + ' · ' + r2 + ' · متأخر=' + overdueBar);

  // P5-07 خطاب جهة البحث العلمي (AC-COM-01): المستوى المقترح والبنود وقيمة العام الماضي، وتعديل المسودة
  await p.route('#/entities/ent-research');
  await p.clickSelector('#entity-letter');
  const letter = await p.eval('return { hash: location.hash, sel: document.querySelector("[name=level]").value, body: document.querySelector(".letter__editor").value, items: document.querySelectorAll(".letters-page .compact-list li").length };');
  await p.eval('const t = document.querySelector(".letter__editor"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true;');
  await p.typeText('\nملاحظة مضافة للتجربة');
  const preview = await p.eval('return document.querySelector(".letter__body").textContent.endsWith("ملاحظة مضافة للتجربة");');
  check('P5-07', 'خطاب البحث العلمي من صفحة الجهة: L0، وبندان (F5 ثم F4) مع قيمة العام الماضي 90، والتعديل يظهر في نسخة الطباعة',
    letter.sel === 'L0' && letter.items === 2 && /قيمة العام الماضي للتأكيد أو التحديث: 90/.test(letter.body) && letter.body.indexOf('أعداد البحوث') < letter.body.indexOf('إحصاءات الاستشهادات') && preview, letter.hash);

  // P5-08 النسخ إلى الحافظة
  await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
  await p.clickSelector('.letters-page button', 'نسخ النص');
  await sleep(300);
  const copied = await p.eval('const t = [...document.querySelectorAll(".toast")].map(x => x.textContent).pop() || ""; let clip = ""; try { clip = await navigator.clipboard.readText(); } catch (e) { clip = "ERR " + e.message; } return { t, clip };');
  check('P5-08', '«نسخ النص» يضع الموضوع والنص المعدّل في الحافظة', /نُسخ نص الخطاب/.test(copied.t) && copied.clip.startsWith('الموضوع: طلب استكمال بيانات') && copied.clip.endsWith('ملاحظة مضافة للتجربة'), copied.t + ' · ' + copied.clip.slice(0, 40));

  // P5-09 الطباعة: الخطاب وحده (AC-COM-02)
  await p.send('Emulation.setEmulatedMedia', { media: 'print' });
  const printView = await p.eval('const vis = s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }; return { letter: vis(".letter"), editor: vis(".letter__editor"), nav: vis(".sidebar"), head: vis(".letters-page .page-head"), items: vis(".letters-page .grid > .stack") };');
  await p.send('Emulation.setEmulatedMedia', { media: '' });
  check('P5-09', 'معاينة الطباعة: يظهر الخطاب فقط، دون المحرر والتنقل والعنوان والبنود الجانبية', printView.letter && !printView.editor && !printView.nav && !printView.head && !printView.items, JSON.stringify(printView));

  // P5-10 «تسجيل الإرسال» (AC-COM-03)
  await p.clickSelector('#record-sent');
  const recBody = await p.eval('return document.querySelector(".dialog__body").textContent;');
  await confirmDialog('تسجيل الإرسال');
  const s1 = await stored();
  const f5 = s1.requirements.find(r => r.id === 'req-f5').followUps.slice(-1)[0];
  await p.route('#/requirements/req-f5');
  const f5next = await p.eval('return document.getElementById("next-step").textContent;');
  check('P5-10', '«تسجيل الإرسال»: متابعة L0 بموعد تالٍ 2026-11-05 لـ F5، ونشاط letter_sent، والخطوة التالية «انتظار… L1»',
    /بندان/.test(recBody) && f5 && f5.escalationLevel === 0 && f5.nextActionDate === '2026-11-05' && s1.activities[0].action === 'letter_sent' && /انتظار رد الجهة.*L1/.test(f5next), f5next.trim());

  // P5-11 قوالب الخطابات: رفض المتغير غير المعروف، ثم الحفظ والاستخدام والاستعادة
  await p.route('#/letters/templates');
  const tplBefore = JSON.stringify((await stored()).settings || null);
  await setv('[data-template=L1] [name=body]', 'تذكير إلى {الجهة} بالبنود {البنودد} قبل الموعد');
  await p.clickSelector('[data-template=L1] button[type=submit]');
  const tplErr = await p.eval('return (document.getElementById("t-L1-body-error") || {}).textContent || "";');
  const tplSame = JSON.stringify((await stored()).settings || null) === tplBefore;
  await setv('[data-template=L1] [name=body]', 'تذكير مخصص إلى {الجهة}:\n{البنود}');
  await p.clickSelector('[data-template=L1] button[type=submit]');
  const badge = await p.eval('return document.querySelector("#tpl-L1").parentElement.querySelector(".meta-line").textContent;');
  await p.route('#/letters?entity=ent-research&level=L1');
  const custom = await p.eval('return document.querySelector(".letter__editor").value;');
  await p.route('#/letters/templates');
  await p.clickSelector('[data-template=L1] button', 'استعادة النص الافتراضي');
  await confirmDialog('استعادة');
  const restored = await stored();
  check('P5-11', 'القوالب: {البنودد} يُرفض دون حفظ، والقالب المعدل يُستخدم في الخطاب، ثم يُستعاد الافتراضي',
    /متغيرات غير معروفة: \{البنودد\}/.test(tplErr) && tplSame && /معدّل/.test(badge) && custom.startsWith('تذكير مخصص إلى وحدة البحث العلمي:') && !restored.settings.letterTemplates.L1,
    tplErr);

  // P5-12 تصدير CSV حقيقي من التقارير ومن التحليل
  await p.route('#/reports?type=priorities');
  await p.clickSelector('#export-csv');
  const csv1 = await waitFile('basira-priorities-' + TODAY + '.csv');
  await p.route('#/reports?type=response');
  await p.clickSelector('#export-csv');
  const csv2 = await waitFile('basira-response-' + TODAY + '.csv');
  const lines1 = csv1 ? csv1.split('\r\n').filter(Boolean) : [];
  check('P5-12', 'تصدير CSV: ملف الأولويات (BOM + رأس + 4 صفوف، أولها F6 بدرجة 87) وملف استجابة الجهات',
    csv1 && csv1.charCodeAt(0) === 0xFEFF && lines1.length === 5 && lines1[1].startsWith('"1","87","بيانات الخبراء') && csv2 && /"وحدة الشراكات الدولية","1","1","100%"/.test(csv2),
    (lines1[1] || 'لا ملف').slice(0, 50));

  // P5-13 لا طلبات شبكة خارج الملفات المحلية، ولا أخطاء
  const external = requests.filter(u => !/^(file|blob|data|about|chrome-extension|devtools):/.test(u));
  check('P5-13', 'لا أي طلب شبكة خارجي أثناء التحليل والخطابات والنسخ والطباعة والتصدير (AC-COM-09)', requests.length > 0 && !external.length, external.join(', ') || requests.length + ' طلبًا محليًا فقط');
  check('P5-14', 'لا أخطاء في وحدة التحكم طوال سيناريوهات المرحلة 5', !p.errors.length, p.errors.join(' | ') || 'صفر');
  await cdp.send('Target.closeTarget', { targetId: p.targetId });
}

// ---------- التشغيل ----------
async function main() {
  const browser = CANDIDATES.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (!browser) { console.error('لم يُعثر على Edge أو Chrome. حدد المسار في BASIRA_BROWSER.'); process.exit(2); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'basira-e2e-'));
  const profile = path.join(tmp, 'profile');
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let cdp;
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100);
      try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch { /* لم يجهز بعد */ }
    }
    if (!port) throw new Error('لم يبدأ المتصفح في وضع التحكم');
    const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
    console.log('المتصفح: ' + version.Browser + ' · الصفحة: ' + APP + '\n');
    cdp = createClient(version.webSocketDebuggerUrl);
    await cdp.opened;
    const pdfPath = await run(cdp, tmp);
    await runPhase4(cdp);
    await runPhase5(cdp, tmp);
    if (ARTIFACTS) console.log('\nPDF الطباعة: ' + pdfPath);
  } catch (err) {
    check('E-ERR', 'خطأ في تشغيل الفحص', false, err.message);
  } finally {
    if (cdp) { try { await cdp.send('Browser.close'); } catch { /* أُغلق */ } cdp.close(); }
    // انتظار خروج المتصفح فعلًا قبل حذف ملف التعريف المؤقت (كانت ملفاته مقفلة فيبقى المجلد).
    const exited = new Promise(res => (proc.exitCode !== null ? res() : proc.once('exit', res)));
    if (proc.exitCode === null) proc.kill();
    await withTimeout(exited, 10000, 'إغلاق المتصفح').catch(() => {});
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { console.log('تنبيه: تعذر حذف المجلد المؤقت ' + tmp + ': ' + e.message); }
  }
  const failed = results.filter(r => !r.ok);
  console.log('\nالنتيجة: ' + (results.length - failed.length) + ' ناجح، ' + failed.length + ' فاشل من ' + results.length);
  process.exit(failed.length ? 1 : 0);
}

main();
