// فحوص Hook الحماية (.claude/hooks/guard.js): يُشغَّل كما يشغّله Claude Code، بمدخل JSON على stdin.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', '.claude', 'hooks', 'guard.js');
const REAL = 'C:\\Users\\User\\Desktop\\ملف التصنيفات العربية';

function run(tool_name, tool_input) {
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input }), encoding: 'utf8' });
  let json = null;
  try { json = r.stdout ? JSON.parse(r.stdout) : null; } catch (e) { json = 'invalid'; }
  return { code: r.status, stderr: r.stderr, json };
}
const ask = res => res.code === 0 && res.json && res.json.hookSpecificOutput.permissionDecision === 'ask';

test('HOOK-01 الكتابة في مجلد البيانات الحقيقية تُمنع بكل صيغ المسار (رمز 2 ورسالة عربية)', () => {
  for (const [tool, input] of [
    ['Write', { file_path: REAL + '\\جديد.txt', content: 'x' }],
    ['Edit', { file_path: REAL + '\\ملفات مساعدة\\a.md', old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: 'C:/Users/User/Desktop/ملف التصنيفات العربية/x.csv', content: 'x' }],
    ['NotebookEdit', { notebook_path: '/c/Users/User/Desktop/ملف التصنيفات العربية/n.ipynb' }],
    ['Bash', { command: 'echo x > "/c/Users/User/Desktop/ملف التصنيفات العربية/x.txt"' }],
    ['Bash', { command: 'rm -f "/c/Users/User/Desktop/ملف التصنيفات العربية/old.xlsx"' }],
    ['PowerShell', { command: 'Remove-Item "' + REAL + '\\a.xlsx" -Confirm:$false' }],
    ['PowerShell', { command: 'Set-Content -Path "' + REAL + '\\a.txt" -Value 1' }]
  ]) {
    const r = run(tool, input);
    assert.equal(r.code, 2, tool + ' ' + JSON.stringify(input));
    assert.match(r.stderr, /للقراءة فقط/);
  }
});

test('HOOK-02 القراءة من المجلد الحقيقي، والكتابة في المشروع، تمر دون تدخل', () => {
  for (const [tool, input] of [
    ['Bash', { command: 'ls "/c/Users/User/Desktop/ملف التصنيفات العربية" 2>/dev/null' }],
    ['PowerShell', { command: 'Get-ChildItem "' + REAL + '"' }],
    ['Write', { file_path: 'C:\\Users\\User\\Documents\\Final Project\\BASIRA\\docs\\x.md', content: 'x' }],
    ['Bash', { command: 'node --test > out.txt' }],
    ['Read', { file_path: REAL + '\\منهجية.pdf' }]
  ]) {
    const r = run(tool, input);
    assert.equal(r.code, 0, tool + ' ' + JSON.stringify(input));
    assert.equal(r.json, null, 'لا مخرج');
  }
});

test('HOOK-03 git push وتعديل بيانات الفحص يطلبان تأكيد المستخدمة (ask) ولا يُمنعان', () => {
  for (const [tool, input] of [
    ['Bash', { command: 'git push -u origin main' }],
    ['PowerShell', { command: 'git push origin feature/export-filtered-requirements' }],
    ['Edit', { file_path: 'C:\\Users\\User\\Documents\\Final Project\\BASIRA\\data\\sample-data.js', old_string: 'a', new_string: 'b' }]
  ]) {
    const r = run(tool, input);
    assert.ok(ask(r), tool + ' ' + JSON.stringify(input));
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /يرجى التأكيد/);
  }
  assert.equal(run('Bash', { command: 'git status && git log --oneline -1' }).json, null);
  assert.equal(run('Edit', { file_path: 'data/demo-data.js', old_string: 'a', new_string: 'b' }).json, null);
});

test('HOOK-04 مدخل غير صالح لا يعطل العمل', () => {
  const r = spawnSync(process.execPath, [GUARD], { input: 'ليس JSON', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
