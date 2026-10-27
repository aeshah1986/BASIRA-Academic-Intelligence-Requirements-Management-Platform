/*
 * بيانات تجريبية وهمية بالكامل — منصة «بصيرة» (BASIRA)
 * ------------------------------------------------------------
 * - كل القيم والجهات والمكلفين والتواريخ في هذا الملف وهمية، ولا تمثل بيانات أي جامعة.
 * - أسماء المؤشرات مأخوذة من منهجية التصنيف المنشورة علنًا، دون أوزان.
 * - حالات القبول في ACCEPTANCE_CRITERIA.md مبنية على هذه السجلات (F1–F6، I1/I6/I8/IQ، D1).
 *   لا تعدّل هذا الملف إلا بطلب صريح، ومع تحديث حالات القبول.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Basira = root.Basira || {};
    root.Basira.sampleData = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ARAB_EDU = 'التعليم والتعلم';
  var QS_DOMAIN = 'مؤشرات QS';

  function indicator(id, code, ranking, domain, order, name, extra) {
    var base = {
      id: id,
      code: code,
      ranking: ranking,
      domain: domain,
      order: order,
      name: name,
      workStatus: 'not_started',
      currentValue: '',
      progressFileValue: '',
      lastYearValue: '',
      notes: ''
    };
    return Object.assign(base, extra || {});
  }

  var SAMPLE = {
    schemaVersion: 1,
    isSample: true,

    entities: [
      { id: 'ent-hr', name: 'وحدة الموارد البشرية (وهمية)' },
      { id: 'ent-students', name: 'وحدة شؤون الطلاب (وهمية)' },
      { id: 'ent-partnerships', name: 'وحدة الشراكات الدولية (وهمية)' },
      { id: 'ent-research', name: 'وحدة البحث العلمي (وهمية)' },
      { id: 'ent-academic', name: 'وحدة الشؤون الأكاديمية (وهمية)' }
    ],

    indicators: [
      // I1
      indicator('ind-ar-edu-1', 'AR-EDU-1', 'ARAB', ARAB_EDU, 1,
        'نسبة أعضاء هيئة التدريس (العدد المكافئ للدوام الكامل) إلى عدد الطلبة',
        { workStatus: 'evidenced', currentValue: '1:15', progressFileValue: '1:11', lastYearValue: '1:19' }),
      indicator('ind-ar-edu-2', 'AR-EDU-2', 'ARAB', ARAB_EDU, 2,
        'نسبة أعضاء هيئة التدريس الحاصلين على الدكتوراه إلى عدد الطلبة'),
      indicator('ind-ar-edu-3', 'AR-EDU-3', 'ARAB', ARAB_EDU, 3,
        'معدل استخدام المنصات الرقمية وأدوات الذكاء الاصطناعي في التعليم'),
      indicator('ind-ar-edu-4', 'AR-EDU-4', 'ARAB', ARAB_EDU, 4,
        'عدد البرامج الأكاديمية البينية'),
      indicator('ind-ar-edu-5', 'AR-EDU-5', 'ARAB', ARAB_EDU, 5,
        'عدد أعضاء هيئة التدريس ذوي معامل هيرش 10 فأكثر في Scopus'),
      // I6
      indicator('ind-ar-edu-6', 'AR-EDU-6', 'ARAB', ARAB_EDU, 6,
        'عدد الخبراء المنتدبين من خارج الجامعة',
        { progressFileValue: '40', lastYearValue: '35' }),
      indicator('ind-ar-edu-7', 'AR-EDU-7', 'ARAB', ARAB_EDU, 7,
        'عدد الاعتمادات البرامجية الإقليمية أو الدولية'),
      // I8
      indicator('ind-ar-edu-8', 'AR-EDU-8', 'ARAB', ARAB_EDU, 8,
        'عدد الأبحاث المنشورة في مجلات مفهرسة عالميًا بمشاركة طلبة البكالوريوس',
        { workStatus: 'draft', currentValue: '120', progressFileValue: '120', lastYearValue: '90' }),
      indicator('ind-ar-edu-9', 'AR-EDU-9', 'ARAB', ARAB_EDU, 9,
        'عدد الحاصلين على جوائز علمية وأكاديمية مرموقة'),
      // IQ
      indicator('ind-qs-isr', 'QS-ISR', 'QS', QS_DOMAIN, 1, 'نسبة الطلاب الدوليين'),
      indicator('ind-qs-irn', 'QS-IRN', 'QS', QS_DOMAIN, 2, 'شبكة البحث الدولية'),
      indicator('ind-qs-cpf', 'QS-CPF', 'QS', QS_DOMAIN, 3, 'الاستشهادات لكل عضو هيئة تدريس')
    ],

    requirements: [
      { // F1
        id: 'req-f1',
        title: 'تحديث أعداد أعضاء هيئة التدريس',
        description: 'حصر الأعضاء على رأس العمل وفق تعريف العدد المكافئ للدوام الكامل.',
        indicatorId: 'ind-ar-edu-1',
        entityId: 'ent-hr',
        assignee: 'د. مكلف (أ)',
        deadline: '2026-10-20',
        status: 'in_progress',
        priority: 'high',
        missingData: 'عدد غير المتفرغين',
        createdAt: '2026-10-10T08:00:00.000Z',
        updatedAt: '2026-10-22T08:00:00.000Z',
        followUps: [
          { id: 'fu-1', date: '2026-10-22', note: 'تم التواصل مع الوحدة وطلب الحصر المحدث.' }
        ]
      },
      { // F2
        id: 'req-f2',
        title: 'بيانات الطلاب الدوليين',
        description: 'حصر الجنسيات المسجلة لمؤشر QS.',
        indicatorId: 'ind-qs-isr',
        entityId: 'ent-students',
        assignee: 'د. مكلف (ب)',
        deadline: '2026-11-05',
        status: 'waiting',
        priority: 'high',
        missingData: 'ملف الجنسيات للفصل الثاني',
        createdAt: '2026-10-12T08:00:00.000Z',
        updatedAt: '2026-10-12T08:00:00.000Z',
        followUps: []
      },
      { // F3
        id: 'req-f3',
        title: 'قائمة الشراكات البحثية الدولية',
        description: 'حصر الأبحاث المشتركة مع مؤسسات خارجية.',
        indicatorId: 'ind-qs-irn',
        entityId: 'ent-partnerships',
        assignee: 'د. مكلف (ج)',
        deadline: '2026-10-15',
        status: 'done',
        priority: 'medium',
        missingData: '',
        createdAt: '2026-10-01T08:00:00.000Z',
        updatedAt: '2026-10-14T08:00:00.000Z',
        followUps: []
      },
      { // F4
        id: 'req-f4',
        title: 'إحصاءات الاستشهادات للأبحاث المنشورة',
        description: 'استخراج تقرير الاستشهادات من SciVal للسنوات الخمس الأخيرة.',
        indicatorId: 'ind-qs-cpf',
        entityId: 'ent-research',
        assignee: 'د. مكلف (د)',
        deadline: '2026-12-15',
        status: 'new',
        priority: 'medium',
        missingData: 'تقرير SciVal محدث',
        createdAt: '2026-10-15T08:00:00.000Z',
        updatedAt: '2026-10-15T08:00:00.000Z',
        followUps: []
      },
      { // F5
        id: 'req-f5',
        title: 'أعداد البحوث المنشورة بمشاركة طلبة البكالوريوس',
        description: 'مطابقة الروابط مع Scopus والتأكد من ظهور اسم الطالب.',
        indicatorId: 'ind-ar-edu-8',
        entityId: 'ent-research',
        assignee: 'د. مكلف (د)',
        deadline: '2026-11-08',
        status: 'new',
        priority: 'low',
        missingData: 'روابط Scopus لبعض الأبحاث',
        createdAt: '2026-10-16T08:00:00.000Z',
        updatedAt: '2026-10-16T08:00:00.000Z',
        followUps: []
      },
      { // F6
        id: 'req-f6',
        title: 'بيانات الخبراء المنتدبين من خارج الجامعة',
        description: 'تعبئة نموذج المؤشر 6 من الكليات.',
        indicatorId: 'ind-ar-edu-6',
        entityId: 'ent-academic',
        assignee: 'د. مكلف (هـ)',
        deadline: '2026-10-25',
        status: 'waiting',
        priority: 'high',
        missingData: 'ردود الكليات على خطاب الطلب',
        createdAt: '2026-10-11T08:00:00.000Z',
        updatedAt: '2026-10-11T08:00:00.000Z',
        followUps: []
      }
    ],

    decisions: [
      { // D1
        id: 'dec-1',
        indicatorId: 'ind-ar-edu-1',
        question: 'أي رقم نعتمد لعدد أعضاء هيئة التدريس: المحسوب من ملف المصدر أم رقم ملف التقدم؟',
        askedTo: 'وكيل الجامعة (افتراضي)',
        askedOn: '2026-10-24',
        status: 'open',
        decision: '',
        decidedOn: ''
      }
    ]
  };

  // نسخة جديدة في كل مرة حتى لا تُعدَّل البيانات الأصلية عن طريق الخطأ.
  function createSampleData() {
    return JSON.parse(JSON.stringify(SAMPLE));
  }

  return { createSampleData: createSampleData };
});
