/*
 * نموذج البيانات والتحقق من المدخلات — منصة «بصيرة»
 * يعمل في المتصفح (window.Basira.model) وفي Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Basira = root.Basira || {};
    root.Basira.model = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RANKINGS = { ARAB: 'التصنيف العربي', QS: 'QS' };

  var STATUSES = {
    new: 'جديد',
    in_progress: 'قيد التنفيذ',
    waiting: 'بانتظار الجهة',
    done: 'مكتمل'
  };

  var PRIORITIES = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };

  var WORK_STATUSES = {
    not_started: 'لم يبدأ',
    draft: 'مسودة',
    evidenced: 'محسوب بالأدلة',
    entered: 'مُدخل في المنصة'
  };

  var MESSAGES = {
    titleRequired: 'العنوان مطلوب.',
    indicatorRequired: 'يرجى اختيار المؤشر.',
    indicatorUnknown: 'المؤشر المحدد غير موجود.',
    entityRequired: 'يرجى اختيار الجهة المسؤولة.',
    entityUnknown: 'الجهة المحددة غير موجودة.',
    deadlineInvalid: 'الموعد النهائي غير صالح.',
    statusUnknown: 'الحالة غير معروفة.',
    priorityUnknown: 'الأولوية غير معروفة.'
  };

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function collapseSpaces(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  // صيغة YYYY-MM-DD وتاريخ موجود فعلًا في التقويم (يرفض 2026-02-30).
  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split('-').map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0] &&
      date.getUTCMonth() === parts[1] - 1 &&
      date.getUTCDate() === parts[2];
  }

  function containsId(list, id) {
    return (list || []).some(function (item) { return item.id === id; });
  }

  /*
   * يتحقق من متطلب ويعيد نسخة نظيفة منه.
   * context = { indicators, entities } للتأكد من أن المؤشر والجهة موجودان.
   * النتيجة: { ok, errors: { field: message }, value }
   */
  function validateRequirement(input, context) {
    input = input || {};
    context = context || {};
    var errors = {};

    var value = {
      title: collapseSpaces(input.title),
      description: String(input.description == null ? '' : input.description).trim(),
      indicatorId: collapseSpaces(input.indicatorId),
      entityId: collapseSpaces(input.entityId),
      assignee: collapseSpaces(input.assignee),
      deadline: collapseSpaces(input.deadline),
      status: collapseSpaces(input.status) || 'new',
      priority: collapseSpaces(input.priority) || 'medium',
      missingData: String(input.missingData == null ? '' : input.missingData).trim()
    };

    if (!value.title) errors.title = MESSAGES.titleRequired;

    if (!value.indicatorId) errors.indicatorId = MESSAGES.indicatorRequired;
    else if (context.indicators && !containsId(context.indicators, value.indicatorId)) {
      errors.indicatorId = MESSAGES.indicatorUnknown;
    }

    if (!value.entityId) errors.entityId = MESSAGES.entityRequired;
    else if (context.entities && !containsId(context.entities, value.entityId)) {
      errors.entityId = MESSAGES.entityUnknown;
    }

    if (!isValidDate(value.deadline)) errors.deadline = MESSAGES.deadlineInvalid;
    if (!hasOwn(STATUSES, value.status)) errors.status = MESSAGES.statusUnknown;
    if (!hasOwn(PRIORITIES, value.priority)) errors.priority = MESSAGES.priorityUnknown;

    return { ok: Object.keys(errors).length === 0, errors: errors, value: value };
  }

  /*
   * تعارض القيم: القيمة الحالية وقيمة ملف التقدم موجودتان ومختلفتان.
   * القيم نصية لأن بعضها نسب مثل «1:15»، والمسافات لا تُحتسب فرقًا.
   */
  function hasValueConflict(indicator) {
    if (!indicator) return false;
    var current = String(indicator.currentValue == null ? '' : indicator.currentValue).replace(/\s+/g, '');
    var progress = String(indicator.progressFileValue == null ? '' : indicator.progressFileValue).replace(/\s+/g, '');
    return current !== '' && progress !== '' && current !== progress;
  }

  var ENTITY_TYPES = { deanship: 'عمادة', vice_presidency: 'وكالة', department: 'إدارة', unit: 'وحدة', college: 'كلية', center: 'مركز', other: 'أخرى' };
  var FOLLOWUP_TYPES = { call: 'اتصال', letter: 'خطاب', meeting: 'اجتماع', email: 'بريد', other: 'أخرى' };
  // مستويات سلّم التصعيد (docs/design/07 §3). المتابعة العادية بلا مستوى.
  var ESCALATION_NAMES = ['طلب رسمي', 'تذكير ودي', 'تذكير رسمي', 'تصعيد للمشرف', 'تصعيد للرئاسة أو اللجنة'];
  var FOLLOWUP_OUTCOMES = {
    no_reply: 'لا رد بعد',
    promised: 'وعد بالتسليم',
    partial: 'تسليم جزئي',
    delivered: 'تسليم كامل',
    declined: 'اعتذار أو رفض',
    other: 'أخرى'
  };
  var EVIDENCE_TYPES = { file: 'ملف', link: 'رابط', letter: 'خطاب رسمي', template: 'نموذج معبأ', other: 'أخرى' };
  var EVIDENCE_STATUSES = { pending: 'بانتظار التحقق', verified: 'متحقق منه', rejected: 'مرفوض' };

  function isHttpUrl(value) {
    return typeof value === 'string' && /^https?:\/\/[^\s<>"']+$/i.test(value.trim());
  }

  // بريد إلكتروني أو رقم هاتف داخل نص (خصوصية: R-V-NO-CONTACT).
  function hasContactInfo(text) {
    var s = String(text == null ? '' : text);
    return /[\w.+-]+@[\w-]+\.[\w.]+/.test(s) || /\+?\d[\d\s-]{7,}\d/.test(s);
  }

  function isEnum(map, value) {
    return Object.prototype.hasOwnProperty.call(map, value);
  }

  return {
    ENTITY_TYPES: ENTITY_TYPES,
    FOLLOWUP_TYPES: FOLLOWUP_TYPES,
    ESCALATION_NAMES: ESCALATION_NAMES,
    FOLLOWUP_OUTCOMES: FOLLOWUP_OUTCOMES,
    EVIDENCE_TYPES: EVIDENCE_TYPES,
    EVIDENCE_STATUSES: EVIDENCE_STATUSES,
    isHttpUrl: isHttpUrl,
    hasContactInfo: hasContactInfo,
    isEnum: isEnum,
    RANKINGS: RANKINGS,
    STATUSES: STATUSES,
    PRIORITIES: PRIORITIES,
    WORK_STATUSES: WORK_STATUSES,
    MESSAGES: MESSAGES,
    isValidDate: isValidDate,
    validateRequirement: validateRequirement,
    hasValueConflict: hasValueConflict
  };
});
