/*
 * الخطابات — #/letters و#/letters/templates (docs/design/07 §4.1–4.2)
 * يُعد الخطاب من قالب قابل للتعديل وبيانات الجهة المفتوحة. المنصة لا ترسل شيئًا ولا تخزن بريدًا:
 * نسخ، أو طباعة، ثم «تسجيل الإرسال» يوثق متابعة لكل بند بمستوى التصعيد.
 */
(function (root) {
  'use strict';
  var B = root.Basira;
  var h = B.dom.h;
  var U = B.ui;
  var I = B.insights;
  var A = B.actions;
  var D = B.derive;

  // صياغة العدد: بند واحد، بندان، 3–10 بنود، 11+ بندًا.
  function countItems(n) {
    if (n === 1) return 'بند واحد';
    if (n === 2) return 'بندان';
    if (n >= 3 && n <= 10) return n + ' بنود';
    return n + ' بندًا';
  }

  function levelOptions() {
    return I.LEVELS.map(function (L) { return { value: L.code, label: L.code + ' — ' + L.name }; });
  }

  B.views.letters = function (ctx) {
    var d = ctx.data;
    var withOpen = d.entities.filter(function (e) { return d.requirements.some(function (r) { return r.entityId === e.id && D.isOpen(r); }); });
    var header = U.pageHeader('الخطابات', 'خطابات طلب البيانات والتذكير والتصعيد من قوالب قابلة للتعديل. المنصة لا ترسل شيئًا: يُنسخ النص أو يُطبع.',
      h('a', { href: '#/letters/templates', class: 'btn btn--secondary' }, 'تعديل القوالب'));
    if (!withOpen.length) {
      return h('div', null, header, B.dom.emptyState('لا جهات لديها متطلبات مفتوحة', 'لا حاجة إلى خطابات الآن.'));
    }
    var entityId = ctx.query.get('entity');
    if (!withOpen.some(function (e) { return e.id === entityId; })) entityId = withOpen[0].id;
    var suggested = I.suggestedLevel(d, entityId, ctx.today);
    var level = ctx.query.get('level');
    if (!I.LEVELS.some(function (L) { return L.code === level; })) level = suggested;

    var entSel = U.selectControl('entity', withOpen.map(function (e) {
      var n = d.requirements.filter(function (r) { return r.entityId === e.id && D.isOpen(r); }).length;
      return { value: e.id, label: e.name + ' (' + n + ' مفتوح)' };
    }), entityId);
    var lvlSel = U.selectControl('level', levelOptions(), level);
    var apply = function (resetLevel) {
      ctx.go(B.app.buildHash('/letters', { entity: entSel.value, level: resetLevel ? '' : lvlSel.value }));
    };
    entSel.addEventListener('change', function () { apply(true); });
    lvlSel.addEventListener('change', function () { apply(false); });

    var letter = I.buildLetter(d, entityId, level, ctx.today);
    var picker = h('div', { class: 'filters filters--inline no-print' },
      U.field({ id: 'l-entity', name: 'entity', label: 'الجهة', control: entSel }),
      U.field({ id: 'l-level', name: 'level', label: 'مستوى الخطاب', control: lvlSel }));
    var hint = h('p', { class: 'muted small no-print', id: 'suggested-level' },
      'المستوى المقترح لهذه الجهة اليوم حسب سلّم التصعيد: ', h('strong', null, suggested), ' (' + I.LEVELS[Number(suggested.slice(1))].name + ').',
      level !== suggested ? ' اخترت مستوى مختلفًا.' : '');
    if (!letter.ok) return h('div', null, header, picker, B.dom.emptyState('تعذر إعداد الخطاب', letter.message));

    var subject = h('input', { type: 'text', name: 'subject', class: 'input', value: letter.subject, dir: 'auto' });
    var body = h('textarea', { name: 'body', class: 'input letter__editor', rows: '18', dir: 'auto' });
    body.value = letter.body;
    var printSubject = h('p', { class: 'letter__subject' }, 'الموضوع: ' + letter.subject);
    var printBody = h('div', { class: 'letter__body' }, letter.body);
    var sync = function () { printSubject.textContent = 'الموضوع: ' + subject.value; printBody.textContent = body.value; };
    subject.addEventListener('input', sync);
    body.addEventListener('input', sync);

    function fullText() { return 'الموضوع: ' + subject.value + '\n\n' + body.value; }

    function copy() {
      ctx.copyText(fullText()).then(function (ok) {
        ctx.toast(ok ? 'نُسخ نص الخطاب. يمكن لصقه في البريد الرسمي.' : 'تعذر النسخ في هذا المتصفح. يرجى تحديد النص ونسخه يدويًا.', ok ? 'success' : 'error');
        if (!ok) { body.focus(); body.select(); }
      });
    }

    function record() {
      ctx.confirm({
        title: 'تسجيل إرسال الخطاب؟',
        body: 'ستُسجَّل متابعة «خطاب ' + letter.level.code + '» بتاريخ اليوم لكل بند (' + countItems(letter.items.length) + ') لدى «' + letter.entity.name + '»، مع موعد الإجراء التالي حسب سلّم التصعيد. لا يُرسل شيء من المنصة: سجّل فقط بعد إرسالك الخطاب بنفسك.',
        confirmLabel: 'تسجيل الإرسال'
      }).then(function (ok) {
        if (!ok) return;
        var res = A.recordLetterSent(d, letter.entity.id, letter.level.level, letter.plan, ctx.env());
        if (!res.ok) { ctx.toast(res.message, 'error'); return; }
        ctx.save('سُجل إرسال خطاب ' + letter.level.code + ': ' + countItems(res.info.count) + '.');
        ctx.rerender();
      });
    }

    var items = h('ul', { class: 'compact-list' }, letter.items.map(function (r) {
      var esc = I.escalation(r, ctx.today);
      return h('li', null, h('a', { href: '#/requirements/' + encodeURIComponent(r.id) }, r.title), ' ', U.dueBadge(r, ctx.today),
        esc.executed >= 0 ? [' ', h('span', { class: 'muted small' }, 'آخر مستوى مسجل: '), U.escalationBadge(esc.executed)] : h('span', { class: 'muted small' }, ' · لا مستويات مسجلة'));
    }));

    return h('div', { class: 'letters-page' }, header, picker, hint,
      letter.unknown.length ? h('p', { class: 'banner banner--warning no-print', role: 'status' }, 'في القالب متغيرات غير معروفة تُركت كما هي: ' + letter.unknown.map(function (x) { return '{' + x + '}'; }).join('، ')) : null,
      h('div', { class: 'grid grid--main-side' },
        U.card('مسودة الخطاب', h('div', { class: 'stack' },
          h('div', { class: 'no-print stack' },
            U.field({ id: 'l-subject', name: 'subject', label: 'الموضوع', control: subject }),
            U.field({ id: 'l-body', name: 'body', label: 'النص (قابل للتعديل قبل النسخ أو الطباعة)', hint: 'التعديل هنا للخطاب الحالي فقط. لتغيير النص الأساسي لكل الخطابات: «تعديل القوالب».' + (letter.custom ? ' القالب المستخدم معدّل.' : ' القالب المستخدم افتراضي.'), control: body })),
          h('div', { class: 'letter print-only' }, printSubject, printBody),
          h('div', { class: 'form-actions no-print' },
            h('button', { type: 'button', class: 'btn btn--primary', onclick: copy }, B.dom.icon('copy'), 'نسخ النص'),
            h('button', { type: 'button', class: 'btn btn--secondary', onclick: function () { root.print(); } }, B.dom.icon('printer'), 'طباعة'),
            h('button', { type: 'button', class: 'btn btn--secondary', id: 'record-sent', onclick: record }, 'تسجيل الإرسال'))), { id: 'letter-title' }),
        h('div', { class: 'stack no-print' },
          U.card('بنود الخطاب: ' + countItems(letter.items.length), h('div', null,
            h('p', { class: 'muted small' }, 'كل متطلبات الجهة المفتوحة، مرتبة بالموعد.'), items)),
          U.card('الخصوصية', h('p', { class: 'muted small' }, 'الخطاب يذكر المسميات الوظيفية فقط. لا يُخزن بريد أو هاتف، ولا يُرسل شيء من المنصة أو إليها.')))));
  };

  // ---------- تعديل القوالب ----------
  B.views.letterTemplates = function (ctx) {
    var d = ctx.data;
    var vars = h('ul', { class: 'compact-list' }, Object.keys(I.PLACEHOLDERS).map(function (k) {
      return h('li', null, B.dom.ltr('{' + k + '}', 'strong'), ' — ', I.PLACEHOLDERS[k]);
    }));

    function templateForm(L) {
      var t = I.templateFor(d, L.code);
      var form = h('form', { class: 'form', novalidate: true, 'data-template': L.code },
        h('p', { class: 'form-summary banner banner--danger', role: 'alert', hidden: true }),
        U.field({ id: 't-' + L.code + '-subject', name: 'subject', label: 'الموضوع', required: true, control: h('input', { type: 'text', name: 'subject', class: 'input', value: t.subject, maxlength: '220', dir: 'auto' }) }),
        U.field({ id: 't-' + L.code + '-body', name: 'body', label: 'النص', required: true, control: (function () { var ta = h('textarea', { name: 'body', class: 'input', rows: '10', maxlength: '4200', dir: 'auto' }); ta.value = t.body; return ta; })() }),
        h('div', { class: 'form-actions' },
          h('button', { type: 'submit', class: 'btn btn--primary' }, 'حفظ القالب'),
          t.custom ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: reset }, 'استعادة النص الافتراضي') : null));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var res = A.updateLetterTemplate(d, L.code, { subject: form.elements.subject.value, body: form.elements.body.value }, ctx.env(), I.unknownPlaceholders);
        if (!U.handle(form, res, ctx)) return;
        ctx.save('حُفظ قالب ' + L.code + '.');
        ctx.rerender();
      });
      function reset() {
        ctx.confirm({ title: 'استعادة النص الافتراضي؟', body: 'سيُحذف تعديلك على قالب ' + L.code + ' ويعود النص الافتراضي.', confirmLabel: 'استعادة' }).then(function (ok) {
          if (!ok) return;
          var res = A.resetLetterTemplate(d, L.code, ctx.env());
          if (!res.ok) { ctx.toast(res.message, 'error'); return; }
          ctx.save('أُعيد قالب ' + L.code + ' إلى النص الافتراضي.');
          ctx.rerender();
        });
      }
      return U.card(L.code + ' — ' + L.name, h('div', null,
        h('p', { class: 'meta-line' }, t.custom ? B.dom.badge('معدّل', 'info') : B.dom.badge('افتراضي', 'neutral'), ' ',
          h('span', { class: 'muted small' }, 'الموجَّه إليه: ' + L.to + (L.offset === null ? ' · عند بدء الطلب' : ' · ' + (L.offset < 0 ? 'قبل الموعد بـ ' + B.format.dayCount(-L.offset) : 'بعد الموعد بـ ' + B.format.dayCount(L.offset))))),
        form), { id: 'tpl-' + L.code });
    }

    return h('div', null,
      U.backLink('#/letters', 'الخطابات'),
      U.pageHeader('قوالب الخطابات', 'نص كل مستوى من سلّم التصعيد. تُستبدل المتغيرات ببيانات الجهة عند إعداد الخطاب.'),
      U.card('المتغيرات المتاحة', h('div', null, vars, h('p', { class: 'muted small' }, 'المتغير غير المعروف يُرفض عند الحفظ. ولا يُقبل بريد أو هاتف في القالب.'))),
      I.LEVELS.map(templateForm));
  };
})(window);
