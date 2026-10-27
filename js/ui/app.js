/*
 * نواة التطبيق — منصة «بصيرة» (للمتصفح فقط)
 * التحميل والحفظ، والتنقل بمسارات #/…، والرسائل، وحوار التأكيد، وحوار «البيانات».
 * الصفحات نفسها في js/ui/views/*.js وتُسجَّل على Basira.views.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var icon = B.dom.icon;

  // ---------- الحالة ----------
  var state = { data: null, today: null, persistent: true, loadMessage: '', currentPath: null };
  var store = B.storage.createStore(B.storage.getBrowserStorage(), B.sampleData.createSampleData);

  // تاريخ مرجعي اختياري للتجربة: index.html?today=2026-11-01 (وإلا تاريخ الجهاز).
  function resolveToday() {
    var param = new URLSearchParams(root.location.search).get('today');
    return param && B.format.parseISO(param) !== null ? param : B.format.todayISO();
  }

  function load() {
    var result = store.load();
    state.data = result.data;
    state.persistent = result.persistent;
    state.loadMessage = result.message;
    state.today = resolveToday();
  }

  function lookups() {
    var d = state.data;
    var index = function (list) { var o = {}; list.forEach(function (x) { o[x.id] = x; }); return o; };
    return { indicatorsById: index(d.indicators), entitiesById: index(d.entities), requirementsById: index(d.requirements) };
  }

  // يحفظ ويُظهر رسالة. يعيد true عند النجاح.
  function save(successMessage) {
    var result = store.save(state.data);
    if (result.ok) {
      if (successMessage) toast(successMessage, 'success');
      return true;
    }
    toast(result.message + ' التعديل ظاهر الآن لكنه لن يبقى بعد إغلاق الصفحة.', 'error');
    return false;
  }

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  // ---------- الرسائل ----------
  function toast(message, type) {
    var region = document.getElementById('toasts');
    var tone = type || 'info';
    var item = h('div', { class: 'toast toast--' + tone, role: tone === 'error' ? 'alert' : 'status' },
      icon(tone === 'error' ? 'alert' : 'check'),
      h('span', { class: 'toast__text' }, message),
      h('button', { type: 'button', class: 'toast__close', 'aria-label': 'إغلاق الرسالة', onclick: function () { item.remove(); } }, icon('close')));
    region.appendChild(item);
    if (tone !== 'error') setTimeout(function () { item.remove(); }, 4000);
  }

  // ---------- الحوارات ----------
  var dialog = null;

  function openDialog(titleText, body, actions, onClose) {
    dialog = dialog || document.getElementById('dialog');
    var opener = document.activeElement;
    B.dom.clear(dialog);
    var titleId = 'dialog-title';
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.appendChild(h('div', { class: 'dialog__box' },
      h('h2', { id: titleId, class: 'dialog__title' }, titleText),
      h('div', { class: 'dialog__body' }, body),
      h('div', { class: 'dialog__actions' }, actions)));
    var handler = function () {
      dialog.removeEventListener('close', handler);
      if (onClose) onClose(dialog.returnValue);
      if (opener && opener.focus) opener.focus();
    };
    dialog.addEventListener('close', handler);
    dialog.returnValue = '';
    dialog.showModal();
    var preferred = dialog.querySelector('[data-autofocus]');
    if (preferred) preferred.focus();
    return dialog;
  }

  // يعيد Promise<boolean>. التركيز الافتراضي على «إلغاء».
  function confirmDialog(options) {
    return new Promise(function (resolve) {
      var close = function (value) { return function () { dialog.close(value); }; };
      openDialog(options.title, h('p', null, options.body), [
        h('button', { type: 'button', class: 'btn ' + (options.danger ? 'btn--danger' : 'btn--primary'), onclick: close('yes') }, options.confirmLabel || 'تأكيد'),
        h('button', { type: 'button', class: 'btn btn--ghost', 'data-autofocus': true, onclick: close('no') }, 'إلغاء')
      ], function (value) { resolve(value === 'yes'); });
    });
  }

  // صياغة العدد العربية للمتطلبات: متطلب واحد، متطلبان، 3–10 متطلبات، 11+ متطلبًا.
  function countRequirements(n) {
    if (n === 1) return 'متطلب واحد';
    if (n === 2) return 'متطلبان';
    if (n >= 3 && n <= 10) return n + ' متطلبات';
    return n + ' متطلبًا';
  }

  // ---------- حوار «البيانات» ----------
  function exportBackup() {
    var file = B.storage.exportJson(state.data, state.today);
    var blob = new Blob([file.text], { type: 'application/json;charset=utf-8' });
    var link = h('a', { href: URL.createObjectURL(blob), download: file.filename });
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 0);
    toast('نُزّلت النسخة الاحتياطية: ' + file.filename, 'success');
  }

  function importBackup(fileInput) {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = B.storage.parseImport(reader.result);
      if (!parsed.ok) {
        toast('لم يُستورد الملف: ' + parsed.message + ' لم تتغير بياناتك.', 'error');
        return;
      }
      confirmDialog({
        title: 'استبدال البيانات الحالية؟',
        body: 'سيحل محتوى الملف «' + file.name + '» محل كل البيانات الحالية (في الملف ' + countRequirements(parsed.data.requirements.length) + '). يُستحسن تصدير نسخة احتياطية أولًا.',
        confirmLabel: 'استبدال البيانات',
        danger: true
      }).then(function (ok) {
        if (!ok) { toast('أُلغي الاستيراد ولم تتغير البيانات.', 'info'); return; }
        state.data = parsed.data;
        save('استُوردت البيانات من «' + file.name + '».');
        render(true);
      });
    };
    reader.onerror = function () { toast('تعذرت قراءة الملف.', 'error'); };
    reader.readAsText(file, 'utf-8');
  }

  function resetSample() {
    confirmDialog({
      title: 'إعادة البيانات التجريبية؟',
      body: 'ستُحذف كل التعديلات الحالية وتعود البيانات التجريبية الوهمية الأصلية. لا يمكن التراجع إلا من نسخة احتياطية.',
      confirmLabel: 'إعادة البيانات التجريبية',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      var result = store.resetToSample();
      state.data = result.data;
      if (result.ok) toast('أُعيدت البيانات التجريبية.', 'success');
      else toast(result.message, 'error');
      render(true);
    });
  }

  /*
   * يغلق الحوار الحالي ثم ينفذ fn بعد حدث close.
   * حدث close يصل متأخرًا، فلو فُتح حوار تأكيد مباشرة لاستقبل ذلك الحدث وعدّه «إلغاء».
   * المستمع المضاف هنا يُنفذ بعد مستمع الحوار القديم، والحوار الجديد يضيف مستمعه أثناء
   * إرسال الحدث نفسه، فلا يستقبله.
   */
  function closeThen(fn) {
    dialog.addEventListener('close', function () { fn(); }, { once: true });
    dialog.close();
  }

  function openDataDialog() {
    var input = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'import-file', onchange: function () { closeThen(function () { importBackup(input); }); } });
    var body = h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'البيانات محفوظة في هذا المتصفح فقط، فيُستحسن تصدير نسخة احتياطية بانتظام.'),
      h('button', { type: 'button', class: 'btn btn--primary btn--block', 'data-autofocus': true, onclick: function () { closeThen(exportBackup); } }, 'تصدير نسخة احتياطية (JSON)'),
      h('label', { class: 'btn btn--secondary btn--block', for: 'import-file' }, 'استيراد نسخة احتياطية'),
      input,
      h('button', { type: 'button', class: 'btn btn--ghost-danger btn--block', onclick: function () { closeThen(resetSample); } }, 'إعادة البيانات التجريبية'));
    openDialog('البيانات والنسخ الاحتياطي', body, [
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: function () { dialog.close(); } }, 'إغلاق')
    ]);
  }

  // ---------- التنقل ----------
  var ROUTES = [
    { re: /^\/dashboard$/, view: 'dashboard', nav: 'dashboard' },
    { re: /^\/rankings$/, view: 'rankings', nav: 'rankings' },
    { re: /^\/indicators\/([^/]+)\/edit$/, view: 'indicatorEdit', nav: 'rankings' },
    { re: /^\/indicators\/([^/]+)$/, view: 'indicator', nav: 'rankings' },
    { re: /^\/requirements$/, view: 'requirements', nav: 'requirements' },
    { re: /^\/requirements\/new$/, view: 'requirementForm', nav: 'requirements' },
    { re: /^\/requirements\/([^/]+)\/edit$/, view: 'requirementForm', nav: 'requirements' },
    { re: /^\/requirements\/([^/]+)$/, view: 'requirement', nav: 'requirements' },
    { re: /^\/entities$/, view: 'entities', nav: 'entities' },
    { re: /^\/entities\/([^/]+)$/, view: 'entity', nav: 'entities' },
    { re: /^\/followups$/, view: 'followups', nav: 'followups' },
    { re: /^\/reports$/, view: 'reports', nav: 'reports' },
    { re: /^\/activity$/, view: 'activity', nav: 'activity' }
  ];

  var NAV = [
    { key: 'dashboard', href: '#/dashboard', label: 'لوحة القيادة', short: 'القيادة', icon: 'home', mobile: true },
    { key: 'rankings', href: '#/rankings', label: 'التصنيفات والمؤشرات', short: 'المؤشرات', icon: 'chart', mobile: true },
    { key: 'requirements', href: '#/requirements', label: 'المتطلبات', short: 'المتطلبات', icon: 'list', mobile: true },
    { key: 'entities', href: '#/entities', label: 'الجهات والمسؤوليات', short: 'الجهات', icon: 'building' },
    { key: 'followups', href: '#/followups', label: 'المتابعات', short: 'المتابعات', icon: 'chat', mobile: true },
    { key: 'reports', href: '#/reports', label: 'التقارير', short: 'التقارير', icon: 'file' },
    { key: 'activity', href: '#/activity', label: 'سجل الأنشطة', short: 'السجل', icon: 'clock' }
  ];

  function parseHash() {
    var raw = (root.location.hash || '').replace(/^#/, '');
    var q = raw.indexOf('?');
    var path = q === -1 ? raw : raw.slice(0, q);
    var query = new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
    return { path: path || '', query: query };
  }

  function buildHash(path, params) {
    var qs = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) { if (params[k]) qs.set(k, params[k]); });
    var s = qs.toString();
    return '#' + path + (s ? '?' + s : '');
  }

  // تحديث معاملات الرابط دون إعادة رسم الصفحة (لحفظ حالة البحث والتصفية).
  function setQuery(params) {
    var current = parseHash();
    root.history.replaceState(null, '', buildHash(current.path, params));
  }

  function go(hash) {
    root.location.hash = hash;
  }

  function renderNav(activeKey) {
    var side = B.dom.clear(document.getElementById('nav-list'));
    var bottom = B.dom.clear(document.getElementById('bottom-nav-list'));
    var moreList = B.dom.clear(document.getElementById('more-list'));
    var moreActive = false;
    NAV.forEach(function (item) {
      var current = item.key === activeKey ? 'page' : null;
      side.appendChild(h('li', null, h('a', { href: item.href, class: 'nav__link', 'aria-current': current, title: item.label },
        icon(item.icon), h('span', { class: 'nav__label' }, item.label))));
      if (item.mobile) {
        bottom.appendChild(h('li', null, h('a', { href: item.href, class: 'bnav__link', 'aria-current': current },
          icon(item.icon), h('span', null, item.short))));
      } else {
        if (current) moreActive = true;
        moreList.appendChild(h('li', null, h('a', { href: item.href, class: 'more__link', 'aria-current': current }, icon(item.icon), h('span', null, item.label))));
      }
    });
    var moreBtn = document.getElementById('more-button');
    moreBtn.classList.toggle('is-active', moreActive);
  }

  function renderBanners() {
    var area = B.dom.clear(document.getElementById('banners'));
    if (!state.persistent && state.loadMessage) {
      area.appendChild(h('div', { class: 'banner banner--danger', role: 'alert' }, icon('alert'), h('span', null, state.loadMessage)));
    } else if (state.loadMessage) {
      area.appendChild(h('div', { class: 'banner banner--warning', role: 'status' }, icon('alert'), h('span', null, state.loadMessage)));
    }
    if (state.data.isSample) {
      area.appendChild(h('div', { class: 'banner banner--info' },
        h('span', null, 'تعمل المنصة ببيانات تجريبية وهمية للعرض والتجربة، ولا تمثل بيانات أي جامعة.'),
        h('button', { type: 'button', class: 'link-button', onclick: resetSample }, 'إعادة البيانات التجريبية')));
    }
  }

  function notFound() {
    toast('الصفحة غير موجودة، فتم الانتقال إلى لوحة القيادة.', 'info');
    root.location.replace('#/dashboard');
  }

  /*
   * يرسم الصفحة الحالية. keepFocus = true عند إعادة الرسم في الصفحة نفسها (بعد حفظ مثلًا)
   * حتى لا يقفز التركيز إلى العنوان.
   */
  function render(keepFocus) {
    var parsed = parseHash();
    if (!parsed.path) { root.location.replace('#/dashboard'); return; }
    var route = null;
    var match = null;
    for (var i = 0; i < ROUTES.length; i++) {
      match = parsed.path.match(ROUTES[i].re);
      if (match) { route = ROUTES[i]; break; }
    }
    if (!route) { notFound(); return; }

    var ctx = {
      data: state.data,
      today: state.today,
      lookups: lookups(),
      params: match.slice(1).map(decodeURIComponent),
      query: parsed.query,
      save: save,
      toast: toast,
      confirm: confirmDialog,
      go: go,
      setQuery: setQuery,
      newId: newId,
      rerender: function () { render(true); }
    };

    var main = document.getElementById('main');
    var view = B.views[route.view];
    var node;
    try {
      node = view(ctx);
    } catch (err) {
      node = B.dom.emptyState('تعذر عرض هذه الصفحة', 'حدث خطأ غير متوقع: ' + (err && err.message ? err.message : String(err)));
      if (root.console) root.console.error(err);
    }
    B.dom.clear(main).appendChild(node);
    renderNav(route.nav);
    renderBanners();
    document.getElementById('more-sheet').hidden = true;
    document.getElementById('more-button').setAttribute('aria-expanded', 'false');

    var heading = main.querySelector('h1');
    document.title = (heading ? heading.textContent + ' — ' : '') + 'بصيرة';
    // لا يُنقل التركيز عند التحميل الأول، حتى يبدأ Tab من «انتقل إلى المحتوى» والقائمة.
    var firstRender = state.currentPath === null;
    var routeChanged = state.currentPath !== parsed.path;
    state.currentPath = parsed.path;
    if (routeChanged && !keepFocus && !firstRender) {
      root.scrollTo(0, 0);
      if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    }
  }

  function boot() {
    load();
    document.getElementById('today-label').textContent = 'اليوم: ' + B.format.formatDate(state.today);
    document.getElementById('data-button').addEventListener('click', openDataDialog);
    // رابط التخطي: الموجّه يعامل أي # كمسار، فيُنقل التركيز مباشرة دون تغيير الرابط.
    document.querySelector('.skip-link').addEventListener('click', function (e) {
      e.preventDefault();
      document.getElementById('main').focus();
    });
    var moreBtn = document.getElementById('more-button');
    var sheet = document.getElementById('more-sheet');
    moreBtn.addEventListener('click', function () {
      sheet.hidden = !sheet.hidden;
      moreBtn.setAttribute('aria-expanded', String(!sheet.hidden));
      if (!sheet.hidden) { var first = sheet.querySelector('a'); if (first) first.focus(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) { sheet.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); moreBtn.focus(); }
    });
    root.addEventListener('hashchange', function () { render(false); });
    render(false);
  }

  B.app = { boot: boot, buildHash: buildHash };
  B.views = B.views || {};
  document.addEventListener('DOMContentLoaded', boot);
})(window);
