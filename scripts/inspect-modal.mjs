// Modal / dialog inspection. The brief requires dialogs to fit the viewport and stay
// reachable at phone and landscape-phone heights. Automated audits only measure text and
// page overflow, so a dialog taller than the viewport is invisible to them.
//
//   PW=<path>/playwright-core/index.js node scripts/inspect-modal.mjs
//
// Opens each known dialog at portrait and landscape, screenshots it, and reports whether
// the dialog box fits, whether it scrolls, and whether its action buttons are reachable.

import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'qa', 'inspect');
const PORT = 8814;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || spec.includes(':') ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || mod.default.chromium;

// page, account, how to open the dialog, and the dialog selector
const CASES = [
  ['accounts', 'superadmin', "document.querySelector('.ac-edit').click()", '.ac-m', 'account editor'],
  ['billing', 'superadmin', "document.dispatchEvent(new CustomEvent('bl:open',{detail:'pay'}))", '.bl-modal', 'payment dialog'],
  ['appointments', 'superadmin', "actionModal('cancel', 0)", '.ap-modal', 'cancel dialog'],
  ['attendance', 'hr', "document.querySelector('.at-ps').click()", '.at-modal', 'attendance detail'],
  ['payroll', 'hr', "document.querySelector('.pr-ps').click()", '.pr-modal', 'payslip'],
  ['treatment', 'doctor', "document.querySelector('[data-modal], .tp-rx')?.click()", '.tp-modal, .tm, [role=dialog]', 'treatment dialog']
];

const VIEWPORTS = [[390, 844, 'portrait'], [844, 390, 'landscape']];

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });
let issues = 0;

for (const [slug, who, open, sel, label] of CASES) {
  for (const [w, h, tag] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p0 = await ctx.newPage();
    await p0.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    const ok = await p0.evaluate(([e, pw]) => !!HIS.auth.attempt(e, pw, true).ok, [`${who}@mediheal.test`, 'MediHeal2026!']);
    await p0.close();
    if (!ok) { console.log(`SKIP ${slug} (no account ${who})`); await ctx.close(); continue; }

    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/${slug}.html`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(400);

    const opened = await page.evaluate(js => { try { eval(js); return true; } catch (e) { return false; } }, open).catch(() => false);
    await page.waitForTimeout(350);

    const r = await page.evaluate(s => {
      const nodes = [...document.querySelectorAll(s)].filter(el => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return b.width > 40 && b.height > 40 && cs.display !== 'none' && cs.visibility !== 'hidden';
      });
      if (!nodes.length) return { found: false };
      const el = nodes[0];
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const btns = [...el.querySelectorAll('button, a[href], [role="button"]')].map(x => {
        const rb = x.getBoundingClientRect();
        return { t: (x.textContent || '').trim().slice(0, 18), bottom: Math.round(rb.bottom), w: Math.round(rb.width), h: Math.round(rb.height) };
      });
      return {
        found: true,
        box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
        scrolls: el.scrollHeight > el.clientHeight + 2,
        overflowY: cs.overflowY,
        fitsV: b.top >= -1 && b.bottom <= innerHeight + 1,
        fitsH: b.left >= -1 && b.right <= innerWidth + 1,
        lastBtnBottom: btns.length ? Math.max(...btns.map(z => z.bottom)) : null,
        tiny: btns.filter(z => z.w < 32 || z.h < 32).length,
        nBtns: btns.length
      };
    }, sel);

    const name = `modal__${slug}__${w}x${h}.png`;
    // A tall dialog on a short landscape viewport is acceptable as long as every action can
    // be brought into view by scrolling the dialog. Checking them all at once would be wrong:
    // a scrolling dialog can never show its first and last action simultaneously.
    if (r.found) {
      r.reachable = await page.evaluate(s => {
        const el = [...document.querySelectorAll(s)].find(x => x.getBoundingClientRect().width > 40);
        if (!el) return true;
        const btns = [...el.querySelectorAll('button, a[href], [role="button"]')];
        for (const b of btns) {
          b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const rb = b.getBoundingClientRect();
          if (rb.bottom > innerHeight + 1 || rb.top < -1 || rb.right > innerWidth + 1) return false;
        }
        return true;
      }, sel);
      await page.waitForTimeout(120);
    }

    await page.screenshot({ path: path.join(SHOTS, name), animations: 'disabled' });

    if (!opened || !r.found) {
      console.log(`?    ${slug.padEnd(13)} ${String(w + 'x' + h).padEnd(9)} ${label.padEnd(18)} not opened (selector ${sel})`);
    } else {
      const bad = !r.fitsV || !r.fitsH || r.reachable === false;
      if (bad) issues++;
      console.log(`${bad ? 'BAD ' : 'ok  '} ${slug.padEnd(13)} ${String(w + 'x' + h).padEnd(9)} ${label.padEnd(18)} box:${r.box.w}x${r.box.h}@y${r.box.y} fitsV:${r.fitsV} fitsH:${r.fitsH} scroll:${r.scrolls} reachable:${r.reachable} tiny:${r.tiny}`);
    }
    await ctx.close();
  }
}

await browser.close();
server.close();
console.log(`\n${issues} dialog issue(s)`);
