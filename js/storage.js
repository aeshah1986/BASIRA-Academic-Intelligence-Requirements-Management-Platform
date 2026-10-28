/*
 * الحفظ المحلي والنسخ الاحتياطي — منصة «بصيرة»
 * يعمل في المتصفح (window.Basira.storage) وفي Node (module.exports).
 * التخزين يُمرَّر كمعامل (localStorage في المتصفح، أو بديل وهمي في الفحوص).
 * البنية الحالية v2 (docs/design/03-data-model.md)، وبيانات v1 تُرقّى تلقائيًا عند التحميل والاستيراد.
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

  // مفتاح الحفظ ثابت منذ v1 حتى تُرقّى البيانات المحفوظة سابقًا ولا تضيع.
  var STORAGE_KEY = 'basira.v1';
  var SCHEMA_VERSION = 2;
  var MAX_IMPORT_CHARS = 10 * 1024 * 1024; // 10MB تقريبًا
  var ACTIVITY_CAP = 500;

  var RANKING_NAMES = { ARAB: 'التصنيف العربي للجامعات', QS: 'QS' };

  var MESSAGES = {
    storageUnavailable: 'الحفظ غير متاح في هذا المتصفح؛ ستعمل الصفحة لكن التعديلات لن تبقى بعد إغلاقها.',
    storedDataUnreadable: 'تعذرت قراءة البيانات المحفوظة؛ عُرضت البيانات التجريبية ولم تُحذف النسخة المحفوظة.',
    saveFailed: 'تعذر حفظ التعديلات في المتصفح.',
    notJson: 'الملف ليس بصيغة JSON صالحة.',
    tooLarge: 'الملف أكبر من الحد المسموح (10MB تقريبًا).',
    invalidStructure: 'الملف لا يطابق بنية بيانات «بصيرة»: '
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function isISODate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  /*
   * ترقية v1 إلى v2 دون حذف أي حقل قديم. لا تعدّل المدخل، وتعيد نسخة.
   * بيانات v2 تُعاد نسخة منها كما هي. أي إصدار آخر يُعاد كما هو ليرفضه التحقق.
   */
  function migrate(input) {
    if (!isObject(input)) return input;
    var data = JSON.parse(JSON.stringify(input));
    if (data.schemaVersion !== 1) return data;

    // القوائم غير الصالحة لا تُلمس هنا، والتحقق بعدها يرفضها برسالة (لا انهيار).
    var arr = function (x) { return Array.isArray(x) ? x : []; };
    var codes = [];
    arr(data.indicators).forEach(function (i) {
      if (isObject(i) && i.ranking && codes.indexOf(i.ranking) === -1) codes.push(i.ranking);
    });
    if (!Array.isArray(data.rankings)) {
      data.rankings = codes.map(function (c) { return { id: c, name: RANKING_NAMES[c] || c, submissionDeadline: '', cycleLabel: '' }; });
    }
    arr(data.indicators).forEach(function (i) {
      if (!isObject(i)) return;
      if (i.active === undefined) i.active = true;
      if (i.valueSource === undefined) i.valueSource = '';
    });
    arr(data.entities).forEach(function (e) {
      if (!isObject(e)) return;
      if (e.type === undefined) e.type = 'unit';
      if (e.contactRole === undefined) e.contactRole = '';
      if (e.notes === undefined) e.notes = '';
    });
    arr(data.requirements).forEach(function (r) {
      if (!isObject(r)) return;
      if (r.evidenceLink === undefined) r.evidenceLink = '';
      if (r.completedAt === undefined) r.completedAt = r.status === 'done' ? (r.updatedAt || '') : '';
      if (!Array.isArray(r.followUps)) r.followUps = [];
      r.followUps.forEach(function (f) {
        if (!isObject(f)) return;
        if (f.type === undefined) f.type = 'other';
        if (f.outcome === undefined) f.outcome = '';
        if (f.nextActionDate === undefined) f.nextActionDate = '';
      });
    });
    if (!Array.isArray(data.evidence)) data.evidence = [];
    if (!Array.isArray(data.activities)) data.activities = [];
    data.schemaVersion = 2;
    return data;
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
    return data[key].filter(isObject);
  }

  /*
   * يتحقق من بنية مجموعة البيانات (v2) وسلامة الروابط بين عناصرها.
   * النتيجة: { ok, errors: [نص] }
   */
  function validateDataset(data) {
    var errors = [];
    if (!isObject(data)) return { ok: false, errors: ['المحتوى ليس كائن بيانات.'] };
    if (data.schemaVersion !== SCHEMA_VERSION) {
      errors.push('إصدار البنية غير مدعوم (' + data.schemaVersion + '؛ المدعوم 1 و' + SCHEMA_VERSION + ').');
      return { ok: false, errors: errors };
    }

    var rankings = checkList(data, 'rankings', ['id', 'name'], errors);
    var entities = checkList(data, 'entities', ['id', 'name'], errors);
    var indicators = checkList(data, 'indicators', ['id', 'name', 'ranking', 'code'], errors);
    var requirements = checkList(data, 'requirements', ['id', 'title', 'indicatorId', 'entityId', 'deadline'], errors);
    var decisions = checkList(data, 'decisions', ['id', 'indicatorId', 'question', 'status'], errors);
    var evidence = checkList(data, 'evidence', ['id', 'indicatorId', 'title', 'status'], errors);
    checkList(data, 'activities', ['id', 'at', 'action'], errors);

    var ids = function (list) { var o = {}; list.forEach(function (x) { o[x.id] = x; }); return o; };
    var rankingIds = ids(rankings);
    var indicatorIds = ids(indicators);
    var entityIds = ids(entities);
    var requirementIds = ids(requirements);

    rankings.forEach(function (r) {
      if (r.submissionDeadline && !isISODate(r.submissionDeadline)) errors.push('موعد تسليم «' + r.id + '» غير صالح.');
    });
    var codes = {};
    indicators.forEach(function (i) {
      if (i.ranking && !rankingIds[i.ranking]) errors.push('المؤشر «' + i.id + '» يتبع تصنيفًا غير موجود.');
      var code = String(i.code || '').toUpperCase();
      if (code && codes[code]) errors.push('رمز المؤشر «' + i.code + '» مكرر.');
      codes[code] = true;
    });
    requirements.forEach(function (r) {
      if (r.indicatorId && !indicatorIds[r.indicatorId]) errors.push('المتطلب «' + r.id + '» يشير إلى مؤشر غير موجود.');
      if (r.entityId && !entityIds[r.entityId]) errors.push('المتطلب «' + r.id + '» يشير إلى جهة غير موجودة.');
      if (r.deadline && !isISODate(r.deadline)) errors.push('موعد المتطلب «' + r.id + '» غير صالح.');
      if (!Array.isArray(r.followUps)) {
        errors.push('متابعات المتطلب «' + r.id + '» ليست قائمة.');
        return;
      }
      r.followUps.forEach(function (f, k) {
        if (!isObject(f) || !isNonEmptyString(f.id) || !isISODate(f.date) || typeof f.note !== 'string') {
          errors.push('متابعة رقم ' + (k + 1) + ' في المتطلب «' + r.id + '» غير صالحة.');
        } else if (f.escalationLevel !== undefined && f.escalationLevel !== null && [0, 1, 2, 3, 4].indexOf(f.escalationLevel) === -1) {
          errors.push('مستوى التصعيد في متابعة رقم ' + (k + 1) + ' من المتطلب «' + r.id + '» غير صالح.');
        }
      });
    });
    decisions.forEach(function (d) {
      if (d.indicatorId && !indicatorIds[d.indicatorId]) errors.push('السؤال «' + d.id + '» يشير إلى مؤشر غير موجود.');
    });
    evidence.forEach(function (ev) {
      if (ev.indicatorId && !indicatorIds[ev.indicatorId]) errors.push('الدليل «' + ev.id + '» يشير إلى مؤشر غير موجود.');
      if (ev.requirementId && !requirementIds[ev.requirementId]) errors.push('الدليل «' + ev.id + '» يشير إلى متطلب غير موجود.');
    });

    // الإعدادات اختيارية: قوالب الخطابات المعدلة فقط (L0..L4)، كل قالب { subject, body } نصّان.
    if (data.settings !== undefined) {
      if (!isObject(data.settings)) errors.push('الإعدادات «settings» ليست كائنًا.');
      else if (data.settings.letterTemplates !== undefined) {
        var lt = data.settings.letterTemplates;
        if (!isObject(lt)) errors.push('قوالب الخطابات ليست كائنًا.');
        else Object.keys(lt).forEach(function (code) {
          if (!/^L[0-4]$/.test(code) || !isObject(lt[code]) || !isNonEmptyString(lt[code].subject) || !isNonEmptyString(lt[code].body)) errors.push('قالب الخطاب «' + code + '» غير صالح.');
        });
      }
    }

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
   * createSeed: دالة تعيد نسخة جديدة من البيانات التجريبية (تُرقّى إن كانت v1).
   */
  function createStore(storage, createSeed) {
    var seed = function () { return migrate(createSeed()); };

    function load() {
      if (!storage) {
        return { data: seed(), persistent: false, firstRun: true, message: MESSAGES.storageUnavailable };
      }
      var raw;
      try {
        raw = storage.getItem(STORAGE_KEY);
      } catch (e) {
        return { data: seed(), persistent: false, firstRun: true, message: MESSAGES.storageUnavailable };
      }
      if (raw === null || raw === undefined) {
        return { data: seed(), persistent: true, firstRun: true, message: '' };
      }
      var parsed = parseImport(raw);
      if (!parsed.ok) {
        return { data: seed(), persistent: true, firstRun: false, message: MESSAGES.storedDataUnreadable };
      }
      return { data: parsed.data, persistent: true, firstRun: false, message: '', migratedFrom: parsed.migratedFrom };
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
      var data = seed();
      var saved = save(data);
      return { ok: saved.ok, data: data, message: saved.message };
    }

    return { load: load, save: save, importText: importText, resetToSample: resetToSample };
  }

  // ملف النسخة الاحتياطية. today بصيغة YYYY-MM-DD.
  function exportJson(data, today) {
    var copy = JSON.parse(JSON.stringify(data));
    copy.schemaVersion = SCHEMA_VERSION;
    copy.exportedAt = new Date().toISOString();
    return {
      filename: 'basira-backup-' + today + '.json',
      text: JSON.stringify(copy, null, 2)
    };
  }

  // يحلل نص JSON ويرقّيه ويتحقق منه دون أي أثر جانبي.
  function parseImport(text) {
    var str = String(text);
    if (str.length > MAX_IMPORT_CHARS) return { ok: false, message: MESSAGES.tooLarge, errors: [] };
    var raw;
    try {
      raw = JSON.parse(str.replace(/^﻿/, ''));
    } catch (e) {
      return { ok: false, message: MESSAGES.notJson, errors: [] };
    }
    var data = migrate(raw);
    var check = validateDataset(data);
    if (!check.ok) {
      return { ok: false, message: MESSAGES.invalidStructure + check.errors[0], errors: check.errors };
    }
    return { ok: true, data: data, message: '', migratedFrom: isObject(raw) && raw.schemaVersion === 1 ? 1 : null };
  }

  // ملخص أعداد مجموعة بيانات (لحوار تأكيد الاستيراد).
  function summarize(data) {
    return {
      requirements: data.requirements.length,
      indicators: data.indicators.length,
      entities: data.entities.length,
      evidence: data.evidence.length,
      decisions: data.decisions.length,
      activities: data.activities.length
    };
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    ACTIVITY_CAP: ACTIVITY_CAP,
    MESSAGES: MESSAGES,
    migrate: migrate,
    validateDataset: validateDataset,
    getBrowserStorage: getBrowserStorage,
    createStore: createStore,
    exportJson: exportJson,
    parseImport: parseImport,
    summarize: summarize
  };
});
