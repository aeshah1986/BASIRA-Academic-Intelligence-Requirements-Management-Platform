/*
 * الحفظ المحلي والنسخ الاحتياطي — منصة «بصيرة»
 * يعمل في المتصفح (window.Basira.storage) وفي Node (module.exports).
 * التخزين يُمرَّر كمعامل (localStorage في المتصفح، أو بديل وهمي في الفحوص).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Basira = root.Basira || {};
    root.Basira.storage = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_KEY = 'basira.v1';
  var SCHEMA_VERSION = 1;

  var MESSAGES = {
    storageUnavailable: 'الحفظ غير متاح في هذا المتصفح؛ ستعمل الصفحة لكن التعديلات لن تبقى بعد إغلاقها.',
    storedDataUnreadable: 'تعذرت قراءة البيانات المحفوظة؛ عُرضت البيانات التجريبية ولم تُحذف النسخة المحفوظة.',
    saveFailed: 'تعذر حفظ التعديلات في المتصفح.',
    notJson: 'الملف ليس بصيغة JSON صالحة.',
    invalidStructure: 'الملف لا يطابق بنية بيانات «بصيرة»: '
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function checkList(data, key, requiredFields, errors) {
    if (!Array.isArray(data[key])) {
      errors.push('القائمة «' + key + '» مفقودة.');
      return [];
    }
    var seen = {};
    data[key].forEach(function (item, index) {
      if (!isObject(item)) {
        errors.push(key + '[' + index + '] ليس عنصرًا صالحًا.');
        return;
      }
      requiredFields.forEach(function (field) {
        if (!isNonEmptyString(item[field])) errors.push(key + '[' + index + '] ينقصه الحقل «' + field + '».');
      });
      if (seen[item.id]) errors.push('المعرّف «' + item.id + '» مكرر في «' + key + '».');
      seen[item.id] = true;
    });
    return data[key];
  }

  /*
   * يتحقق من بنية مجموعة البيانات كاملة وسلامة الروابط بين عناصرها.
   * النتيجة: { ok, errors: [نص] }
   */
  function validateDataset(data) {
    var errors = [];
    if (!isObject(data)) return { ok: false, errors: ['المحتوى ليس كائن بيانات.'] };
    if (data.schemaVersion !== SCHEMA_VERSION) {
      errors.push('إصدار البنية غير مدعوم (المتوقع ' + SCHEMA_VERSION + ').');
    }

    var entities = checkList(data, 'entities', ['id', 'name'], errors);
    var indicators = checkList(data, 'indicators', ['id', 'name', 'ranking'], errors);
    var requirements = checkList(data, 'requirements', ['id', 'title', 'indicatorId', 'entityId', 'deadline'], errors);
    var decisions = checkList(data, 'decisions', ['id', 'indicatorId', 'question', 'status'], errors);

    var indicatorIds = {};
    indicators.forEach(function (i) { if (isObject(i)) indicatorIds[i.id] = true; });
    var entityIds = {};
    entities.forEach(function (e) { if (isObject(e)) entityIds[e.id] = true; });

    requirements.forEach(function (r) {
      if (!isObject(r)) return;
      if (r.indicatorId && !indicatorIds[r.indicatorId]) errors.push('المتطلب «' + r.id + '» يشير إلى مؤشر غير موجود.');
      if (r.entityId && !entityIds[r.entityId]) errors.push('المتطلب «' + r.id + '» يشير إلى جهة غير موجودة.');
      if (r.followUps !== undefined && !Array.isArray(r.followUps)) errors.push('متابعات المتطلب «' + r.id + '» ليست قائمة.');
    });
    decisions.forEach(function (d) {
      if (isObject(d) && d.indicatorId && !indicatorIds[d.indicatorId]) {
        errors.push('القرار «' + d.id + '» يشير إلى مؤشر غير موجود.');
      }
    });

    return { ok: errors.length === 0, errors: errors };
  }

  // يعيد localStorage إذا كان يعمل فعلًا، وإلا null (مثل التصفح الخاص المقيد أو Node).
  function getBrowserStorage() {
    try {
      var storage = globalThis.localStorage;
      if (!storage) return null;
      var probe = '__basira_probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return storage;
    } catch (e) {
      return null;
    }
  }

  /*
   * مخزن البيانات.
   * storage: كائن بواجهة getItem/setItem (أو null إذا كان الحفظ غير متاح).
   * createSeed: دالة تعيد نسخة جديدة من البيانات التجريبية.
   */
  function createStore(storage, createSeed) {
    function load() {
      if (!storage) {
        return { data: createSeed(), persistent: false, firstRun: true, message: MESSAGES.storageUnavailable };
      }
      var raw;
      try {
        raw = storage.getItem(STORAGE_KEY);
      } catch (e) {
        return { data: createSeed(), persistent: false, firstRun: true, message: MESSAGES.storageUnavailable };
      }
      if (raw === null || raw === undefined) {
        return { data: createSeed(), persistent: true, firstRun: true, message: '' };
      }
      var parsed = parseImport(raw);
      if (!parsed.ok) {
        return { data: createSeed(), persistent: true, firstRun: false, message: MESSAGES.storedDataUnreadable };
      }
      return { data: parsed.data, persistent: true, firstRun: false, message: '' };
    }

    function save(data) {
      if (!storage) return { ok: false, message: MESSAGES.storageUnavailable };
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(data));
        return { ok: true, message: '' };
      } catch (e) {
        return { ok: false, message: MESSAGES.saveFailed };
      }
    }

    // يستورد نصًا ويحفظه فقط إذا كان صالحًا؛ عند الفشل لا يُلمس المحفوظ.
    function importText(text) {
      var parsed = parseImport(text);
      if (!parsed.ok) return parsed;
      var saved = save(parsed.data);
      return { ok: saved.ok, data: parsed.data, message: saved.message };
    }

    function resetToSample() {
      var data = createSeed();
      var saved = save(data);
      return { ok: saved.ok, data: data, message: saved.message };
    }

    return { load: load, save: save, importText: importText, resetToSample: resetToSample };
  }

  // ملف النسخة الاحتياطية. today بصيغة YYYY-MM-DD.
  function exportJson(data, today) {
    var copy = JSON.parse(JSON.stringify(data));
    copy.schemaVersion = SCHEMA_VERSION;
    return {
      filename: 'basira-backup-' + today + '.json',
      text: JSON.stringify(copy, null, 2)
    };
  }

  // يحلل نص JSON ويتحقق منه دون أي أثر جانبي.
  function parseImport(text) {
    var data;
    try {
      data = JSON.parse(String(text).replace(/^﻿/, ''));
    } catch (e) {
      return { ok: false, message: MESSAGES.notJson, errors: [] };
    }
    var check = validateDataset(data);
    if (!check.ok) {
      return { ok: false, message: MESSAGES.invalidStructure + check.errors[0], errors: check.errors };
    }
    return { ok: true, data: data, message: '' };
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MESSAGES: MESSAGES,
    validateDataset: validateDataset,
    getBrowserStorage: getBrowserStorage,
    createStore: createStore,
    exportJson: exportJson,
    parseImport: parseImport
  };
});
