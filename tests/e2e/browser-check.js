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
let BROWSER_NAME = '';
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
  '#/insights', '#/letters', '#/letters?entity=ent-hr&level=L2', '#/letters/templates', '#/reports?type=priorities', '#/reports?type=response',
  // المرحلة 6
  '#/calculate'];

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
  const netLog = [];
  cdp.on(m => { if (m.sessionId === page.sessionId && m.method === 'Network.requestWillBeSent') netLog.push(m.params.request.url); });
  await page.send('Network.enable');

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
  const outsideE = netLog.filter(u => !/^(file|blob|data|about|devtools):/.test(u));
  check('E-25', 'لا أي طلب شبكة خارجي في سيناريوهات الإقلاع والبحث والإضافة والتصدير والاستيراد والطباعة (AC-SEC-02)', netLog.length > 0 && !outsideE.length, outsideE.join(', ') || netLog.length + ' طلبًا محليًا فقط');
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

  // P5-15 تصدير قائمة المتطلبات المصفاة (AC-RPT-07): الحالة «بانتظار الجهة» = F6 ثم F2، ودون تصفية = كل المتطلبات
  await p.route('#/requirements?status=waiting');
  const note = await p.eval('return document.querySelector(".filters").textContent;');
  await p.clickSelector('#export-requirements');
  const csv3 = await waitFile('basira-requirements-filtered-' + TODAY + '.csv');
  await p.route('#/requirements');
  await p.clickSelector('#export-requirements');
  const csv4 = await waitFile('basira-requirements-' + TODAY + '.csv');
  const total = (await stored()).requirements.length;
  const lines3 = csv3 ? csv3.split('\r\n').filter(Boolean) : [];
  const lines4 = csv4 ? csv4.split('\r\n').filter(Boolean) : [];
  check('P5-15', 'تصدير المتطلبات المصفاة: الظاهر فقط وبترتيبه (F6 ثم F2)، ودون تصفية كل المتطلبات، والواجهة تذكر ذلك (AC-RPT-07)',
    /النتائج الظاهرة فقط/.test(note) && csv3 && csv3.charCodeAt(0) === 0xFEFF && lines3.length === 3 &&
    lines3[1].startsWith('"بيانات الخبراء المنتدبين') && lines3[2].startsWith('"بيانات الطلاب الدوليين') && lines4.length === total + 1,
    lines3.length - 1 + ' مصفاة، و' + (lines4.length - 1) + ' من ' + total + ' دون تصفية');

  // P5-13 لا طلبات شبكة خارج الملفات المحلية، ولا أخطاء
  const external = requests.filter(u => !/^(file|blob|data|about|chrome-extension|devtools):/.test(u));
  check('P5-13', 'لا أي طلب شبكة خارجي أثناء التحليل والخطابات والنسخ والطباعة والتصدير (AC-COM-09)', requests.length > 0 && !external.length, external.join(', ') || requests.length + ' طلبًا محليًا فقط');
  check('P5-14', 'لا أخطاء في وحدة التحكم طوال سيناريوهات المرحلة 5', !p.errors.length, p.errors.join(' | ') || 'صفر');
  await cdp.send('Target.closeTarget', { targetId: p.targetId });
}

// ---------- التحقق الشامل قبل التسليم ----------
// مرجع مستقل للأرقام: يُحسب هنا في Node من البيانات نفسها بمنطق مكتوب من جديد، لا بدوال التطبيق.
function oracle(data, today) {
  const add7 = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
  const activeIds = new Set(data.indicators.filter(i => i.active !== false).map(i => i.id));
  const open = data.requirements.filter(r => r.status !== 'done');
  const overdue = open.filter(r => r.deadline < today);
  const soon = open.filter(r => r.deadline >= today && r.deadline <= add7);
  const conflicts = data.indicators.filter(i => String(i.currentValue || '').trim() && String(i.progressFileValue || '').trim() && String(i.currentValue).trim() !== String(i.progressFileValue).trim());
  const pct = (a, b) => (b ? Math.round(100 * a / b) : null);
  const W = { not_started: 0, draft: 1 / 3, evidenced: 2 / 3, entered: 1 };
  const rankings = {};
  for (const rk of data.rankings) {
    const inds = data.indicators.filter(i => i.ranking === rk.id && i.active !== false);
    const reqs = data.requirements.filter(r => inds.some(i => i.id === r.indicatorId));
    rankings[rk.id] = {
      progress: pct(reqs.filter(r => r.status === 'done').length, reqs.length),
      readiness: inds.length ? Math.round(100 * inds.reduce((s, i) => s + W[i.workStatus], 0) / inds.length) : null
    };
  }
  const entities = {};
  for (const e of data.entities) {
    const o = open.filter(r => r.entityId === e.id);
    if (o.length) entities[e.name] = o.length + ' مفتوح · ' + o.filter(r => r.deadline < today).length + ' متأخر';
  }
  return {
    kpis: [open.length, overdue.length, soon.length, conflicts.length, data.decisions.filter(q => q.status === 'open').length].join(','),
    rankings, entities, activeIds: activeIds.size,
    overall: pct(data.requirements.filter(r => r.status === 'done').length, data.requirements.length),
    byStatus: ['new', 'in_progress', 'waiting', 'done'].map(s => data.requirements.filter(r => r.status === s).length).join('/')
  };
}

async function runQA(cdp) {
  const p = await openPage(cdp);
  await p.viewport(1280, 900, false);
  const qaRequests = [];
  cdp.on(m => { if (m.sessionId === p.sessionId && m.method === 'Network.requestWillBeSent') qaRequests.push(m.params.request.url); });
  await p.send('Network.enable');
  await p.goto(APP + '#/dashboard');
  await p.eval("localStorage.removeItem('basira.v1');");
  await p.goto(APP + '#/dashboard');
  const setv = (sel, v) => p.eval('const el = document.querySelector(' + JSON.stringify(sel) + '); el.value = ' + JSON.stringify(v) + '; el.dispatchEvent(new Event("change", { bubbles: true })); return true;');
  const stored = () => p.eval("return JSON.parse(localStorage.getItem('basira.v1') || 'null');");
  const rowIds = () => p.eval('return [...document.querySelectorAll("#main .row-link")].map(a => decodeURIComponent(a.getAttribute("href").split("/").pop())).sort().join(",");');
  // ضغطة كاملة (keyDown بنص) كما تفعل لوحة المفاتيح الحقيقية: Enter بلا نص لا يرسل النموذج ضمنيًا.
  const press = async (key, vk, shift) => {
    const k = { key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0, text: key === 'Enter' ? String.fromCharCode(13) : undefined };
    await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, k));
    await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, k));
    await sleep(120);
  };
  const textOf = sel => p.eval('const e = document.querySelector(' + JSON.stringify(sel) + '); return e ? e.textContent.replace(/\\s+/g, " ").trim() : "";');

  // Q-01 كل رابط داخلي في كل صفحة يفتح صفحة صحيحة
  const hrefs = new Set();
  for (const r of ROUTES) {
    await p.route(r);
    (await p.eval('return [...document.querySelectorAll("a[href^=\'#/\']")].map(a => a.getAttribute("href"));')).forEach(h => hrefs.add(h));
  }
  const badLinks = [];
  for (const href of hrefs) {
    await p.route('#/dashboard');
    await p.route(href);
    const st = await p.eval(`const m = document.getElementById('main'); return { hash: location.hash, h1: !!m.querySelector('h1'), crash: /تعذر عرض هذه الصفحة/.test(m.textContent),
      notFound: [...document.querySelectorAll('.toast')].some(t => /الصفحة غير موجودة/.test(t.textContent)) };`);
    if (!st.h1 || st.crash || st.notFound) badLinks.push(href + JSON.stringify(st));
  }
  const ext = await p.eval('return [...document.querySelectorAll("a[href^=\'http\']")].filter(a => a.target !== "_blank" || !/noopener/.test(a.rel)).length;');
  check('Q-01', 'كل رابط داخلي في كل الصفحات يفتح صفحة بعنوان دون انهيار ودون «الصفحة غير موجودة»', !badLinks.length && hrefs.size > 40 && ext === 0, hrefs.size + ' رابطًا فريدًا' + (badLinks.length ? ' · معطوبة: ' + badLinks.join(' ') : ''));

  // Q-02 كل زر مربوط بوظيفة (مستمع نقر، أو إرسال نموذج له مستمع، أو تسمية لحقل، أو ملخص قابل للطي)، وله اسم مقروء
  const dead = [];
  let buttons = 0;
  for (const r of ROUTES) {
    await p.route(r);
    const n = await p.eval(`const els = [...document.querySelectorAll('button, summary, label.btn, [role=button]')].filter(e => e.offsetParent || e.getClientRects().length);
      window.__qa = els; return els.length;`);
    for (let i = 0; i < n; i++) {
      const info = await p.eval(`const e = window.__qa[${i}]; return { tag: e.tagName, type: e.type || '', disabled: !!e.disabled, name: (e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
        forOk: e.tagName === 'LABEL' ? !!document.getElementById(e.htmlFor) : null, reason: e.getAttribute('aria-describedby') ? !!document.getElementById(e.getAttribute('aria-describedby')) : false, inForm: !!e.form };`);
      buttons++;
      if (!info.name) { dead.push(r + ' زر بلا اسم'); continue; }
      if (info.tag === 'SUMMARY') continue;
      if (info.tag === 'LABEL') { if (!info.forOk) dead.push(r + ' «' + info.name + '» تسمية بلا حقل'); continue; }
      if (info.disabled) { if (!info.reason) dead.push(r + ' «' + info.name + '» معطل دون سبب'); continue; }
      const own = await p.send('Runtime.evaluate', { expression: `window.__qa[${i}]` });
      const ls = await p.send('DOMDebugger.getEventListeners', { objectId: own.result.objectId });
      let wired = ls.listeners.some(l => l.type === 'click');
      if (!wired && info.type === 'submit' && info.inForm) {
        const form = await p.send('Runtime.evaluate', { expression: `window.__qa[${i}].form` });
        const fl = await p.send('DOMDebugger.getEventListeners', { objectId: form.result.objectId });
        wired = fl.listeners.some(l => l.type === 'submit');
      }
      if (!wired) dead.push(r + ' «' + info.name + '»');
    }
  }
  check('Q-02', 'كل زر ظاهر في كل الصفحات مربوط بوظيفة وله اسم (AC-UI-07)', !dead.length && buttons > 100, buttons + ' زرًا مفحوصًا' + (dead.length ? ' · بلا وظيفة: ' + dead.join(' | ') : ''));

  // Q-03 دقة الأرقام مقابل مرجع مستقل (البيانات الأولية)
  const fixture = require(path.join(ROOT, 'data', 'sample-data.js')).createSampleData();
  async function compareWithOracle(data, label) {
    const o = oracle(data, TODAY);
    await p.route('#/dashboard');
    const ui = await p.eval(`return { kpis: [...document.querySelectorAll('nav.kpis .kpi__value')].map(e => e.textContent).join(','),
      cards: [...document.querySelectorAll('.rank-card')].map(c => [...c.querySelectorAll('.progress__value')].map(v => v.textContent).join('/')),
      ents: Object.fromEntries([...document.querySelectorAll('.entity-bars__row')].map(r => [r.querySelector('.entity-bars__name').textContent, r.querySelector('.entity-bars__text').textContent])) };`);
    await p.route('#/insights');
    const ins = await p.eval(`return { overall: document.querySelector('#kpi-overall .kpi__value').textContent,
      status: [...document.querySelectorAll('.chart')].find(c => /حسب الحالة/.test(c.textContent)).querySelectorAll('.chart__value') ? [...[...document.querySelectorAll('.chart')].find(c => /حسب الحالة/.test(c.textContent)).querySelectorAll('.chart__value')].map(v => v.textContent).join('/') : '' };`);
    const fmt = v => (v === null ? '—' : v + '%');
    const expCards = ['ARAB', 'QS'].filter(k => o.rankings[k]).map(k => fmt(o.rankings[k].readiness) + '/' + fmt(o.rankings[k].progress));
    const ok = ui.kpis === o.kpis && JSON.stringify(ui.cards) === JSON.stringify(expCards) && JSON.stringify(Object.entries(ui.ents).sort()) === JSON.stringify(Object.entries(o.entities).sort()) &&
      ins.overall === fmt(o.overall) && ins.status === o.byStatus;
    return { ok, detail: label + ': KPI ' + ui.kpis + ' (المرجع ' + o.kpis + ') · بطاقات ' + ui.cards.join(' ، ') + ' (المرجع ' + expCards.join(' ، ') + ') · الكلي ' + ins.overall + ' · الحالات ' + ins.status + (ok ? '' : ' · جهات UI ' + JSON.stringify(ui.ents) + ' مرجع ' + JSON.stringify(o.entities)) };
  }
  const acc1 = await compareWithOracle(fixture, 'البيانات الأولية');
  check('Q-03', 'دقة الإحصاءات: لوحة القيادة والتحليل تطابق مرجعًا مستقلًا محسوبًا في Node (AC-PRG-01/02، AC-DEC-03، AC-RPT-01/02)', acc1.ok, acc1.detail);

  // Q-04 إضافة متطلب متأخر بلوحة المفاتيح فقط، ثم مطابقة الأرقام بعد التغيير
  await p.route('#/requirements/new');
  await p.eval('document.getElementById("r-title").focus(); return true;');
  await p.typeText('متطلب مضاف بلوحة المفاتيح');
  const tabOrder = [];
  for (let i = 0; i < 14; i++) {
    await p.key('Tab', 'Tab', 9);
    tabOrder.push(await p.eval('const a = document.activeElement; return a.name || a.textContent.trim().slice(0, 12);'));
  }
  // Enter داخل حقل العنوان يرسل النموذج، فتظهر أخطاء الحقول الناقصة ولا يُحفظ شيء
  await p.eval('document.getElementById("r-title").focus(); return true;');
  await press('Enter', 13);
  const enterErr = await p.eval('return { ind: (document.getElementById("r-indicator-error") || {}).textContent || "", saved: !!localStorage.getItem("basira.v1") };');
  // اختيار المؤشر والجهة بالأسهم، وكتابة التاريخ بالأرقام
  for (const id of ['r-indicator', 'r-entity']) {
    await p.eval('document.getElementById("' + id + '").focus(); return true;');
    const k = { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 };
    await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, k));
    await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, k));
    await sleep(80);
  }
  await p.eval('document.getElementById("r-deadline").focus(); return true;');
  // ترتيب حقول التاريخ في المتصفح المختبر: يوم/شهر/سنة
  for (const ch of '30102026') {
    const k = { key: ch, code: 'Digit' + ch, text: ch, windowsVirtualKeyCode: 48 + Number(ch), nativeVirtualKeyCode: 48 + Number(ch) };
    await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, k));
    await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, k));
    await sleep(40);
  }
  const formVals = await p.eval('return ["r-indicator", "r-entity", "r-deadline"].map(id => document.getElementById(id).value).join(" | ");');
  await p.eval('document.getElementById("r-title").focus(); return true;');
  await press('Enter', 13);
  const kb = await p.eval('return { hash: location.hash, n: (JSON.parse(localStorage.getItem("basira.v1") || "{}").requirements || []).length, errs: [...document.querySelectorAll(".field__error, .form-summary")].map(e => e.textContent).filter(Boolean).join(" / ") };');
  check('Q-04', 'لوحة المفاتيح فقط: الانتقال بين حقول نموذج المتطلب بـ Tab، وEnter يرسل، والأسهم تختار، والكتابة تملأ التاريخ (AC-UI-05، AC-CRUD-01)',
    /يرجى اختيار المؤشر/.test(enterErr.ind) && !enterErr.saved && kb.n === 7 && /^#\/requirements\/req-/.test(kb.hash) && tabOrder.includes('indicatorId') && tabOrder.includes('entityId') && tabOrder.includes('deadline'),
    'ترتيب Tab: ' + tabOrder.join(' ← ') + ' · القيم: ' + formVals + ' · ' + kb.hash + (kb.errs ? ' · أخطاء: ' + kb.errs : ''));
  const acc2 = kb.n === 7 ? await compareWithOracle(await stored(), 'بعد الإضافة') : { ok: false, detail: 'لم يُحفظ المتطلب في Q-04، فلا مقارنة' };
  check('Q-05', 'دقة الإحصاءات بعد إضافة متطلب: الأرقام تتحدث وتطابق المرجع المستقل', acc2.ok, acc2.detail);

  // Q-06 حذف بلوحة المفاتيح: Esc يلغي، وEnter على «تأكيد الحذف» يحذف (AC-CRUD-03، AC-CRUD-04)
  const newId = kb.hash.split('/').pop();
  await p.route(kb.hash);
  await p.eval('[...document.querySelectorAll("#main .page-actions button")].find(b => b.textContent.trim() === "حذف").focus(); return true;');
  await press('Enter', 13);
  const dlgFocus = await p.eval('return document.getElementById("dialog").open + ":" + document.activeElement.textContent.trim();');
  await press('Escape', 27);
  await sleep(150);
  const afterEsc = (await stored()).requirements.length;
  await p.eval('[...document.querySelectorAll("#main .page-actions button")].find(b => b.textContent.trim() === "حذف").focus(); return true;');
  await press('Enter', 13);
  await press('Tab', 9, true);
  const onConfirm = await p.eval('return document.activeElement.textContent.trim();');
  await press('Enter', 13);
  await sleep(250);
  const afterDel = await stored();
  await p.route('#/requirements');
  const listCount = await textOf('.result-count');
  check('Q-06', 'الحذف بلوحة المفاتيح: التركيز على «إلغاء»، وEsc لا يحذف، وShift+Tab ثم Enter على «تأكيد الحذف» يحذف وينقص العدد',
    dlgFocus === 'true:إلغاء' && afterEsc === 7 && onConfirm === 'تأكيد الحذف' && afterDel.requirements.length === 6 && !afterDel.requirements.some(r => r.id === newId) && listCount === 'عدد النتائج: 6 من 6',
    dlgFocus + ' · بعد Esc: ' + afterEsc + ' · ' + onConfirm + ' · ' + listCount);

  // Q-07 تعديل F4 من التغيير السريع دون تغيير بقية الحقول (AC-CRUD-02)
  const f4Before = (await stored()).requirements.find(r => r.id === 'req-f4');
  await p.route('#/requirements/req-f4');
  await setv('#q-status', 'in_progress');
  await p.clickSelector('.inline-form button[type=submit]');
  const f4After = (await stored()).requirements.find(r => r.id === 'req-f4');
  const same = Object.keys(f4Before).filter(k => !['status', 'updatedAt'].includes(k)).every(k => JSON.stringify(f4Before[k]) === JSON.stringify(f4After[k]));
  await p.route('#/requirements?status=in_progress');
  const inProg = await rowIds();
  check('Q-07', 'تعديل حالة F4 إلى «قيد التنفيذ»: تتغير الحالة في القائمة دون تغيير بقية الحقول (AC-CRUD-02)', f4After.status === 'in_progress' && same && inProg === 'req-f1,req-f4', inProg);

  // Q-08 البحث والتصفية: ترتيب الخطوات، والعداد، و«مسح الكل»، ورسالة «لا نتائج» وزرها
  await p.route('#/requirements');
  await setv('#f-ranking', 'ARAB');
  await p.clickSelector('#q'); await p.typeText('بيانات');
  const a1 = await rowIds();
  const c1 = await textOf('.result-count');
  await p.route('#/dashboard'); await p.route('#/requirements');
  await p.clickSelector('#q'); await p.typeText('بيانات');
  await setv('#f-ranking', 'ARAB');
  const a2 = await rowIds();
  await setv('#f-priority', 'high'); await setv('#f-due', 'overdue');
  await p.clickSelector('.filters__actions button', 'مسح الكل');
  const cleared = await p.eval('return { q: document.getElementById("q").value, sel: [...document.querySelectorAll(".filters select")].filter(s => s.name !== "sort").map(s => s.value).join(""), count: document.querySelector(".result-count").textContent, focus: document.activeElement.id, hash: location.hash };');
  await p.clickSelector('#q'); await p.typeText('براكين');
  const empty = await textOf('#main .empty');
  await p.clickSelector('#main .empty button');
  const afterEmpty = await textOf('.result-count');
  check('Q-08', 'البحث والتصفية: الترتيبان يعطيان النتيجة نفسها، والعداد صحيح، و«مسح الكل» يعيد الكل، و«لا نتائج» مع زر يعمل (AC-FLT-08/09/10، AC-SRCH-03)',
    a1 === a2 && a1 === 'req-f6' && c1 === 'عدد النتائج: 1 من 6' && cleared.q === '' && cleared.sel === '' && cleared.count === 'عدد النتائج: 6 من 6' && cleared.focus === 'q' && /لا توجد نتائج مطابقة/.test(empty) && afterEmpty === 'عدد النتائج: 6 من 6',
    'تصفية ثم بحث: ' + a1 + ' · بحث ثم تصفية: ' + a2 + ' · ' + c1 + ' · بعد المسح: ' + cleared.count + ' (' + cleared.hash + ')');

  // Q-09 المتابعات: الترتيب والاستمرار و«آخر متابعة» ورفض الفارغة (AC-FUP-01/02/03/04/05)
  await p.route('#/requirements/req-f2');
  const fuForm = '#followups-title ~ div form ';
  await setv(fuForm + '[name=outcome]', 'promised');
  await p.clickSelector(fuForm + 'button[type=submit]');
  const emptyNote = await p.eval('return (document.getElementById("fu-note-error") || {}).textContent || "";');
  await setv(fuForm + '[name=date]', '2026-10-28'); await setv(fuForm + '[name=outcome]', 'no_reply');
  await p.clickSelector(fuForm + '[name=note]'); await p.typeText('اتصال أول بالجهة');
  await p.clickSelector(fuForm + 'button[type=submit]');
  await setv(fuForm + '[name=date]', '2026-10-31'); await setv(fuForm + '[name=outcome]', 'promised');
  await p.clickSelector(fuForm + '[name=note]'); await p.typeText('وعد بالتسليم خلال يومين');
  await p.clickSelector(fuForm + 'button[type=submit]');
  await p.goto(APP + '#/requirements/req-f2');
  const timeline = await p.eval('return [...document.querySelectorAll(".timeline > li")].map(li => li.querySelector("p:nth-child(2)").textContent);');
  await p.route('#/requirements?q=' + encodeURIComponent('الدوليين'));
  const lastCol = await p.eval('const row = document.querySelector("#main tbody tr"); return row ? row.lastElementChild.textContent : "";');
  check('Q-09', 'المتابعات: الفارغة تُرفض، والأحدث أولًا، وتبقى بعد إعادة التحميل، وعمود «آخر متابعة» يعرض تاريخ الأحدث',
    /الملاحظة/.test(emptyNote) && timeline[0] === 'وعد بالتسليم خلال يومين' && timeline[1] === 'اتصال أول بالجهة' && /31/.test(lastCol), 'الرفض: ' + emptyNote + ' · الترتيب: ' + timeline.join(' ← ') + ' · آخر متابعة: ' + lastCol);

  // Q-10 محتوى الصفحات: التجميع، والعام الماضي، والتعارض، وتقرير الاجتماع، والشارات النصية، والمسار المجهول، وF3 المكتمل دون دليل
  await p.route('#/rankings?ranking=ARAB');
  const groups = await p.eval('return { heads: [...document.querySelectorAll("#main h2, #main h3")].map(e => e.textContent).filter(t => /التعليم والتعلم/.test(t)).length, rows: document.querySelectorAll("#main .row-link, #main tbody tr").length };');
  await p.route('#/indicators/ind-ar-edu-1');
  const ind1 = await textOf('#main');
  await p.route('#/indicators/ind-ar-edu-8');
  const ind8 = await textOf('#main');
  await p.route('#/reports');
  const meeting = await p.eval('const row = [...document.querySelectorAll("#main tbody tr")].find(tr => /AR-EDU-1/.test(tr.textContent)); return row ? row.textContent : "";');
  await p.route('#/requirements');
  const badges = await p.eval('return [...document.querySelectorAll("#main .badge")].map(b => b.textContent).filter(t => /متأخر|قريب/.test(t)).length;');
  await p.route('#/does-not-exist');
  await sleep(200);
  const nf = await p.eval('return { hash: location.hash, toast: [...document.querySelectorAll(".toast")].map(t => t.textContent).join(" ") };');
  await p.route('#/requirements/req-f3');
  const f3 = await textOf('#conditions, #main .checklist');
  check('Q-10', 'المحتوى: تجميع المؤشرات بالمعيار، والعام الماضي، ووسم التعارض، وتقرير الاجتماع (I1 بتعارض وF1 متأخر)، وشارات نصية، والمسار المجهول، وF3 المكتمل يُظهر «لا يوجد رابط دليل»',
    groups.heads >= 1 && /1:19/.test(ind1) && /يختلف عن ملف التقدم|تعارض/.test(ind1) && !/يختلف عن ملف التقدم/.test(ind8) && /تعارض/.test(meeting) && /متأخر/.test(meeting) && badges >= 4 &&
    nf.hash === '#/dashboard' && /الصفحة غير موجودة/.test(nf.toast) && /لا يوجد رابط دليل/.test(f3),
    'شارات المواعيد: ' + badges + ' · المسار المجهول ← ' + nf.hash + ' · F3: «' + f3 + '»');

  // Q-11 العربية وRTL في كل الصفحات: لا كلمات لاتينية خارج المصطلحات المسموحة، ولا undefined/NaN/null
  // المصطلحات المسموحة: الصيغ، وأسماء المنصات، وأسماء الملفات والأعمدة كما في الملفات المصدرية (RANK_DESC، وTop 500 authors by h-index).
  const ALLOWED = /^(QS|CSV|JSON|Scopus|SciVal|FTE|Excel|PDF|UTF|BOM|AARU|L[0-4]|Tab|https?|example|org|basira|evidence|ar|edu|xlsx|xls|FAQ|HEQS|Top|authors|by|index|RANK|DESC|EMPLOYEE|ID|Windows|csv|scopus|com)$/i;
  const leaks = [];
  async function scanArabic(label) {
    for (const r of ROUTES) {
      await p.route(r);
      const res = await p.eval(`const texts = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) { const n = w.currentNode; const el = n.parentElement; if (!el || el.closest('script,style,svg,code,.visually-hidden') || !el.getClientRects().length) continue; texts.push(n.textContent); }
        document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(e => ['placeholder', 'aria-label', 'title'].forEach(a => { if (e.getAttribute(a)) texts.push(e.getAttribute(a)); }));
        return { dir: document.documentElement.dir, mainDir: getComputedStyle(document.getElementById('main')).direction, text: texts.join(' \\n ') };`);
      const cleaned = res.text.replace(/https?:\/\/\S+/g, ' ').replace(/\b[A-Z]{2,}(-[A-Z0-9]+)+\b/g, ' ').replace(/basira-[\w-]+\.(json|csv)/g, ' ');
      const words = (cleaned.match(/[A-Za-z][A-Za-z]+/g) || []).filter(x => !ALLOWED.test(x));
      if (res.dir !== 'rtl' || res.mainDir !== 'rtl') leaks.push(label + r + ' اتجاه ' + res.dir + '/' + res.mainDir);
      if (words.length) leaks.push(label + r + ': ' + [...new Set(words)].join(','));
      if (/\b(undefined|NaN|null)\b|\[object/.test(res.text)) leaks.push(label + r + ': قيمة برمجية ظاهرة');
    }
  }
  await scanArabic('');
  await p.goto(DEMO + '#/dashboard');
  await scanArabic('عرض ');
  check('Q-11', 'العربية وRTL في كل الصفحات (بيانات الفحص وبيانات العرض): الاتجاه rtl، ولا نصوص إنجليزية خارج المصطلحات، ولا قيم برمجية ظاهرة (AC-UI-02/03)', !leaks.length, leaks.join(' | ') || (ROUTES.length * 2) + ' صفحة');

  // Q-12 الجوال: أهداف اللمس ≥ 24px وحجم الخط ≥ 12px في كل الصفحات
  await p.goto(APP + '#/dashboard');
  await p.viewport(375, 812, true);
  const small = [];
  for (const r of ROUTES) {
    await p.route(r);
    const res = await p.eval(`const out = []; document.querySelectorAll('button, select, input:not([type=hidden]), textarea, summary, .btn, .bnav__link, .nav__link').forEach(e => {
        if (e.closest('.visually-hidden') || !e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') return; const lab = e.matches('input[type=checkbox], input[type=radio]') && e.closest('label'); const b = (lab || e).getBoundingClientRect(); if (b.width === 0) return;
        if (b.height < 24 || b.width < 24) out.push((e.textContent || e.name || e.tagName).trim().slice(0, 20) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height)); });
      const tiny = [...document.querySelectorAll('#main *')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 12).length;
      return { out, tiny };`);
    if (res.out.length || res.tiny) small.push(r + ' ' + res.out.join(',') + (res.tiny ? ' خط صغير=' + res.tiny : ''));
  }
  await p.viewport(1280, 900, false);
  check('Q-12', 'الجوال 375: كل أهداف اللمس 24px فأكثر، ولا نص أصغر من 12px، في كل الصفحات', !small.length, small.join(' | ') || ROUTES.length + ' صفحة');

  // Q-14 عمود «متطلبات مفتوحة» لكل مؤشر يطابق المرجع المستقل (AC-IND-01، AC-RPT-03)
  const nowData = await stored();
  const openBy = {};
  nowData.requirements.filter(r => r.status !== 'done').forEach(r => { openBy[r.indicatorId] = (openBy[r.indicatorId] || 0) + 1; });
  const indMismatch = [];
  for (const rk of ['ARAB', 'QS']) {
    await p.route('#/rankings?ranking=' + rk);
    const cells = await p.eval(`return [...document.querySelectorAll('#main tbody tr')].map(tr => { const a = tr.querySelector('a.row-link'); const td = tr.querySelectorAll('td'); return [decodeURIComponent(a.getAttribute('href').split('/').pop()), td[td.length - 1].textContent.trim(), td[2].textContent.trim()]; });`);
    cells.forEach(([id, n, work]) => { if (String(openBy[id] || 0) !== n || !work) indMismatch.push(id + ':' + n + '≠' + (openBy[id] || 0)); });
    if (!cells.length) indMismatch.push(rk + ': لا صفوف');
  }
  check('Q-14', 'المؤشرات: لكل مؤشر حالة عمل وعدد متطلبات مفتوحة يطابق المرجع المستقل، في التصنيفين (AC-IND-01، AC-RPT-03)', !indMismatch.length, indMismatch.join(' ') || 'كل الصفوف مطابقة (' + Object.values(openBy).reduce((a, b) => a + b, 0) + ' مفتوحًا)');

  // Q-15 تقرير ما قبل الاجتماع يذكر سؤال D1 المفتوح في «قرارات مطلوبة» (AC-RPT-08)
  await p.route('#/reports?type=meeting&ranking=ARAB');
  const decisionsPart = await p.eval('const h = [...document.querySelectorAll("#main h3")].find(e => /قرارات مطلوبة/.test(e.textContent)); return h && h.nextElementSibling ? h.nextElementSibling.textContent : "";');
  check('Q-15', 'تقرير ما قبل الاجتماع: قسم «قرارات مطلوبة» يذكر سؤال D1 لمؤشر AR-EDU-1 (AC-RPT-08)', /AR-EDU-1/.test(decisionsPart) && /أي رقم نعتمد لعدد أعضاء هيئة التدريس/.test(decisionsPart), decisionsPart.slice(0, 90));

  // Q-16 «إعادة البيانات التجريبية» ثم «إلغاء» لا يغيّر شيئًا (AC-PER-05)
  const beforeReset = await p.eval("return localStorage.getItem('basira.v1');");
  await p.clickSelector('#data-button');
  await p.clickSelector('.dialog button', 'إعادة البيانات التجريبية');
  const resetDlg = await p.eval('return document.querySelector(".dialog__title").textContent;');
  await p.clickSelector('.dialog button', 'إلغاء');
  await sleep(200);
  const afterCancel = await p.eval("return localStorage.getItem('basira.v1');");
  check('Q-16', '«إعادة البيانات التجريبية» ثم «إلغاء»: لا يتغير أي شيء في البيانات المحفوظة (AC-PER-05)', /إعادة البيانات التجريبية/.test(resetDlg) && afterCancel === beforeReset && !!beforeReset, resetDlg + ' ← بلا تغيير: ' + (afterCancel === beforeReset));

  const outside = qaRequests.filter(u => !/^(file|blob|data|about|devtools):/.test(u));
  check('Q-17', 'لا أي طلب شبكة خارجي طوال التحقق الشامل (كل الصفحات والعمليات)', qaRequests.length > 0 && !outside.length, outside.join(', ') || qaRequests.length + ' طلبًا محليًا فقط');
  check('Q-13', 'لا أخطاء في وحدة التحكم طوال التحقق الشامل', !p.errors.length, p.errors.join(' | ') || 'صفر');
  await cdp.send('Target.closeTarget', { targetId: p.targetId });
}

// ---------- المرحلة 6: صفحة مصادر البيانات والحساب (رفع ملفات حقيقي) ----------
// أرشيف ZIP صحيح لبناء ملفات xlsx وهمية في المجلد المؤقت (نفس منطق tests/engine.test.js).
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function zipFiles(files) {
  const zlib = require('node:zlib');
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8'), data = zlib.deflateRawSync(raw), nm = Buffer.from(name, 'utf8'), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm); offset += lh.length + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
function xlsxBuffer(rows, emptyRows) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let xml = rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => v === '' ? '' : (/^-?\d+(\.\d+)?$/.test(v)
    ? '<c r="' + String.fromCharCode(65 + ci) + (ri + 1) + '"><v>' + v + '</v></c>'
    : '<c r="' + String.fromCharCode(65 + ci) + (ri + 1) + '" t="inlineStr"><is><t>' + esc(v) + '</t></is></c>')).join('') + '</row>').join('');
  const parts = [xml];
  for (let k = 0; k < (emptyRows || 0); k++) { const rn = rows.length + 1 + k; parts.push('<row r="' + rn + '" spans="1:14" s="3" customFormat="1"><c r="A' + rn + '" s="3"/><c r="B' + rn + '" s="3"/></row>'); }
  return zipFiles([
    ['xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="البيانات" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData>' + parts.join('') + '</sheetData></worksheet>']
  ]);
}

async function runCalc(cdp, tmp) {
  const p = await openPage(cdp);
  await p.viewport(1280, 900, false);
  const requests = [];
  cdp.on(m => { if (m.sessionId === p.sessionId && m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url); });
  await p.send('Network.enable');
  await p.goto(APP + '#/dashboard');
  await p.eval("localStorage.removeItem('basira.v1');");
  await p.goto(APP + '#/calculate');
  const FIX = path.join(ROOT, 'tests', 'fixtures');
  const stored = () => p.eval("return JSON.parse(localStorage.getItem('basira.v1') || 'null');");
  const txt = sel => p.eval('const e = document.querySelector(' + JSON.stringify(sel) + '); return e ? e.textContent.replace(/\\s+/g, " ").trim() : "";');
  const status = slot => txt('[data-slot="' + slot + '"] .slot__status, [data-slot="' + slot + '"] .banner');
  async function upload(slot, file) {
    const { root } = await p.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-' + slot.replace(/[^A-Za-z0-9_-]/g, '_') });
    const t0 = Date.now();
    await p.send('DOM.setFileInputFiles', { nodeId, files: [file] });
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      const s = await status(slot);
      if (/مرفوع|لم يُقرأ|غير مدعومة|القديمة|ليس بصيغة/.test(s)) return { ms: Date.now() - t0, status: s };
    }
    return { ms: Date.now() - t0, status: 'انتهت المهلة' };
  }
  // يضمن أن المربع مختار (قد يكون مختارًا تلقائيًا من قبل): لا ينقر إلا إذا لم يكن مختارًا.
  const tick = async (name, values) => {
    for (const v of values) {
      const sel = 'input[name="' + name + '"][value="' + v + '"]';
      if (!(await p.eval('return document.querySelector(' + JSON.stringify(sel) + ').checked;'))) await p.clickSelector(sel);
    }
  };
  const row = code => p.eval('const tr = document.querySelector(\'tr[data-key="' + code + '"]\'); return tr ? tr.textContent.replace(/\\s+/g, " ").trim() : "";');
  const calc = async () => { await p.clickSelector('#calc-run'); await sleep(300); };
  // قيمة خانة «المحسوبة» وحدها (القيمة، أو «لم تُحسب» مع الخطأ)
  const val = code => p.eval(`const tr = document.querySelector('tr[data-key="${code}"]'); return tr ? tr.children[1].textContent.replace(/\\s+/g, ' ').trim() : '';`);
  const dlDir = path.join(tmp, 'downloads');
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });

  // C6-01 رفع أربعة ملفات من حقل الملف الحقيقي، واكتشاف سطر العناوين 13
  const ups = [];
  for (const [slot, f] of [['admission', 'admission.csv'], ['graduate', 'graduate.csv'], ['faculty', 'faculty.csv'], ['top500', 'top500.csv']]) ups.push(await upload(slot, path.join(FIX, f)));
  check('C6-01', 'رفع 4 ملفات CSV من حقل الملف: الحالة وعدد الصفوف، وسطر العناوين 13 في Top 500 (AC-CALC-01)',
    /admission\.csv · 3 صفوف · سطر العناوين 1/.test(ups[0].status) && /faculty\.csv · 10 صفوف/.test(ups[2].status) && /top500\.csv · 15 صفًا · سطر العناوين 13 · 6 أعمدة · UTF-8/.test(ups[3].status), ups.map(u => u.status).join(' | '));

  // C6-02 تغيير سطر العناوين يدويًا ثم إعادته
  await p.eval('document.getElementById("hdr-top500").value = "1"; return true;');
  await p.clickSelector('[data-slot="top500"] .inline-form button', 'تطبيق');
  const hdr1 = await txt('[data-slot="top500"] .slot__cols');
  await p.eval('document.getElementById("hdr-top500").value = "13"; return true;');
  await p.clickSelector('[data-slot="top500"] .inline-form button', 'تطبيق');
  const hdr13 = await txt('[data-slot="top500"] .slot__cols');
  check('C6-02', 'تغيير سطر العناوين يدويًا يغيّر الأعمدة، والعودة إلى 13 تعيدها (AC-CALC-01)', /Top authors by h-index/.test(hdr1) && /h-index/.test(hdr13) && !/Top authors/.test(hdr13), hdr13);

  // C6-03 اختيار البنود والرتب بنقرات حقيقية، ثم «احسب»
  await tick('items-admissionStudents', ['طلبة الدبلوم', 'طلبة البكالوريوس']);
  await tick('items-graduateStudents', ['طلبة الدبلوم العالي', 'طلبة الماجستير', 'طلبة الدكتوراه']);
  await tick('values-facultyFull', ['أستاذ', 'أستاذ مشارك', 'أستاذ مساعد', 'محاضر', 'معيد']);
  await tick('values-phdHolders', ['أستاذ', 'أستاذ مشارك', 'أستاذ مساعد']);
  await calc();
  const r1 = await row('AR-EDU-1'), r2 = await row('AR-EDU-2'), r5 = await row('AR-EDU-5'), r3 = await row('AR-EDU-3');
  check('C6-03', 'الحساب من الواجهة: المؤشر 1 «1:18.8» بتعارض مع ملف التقدم و«تحسّن 1%» وتنبيه FTE، والمؤشر 2 «1:25»، والمؤشر 5 «11»، والناقص «ينقصه» (AC-CALC-02/04/05/07/09)',
    /1:18\.8/.test(r1) && /تعارض/.test(r1) && /تحسّن 1%/.test(r1) && /س10/.test(r1) && /1:25/.test(r2) && (await val('AR-EDU-5')) === '11' && /العتبة المستخدمة 10/.test(r5) && /ينقصه: ملف المؤشر AR-EDU-3/.test(r3),
    r1.slice(0, 160));

  // C6-04 ما حُفظ: الإعداد والوصف والنتائج فقط، ولا اسم ولا معرّف من الملفات (AC-CALC-11)
  const raw = await p.eval("return localStorage.getItem('basira.v1');");
  const st = JSON.parse(raw);
  const secrets = [];
  const SRC = require(path.join(ROOT, 'js', 'sources.js'));
  for (const f of ['faculty.csv', 'top500.csv']) {
    const t = SRC.tableFromCSV(fs.readFileSync(path.join(FIX, f), 'utf8'));
    for (const col of ['NAME', 'Name', 'EMPLOYEE_ID', 'Scopus author ID']) { const v = SRC.column(t, col); if (v) secrets.push(...v); }
  }
  const leaked = secrets.filter(s => raw.includes(s));
  const cyc = st.calc && st.calc.cycles[0];
  check('C6-04', 'الحفظ بعد «احسب»: الإعداد ووصف 4 ملفات وتشغيل واحد، ولا أي اسم أو معرّف من 50 قيمة شخصية وهمية (AC-CALC-11)',
    cyc && cyc.runs.length === 1 && cyc.sources.length === 4 && cyc.inputs.find(i => i.key === 'facultyFull').args.values.length === 5 && !leaked.length,
    'المسرّب: ' + (leaked.join('، ') || 'لا شيء') + ' · الملفات: ' + (cyc ? cyc.sources.map(s => s.fileName + ':' + s.rowCount).join('، ') : '—'));

  // C6-05 «اعتماد القيمة»: الإلغاء لا يغيّر شيئًا، والتأكيد يحدّث القيمة والمصدر فقط (AC-CALC-10، AC-GAP-01)
  await p.clickSelector('button.approve[data-code="AR-EDU-1"]');
  const dlg = await txt('.dialog__body');
  await p.clickSelector('.dialog button', 'إلغاء');
  const afterCancel = (await stored()).indicators.find(i => i.code === 'AR-EDU-1').currentValue;
  await p.clickSelector('button.approve[data-code="AR-EDU-1"]');
  await p.clickSelector('.dialog button', 'اعتماد القيمة');
  const s5 = await stored();
  const i1 = s5.indicators.find(i => i.code === 'AR-EDU-1');
  const approvedCell = await row('AR-EDU-1');
  check('C6-05', '«اعتماد القيمة»: التأكيد يذكر القيمتين، و«إلغاء» لا يغيّر شيئًا، والتأكيد يحدّث القيمة والمصدر دون حالة العمل، ويُسجَّل (AC-CALC-10، AC-GAP-01)',
    /«1:18\.8» بدل «1:15»/.test(dlg) && afterCancel === '1:15' && i1.currentValue === '1:18.8' && /^محسوب في بصيرة/.test(i1.valueSource) && i1.workStatus === 'evidenced' && s5.activities[0].action === 'calc_approve' && /معتمدة/.test(approvedCell),
    'بعد الإلغاء: ' + afterCancel + ' · بعد الاعتماد: ' + i1.currentValue + ' · المصدر: ' + i1.valueSource.slice(0, 60));

  // C6-06 متطلب من تنبيه FTE، والضغط مرة ثانية لا يكرره (AC-GAP-02)
  const nBefore = (await stored()).requirements.length;
  await p.clickSelector('tr[data-key="AR-EDU-1"] .make-req');
  const reqDlg = await txt('.dialog__body');
  await p.clickSelector('.dialog button', 'إنشاء المتطلب');
  const s6 = await stored();
  const made = s6.requirements.find(r => r.title === 'بيانات أعضاء هيئة التدريس غير المتفرغين');
  await p.route('#/calculate');
  await p.clickSelector('tr[data-key="AR-EDU-1"] .make-req');
  await sleep(300);
  const dup = await p.eval('return { hash: location.hash, toast: [...document.querySelectorAll(".toast")].map(t => t.textContent).join(" "), n: JSON.parse(localStorage.getItem("basira.v1")).requirements.length };');
  check('C6-06', 'متطلب من تنبيه FTE: التأكيد يذكر الموارد البشرية، فيُنشأ متطلب واحد، والضغط الثاني يفتح الموجود دون تكرار (AC-GAP-02)',
    /وحدة الموارد البشرية/.test(reqDlg) && made && made.entityId === 'ent-hr' && s6.requirements.length === nBefore + 1 && dup.n === nBefore + 1 && /لم يُنشأ متطلب مكرر/.test(dup.toast) && dup.hash === '#/requirements/' + made.id,
    reqDlg.slice(0, 80) + ' · ' + dup.hash);

  // C6-07 إدخال يدوي لغير المتفرغين (الملفات باقية في ذاكرة الصفحة بعد التنقل)
  await p.route('#/calculate');
  const still = await status('faculty');
  await p.eval('document.getElementById("manual-fix").open = true; return true;');
  await p.clickSelector('#manual-facultyPart'); await p.typeText('3');
  await p.clickSelector('#reason-facultyPart'); await p.typeText('كشف وهمي من الموارد البشرية');
  await calc();
  const r1b = await row('AR-EDU-1');
  check('C6-07', 'غير المتفرغين = 3 بسبب مكتوب: المؤشر 1 «1:16.7» ويختفي تنبيه FTE، والملفات باقية في الذاكرة بعد التنقل (AC-CALC-07)', /مرفوع/.test(still) && /1:16\.7/.test(r1b) && !/س10/.test(r1b), r1b.slice(0, 100));

  // C6-08 ملف بلا العمود المطلوب في خانة المحاضرين ← رسالة تسمي العمود ولا حساب (AC-CALC-12)
  await upload('faculty', path.join(FIX, 'staff-b.csv'));
  await calc();
  const r1c = await row('AR-EDU-1');
  const r5c = await row('AR-EDU-5');
  check('C6-08', 'ملف محاضرين بلا «RANK_DESC»: المؤشر 1 لم يُحسب برسالة تسمي العمود، والمؤشر 5 يُحسب (AC-CALC-12)', /لم تُحسب/.test(r1c) && /العمود «RANK_DESC» غير موجود/.test(r1c) && (await val('AR-EDU-5')) === '11', r1c.slice(0, 120));

  // C6-09 ملف .xls القديم يُرفض برسالة إرشادية (AC-CALC-15)
  const xlsPath = path.join(tmp, 'المحاضرون القديم.xls');
  fs.writeFileSync(xlsPath, Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0, 0, 0]));
  const xu = await upload('top500', xlsPath);
  check('C6-09', 'رفع .xls: رسالة «حفظ باسم» بالعربية ولا يُقرأ (AC-CALC-15)', /بصيغة .xls القديمة/.test(xu.status) && /حفظ باسم/.test(xu.status) && /مصنف Excel/.test(xu.status), xu.status.slice(0, 100));
  await upload('top500', path.join(FIX, 'top500.csv'));

  // C6-10 xlsx حقيقي عبر حقل الملف: 1000 صف فارغ منسق، والنتيجة نفسها (AC-GAP-07)
  const facRows = SRC.parseCSV(fs.readFileSync(path.join(FIX, 'faculty.csv'), 'utf8'));
  const xlsxPath = path.join(tmp, 'faculty.xlsx');
  fs.writeFileSync(xlsxPath, xlsxBuffer(facRows, 1000));
  const xl = await upload('faculty', xlsxPath);
  await calc();
  const r1d = await row('AR-EDU-1');
  check('C6-10', 'رفع xlsx فيه 1000 صف فارغ منسق: «faculty.xlsx · 10 صفوف»، والمؤشر 1 «1:16.7» كما في CSV (AC-GAP-07)', /faculty\.xlsx · 10 صفوف/.test(xl.status) && /الورقة: البيانات/.test(xl.status) && /1:16\.7/.test(r1d), xl.status);

  // C6-11 فحوص الجودة ونطاق الروابط في نموذجين (AC-CALC-14، AC-GAP-04)
  await upload('ind:AR-EDU-3', path.join(FIX, 'quality.csv'));
  const q3 = await txt('[data-slot="ind:AR-EDU-3"] .quality');
  await upload('ind:AR-EDU-8', path.join(FIX, 'links.csv'));
  // لا اختيار أعمدة: يُعد النموذج تلقائيًا ويُكتشف عمود الروابط تلقائيًا
  await calc();
  const r8 = await row('AR-EDU-8'), r3b = await row('AR-EDU-3');
  check('C6-11', 'الجودة: «3 صفوف فارغة في آخر الملف (من الصف 10)»، ونطاق الروابط: المؤشر 8 «5» مع «2 مخالفة … (الصفوف 3، 5)» (AC-CALC-14، AC-GAP-04)',
    /3 صفوف فارغة في آخر الملف \(من الصف 10\)/.test(q3) && (await val('AR-EDU-8')) === '5' && /2 مخالفة للنطاق scopus\.com \(الصفوف 3، 5\)/.test(r8) && (await val('AR-EDU-3')) === '8', q3 + ' · ' + r8.slice(0, 80));

  // C6-12 تصدير تقرير الحساب CSV
  await p.clickSelector('#calc-export');
  let csv = null;
  for (let i = 0; i < 40 && !csv; i++) { await sleep(150); const f = path.join(dlDir, 'basira-calculation-' + TODAY + '.csv'); if (fs.existsSync(f)) { await sleep(150); csv = fs.readFileSync(f, 'utf8'); } }
  const lines = csv ? csv.split('\r\n').filter(Boolean) : [];
  check('C6-12', 'تصدير تقرير الحساب: CSV بترميز UTF-8 مع BOM، ورأس و12 مؤشرًا، وAR-EDU-1 بقيمته ومقارنته', csv && csv.charCodeAt(0) === 0xFEFF && lines.length === 13 && /"AR-EDU-1",".*","1:16\.7","1:11","نعم","1:19"/.test(lines[1]), (lines[1] || 'لا ملف').slice(0, 90));

  // C6-13 إعادة التحميل: الملفات تختفي من الذاكرة، وتبقى آخر نتائج محفوظة دون إنشاء متطلبات
  await p.goto(APP + '#/calculate');
  const after = await p.eval('return { meta: (document.getElementById("results-meta") || {}).textContent || "", slot: document.querySelector(\'[data-slot="faculty"]\').textContent, makeReq: document.querySelectorAll(".make-req").length, r1: (document.querySelector(\'tr[data-key="AR-EDU-1"]\') || {}).textContent || "" };');
  check('C6-13', 'بعد إعادة التحميل: «يلزم رفعه من جديد» للملفات، وتُعرض نتائج آخر تشغيل محفوظ، ولا أزرار متطلبات من نتائج محفوظة',
    /نتائج آخر حساب محفوظ/.test(after.meta) && /آخر ملف استُخدم: «faculty\.xlsx»/.test(after.slot) && /يلزم رفعه من جديد/.test(after.slot) && after.makeReq === 0 && /1:16\.7/.test(after.r1), after.meta);

  // C6-14 الأداء في المتصفح: CSV بـ 100 ألف صف و300 ألف صف فارغ، وxlsx فيه نحو 300 ألف صف فارغ منسق
  let big = 'EMPLOYEE_ID,RANK_DESC,NAME\n';
  for (let i = 0; i < 100000; i++) big += 'X' + i + ',' + (i % 10 === 0 ? 'فني' : 'أستاذ') + ',اسم-وهمي-' + i + '\n';
  big += ',,\n'.repeat(300000);
  const bigCsv = path.join(tmp, 'big.csv'); fs.writeFileSync(bigCsv, big);
  const bc = await upload('faculty', bigCsv);
  const bigX = path.join(tmp, 'big.xlsx');
  fs.writeFileSync(bigX, xlsxBuffer(facRows, 298000));
  const bx = await upload('heqs', bigX);
  const sizes = (fs.statSync(bigCsv).size / 1048576).toFixed(1) + 'MB CSV و' + (fs.statSync(bigX).size / 1048576).toFixed(1) + 'MB xlsx';
  check('C6-14', 'الأداء في المتصفح: قراءة الملفين الكبيرين أقل من 10 ثوانٍ لكل منهما', /100000 صفًا/.test(bc.status) && /10 صفوف/.test(bx.status) && bc.ms < 10000 && bx.ms < 10000,
    sizes + ' · CSV ' + (bc.ms / 1000).toFixed(1) + ' ث · xlsx ' + (bx.ms / 1000).toFixed(1) + ' ث');

  const outside = requests.filter(u => !/^(file|blob|data|about|devtools):/.test(u));
  check('C6-15', 'لا طلبات شبكة خارجية ولا أخطاء في وحدة التحكم طوال سيناريوهات الحساب', !outside.length && !p.errors.length, (outside.join(', ') || requests.length + ' طلبًا محليًا') + ' · أخطاء: ' + (p.errors.join(' | ') || 'صفر'));
  await cdp.send('Target.closeTarget', { targetId: p.targetId });
}

// ---------- ربط نتائج الملفات بالتحليل ولوحة القيادة والمؤشر (طلب المستخدمة: «أرفع الملف ولا يظهر مع التحليل») ----------
async function runLink(cdp) {
  const p = await openPage(cdp);
  await p.viewport(1280, 900, false);
  await p.goto(APP + '#/dashboard');
  await p.eval("localStorage.removeItem('basira.v1');");
  await p.goto(APP + '#/calculate');
  const FIX = path.join(ROOT, 'tests', 'fixtures');
  const txt = sel => p.eval('const e = document.querySelector(' + JSON.stringify(sel) + '); return e ? e.textContent.replace(/\\s+/g, " ").trim() : "";');
  const stored = () => p.eval("return JSON.parse(localStorage.getItem('basira.v1') || 'null');");
  const val = code => p.eval(`const tr = document.querySelector('tr[data-key="${code}"]'); return tr ? tr.children[1].textContent.replace(/\\s+/g, ' ').trim() : '';`);
  async function upload(slot, file) {
    const { root } = await p.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-' + slot.replace(/[^A-Za-z0-9_-]/g, '_') });
    await p.send('DOM.setFileInputFiles', { nodeId, files: [file] });
    for (let i = 0; i < 100; i++) { await sleep(100); if (/مرفوع|القديمة|لم يُقرأ/.test(await txt('[data-slot="' + slot + '"]'))) return; }
  }

  // L-01 تحليل فوري بعد رفع ملف المحاضرين وحده، دون أي اختيار ودون «احسب»، ودون عرض الأسماء
  await upload('faculty', path.join(FIX, 'faculty.csv'));
  const an = await txt('[data-slot="faculty"] .file-analysis');
  const page1 = await p.eval('return document.getElementById("main").textContent;');
  check('L-01', 'رفع ملف وحده يُظهر «تحليل الملف» فورًا: توزيع الرتب والجنسيات، والأعمدة الشخصية دون قيمها، ولا اسم في الصفحة',
    /RANK_DESC: .*فني \(2\)/.test(an) && /NATIONALITY: دولة أ \(6\)/.test(an) && /أعمدة شخصية لا تُعرض قيمها: EMPLOYEE_ID، NAME/.test(an) && !/اسم-وهمي/.test(page1), an.slice(0, 140));

  // L-02 قراءة كاملة واختيار تلقائي: كل المؤشرات تُحسب فور الرفع دون أي نقرة ودون «احسب»
  for (const [slot, f] of [['admission', 'admission.csv'], ['graduate', 'graduate.csv'], ['top500', 'top500.csv']]) await upload(slot, path.join(FIX, f));
  const v5 = await val('AR-EDU-5'), v1 = await val('AR-EDU-1'), v2 = await val('AR-EDU-2');
  const autoState = await p.eval(`return { badges: [...document.querySelectorAll('.recipe-input .badge')].filter(b => /اختيار تلقائي/.test(b.textContent)).length,
    clerks: document.querySelector('input[name="items-admissionStudents"][value="الموظفون الإداريون"]').checked, tech: document.querySelector('input[name="values-facultyFull"][value="فني"]').checked };`);
  check('L-02', 'فور الرفع ودون أي اختيار: المؤشر 1 «1:18.8» والمؤشر 2 «1:25» والمؤشر 5 «11»، مع شارة «اختيار تلقائي»، ودون الموظفين الإداريين والفنيين',
    v1 === '1:18.8' && v2 === '1:25' && v5 === '11' && autoState.badges >= 4 && !autoState.clerks && !autoState.tech, JSON.stringify(autoState));

  await p.eval('document.getElementById("manual-fix").open = true; return true;');
  // L-03 تعديل الاختيار التلقائي يحدّث النتائج فورًا دون إعادة رسم الصفحة (يبقى التركيز على المربع)
  await p.clickSelector('input[name="values-facultyFull"][value="معيد"]');
  const v1off = await val('AR-EDU-1');
  const focus = await p.eval('return document.activeElement.name + ":" + document.activeElement.value;');
  await p.clickSelector('input[name="values-facultyFull"][value="معيد"]');
  const v1on = await val('AR-EDU-1');
  const s3 = await stored();
  check('L-03', 'إلغاء «معيد» يغيّر المؤشر 1 فورًا إلى «1:21.4» (150 ÷ 7) وإعادته ترجع «1:18.8»، والتركيز باقٍ، ولا شيء في سجل الأنشطة',
    v1off === '1:21.4' && v1on === '1:18.8' && focus === 'values-facultyFull:معيد' && s3.calc.cycles[0].latest && !s3.activities.some(a => a.action === 'calc_run'), v1off + ' ← ' + v1on + ' · التركيز: ' + focus + ' · أنشطة: ' + s3.activities.length);

  // L-04 التحليل التشغيلي: بطاقة نتائج الحساب، والتنبيهات تشمل التعارض والانتظار
  await p.route('#/insights');
  const sum = await txt('#calc-findings-summary');
  const row1 = await p.eval('const tr = [...document.querySelectorAll("#calc-findings-title ~ div tbody tr")].find(t => t.dataset.key === "AR-EDU-1"); return tr ? tr.textContent : "";');
  const alertsTxt = await txt('#alerts-title ~ ul, #alerts-title ~ *');
  check('L-04', 'التحليل التشغيلي يعرض نتائج الملفات: «حُسب 3 من 12 · بانتظار الاعتماد 3 · تعارض 1»، وAR-EDU-1 بتعارض، والتنبيهات تذكرها',
    /حُسب 3 من 12 مؤشرًا · بانتظار الاعتماد 3 · تعارض مع ملف التقدم 1/.test(sum) && /1:18\.8/.test(row1) && /تعارض/.test(row1) && /بانتظار الاعتماد/.test(row1) &&
    /المحسوب من الملفات يخالف ملف التقدم في AR-EDU-1/.test(alertsTxt) && /قيمة محسوبة بانتظار الاعتماد في AR-EDU-5/.test(alertsTxt), sum);

  // L-05 لوحة القيادة: بطاقة ملفات المصدر
  await p.route('#/dashboard');
  const dash = await txt('#dash-sources-summary');
  const dashAlerts = await txt('.alerts-card h2');
  check('L-05', 'لوحة القيادة: «4 ملفات · حُسب 3 من 12» مع «بانتظار الاعتماد 3» و«تعارض 1»، وتنبيهات الحساب ضمن العدد', /4 ملفات · حُسب 3 من 12 مؤشرًا/.test(dash) && /بانتظار الاعتماد 3/.test(dash) && /تعارض 1/.test(dash) && /و\d+ للمتابعة/.test(dashAlerts), dash + ' · ' + dashAlerts);

  // L-06 صفحة المؤشر: آخر قيمة محسوبة واعتمادها من هناك
  await p.route('#/indicators/ind-ar-edu-1');
  const sec = await txt('#indicator-calc');
  await p.clickSelector('#indicator-approve');
  await p.clickSelector('.dialog button', 'اعتماد القيمة');
  const i1 = (await stored()).indicators.find(i => i.code === 'AR-EDU-1');
  const sec2 = await txt('#indicator-calc');
  await p.route('#/insights');
  const sum2 = await txt('#calc-findings-summary');
  check('L-06', 'صفحة المؤشر تعرض «بانتظار الاعتماد» 1:18.8 بتعارض، والاعتماد منها يحدّث القيمة فتصبح «معتمدة» وينقص الانتظار في التحليل إلى 2',
    /بانتظار الاعتماد/.test(sec) && /1:18\.8/.test(sec) && /تعارض مع ملف التقدم \(1:11\)/.test(sec) && i1.currentValue === '1:18.8' && /معتمدة/.test(sec2) && /بانتظار الاعتماد 2/.test(sum2), sum2);

  // L-07 بعد إعادة التحميل: النتائج المرتبطة باقية في التحليل (الملفات نفسها لا تُخزن)
  await p.goto(APP + '#/insights');
  const sum3 = await txt('#calc-findings-summary');
  const raw = await p.eval("return localStorage.getItem('basira.v1');");
  check('L-07', 'بعد إعادة التحميل: نتائج الحساب باقية في التحليل، ولا اسم من الملفات في البيانات المحفوظة', /حُسب 3 من 12/.test(sum3) && !/اسم-وهمي|باحث-وهمي|E10\d\d/.test(raw), sum3);

  // L-09 في المرة القادمة: الاختيارات محفوظة، فرفع الملفات من جديد يكفي (مع إلغاء «معيد» كاختيار شخصي يبقى محفوظًا)
  await p.route('#/calculate');
  for (const [slot, f] of [['faculty', 'faculty.csv'], ['admission', 'admission.csv'], ['graduate', 'graduate.csv']]) await upload(slot, path.join(FIX, f));
  await p.eval('document.getElementById("manual-fix").open = true; return true;');
  await p.clickSelector('input[name="values-facultyFull"][value="معيد"]');
  await p.goto(APP + '#/calculate');
  for (const [slot, f] of [['faculty', 'faculty.csv'], ['admission', 'admission.csv'], ['graduate', 'graduate.csv']]) await upload(slot, path.join(FIX, f));
  const again = await val('AR-EDU-1');
  const kept = await p.eval('return document.querySelector(\'input[name="values-facultyFull"][value="معيد"]\').checked;');
  check('L-09', 'بعد إعادة التحميل ورفع الملفات من جديد: يُحسب فورًا باختيارك المحفوظ («معيد» ما زال مستبعدًا ← «1:21.4») دون إعادة الاختيار', again === '1:21.4' && kept === false, again);
  // L-10 مؤشر جديد من النموذج ← خانة ملفه تظهر تلقائيًا ← رفع ملفه وحده يكفي للحساب (عنوان في الصف 3، وصف مكرر، وأعمدة وصفوف فارغة)
  await p.route('#/indicators/new?ranking=ARAB');
  const setv = (sel, v) => p.eval('const el = document.querySelector(' + JSON.stringify(sel) + '); el.value = ' + JSON.stringify(v) + '; el.dispatchEvent(new Event("change", { bubbles: true })); return true;');
  await setv('[name=domain]', 'البحث العلمي'); await setv('[name=code]', 'AR-RES-1'); await setv('[name=name]', 'عدد الجوائز البحثية');
  await p.clickSelector('form button[type=submit]');
  await p.route('#/calculate');
  const hasSlot = await p.eval('return !!document.querySelector(\'[data-slot="ind:AR-RES-1"]\');');
  const awards = path.join(require('os').tmpdir(), 'basira-awards-' + Date.now() + '.csv');
  fs.writeFileSync(awards, 'قائمة الجوائز\n\nالجائزة,الباحث,السنة,,\nجائزة أ,باحث-وهمي-1,2025,,\nجائزة ب,باحث-وهمي-2,2025,,\n,,,,\nجائزة أ,باحث-وهمي-1,2025,,\nجائزة ج,باحث-وهمي-3,2024,,\n,,,,\n');
  await upload('ind:AR-RES-1', awards);
  fs.rmSync(awards, { force: true });
  const st10 = await txt('[data-slot="ind:AR-RES-1"] .slot__status');
  const v10 = await val('AR-RES-1');
  const r10 = await p.eval('const tr = document.querySelector(\'tr[data-key="AR-RES-1"]\'); return tr ? tr.textContent : "";');
  await p.route('#/insights');
  const in10 = await p.eval('const tr = [...document.querySelectorAll("#calc-findings-title ~ div tbody tr")].find(t => t.dataset.key === "AR-RES-1"); return tr ? tr.textContent : "";');
  check('L-10', 'مؤشر جديد AR-RES-1: خانة ملفه تظهر تلقائيًا، ورفع ملفه وحده يعطي 3 (سطر العناوين 3، واستبعاد عمودين فارغين وصف مكرر)، ويظهر في التحليل',
    hasSlot && /سطر العناوين 3 · 3 أعمدة \(استُبعد 2 فارغ\)/.test(st10) && v10 === '3' && /استُبعد من العدّ 1 صف مكرر تمامًا \(الصفوف 7\)/.test(r10) && /بانتظار الاعتماد/.test(in10),
    st10 + ' · القيمة: ' + v10);
  // L-11 ملف العام الماضي يُرفع وحده بجانب ملف هذا العام (عدد صفوف مختلف)، وتُقارن السنتان تلقائيًا
  await p.route('#/calculate');
  await upload('top500', path.join(FIX, 'top500.csv'));
  async function uploadLast(slot, file) {
    const sid = slot.replace(/[^A-Za-z0-9_-]/g, '_');
    const { root } = await p.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#last-' + sid });
    await p.send('DOM.setFileInputFiles', { nodeId, files: [file] });
    for (let i = 0; i < 100; i++) { await sleep(100); if (/العام الماضي .*·|لم يُقرأ/.test(await txt('[data-last="' + slot + '"]'))) return; }
  }
  for (const [slot, f] of [['admission', 'admission-2025.csv'], ['graduate', 'graduate-2025.csv'], ['faculty', 'faculty-2025.csv'], ['top500', 'top500-2025.csv']]) await uploadLast(slot, path.join(FIX, f));
  const last5 = await txt('[data-last="top500"]');
  const r5y = await p.eval('const tr = document.querySelector(\'tr[data-key="AR-EDU-5"]\'); return tr ? tr.textContent.replace(/\\s+/g, " ") : "";');
  const r2y = await p.eval('const tr = document.querySelector(\'tr[data-key="AR-EDU-2"]\'); return tr ? tr.textContent.replace(/\\s+/g, " ") : "";');
  await p.route('#/insights');
  const in5 = await p.eval('const tr = [...document.querySelectorAll("#calc-findings-title ~ div tbody tr")].find(t => t.dataset.key === "AR-EDU-5"); return tr ? tr.textContent : "";');
  await p.route('#/indicators/ind-ar-edu-2');
  const yoy2 = await txt('#indicator-calc-yoy');
  await p.clickSelector('#indicator-approve-last');
  await p.clickSelector('.dialog button', 'اعتماد قيمة العام الماضي');
  const i2 = (await stored()).indicators.find(i => i.code === 'AR-EDU-2');
  check('L-11', 'ملف العام الماضي (10 صفوف مقابل 15): المؤشر 5 «6 ← 11» و«تحسّن 83%»، والمؤشر 2 «1:26 ← 1:25» و«تحسّن 4%»، وتظهر في التحليل وصفحة المؤشر، واعتماد قيمة العام الماضي يحفظها',
    /top500-2025\.csv · 10 صفوف/.test(last5) && /العام الماضي: 6 \(من ملفه\)/.test(r5y) && /تحسّن 83%/.test(r5y) && /أعضاء بمعامل هيرش ≥ العتبة: من 6 إلى 11 \(زيادة 5\)/.test(r5y) &&
    /العام الماضي: 1:26 \(من ملفه\)/.test(r2y) && /تحسّن 4%/.test(r2y) && /«طلبة البكالوريوس»: من 80 إلى 100 \(زيادة 20\)/.test(r2y) &&
    /تحسّن 83%/.test(in5) && /من ملف العام الماضي/.test(in5) && /1:26، من ملفه\): تحسّن 4%/.test(yoy2) && i2.lastYearValue === '1:26',
    yoy2 + ' · قيمة العام الماضي المعتمدة: ' + i2.lastYearValue);
  check('L-08', 'لا أخطاء في وحدة التحكم طوال سيناريوهات الربط', !p.errors.length, p.errors.join(' | ') || 'صفر');
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
    BROWSER_NAME = version.Browser;
    console.log('المتصفح: ' + version.Browser + ' · الصفحة: ' + APP + '\n');
    cdp = createClient(version.webSocketDebuggerUrl);
    await cdp.opened;
    const pdfPath = await run(cdp, tmp);
    await runPhase4(cdp);
    await runPhase5(cdp, tmp);
    await runQA(cdp);
    await runCalc(cdp, tmp);
    await runLink(cdp);
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
  // ملف نتائج اختياري يقرؤه مولّد TEST_REPORT.md (tests/report/build-report.js)
  if (process.env.BASIRA_E2E_JSON) {
    fs.writeFileSync(process.env.BASIRA_E2E_JSON, JSON.stringify({ ranAt: new Date().toISOString(), browser: BROWSER_NAME, results }, null, 2));
  }
  console.log('\nالنتيجة: ' + (results.length - failed.length) + ' ناجح، ' + failed.length + ' فاشل من ' + results.length);
  process.exit(failed.length ? 1 : 0);
}

main();
