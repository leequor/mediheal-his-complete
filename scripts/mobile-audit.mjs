// Mobile readability audit (hotfix driver).
// Overflow-free is NOT the same as readable. This measures the ACTUAL rendered font size of every
// visible text node — declared size multiplied by the CSS `zoom` chain that fit.js applies — and
// reports how many elements fall below readable thresholds at each width.
//
// Usage: node scripts/mobile-audit.mjs [--widths 1440,1200,1000,800,390] [--email ...]
import http from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8798;
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const WIDTHS = String(arg('widths', '1440,1200,1000,800,390')).split(',').map(Number);
const EMAIL = arg('email', 'superadmin@mediheal.test');
const SHOTS = path.resolve(ROOT, arg('shots', 'qa/mobile'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

const spec = process.env.PW || 'playwright-core';
const target = /^[a-zA-Z]:[\\/]|^\//.test(spec) ? pathToFileURL(spec).href : spec;
const mod = await import(target);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
if (!chromium) { console.error('playwright-core not resolvable; set PW=...'); process.exit(2); }

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(PORT, r));
await mkdir(SHOTS, { recursive: true });

const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html')).sort();
const PUBLIC = new Set(['index.html', 'portal.html']);

const browser = await chromium.launch({ channel: 'chrome' });
const seed = await browser.newContext();
const probe = await seed.newPage();
await probe.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
const acct = await probe.evaluate(e => { const a = HIS.accounts.byEmail(e); return a ? { id: a.id, email: a.email, role: a.role } : null; }, EMAIL);
await probe.close(); await seed.close();

const ctx = await browser.newContext();
await ctx.addInitScript(a => {
  localStorage.setItem('mh_session', JSON.stringify({ userId: a.id, email: a.email, role: a.role, at: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(), remember: true }));
}, acct);
const ctxPublic = await browser.newContext();

// Thresholds from the brief: body >= 14px, secondary >= 12px at 390px.
const BODY_MIN = 14, SMALL_MIN = 12;

const report = {};
let worstOverall = 999;

for (const name of pages) {
  const slug = name.replace('.html', '');
  report[slug] = {};
  for (const w of WIDTHS) {
    const page = await (PUBLIC.has(name) ? ctxPublic : ctx).newPage();
    await page.setViewportSize({ width: w, height: 900 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/${name}`, { waitUntil: 'load', timeout: 25000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(260);

    const m = await page.evaluate(([bodyMin, smallMin]) => {
      function zoomChain(el) {
        let z = 1, n = el;
        while (n && n !== document.documentElement) {
          const v = parseFloat(getComputedStyle(n).zoom);
          if (v && !isNaN(v) && v !== 1) z *= v;
          n = n.parentElement;
        }
        return z;
      }
      const sizes = [];
      const small = [];
      const tinyTargets = [];
      document.querySelectorAll('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return;
        const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (hasText) {
          const eff = parseFloat(cs.fontSize) * zoomChain(el);
          sizes.push(eff);
          if (eff < smallMin) small.push({ t: el.textContent.trim().slice(0, 28), px: +eff.toFixed(1) });
        }
        // touch targets: interactive elements
        if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.getAttribute('role') === 'button') {
          let box = r;
          const lab = el.closest('label');
          if (lab && (el.type === 'checkbox' || el.type === 'radio')) box = lab.getBoundingClientRect();
          if (box.width < 32 || box.height < 32) tinyTargets.push({ t: (el.textContent || el.tagName).trim().slice(0, 22), w: Math.round(box.width), h: Math.round(box.height) });
        }
      });
      sizes.sort((a, b) => a - b);
      return {
        textCount: sizes.length,
        min: sizes.length ? +sizes[0].toFixed(1) : null,
        p10: sizes.length ? +sizes[Math.floor(sizes.length * 0.1)].toFixed(1) : null,
        median: sizes.length ? +sizes[Math.floor(sizes.length / 2)].toFixed(1) : null,
        belowSmall: small.length,
        belowSmallSample: small.slice(0, 4),
        tinyTargets: tinyTargets.length,
        tinySample: tinyTargets.slice(0, 3),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        // The stage itself scrolling horizontally means the page is still using the interim
        // fixed-width workaround rather than a real reflow.
        stageScroll: (() => { const st = document.querySelector('.stage'); return st ? st.scrollWidth > st.clientWidth + 1 : false; })(),
        errors: 0
      };
    }, [BODY_MIN, SMALL_MIN]);
    m.errors = errs.length;

    if (w === 390) {
      await page.screenshot({ path: path.join(SHOTS, `${slug}__390.png`), fullPage: true, animations: 'disabled' });
    }
    if (m.min != null && m.min < worstOverall) worstOverall = m.min;
    report[slug][w] = m;

    // 1440px is the locked Figma desktop: its 11px labels are design, not a defect, so the
    // readability floor is only enforced below 1440. Overflow and errors always fail.
    const readabilityBad = w < 1440 && m.belowSmall > 0;
    const flag = readabilityBad || m.overflow || m.stageScroll || m.errors ? 'FAIL' : 'ok  ';
    console.log(`${flag} ${slug.padEnd(22)} @${String(w).padEnd(5)} min:${String(m.min).padStart(5)} p10:${String(m.p10).padStart(5)} med:${String(m.median).padStart(5)} <12px:${String(m.belowSmall).padStart(4)} tinyTargets:${String(m.tinyTargets).padStart(3)}${m.overflow ? ' OVERFLOW' : ''}${m.stageScroll ? ' STAGE-SCROLL' : ''}${m.errors ? ' ERR' : ''}`);
    if (m.belowSmall && w === 390) console.log(`     e.g. ${m.belowSmallSample.map(s => s.px + 'px "' + s.t + '"').join(' | ')}`);
    await page.close();
  }
}

await browser.close();
server.close();
await writeFile(path.join(SHOTS, '_audit.json'), JSON.stringify(report, null, 2));
console.log(`\nsmallest rendered text anywhere: ${worstOverall}px`);
console.log(`screenshots -> ${SHOTS}`);
