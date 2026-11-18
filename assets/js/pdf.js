// Shared PDF helper (session 23). The site has no build step and no PDF library, so invoices and
// profile printouts are written as plain text-only PDF 1.4 files (Helvetica) and saved with a Blob.
// Used by billing-modal.js (Download invoice) and profile-modal.js (Print profile).
// rows: [[text, fontSize, lineHeight], ...] - an empty text draws a blank line.
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/\u20b1/g, 'PHP ').replace(/[\u2013\u2014]/g, '-').replace(/\u00b7/g, '-')
      .replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');
  }
  function text(rows) {
    var y = 780, stream = '';
    rows.forEach(function (r) {
      if (r[0]) stream += 'BT /F1 ' + (r[1] || 10) + ' Tf 40 ' + y + ' Td (' + esc(r[0]) + ') Tj ET\n';
      y -= (r[2] || 15);
    });
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    ];
    var pdf = '%PDF-1.4\n', offs = [];
    objs.forEach(function (o, i) { offs.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offs.forEach(function (o) { pdf += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return pdf;
  }
  function blob(rows) { return new Blob([text(rows)], { type: 'application/pdf' }); }
  function save(rows, filename) {
    var url = URL.createObjectURL(blob(rows));
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  window.HIS = window.HIS || {};
  // ---- ZIP (stored, no compression) ------------------------------------------------------------
  // Eight separate <a download> clicks in a row are throttled by Chrome: the browser delivers the
  // first few and silently drops the rest, so "8 payslips downloaded" was not true. One archive is
  // one download, so the count in the message is the count on disk. Stored mode needs no compressor,
  // which keeps this dependency-free.
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(str) {
    if (window.TextEncoder) return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xFF);
    return new Uint8Array(out);
  }
  // files: [{ name, data: <pdf string> }]
  function zip(files) {
    var parts = [], central = [], offset = 0;
    var d = new Date();
    var time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
    var date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    function u16(a, v) { a.push(v & 0xFF, (v >>> 8) & 0xFF); }
    function u32(a, v) { a.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); }

    files.forEach(function (f) {
      var name = utf8(f.name), data = utf8(f.data), crc = crc32(data);
      var head = [];
      u32(head, 0x04034b50); u16(head, 20); u16(head, 0); u16(head, 0); u16(head, time); u16(head, date);
      u32(head, crc); u32(head, data.length); u32(head, data.length); u16(head, name.length); u16(head, 0);
      parts.push(new Uint8Array(head), name, data);

      var cen = [];
      u32(cen, 0x02014b50); u16(cen, 20); u16(cen, 20); u16(cen, 0); u16(cen, 0); u16(cen, time); u16(cen, date);
      u32(cen, crc); u32(cen, data.length); u32(cen, data.length); u16(cen, name.length); u16(cen, 0); u16(cen, 0);
      u16(cen, 0); u16(cen, 0); u32(cen, 0); u32(cen, offset);
      central.push(new Uint8Array(cen), name);
      offset += head.length + name.length + data.length;
    });

    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var end = [];
    u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, files.length); u16(end, files.length);
    u32(end, cdSize); u32(end, offset); u16(end, 0);

    var all = parts.concat(central, [new Uint8Array(end)]);
    var total = all.reduce(function (s, p) { return s + p.length; }, 0);
    var out = new Uint8Array(total), at = 0;
    all.forEach(function (p) { out.set(p, at); at += p.length; });
    return new Blob([out], { type: 'application/zip' });
  }
  function saveZip(files, filename) {
    var url = URL.createObjectURL(zip(files));
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  HIS.pdf = { text: text, blob: blob, save: save, zip: zip, saveZip: saveZip };
})();