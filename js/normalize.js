/*
 * توحيد النص العربي للبحث — منصة «بصيرة»
 * يعمل في المتصفح (window.Basira.normalize) وفي Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Basira = root.Basira || {};
    root.Basira.normalize = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TASHKEEL = /[ً-ٰٟ]/g; // الحركات والتنوين والشدة والسكون والألف الخنجرية
  var TATWEEL = /ـ/g;
  var ALEF_FORMS = /[آأإٱ]/g; // آ أ إ ٱ
  var TEH_MARBUTA = /ة/g; // ة
  var ALEF_MAKSURA = /ى/g; // ى

  // حذف المسافات من الطرفين وضغط المسافات المتتالية إلى مسافة واحدة.
  function collapseSpaces(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  // صيغة موحدة للمقارنة فقط، ولا تُعرض للمستخدم.
  function normalizeText(value) {
    return collapseSpaces(value)
      .replace(TASHKEEL, '')
      .replace(TATWEEL, '')
      .replace(ALEF_FORMS, 'ا')
      .replace(TEH_MARBUTA, 'ه')
      .replace(ALEF_MAKSURA, 'ي')
      .toLowerCase();
  }

  // تقسيم نص البحث إلى كلمات موحدة.
  function tokenize(query) {
    var normalized = normalizeText(query);
    return normalized ? normalized.split(' ') : [];
  }

  return {
    collapseSpaces: collapseSpaces,
    normalizeText: normalizeText,
    tokenize: tokenize
  };
});
