/*
 * أدوات بناء الواجهة — منصة «بصيرة» (للمتصفح فقط)
 * كل نص يُضاف عبر عقد نصية (textContent)، فلا يُفسَّر إدخال المستخدم كـ HTML (AC-SEC-01).
 */
(function (root) {
  'use strict';
  var Basira = root.Basira = root.Basira || {};
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function append(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return; }
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  /*
   * h('a', { href: '#/x', class: 'btn', onclick: fn }, 'نص', عقدة، [قائمة])
   * الخصائص: class، dataset، on*، وما عداها setAttribute. القيمة true ← خاصية فارغة، وfalse/null ← لا شيء.
   */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.keys(value).forEach(function (k) { el.dataset[k] = value[k]; });
      else if (key.slice(0, 2) === 'on' && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'value') el.value = value;
      else if (key === 'checked' || key === 'selected' || key === 'disabled') el[key] = !!value;
      else el.setAttribute(key, value === true ? '' : value);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  // أيقونات خطية مضمنة (مسارات ثابتة، لا مدخلات مستخدم).
  var ICONS = {
    home: ['M3 11l9-8 9 8', 'M5 10v10h14V10'],
    chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
    list: ['M9 6h12', 'M9 12h12', 'M9 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
    building: ['M4 21V5l8-3 8 3v16', 'M9 21v-5h6v5', 'M9 9h.01', 'M15 9h.01', 'M9 13h.01', 'M15 13h.01'],
    chat: ['M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z'],
    file: ['M14 3H6v18h12V7z', 'M14 3v4h4', 'M9 13h6', 'M9 17h6'],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
    more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    plus: ['M12 5v14', 'M5 12h14'],
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-4.3-4.3'],
    database: ['M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z', 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    printer: ['M6 9V3h12v6', 'M6 18H4v-7h16v7h-2', 'M6 14h12v7H6z'],
    alert: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17h.01'],
    check: ['M5 12l5 5 9-10'],
    chevron: ['M15 6l-6 6 6 6'],
    empty: ['M3 7h18v13H3z', 'M3 7l3-4h12l3 4', 'M9 12h6'],
    shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
    pulse: ['M3 12h4l3-8 4 16 3-8h4'],
    mail: ['M3 6h18v12H3z', 'M3 7l9 6 9-6'],
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1']
  };

  function icon(name, extraClass) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon' + (extraClass ? ' ' + extraClass : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    (ICONS[name] || []).forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  // قيمة باتجاه LTR داخل نص عربي (D8): «1:15» و AR-EDU-1 والروابط.
  function ltr(value, cls) {
    return h('bdi', { dir: 'ltr', class: 'ltr' + (cls ? ' ' + cls : '') }, value === '' || value == null ? '—' : String(value));
  }

  // شارة بكلمة دائمًا (لا يُعتمد على اللون وحده).
  function badge(text, tone) {
    return h('span', { class: 'badge badge--' + (tone || 'neutral') }, text);
  }

  function emptyState(title, text, action) {
    return h('div', { class: 'empty', role: 'status' },
      icon('empty', 'empty__icon'),
      h('p', { class: 'empty__title' }, title),
      text ? h('p', { class: 'empty__text' }, text) : null,
      action || null);
  }

  // شريط تقدم مع النسبة كنص. pct = null ← «—».
  function progress(label, pct) {
    return h('div', { class: 'progress' },
      h('div', { class: 'progress__head' }, h('span', null, label), ltr(pct === null ? '—' : pct + '%', 'progress__value')),
      h('div', { class: 'progress__track', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': pct === null ? null : String(pct) },
        h('div', { class: 'progress__bar', style: 'inline-size:' + (pct || 0) + '%' })));
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  Basira.dom = { h: h, icon: icon, ltr: ltr, badge: badge, emptyState: emptyState, progress: progress, clear: clear };
})(window);
