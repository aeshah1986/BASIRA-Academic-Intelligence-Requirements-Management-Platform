/*
 * قراءة ملفات xlsx دون مكتبات — منصة «بصيرة» (G7 في docs/design/08)
 * ------------------------------------------------------------
 * ملف xlsx أرشيف ZIP فيه ملفات XML. نقرأ:
 *   الدليل المركزي للأرشيف ← xl/workbook.xml وعلاقاته (اسم الورقة ومسارها) ← xl/sharedStrings.xml ← ورقة العمل.
 * فك الضغط بواجهة DecompressionStream('deflate-raw') المدمجة في المتصفحات الحديثة وفي Node 18+.
 * يعيد صفوفًا بالشكل نفسه الذي تعيده sources.parseCSV، فيمر الملف بعدها بالمسار نفسه (سطر العناوين، والجودة، والحساب).
 * الصفوف الفارغة المنسقة في آخر الورقة لا تُنشأ أصلًا (لا يُبنى صف بلا قيم بعد آخر صف فيه بيانات).
 * يعمل في المتصفح (window.Basira.xlsx) وفي Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Basira = root.Basira || {};
    root.Basira.xlsx = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MESSAGES = {
    notZip: 'الملف ليس بصيغة xlsx صالحة. إذا كان بصيغة .xls القديمة فيرجى حفظه بصيغة xlsx أو CSV UTF-8.',
    noSheet: 'لم يُعثر على ورقة عمل في الملف.',
    noInflate: 'هذا المتصفح لا يدعم فك ضغط xlsx. يرجى حفظ الملف بصيغة CSV UTF-8.',
    unsupported: 'طريقة ضغط غير مدعومة داخل الملف.'
  };

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000; }

  // قائمة ملفات الأرشيف من الدليل المركزي: { name: { method, compSize, offset } }
  function listEntries(bytes) {
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) return null;
    var count = u16(bytes, eocd + 10);
    var p = u32(bytes, eocd + 16);
    var out = {};
    var dec = new TextDecoder('utf-8');
    for (var n = 0; n < count; n++) {
      if (u32(bytes, p) !== 0x02014b50) return null;
      var method = u16(bytes, p + 10);
      var compSize = u32(bytes, p + 20);
      var nameLen = u16(bytes, p + 28);
      var extraLen = u16(bytes, p + 30);
      var commentLen = u16(bytes, p + 32);
      var offset = u32(bytes, p + 42);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      out[name] = { method: method, compSize: compSize, offset: offset };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined' || typeof Response === 'undefined') return Promise.reject(new Error(MESSAGES.noInflate));
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function readEntry(bytes, entry) {
    var p = entry.offset;
    if (u32(bytes, p) !== 0x04034b50) return Promise.reject(new Error(MESSAGES.notZip));
    var start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
    var data = bytes.subarray(start, start + entry.compSize);
    var done = entry.method === 0 ? Promise.resolve(data) : entry.method === 8 ? inflateRaw(data) : Promise.reject(new Error(MESSAGES.unsupported));
    return done.then(function (raw) { return new TextDecoder('utf-8').decode(raw); });
  }

  function decodeXml(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      var k = e.toLowerCase();
      if (k === 'amp') return '&';
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      if (k[1] === 'x') return String.fromCodePoint(parseInt(k.slice(2), 16));
      return String.fromCodePoint(parseInt(k.slice(1), 10));
    });
  }

  // نص عنصر نصي قد يكون منسقًا (<r><t>..</t></r> متعددة): تُجمع كل <t>.
  function textOf(xml) {
    var out = '';
    xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, function (m, t) { out += t; return m; });
    return decodeXml(out);
  }

  function sharedStrings(xml) {
    var list = [];
    if (!xml) return list;
    xml.replace(/<si>([\s\S]*?)<\/si>/g, function (m, inner) { list.push(textOf(inner)); return m; });
    return list;
  }

  function colIndex(ref) {
    var letters = (String(ref).match(/^[A-Z]+/) || [''])[0];
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  // صفوف ورقة العمل. الصفوف المفقودة بين صفين فيهما بيانات تُنشأ فارغة حتى تبقى أرقام الصفوف مطابقة للأصل.
  function sheetRows(xml, shared) {
    var rows = [];
    var lastWithData = 0;
    xml.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, function (m, attrs, inner) {
      var rn = Number((attrs.match(/\br="(\d+)"/) || [])[1]) || rows.length + 1;
      if (!inner) return m;
      var cells = [];
      var any = false;
      inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (cm, cattrs, cinner) {
        if (!cinner) return cm;
        var ref = (cattrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
        var type = (cattrs.match(/\bt="(\w+)"/) || [])[1] || 'n';
        var v = (cinner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        var val;
        if (type === 's') val = v === undefined ? '' : (shared[Number(v)] || '');
        else if (type === 'inlineStr') val = textOf(cinner);
        else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else val = v === undefined ? '' : decodeXml(v);
        if (String(val).trim() === '') return cm;
        var ci = ref ? colIndex(ref) : cells.length;
        cells[ci] = String(val);
        any = true;
        return cm;
      });
      if (!any) return m;
      for (var k = 0; k < cells.length; k++) if (cells[k] === undefined) cells[k] = '';
      while (rows.length < rn - 1) rows.push([]);
      rows[rn - 1] = cells;
      lastWithData = rn;
      return m;
    });
    rows.length = lastWithData;
    for (var i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  /*
   * يقرأ ورقة (الأولى افتراضيًا، أو باسمها) ويعيد Promise<{ sheets: [أسماء], sheet, rows }>.
   * bytes: Uint8Array أو ArrayBuffer.
   */
  function readXlsx(input, opts) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    var entries = listEntries(bytes);
    if (!entries || !entries['xl/workbook.xml']) return Promise.reject(new Error(MESSAGES.notZip));
    var read = function (name) { return entries[name] ? readEntry(bytes, entries[name]) : Promise.resolve(''); };
    return Promise.all([read('xl/workbook.xml'), read('xl/_rels/workbook.xml.rels'), read('xl/sharedStrings.xml')]).then(function (parts) {
      var sheets = [];
      parts[0].replace(/<sheet\b([^>]*)\/?>/g, function (m, a) {
        sheets.push({ name: decodeXml((a.match(/\bname="([^"]*)"/) || [])[1] || ''), rid: (a.match(/\br:id="([^"]*)"/) || [])[1] });
        return m;
      });
      if (!sheets.length) throw new Error(MESSAGES.noSheet);
      var rels = {};
      parts[1].replace(/<Relationship\b([^>]*)\/?>/g, function (m, a) {
        var id = (a.match(/\bId="([^"]*)"/) || [])[1];
        var target = (a.match(/\bTarget="([^"]*)"/) || [])[1] || '';
        rels[id] = target.replace(/^\/?xl\//, '').replace(/^\//, '');
        return m;
      });
      var chosen = (opts && opts.sheet) ? sheets.filter(function (s) { return s.name === opts.sheet; })[0] : sheets[0];
      if (!chosen) throw new Error(MESSAGES.noSheet);
      var path = 'xl/' + (rels[chosen.rid] || 'worksheets/sheet1.xml');
      if (!entries[path]) throw new Error(MESSAGES.noSheet);
      var shared = sharedStrings(parts[2]);
      return read(path).then(function (xml) {
        return { sheets: sheets.map(function (s) { return s.name; }), sheet: chosen.name, rows: sheetRows(xml, shared) };
      });
    });
  }

  return { MESSAGES: MESSAGES, readXlsx: readXlsx, listEntries: listEntries, colIndex: colIndex };
});
