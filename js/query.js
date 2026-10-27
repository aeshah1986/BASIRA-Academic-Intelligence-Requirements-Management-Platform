/*
 * البحث بالكلمات المفتاحية والتصفية المركبة للمتطلبات — منصة «بصيرة»
 * البحث في العنوان والوصف والبيانات الناقصة، بعد التوحيد، وكل الكلمات مطلوبة (AND).
 * يعمل في المتصفح (window.Basira.query) وفي Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./normalize.js'), require('./derive.js'));
  } else {
    root.Basira = root.Basira || {};
    root.Basira.query = factory(root.Basira.normalize, root.Basira.derive);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (normalize, derive) {
  'use strict';

  var FILTER_KEYS = ['q', 'ranking', 'indicator', 'entity', 'status', 'priority', 'due'];

  function haystack(req) {
    return normalize.normalizeText([req.title, req.description, req.missingData].join(' '));
  }

  /*
   * filters: { q, ranking, indicator, entity, status, priority, due: 'overdue'|'soon' }
   * القيم الفارغة تعني «الكل». context: { indicatorsById, today }
   */
  function filterRequirements(list, filters, context) {
    filters = filters || {};
    context = context || {};
    var tokens = normalize.tokenize(filters.q || '');
    var byId = context.indicatorsById || {};
    return list.filter(function (r) {
      if (tokens.length) {
        var text = haystack(r);
        for (var i = 0; i < tokens.length; i++) {
          if (text.indexOf(tokens[i]) === -1) return false;
        }
      }
      if (filters.ranking) {
        var ind = byId[r.indicatorId];
        if (!ind || ind.ranking !== filters.ranking) return false;
      }
      if (filters.indicator && r.indicatorId !== filters.indicator) return false;
      if (filters.entity && r.entityId !== filters.entity) return false;
      // «open» قيمة خاصة: كل ما لم يكتمل (رابط «متطلبات مفتوحة» في لوحة القيادة).
      if (filters.status === 'open') {
        if (r.status === 'done') return false;
      } else if (filters.status && r.status !== filters.status) return false;
      if (filters.priority && r.priority !== filters.priority) return false;
      if (filters.due) {
        var kind = derive.dueInfo(r, context.today).kind;
        if (kind !== filters.due) return false;
      }
      return true;
    });
  }

  function hasActiveFilters(filters) {
    return FILTER_KEYS.some(function (k) { return filters && filters[k]; });
  }

  return {
    FILTER_KEYS: FILTER_KEYS,
    filterRequirements: filterRequirements,
    hasActiveFilters: hasActiveFilters
  };
});
