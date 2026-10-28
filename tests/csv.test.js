// فحوص تصدير CSV (js/csv.js): الترميز، والتنصيص، والحماية من حقن الصيغ.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/csv.js');

test('CSV-01 BOM وCRLF وتنصيص كل خلية ومضاعفة علامات التنصيص', () => {
  const text = C.toCSV(['الاسم', 'الملاحظة'], [['وحدة "أ"', 'سطر1\nسطر2'], [3, null]]);
  assert.equal(text.charCodeAt(0), 0xFEFF);
  assert.equal(text, '﻿"الاسم","الملاحظة"\r\n"وحدة ""أ""","سطر1\nسطر2"\r\n"3",""\r\n');
});

test('CSV-02 الحماية من حقن الصيغ: = و+ و- و@ وTab وCR تُسبق بعلامة \'، والأرقام السالبة تبقى', () => {
  const cases = [
    ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
    ['+966 1', "'+966 1"],
    ['-cmd|calc', "'-cmd|calc"],
    ['@HYPERLINK("x")', "'@HYPERLINK(\"x\")"],
    ['\t=1', "'\t=1"],
    ['\r=1', "'\r=1"],
    ['-5', '-5'],
    ['-2.5', '-2.5'],
    ['1:15', '1:15'],
    ['AR-EDU-1', 'AR-EDU-1'],
    ['نص عادي = لا خطر', 'نص عادي = لا خطر']
  ];
  for (const [input, out] of cases) assert.equal(C.safeCell(input), out, JSON.stringify(input));
  assert.match(C.toCSV(['x'], [['=1+1']]), /"'=1\+1"/);
});
