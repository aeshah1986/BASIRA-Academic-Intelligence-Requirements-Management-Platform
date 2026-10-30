// يتحقق من أن ملفات المنطق تعمل كسكربتات عادية في المتصفح (دون module)،
// وأنها تضع واجهتها على Basira كما يشترط CLAUDE.md (التشغيل عبر file://).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
  ['data/sample-data.js', 'sampleData', 'createSampleData'],
  ['data/demo-data.js', 'demoData', 'createDemoData'],
  ['js/normalize.js', 'normalize', 'normalizeText'],
  ['js/model.js', 'model', 'validateRequirement'],
  ['js/storage.js', 'storage', 'createStore'],
  ['js/format.js', 'format', 'formatDate'],
  ['js/derive.js', 'derive', 'dueInfo'],
  ['js/query.js', 'query', 'filterRequirements'],
  ['js/actions.js', 'actions', 'recordLetterSent'],
  ['js/csv.js', 'csv', 'toCSV'],
  ['js/insights.js', 'insights', 'rankRequirements'],
  ['js/sources.js', 'sources', 'tableFromCSV'],
  ['js/xlsx.js', 'xlsx', 'readXlsx'],
  ['js/engine.js', 'engine', 'run']
];

test('كل ملف يعمل كسكربت عادي ويضيف واجهته إلى Basira دون تعارض', () => {
  const sandbox = vm.createContext({});
  for (const [file] of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  }
  for (const [file, key, fn] of FILES) {
    assert.ok(sandbox.Basira && sandbox.Basira[key], file + ' → Basira.' + key);
    assert.equal(typeof sandbox.Basira[key][fn], 'function', file + ' → ' + fn);
  }
});

test('لا يستخدم أي ملف import/export (لا تعمل عبر file://)', () => {
  for (const [file] of FILES) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(text, /^\s*(import|export)\s/m, file);
  }
});
