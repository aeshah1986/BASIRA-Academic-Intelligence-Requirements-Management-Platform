// فحوص الحفظ والنسخ الاحتياطي (AC-DATA-01، AC-CRUD-05 المنطق، AC-PER-01/02/03/06)
const test = require('node:test');
const assert = require('node:assert/strict');

const storageApi = require('../js/storage.js');
const { createSampleData } = require('../data/sample-data.js');
const { createStore, exportJson, parseImport, STORAGE_KEY, MESSAGES } = storageApi;

// بديل لـ localStorage داخل Node.
function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    raw: key => map.get(key)
  };
}

test('AC-DATA-01 (المنطق): عند غياب بيانات محفوظة تُحمَّل البيانات التجريبية F1–F6', () => {
  const store = createStore(memoryStorage(), createSampleData);
  const loaded = store.load();
  assert.equal(loaded.firstRun, true);
  assert.equal(loaded.persistent, true);
  assert.deepEqual(loaded.data.requirements.map(r => r.id), ['req-f1', 'req-f2', 'req-f3', 'req-f4', 'req-f5', 'req-f6']);
});

test('أساس AC-CRUD-05: ما يُحفظ يبقى بعد إعادة التحميل', () => {
  const storage = memoryStorage();
  const store = createStore(storage, createSampleData);
  const data = store.load().data;
  data.requirements.push(Object.assign({}, data.requirements[0], { id: 'req-new', title: 'متطلب مضاف' }));
  assert.equal(store.save(data).ok, true);

  const reloaded = createStore(storage, createSampleData).load();
  assert.equal(reloaded.firstRun, false);
  assert.equal(reloaded.data.requirements.length, 7);
  assert.equal(reloaded.data.requirements[6].title, 'متطلب مضاف');
});

test('AC-PER-01 (المنطق): ملف التصدير باسم مؤرخ ويحتوي كل البيانات وschemaVersion', () => {
  const data = createSampleData();
  const file = exportJson(data, '2026-11-01');
  assert.equal(file.filename, 'basira-backup-2026-11-01.json');
  const parsed = JSON.parse(file.text);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.requirements.length, 6);
  assert.equal(parsed.indicators.length, 12);
  assert.equal(parsed.decisions.length, 1);
});

test('AC-PER-02: تصدير ثم استيراد يعيد البيانات نفسها تمامًا', () => {
  const data = createSampleData();
  data.requirements[1].followUps.push({ id: 'fu-x', date: '2026-10-28', note: 'ملاحظة "بعلامات تنصيص"، وفاصلة' });
  const imported = parseImport(exportJson(data, '2026-11-01').text);
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.data, data);
});

test('الاستيراد يقبل ملفًا يبدأ بعلامة BOM', () => {
  const text = '﻿' + exportJson(createSampleData(), '2026-11-01').text;
  assert.equal(parseImport(text).ok, true);
});

test('AC-PER-03: ملف ليس JSON يُرفض برسالة عربية', () => {
  const result = parseImport('هذا ليس ملف JSON');
  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.notJson);
});

test('AC-PER-03: ملف ينقصه حقل إلزامي أو فيه رابط مكسور يُرفض', () => {
  const missingTitle = createSampleData();
  delete missingTitle.requirements[0].title;
  const r1 = parseImport(JSON.stringify(missingTitle));
  assert.equal(r1.ok, false);
  assert.match(r1.message, /ينقصه الحقل «title»/);

  const brokenRef = createSampleData();
  brokenRef.requirements[0].entityId = 'ent-missing';
  const r2 = parseImport(JSON.stringify(brokenRef));
  assert.equal(r2.ok, false);
  assert.match(r2.message, /جهة غير موجودة/);

  const noList = createSampleData();
  delete noList.decisions;
  assert.equal(parseImport(JSON.stringify(noList)).ok, false);

  const wrongVersion = createSampleData();
  wrongVersion.schemaVersion = 99;
  assert.equal(parseImport(JSON.stringify(wrongVersion)).ok, false);

  const duplicate = createSampleData();
  duplicate.requirements[1].id = 'req-f1';
  assert.match(parseImport(JSON.stringify(duplicate)).message, /مكرر/);
});

test('AC-PER-03: استيراد ملف تالف لا يغيّر البيانات المحفوظة', () => {
  const storage = memoryStorage();
  const store = createStore(storage, createSampleData);
  store.save(store.load().data);
  const before = storage.raw(STORAGE_KEY);

  const result = store.importText('{"schemaVersion":1,"requirements":"broken"}');
  assert.equal(result.ok, false);
  assert.equal(storage.raw(STORAGE_KEY), before);
});

test('استيراد ملف سليم عبر المخزن يحفظه', () => {
  const storage = memoryStorage();
  const store = createStore(storage, createSampleData);
  const data = createSampleData();
  data.requirements.pop();
  const result = store.importText(exportJson(data, '2026-11-01').text);
  assert.equal(result.ok, true);
  assert.equal(createStore(storage, createSampleData).load().data.requirements.length, 5);
});

test('أساس AC-PER-05: إعادة البيانات التجريبية تستبدل التعديلات', () => {
  const storage = memoryStorage();
  const store = createStore(storage, createSampleData);
  const data = store.load().data;
  data.requirements = [];
  store.save(data);
  const reset = store.resetToSample();
  assert.equal(reset.ok, true);
  assert.equal(createStore(storage, createSampleData).load().data.requirements.length, 6);
});

test('AC-PER-06: عند غياب التخزين تعمل الصفحة بالبيانات التجريبية مع رسالة عربية', () => {
  const store = createStore(null, createSampleData);
  const loaded = store.load();
  assert.equal(loaded.persistent, false);
  assert.equal(loaded.data.requirements.length, 6);
  assert.equal(loaded.message, MESSAGES.storageUnavailable);
  assert.deepEqual(store.save(loaded.data), { ok: false, message: MESSAGES.storageUnavailable });
});

test('AC-PER-06: تخزين يرمي أخطاء عند القراءة أو الكتابة لا يوقف الصفحة', () => {
  const throwing = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); }
  };
  const store = createStore(throwing, createSampleData);
  const loaded = store.load();
  assert.equal(loaded.persistent, false);
  assert.equal(loaded.data.requirements.length, 6);
  assert.deepEqual(store.save(loaded.data), { ok: false, message: MESSAGES.saveFailed });
});

test('بيانات محفوظة تالفة: تُعرض البيانات التجريبية برسالة، ولا تُستبدل النسخة المحفوظة تلقائيًا', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{not json' });
  const loaded = createStore(storage, createSampleData).load();
  assert.equal(loaded.message, MESSAGES.storedDataUnreadable);
  assert.equal(loaded.data.requirements.length, 6);
  assert.equal(storage.raw(STORAGE_KEY), '{not json');
});

test('getBrowserStorage تعيد null خارج المتصفح', () => {
  assert.equal(storageApi.getBrowserStorage(), null);
});
