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
const APP = pathToFileURL(path.join(ROOT, 'index.html')).href + '?today=' + TODAY;
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
  '#/activity', '#/requirements/missing'];

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
    files[0] === 'basira-backup-' + TODAY + '.json' && exported && exported.schemaVersion === 1 && exported.requirements.length === 7, files.join(',') || 'لم يُنزَّل ملف');

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
  return pdfPath;
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
