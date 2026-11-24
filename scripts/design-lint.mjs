// Design lint: objective defects, measured rather than judged. Runs across every page and reports
// duplicate ids, unlabelled controls, missing alt text, targets under 24x24 (measuring the area that
// really receives the pointer, so an invisible expander counts), same-row control misalignment,
// text painted over text, mixed date formats and inconsistent money decimals.
//
//   PW=C:/Users/nekoc/node_modules/playwright-core/index.js node scripts/design-lint.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8892;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));
const B=`http://127.0.0.1:${PORT}`;
const PAGES=['dashboard.html','registration.html','registration-form.html','outpatient-form.html','appointments.html','appointment-form.html','appointment-confirmed.html','profile.html','departments.html','billing.html','charges.html','claims.html','laboratory.html','pharmacy.html','treatment.html','nursing.html','consultation.html','admissions.html','personnel.html','payroll.html','attendance.html','reports.html','accounts.html','settings.html','audit.html','staff.html'];
const _pwmod = await import(pathToFileURL(process.env.PW || 'C:/Users/nekoc/node_modules/playwright-core/index.js').href);
const chromium = _pwmod.chromium || (_pwmod.default && _pwmod.default.chromium);
const b = await chromium.launch({ channel:'chrome' });
const ctx = await b.newContext({viewport:{width:1440,height:1024}});
const p = await ctx.newPage();
await p.goto(B+'/index.html'); await p.evaluate(()=>HIS.auth.attempt('superadmin@mediheal.test','MediHeal2026!',true));
const report = {};
for (const pg of PAGES) {
  await p.goto(B+'/'+pg, {waitUntil:'load'}); await p.waitForTimeout(320);
  report[pg] = await p.evaluate(() => {
    const out = { dupIds:[], noLabel:[], noAlt:[], noName:[], tinyTargets:[], rowMisalign:[], collisions:[], mixedDates:[], moneyFormats:[] };
    // duplicate ids
    const ids = {};
    document.querySelectorAll('[id]').forEach(e => { if (e.offsetWidth || e.offsetHeight) ids[e.id] = (ids[e.id]||0)+1; });
    Object.keys(ids).forEach(k => { if (ids[k] > 1) out.dupIds.push(k); });
    // form controls without an accessible name
    document.querySelectorAll('input:not([type=hidden]),select,textarea').forEach(e => {
      if (!e.offsetWidth) return;
      const id = e.id;
      const labelled = (id && document.querySelector('label[for="' + id + '"]')) || e.getAttribute('aria-label') ||
        e.getAttribute('aria-labelledby') || (e.closest('label')) || e.getAttribute('placeholder');
      if (!labelled) out.noLabel.push(e.name || e.id || e.tagName);
      if (!e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !(id && document.querySelector('label[for="' + id + '"]')) && !e.closest('label')) out.noName.push(e.name || id || e.tagName);
    });
    // images without alt
    document.querySelectorAll('img').forEach(e => { if (e.offsetWidth && !e.hasAttribute('alt')) out.noAlt.push(e.getAttribute('src')); });
    // Interactive targets under 24x24. WCAG 2.5.8 measures the area that actually receives the
    // pointer, so an invisible expander (::before/::after) counts: probe past the painted box.
    document.querySelectorAll('button,a,[role=button]').forEach(e => {
      let r = e.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // elementFromPoint only sees the viewport: bring rows that are below the fold into view first
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
        e.scrollIntoView({ block: 'center', inline: 'center' });
        r = e.getBoundingClientRect();
      }
      const own = n => n && (n === e || e.contains(n));
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const span = (dx, dy) => { let d = 0; while (d < 20 && own(document.elementFromPoint(cx + dx * (d + 1), cy + dy * (d + 1)))) d++; return d; };
      const effW = r.width + span(-1, 0) + span(1, 0);
      const effH = r.height + span(0, -1) + span(0, 1);
      if (effW < 24 || effH < 24) out.tinyTargets.push(((e.textContent||'').trim().slice(0, 14) || e.tagName) + ' painted ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' effective ' + Math.round(effW) + 'x' + Math.round(effH));
    });
    // controls in the same row that do not share a baseline (misalignment)
    const rows = [...document.querySelectorAll('.bl-act,.ad-acts,.pr-acts,.at-cbtns,.kit-actions,form')];
    rows.forEach(row => {
      const kids = [...row.children].filter(k => k.offsetWidth && /BUTTON|INPUT|SELECT|A/.test(k.tagName));
      if (kids.length < 2) return;
      const tops = kids.map(k => Math.round(k.getBoundingClientRect().top));
      const hs = kids.map(k => Math.round(k.getBoundingClientRect().height));
      if (Math.max(...tops) - Math.min(...tops) > 2 || Math.max(...hs) - Math.min(...hs) > 6)
        out.rowMisalign.push((row.className || row.tagName) + ' tops=' + tops.join(',') + ' h=' + hs.join(','));
    });
    // two visible text nodes painted over each other (same rect, different text)
    const trulyVisible = e => {
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || +st.opacity === 0) return false;
      // an element in a closed tab/panel still has a box but paints nothing, so ask the hit test
      const r = e.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      return !!hit && (hit === e || e.contains(hit) || hit.contains(e));
    };
    const texts = [...document.querySelectorAll('span,b,small,p,h1,h2,h3,div')].filter(e => {
      if (!e.offsetWidth || e.children.length || !trulyVisible(e)) return false;
      const t = (e.textContent||'').trim(); return t.length > 2 && t.length < 60;
    });
    for (let i = 0; i < texts.length && out.collisions.length < 4; i++) {
      for (let j = i+1; j < texts.length; j++) {
        const a = texts[i].getBoundingClientRect(), c = texts[j].getBoundingClientRect();
        const ox = Math.min(a.right,c.right) - Math.max(a.left,c.left);
        const oy = Math.min(a.bottom,c.bottom) - Math.max(a.top,c.top);
        // A real collision needs most of both boxes shared: neighbouring lines in a stacked label
        // overlap by a few pixels of line-height, which is not text painted over text.
        const minW = Math.min(a.width, c.width), minH = Math.min(a.height, c.height);
        if (ox > minW * 0.6 && oy > minH * 0.5 && texts[i].textContent.trim() !== texts[j].textContent.trim()
          && !texts[i].contains(texts[j]) && !texts[j].contains(texts[i])) {
          out.collisions.push('"' + texts[i].textContent.trim().slice(0,16) + '" over "' + texts[j].textContent.trim().slice(0,16) + '"');
          break;
        }
      }
    }
    // date formats used on the page
    const txt = document.body.innerText;
    const fmts = new Set();
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b/.test(txt)) fmts.add('Mon D, YYYY');
    if (/\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(txt)) fmts.add('D/M/YYYY');
    if (/\b\d{4}-\d{2}-\d{2}\b/.test(txt)) fmts.add('YYYY-MM-DD');
    out.mixedDates = [...fmts];
    // currency formatting used
    const money = (txt.match(/₱[\d,]+(\.\d{2})?/g) || []);
    out.moneyFormats = [...new Set(money.map(x => /\.\d{2}$/.test(x) ? 'with-decimals' : 'no-decimals'))];
    return out;
  });
}
await b.close();
server.close();
const problems = [];
Object.keys(report).forEach(pg => {
  const r = report[pg];
  if (r.dupIds.length) problems.push(pg + ' duplicate ids: ' + r.dupIds.join(','));
  if (r.noName.length) problems.push(pg + ' control with no accessible name: ' + r.noName.slice(0,4).join(','));
  if (r.noAlt.length) problems.push(pg + ' img without alt: ' + r.noAlt.slice(0,3).join(','));
  if (r.tinyTargets.length) problems.push(pg + ' target under 24px: ' + r.tinyTargets.slice(0,3).join(' | '));
  if (r.rowMisalign.length) problems.push(pg + ' row controls misaligned: ' + r.rowMisalign.slice(0,2).join(' | '));
  if (r.collisions.length) problems.push(pg + ' text overlap: ' + r.collisions.slice(0,2).join(' | '));
});
console.log(problems.length ? problems.join('\n') : 'no lint findings');
console.log('\nsummary: ' + PAGES.length + ' pages, ' + problems.length + ' findings');
