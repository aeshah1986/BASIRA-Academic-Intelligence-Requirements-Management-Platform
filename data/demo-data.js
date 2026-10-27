/*
 * بيانات العرض التجريبية — منصة «بصيرة» (BASIRA)
 * ------------------------------------------------------------
 * - كل ما في هذا الملف وهمي: الأسماء والجهات والقيم والتواريخ والملاحظات. لا يمثل جامعة بعينها.
 * - الأسماء مختارة عشوائيًا ولا تشير إلى أشخاص حقيقيين، وتطابق أي اسم مع شخص حقيقي محض مصادفة.
 * - القيم الرقمية مختلقة وتختلف عمدًا عن أي أرقام حقيقية (فحص آلي في tests/demo-data.test.js).
 * - الطبيعة الوهمية مُعلنة للمستخدم في شريط الواجهة وفي التقارير المطبوعة، لا بجانب كل اسم.
 * - التواريخ نسبية إلى «اليوم» عند إنشاء البيانات، حتى تبقى واقعية في أي وقت.
 * - هذه بيانات العرض الافتراضية. حالات القبول مبنية على data/sample-data.js (F1–F6) لا على هذا الملف.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Basira = root.Basira || {};
    root.Basira.demoData = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY_MS = 864e5;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toISO(t) {
    var d = new Date(t);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  var ARAB_EDU = 'التعليم والتعلم';
  var QS_DOMAIN = 'مؤشرات QS';

  function indicator(id, code, ranking, domain, order, name, extra) {
    return Object.assign({
      id: id, code: code, ranking: ranking, domain: domain, order: order, name: name,
      workStatus: 'not_started', currentValue: '', progressFileValue: '', lastYearValue: '', valueSource: '', notes: '', active: true
    }, extra || {});
  }

  /*
   * ينشئ نسخة جديدة من بيانات العرض. today بصيغة YYYY-MM-DD (افتراضيًا تاريخ الجهاز).
   */
  function createDemoData(today) {
    var base = /^\d{4}-\d{2}-\d{2}$/.test(today || '') ? today : localToday();
    var p = base.split('-').map(Number);
    var T = Date.UTC(p[0], p[1] - 1, p[2]);
    var d = function (offset) { return toISO(T + offset * DAY_MS); };
    var at = function (offset) { return new Date(T + offset * DAY_MS + 9 * 3600e3).toISOString(); };

    var entities = [
      { id: 'ent-faculty', name: 'عمادة شؤون أعضاء هيئة التدريس' },
      { id: 'ent-admission', name: 'عمادة القبول والتسجيل' },
      { id: 'ent-graduate', name: 'وكالة الدراسات العليا' },
      { id: 'ent-students', name: 'عمادة شؤون الطلاب' },
      { id: 'ent-quality', name: 'عمادة التطوير والجودة' },
      { id: 'ent-elearning', name: 'عمادة التعلم الإلكتروني' },
      { id: 'ent-international', name: 'إدارة الشراكات الدولية' },
      { id: 'ent-research', name: 'عمادة البحث العلمي' },
      { id: 'ent-careers', name: 'مركز الإرشاد المهني والتوظيف' }
    ];

    var indicators = [
      indicator('ind-ar-edu-1', 'AR-EDU-1', 'ARAB', ARAB_EDU, 1, 'نسبة أعضاء هيئة التدريس (العدد المكافئ للدوام الكامل) إلى عدد الطلبة',
        { workStatus: 'evidenced', currentValue: '1:18', progressFileValue: '1:14', lastYearValue: '1:21', valueSource: 'نظام شؤون أعضاء هيئة التدريس ونظام القبول والتسجيل', notes: 'رقم ملف التقدم بلا مصدر موثق، والقرار معروض على الوكيل.' }),
      indicator('ind-ar-edu-2', 'AR-EDU-2', 'ARAB', ARAB_EDU, 2, 'نسبة أعضاء هيئة التدريس الحاصلين على الدكتوراه إلى عدد الطلبة',
        { workStatus: 'draft', currentValue: '1:29', progressFileValue: '1:29', lastYearValue: '1:31' }),
      indicator('ind-ar-edu-3', 'AR-EDU-3', 'ARAB', ARAB_EDU, 3, 'معدل استخدام المنصات الرقمية وأدوات الذكاء الاصطناعي في التعليم',
        { workStatus: 'evidenced', currentValue: '95%', progressFileValue: '95%', lastYearValue: '88%', valueSource: 'نموذج المؤشر 3 بعد التعبئة' }),
      indicator('ind-ar-edu-4', 'AR-EDU-4', 'ARAB', ARAB_EDU, 4, 'عدد البرامج الأكاديمية البينية',
        { workStatus: 'draft', currentValue: '7', progressFileValue: '9', lastYearValue: '5', notes: 'برنامجان في ملف التقدم دون توصيف يثبت أنهما بينيان.' }),
      indicator('ind-ar-edu-5', 'AR-EDU-5', 'ARAB', ARAB_EDU, 5, 'عدد أعضاء هيئة التدريس ذوي معامل هيرش 10 فأكثر في Scopus',
        { workStatus: 'evidenced', currentValue: '312', progressFileValue: '312', lastYearValue: '280', valueSource: 'تقرير SciVal للفترة 2021–2025' }),
      indicator('ind-ar-edu-6', 'AR-EDU-6', 'ARAB', ARAB_EDU, 6, 'عدد الخبراء المنتدبين من خارج الجامعة',
        { progressFileValue: '27', lastYearValue: '22' }),
      indicator('ind-ar-edu-7', 'AR-EDU-7', 'ARAB', ARAB_EDU, 7, 'عدد الاعتمادات البرامجية الإقليمية أو الدولية',
        { workStatus: 'draft', currentValue: '19', progressFileValue: '23', lastYearValue: '15', notes: 'الفرق ناتج عن احتساب اعتمادات محلية في ملف التقدم.' }),
      indicator('ind-ar-edu-8', 'AR-EDU-8', 'ARAB', ARAB_EDU, 8, 'عدد الأبحاث المنشورة في مجلات مفهرسة عالميًا بمشاركة طلبة البكالوريوس',
        { workStatus: 'draft', currentValue: '142', progressFileValue: '142', lastYearValue: '118' }),
      indicator('ind-ar-edu-9', 'AR-EDU-9', 'ARAB', ARAB_EDU, 9, 'عدد الحاصلين على جوائز علمية وأكاديمية مرموقة',
        { lastYearValue: '2' }),
      indicator('ind-qs-isr', 'QS-ISR', 'QS', QS_DOMAIN, 1, 'نسبة الطلاب الدوليين'),
      indicator('ind-qs-irn', 'QS-IRN', 'QS', QS_DOMAIN, 2, 'شبكة البحث الدولية', { workStatus: 'draft', currentValue: '410', lastYearValue: '365' }),
      indicator('ind-qs-cpf', 'QS-CPF', 'QS', QS_DOMAIN, 3, 'الاستشهادات لكل عضو هيئة تدريس'),
      indicator('ind-qs-ifr', 'QS-IFR', 'QS', QS_DOMAIN, 4, 'نسبة أعضاء هيئة التدريس الدوليين', { workStatus: 'draft', currentValue: '24%', lastYearValue: '26%' }),
      indicator('ind-qs-er', 'QS-ER', 'QS', QS_DOMAIN, 5, 'سمعة الجهات الموظِّفة')
    ];

    var n = 0;
    function req(fields, offsets) {
      n++;
      return Object.assign({
        id: 'req-demo-' + (n < 10 ? '0' : '') + n,
        description: '', assignee: '', missingData: '', evidenceLink: '',
        createdAt: at(offsets.created), updatedAt: at(offsets.updated), followUps: []
      }, fields, { deadline: d(offsets.deadline) });
    }
    function fu(id, offset, type, note, outcome, next) { return { id: id, date: d(offset), type: type, outcome: outcome || 'no_reply', note: note, nextActionDate: next === undefined ? '' : d(next) }; }

    var requirements = [
      req({ title: 'حصر أعضاء هيئة التدريس حسب الرتبة ونوع التفرغ', description: 'حصر المعينين والمعارين والمتعاقدين مع فصل المتفرغين عن غير المتفرغين لاحتساب العدد المكافئ للدوام الكامل.',
        indicatorId: 'ind-ar-edu-1', entityId: 'ent-faculty', assignee: 'د. خالد الشهري', status: 'in_progress', priority: 'high', missingData: 'أعداد غير المتفرغين لاحتساب FTE',
        followUps: [fu('fu-demo-01', -14, 'letter', 'أُرسل خطاب طلب الحصر إلى العمادة مع نموذج التعبئة.'), fu('fu-demo-02', -5, 'call', 'أفادت العمادة بأن الحصر سيُسلَّم خلال أسبوع.', 'promised', -1)] },
        { created: -20, updated: -5, deadline: -9 }),
      req({ title: 'أعداد الطلبة المقيدين في جميع المراحل', description: 'أعداد الدبلوم والبكالوريوس والدراسات العليا لسنة البيانات، بالعدد الفعلي للطلبة.',
        indicatorId: 'ind-ar-edu-1', entityId: 'ent-admission', assignee: 'د. نورة الزهراني', status: 'waiting', priority: 'high', missingData: 'أعداد طلبة الدكتوراه',
        followUps: [fu('fu-demo-03', -8, 'letter', 'خطاب طلب الأعداد مع توضيح شمول طلبة الماجستير والدكتوراه.'), fu('fu-demo-04', -1, 'meeting', 'طُلب فصل أعداد الدكتوراه في جدول مستقل.', 'partial', 3)] },
        { created: -18, updated: -1, deadline: -4 }),
      req({ title: 'التحقق من تعارض عدد الأعضاء مع ملف التقدم', description: 'مقارنة الرقم المحسوب من النظام بالرقم المسجل في ملف التقدم وتحديد مصدر كل منهما.',
        indicatorId: 'ind-ar-edu-1', entityId: 'ent-quality', assignee: 'د. ريم الحربي', status: 'in_progress', priority: 'high', missingData: 'مصدر الرقم المسجل في ملف التقدم' },
        { created: -6, updated: -2, deadline: 2 }),
      req({ title: 'عدد حملة الدكتوراه من أعضاء هيئة التدريس', description: 'الأساتذة والأساتذة المشاركون والأساتذة المساعدون حسب الرتبة.',
        indicatorId: 'ind-ar-edu-2', entityId: 'ent-faculty', assignee: 'د. خالد الشهري', status: 'new', priority: 'medium' },
        { created: -4, updated: -4, deadline: 5 }),
      req({ title: 'قائمة البرامج المستخدمة للمنصات الرقمية وأدوات الذكاء الاصطناعي', description: 'تعبئة نموذج المؤشر 3 بالبرامج والأدوات وروابطها.',
        indicatorId: 'ind-ar-edu-3', entityId: 'ent-elearning', assignee: 'د. فهد المالكي', status: 'done', priority: 'medium', evidenceLink: 'https://example.org/basira/evidence/ar-edu-3' },
        { created: -30, updated: -13, deadline: -12 }),
      req({ title: 'توثيق البرامج البينية بخطاب رسمي', description: 'توصيف كل برنامج بيني مع التخصصات المدمجة والدرجة الممنوحة.',
        indicatorId: 'ind-ar-edu-4', entityId: 'ent-graduate', assignee: 'د. هند الغامدي', status: 'waiting', priority: 'medium', missingData: 'توصيف برنامجين بينيين' },
        { created: -10, updated: -3, deadline: 9 }),
      req({ title: 'تصحيح عدد البرامج البينية في ملف التقدم', indicatorId: 'ind-ar-edu-4', entityId: 'ent-quality', assignee: 'د. ريم الحربي', status: 'new', priority: 'medium' },
        { created: -2, updated: -2, deadline: 3 }),
      req({ title: 'استخراج قائمة الباحثين ذوي معامل هيرش 10 فأكثر', description: 'من SciVal للسنوات الخمس الأخيرة، مع التحقق من أدنى معامل في القائمة.',
        indicatorId: 'ind-ar-edu-5', entityId: 'ent-research', assignee: 'د. عبدالله السبيعي', status: 'done', priority: 'high', evidenceLink: 'https://example.org/basira/evidence/ar-edu-5' },
        { created: -35, updated: -21, deadline: -20 }),
      req({ title: 'بيانات الخبراء المنتدبين من الكليات', description: 'تعبئة نموذج المؤشر 6 من كل كلية: الخبير، والجهة، ونوع الدور، والمقرر، والمؤهل.',
        indicatorId: 'ind-ar-edu-6', entityId: 'ent-graduate', assignee: 'د. هند الغامدي', status: 'waiting', priority: 'high', missingData: 'ردود 4 كليات على خطاب الطلب',
        followUps: [fu('fu-demo-05', -12, 'letter', 'خطاب إلى عمداء الكليات بطلب بيانات الخبراء.'), fu('fu-demo-06', -7, 'email', 'تذكير ثانٍ للكليات التي لم ترد.', 'partial', 0)] },
        { created: -16, updated: -7, deadline: -6 }),
      req({ title: 'خطاب طلب بيانات الخبراء من الكليات الصحية', indicatorId: 'ind-ar-edu-6', entityId: 'ent-quality', assignee: 'د. منى القرني', status: 'in_progress', priority: 'high' },
        { created: -3, updated: -1, deadline: 1 }),
      req({ title: 'حصر الاعتمادات البرامجية الإقليمية والدولية', description: 'الاعتمادات السارية خلال سنة التصنيف مع شهاداتها.',
        indicatorId: 'ind-ar-edu-7', entityId: 'ent-quality', assignee: 'د. منى القرني', status: 'in_progress', priority: 'high', missingData: 'شهادات اعتماد 3 برامج',
        followUps: [fu('fu-demo-07', -10, 'meeting', 'اتُّفق على استبعاد الاعتمادات المحلية حتى يصدر القرار.', 'other')] },
        { created: -15, updated: -10, deadline: -2 }),
      req({ title: 'حذف الاعتمادات المكررة من القائمة', indicatorId: 'ind-ar-edu-7', entityId: 'ent-quality', assignee: 'د. ريم الحربي', status: 'new', priority: 'medium' },
        { created: -1, updated: -1, deadline: 6 }),
      req({ title: 'استكمال روابط Scopus للأبحاث بمشاركة طلبة البكالوريوس', description: 'استبدال روابط DOI بروابط Scopus يظهر فيها اسم الطالب.',
        indicatorId: 'ind-ar-edu-8', entityId: 'ent-research', assignee: 'د. عبدالله السبيعي', status: 'in_progress', priority: 'high', missingData: 'روابط Scopus لـ 11 بحثًا',
        followUps: [fu('fu-demo-08', -3, 'call', 'جارٍ استبدال الروابط، وأُنجز نصفها تقريبًا.', 'partial', 2)] },
        { created: -9, updated: -3, deadline: 4 }),
      req({ title: 'التحقق من ظهور أسماء الطلبة في قائمة المؤلفين', indicatorId: 'ind-ar-edu-8', entityId: 'ent-students', assignee: 'د. لمى الدوسري', status: 'new', priority: 'low' },
        { created: -2, updated: -2, deadline: 12 }),
      req({ title: 'حصر الحاصلين على الجوائز المعتمدة في قائمة التصنيف', description: 'أعضاء هيئة التدريس والطلبة والخريجون، مع اسم الجائزة وسنتها.',
        indicatorId: 'ind-ar-edu-9', entityId: 'ent-students', assignee: 'د. ياسر العتيبي', status: 'new', priority: 'medium', missingData: 'شهادات الجوائز' },
        { created: -5, updated: -5, deadline: 15 }),
      req({ title: 'إعداد ملف التقدم المحدث لاجتماع اللجنة', indicatorId: 'ind-ar-edu-3', entityId: 'ent-quality', assignee: 'د. ريم الحربي', status: 'done', priority: 'medium', evidenceLink: 'https://example.org/basira/evidence/progress-file' },
        { created: -25, updated: -16, deadline: -15 }),
      req({ title: 'نسبة الطلاب الدوليين لدورة QS', indicatorId: 'ind-qs-isr', entityId: 'ent-admission', assignee: 'د. نورة الزهراني', status: 'new', priority: 'medium', missingData: 'أعداد الطلبة غير السعوديين حسب المرحلة' },
        { created: -3, updated: -3, deadline: 35 }),
      req({ title: 'قائمة الأبحاث المشتركة دوليًا', indicatorId: 'ind-qs-irn', entityId: 'ent-international', assignee: 'د. ماجد الشمري', status: 'in_progress', priority: 'medium' },
        { created: -7, updated: -2, deadline: 28 }),
      req({ title: 'تقرير الاستشهادات لكل عضو هيئة تدريس', indicatorId: 'ind-qs-cpf', entityId: 'ent-research', assignee: 'د. عبدالله السبيعي', status: 'new', priority: 'medium' },
        { created: -3, updated: -3, deadline: 42 }),
      req({ title: 'أعداد أعضاء هيئة التدريس غير السعوديين', indicatorId: 'ind-qs-ifr', entityId: 'ent-faculty', assignee: 'د. خالد الشهري', status: 'new', priority: 'low' },
        { created: -3, updated: -3, deadline: 30 }),
      req({ title: 'قائمة جهات التوظيف المرشحة لمسح السمعة', indicatorId: 'ind-qs-er', entityId: 'ent-careers', assignee: 'د. سلمان البقمي', status: 'new', priority: 'medium' },
        { created: -2, updated: -2, deadline: 50 })
    ];

    var decisions = [
      { id: 'dec-demo-1', indicatorId: 'ind-ar-edu-1', question: 'أي رقم نعتمد لعدد أعضاء هيئة التدريس: المحسوب من النظام أم رقم ملف التقدم؟',
        askedTo: 'وكيل الجامعة للشؤون التعليمية', askedOn: d(-5), status: 'open', decision: '', decidedOn: '' },
      { id: 'dec-demo-2', indicatorId: 'ind-ar-edu-7', question: 'هل تُحتسب الاعتمادات المحلية ضمن المؤشر 7، أم الإقليمية والدولية فقط؟',
        askedTo: 'لجنة التصنيفات', askedOn: d(-9), status: 'open', decision: '', decidedOn: '' },
      { id: 'dec-demo-3', indicatorId: 'ind-ar-edu-5', question: 'هل تُعتمد قائمة SciVal للسنوات الخمس الأخيرة مصدرًا للمؤشر 5؟',
        askedTo: 'لجنة التصنيفات', askedOn: d(-18), status: 'resolved', decision: 'اعتُمدت القائمة بعد التحقق من أن أدنى معامل فيها أقل من العتبة.', decidedOn: d(-16) },
      { id: 'dec-demo-4', indicatorId: 'ind-ar-edu-8', question: 'هل نستكمل روابط Scopus الناقصة، أم نقدم الأبحاث الموثقة فقط؟',
        askedTo: 'وكيل الجامعة للدراسات العليا', askedOn: d(-2), status: 'open', decision: '', decidedOn: '' }
    ];

    var rankings = [
      { id: 'ARAB', name: 'التصنيف العربي للجامعات', submissionDeadline: d(9), cycleLabel: 'دورة العرض' },
      { id: 'QS', name: 'QS', submissionDeadline: d(56), cycleLabel: 'دورة العرض' }
    ];

    var ev = function (id, indicatorId, requirementId, title, type, reference, status, reviewNote, reviewedOffset) {
      return { id: id, indicatorId: indicatorId, requirementId: requirementId, title: title, type: type, reference: reference, notes: '',
        status: status, reviewNote: reviewNote || '', reviewedOn: reviewedOffset === undefined ? '' : d(reviewedOffset), createdAt: at(-12), updatedAt: at(-3) };
    };
    var evidence = [
      ev('ev-demo-1', 'ind-ar-edu-3', 'req-demo-05', 'نموذج المؤشر 3 بعد التعبئة', 'template', 'مجلد التصنيفات ← التعليم والتعلم ← المؤشر 3', 'verified', 'العدد مطابق لقائمة البرامج المعتمدة.', -11),
      ev('ev-demo-2', 'ind-ar-edu-5', 'req-demo-08', 'تقرير SciVal لمعامل هيرش', 'link', 'https://example.org/basira/evidence/scival-report', 'verified', 'أدنى معامل في القائمة أقل من العتبة، فالعد مكتمل.', -19),
      ev('ev-demo-3', 'ind-ar-edu-1', 'req-demo-01', 'خطاب العمادة بأعداد أعضاء هيئة التدريس', 'letter', 'بانتظار رقم الصادر من العمادة', 'pending'),
      ev('ev-demo-4', 'ind-ar-edu-7', 'req-demo-11', 'شهادات الاعتماد البرامجي', 'file', 'مجلد الاعتمادات ← دورة العرض', 'rejected', 'ثلاث شهادات منتهية الصلاحية قبل سنة التصنيف.', -4),
      ev('ev-demo-5', 'ind-ar-edu-8', 'req-demo-13', 'قائمة الأبحاث بروابط Scopus', 'template', 'نموذج المؤشر 8 (نسخة العمل)', 'pending'),
      ev('ev-demo-6', 'ind-ar-edu-4', 'req-demo-06', 'توصيف البرامج البينية', 'file', 'ملفات توصيف البرامج من وكالة الدراسات العليا', 'pending'),
      ev('ev-demo-7', 'ind-ar-edu-2', '', 'خطاب حصر حملة الدكتوراه', 'letter', 'مسودة لدى عمادة التطوير والجودة', 'pending')
    ];

    return { schemaVersion: 2, isSample: true, rankings: rankings, entities: entities, indicators: indicators, requirements: requirements,
      decisions: decisions, evidence: evidence, activities: [] };
  }

  return { createDemoData: createDemoData };
});
