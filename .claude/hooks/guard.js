#!/usr/bin/env node
/*
 * Hook حماية لمشروع «بصيرة» — PreToolUse (docs/HOOK_SPEC.md).
 * يقرأ مدخل الأداة JSON من stdin، ويقرر:
 *   1. منع (رمز الخروج 2): أي كتابة في مجلد البيانات الحقيقية «ملف التصنيفات العربية».
 *   2. طلب تأكيد (ask): تعديل data/sample-data.js، لأن حالات القبول مبنية عليه.
 *   3. طلب تأكيد (ask): git push، فلا نشر دون موافقة صريحة لكل مرة.
 * غير ذلك: خروج 0 دون مخرج، فتستمر الأداة كالمعتاد.
 * وحدات Node المدمجة فقط. الفحوص: tests/hook-guard.test.js.
 */
'use strict';

var PROTECTED = 'users/user/desktop/ملف التصنيفات العربية';
var FILE_TOOLS = { Write: 1, Edit: 1, MultiEdit: 1, NotebookEdit: 1 };
var SHELL_TOOLS = { Bash: 1, PowerShell: 1 };
// أوامر أو عمليات تكتب أو تحذف أو تنقل. القراءة (cat، Get-Content، pdftotext إلى مسار آخر) لا تطابق.
var WRITE_OPS = /(^|[^0-9&<])>|\b(rm|rmdir|mv|cp|touch|mkdir|tee|truncate|dd|ln|chmod|del|erase|ren|move|copy)\b|\bsed\s+-i|\b(Set|Add|Clear)-Content\b|\bOut-File\b|\b(Remove|Move|Copy|New|Rename)-Item\b|\bgit\s+(init|clone|add|commit|checkout|reset|clean)\b/i;

function norm(s) {
  return String(s || '').normalize('NFC').replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').toLowerCase();
}

function inProtected(p) {
  return norm(p).indexOf(PROTECTED) !== -1;
}

// يعيد { decision: 'deny'|'ask', reason } أو null.
function decide(input) {
  var tool = input && input.tool_name;
  var ti = (input && input.tool_input) || {};
  if (FILE_TOOLS[tool]) {
    var p = ti.file_path || ti.notebook_path || '';
    if (inProtected(p)) return { decision: 'deny', reason: 'هذا المجلد مرجع للقراءة فقط وفيه بيانات حقيقية (CLAUDE.md). يُسمح بالقراءة فقط.' };
    if (/(^|\/)data\/sample-data\.js$/.test(norm(p))) return { decision: 'ask', reason: 'data/sample-data.js أساس حالات القبول. يرجى التأكيد أن تعديله مطلوب صراحة.' };
    return null;
  }
  if (SHELL_TOOLS[tool]) {
    var cmd = String(ti.command || '');
    if (inProtected(cmd) && WRITE_OPS.test(cmd)) return { decision: 'deny', reason: 'أمر يكتب أو يحذف أو ينقل في مجلد البيانات الحقيقية، وهو للقراءة فقط (CLAUDE.md). يمكن قراءته بأداة Read.' };
    if (/\bgit\b[^|;&]*\bpush\b/.test(cmd)) return { decision: 'ask', reason: 'git push ينشر المشروع خارج الجهاز. يرجى التأكيد أن النشر موافق عليه الآن.' };
  }
  return null;
}

if (require.main === module) {
  var raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (c) { raw += c; });
  process.stdin.on('end', function () {
    var input;
    try { input = JSON.parse(raw || '{}'); } catch (e) { process.exit(0); }
    var d = decide(input);
    if (!d) process.exit(0);
    if (d.decision === 'deny') {
      process.stderr.write(d.reason + '\n');
      process.exit(2);
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: d.reason } }));
    process.exit(0);
  });
}

module.exports = { decide: decide, inProtected: inProtected };
