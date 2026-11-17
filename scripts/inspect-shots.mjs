// Visual inspection capture for M9.2.
// The automated audit proves no overflow and no tiny text; it cannot see a collapsed
// list or a label sitting on top of its value. This captures full-page screenshots of
// the screens that were never inspected by eye, at portrait phone and landscape phone.
//
//   PW=<path>/playwright-core/index.js node scripts/inspect-shots.mjs [--only billing,profile]
//
// Output: qa/inspect/<slug>__<W>x<H>.png  (gitignored)

import http from 'node:http';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'qa', 'inspect');
const PORT = 8811;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('404');
  }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || spec.includes(':') ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || mod.default.chromium;

// Screens the brief requires. `auth` = which seeded account to sign in as.
const PAGES = [
  ['billing', 'superadmin'],
  ['registration', 'superadmin'],
  ['appointments', 'superadmin'],
  ['departments', 'superadmin'],
  ['profile', 'superadmin'],
  ['portal', 'patient'],
  ['outpatient-form', 'superadmin'],
  ['appointment-form', 'superadmin'],
  ['appointment-confirmed', 'superadmin'],
  ['dashboard', 'superadmin'],
  ['attendance', 'hr'],
  ['payroll', 'hr'],
  ['nursing', 'nurse'],
  ['pharmacy', 'pharmacy'],
  ['consultation', 'doctor'],
  ['treatment', 'doctor']
];

const VIEWPORTS = [
  [390, 844, 'portrait'],
  [844, 390, 'landscape'],
  [430, 932, 'portrait430'],
  [932, 430, 'landscape430']
];

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i > -1 ? String(process.argv[i + 1]).split(',') : null;
})();

const EMAILS = {
  superadmin: 'superadmin@mediheal.test', patient: 'patient@mediheal.test',
  hr: 'hr@mediheal.test', nurse: 'nurse@mediheal.test',
  pharmacy: 'pharmacy@mediheal.test', doctor: 'doctor@mediheal.test'
};
const DEMO_PW = 'MediHeal2026!';

// Sign in through the REAL login path. Forging a session object does not work: auth.js resolves
// the account with HIS.accounts.byId(session.userId) and rejects anything that is not an active
// seeded record, so a made-up userId silently lands on the sign-in screen (which is exactly the
// bug that made the first capture pass of this milestone measure the login page 64 times).
async function signIn(ctx, email) {
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  const r = await page.evaluate(async ([e, p]) => {
    if (!window.HIS || !HIS.auth) return { ok: false, why: 'no auth module' };
    const res = HIS.auth.attempt(e, p, true);
    return { ok: !!res.ok, why: res.message || '', who: HIS.auth.account()?.email || null };
  }, [email, DEMO_PW]);
  await page.close();
  return r;
}

// The patient portal still keeps its own account map and session (unification is M5), so it is
// seeded here rather than signed in through HIS.auth.
async function seedPortal(ctx, email, name) {
  await ctx.addInitScript(([e, n]) => {
    try {
      const key = 'mh_portal_accounts';
      const map = JSON.parse(localStorage.getItem(key) || '{}');
      map[e] = { email: e, name: n, hash: 'demo', mobile: '+63 917 000 0000', dob: '1990-01-01', at: new Date().toISOString() };
      localStorage.setItem(key, JSON.stringify(map));
      localStorage.setItem('mh_portal_session', JSON.stringify({ email: e, name: n, at: new Date().toISOString() }));
    } catch { /* blocked */ }
  }, [email, name]);
}

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });
let n = 0;

for (const [slug, who] of PAGES) {
  if (only && !only.includes(slug)) continue;
  for (const [w, h, tag] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    if (who === 'patient') {
      await seedPortal(ctx, 'patient@mediheal.test', 'Maria Santos');
    } else {
      const s = await signIn(ctx, EMAILS[who]);
      if (!s.ok) { console.log(`FAIL ${slug.padEnd(22)} ${w}x${h} sign-in failed: ${s.why}`); await ctx.close(); continue; }
    }
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    try {
      await page.goto(`http://127.0.0.1:${PORT}/${slug}.html`, { waitUntil: 'load', timeout: 20000 });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await page.waitForTimeout(500);
      const info = await page.evaluate(() => ({
        path: location.pathname,
        title: document.querySelector('.bl-title,.dp-title,.rf-title,.f-title,.page-h,.dash-title,.at-title,.pr-title,.pf-name,.po-h')?.textContent?.trim()?.slice(0, 44) || '',
        docH: document.documentElement.scrollHeight,
        clippedBelow: [...document.querySelectorAll('.stage *')].filter(el => {
          const cs = getComputedStyle(el);
          if (cs.overflow !== 'hidden' && cs.overflowY !== 'hidden') return false;
          return el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0 && el.clientHeight < 300;
        }).length
      }));
      // Guard: a redirect to the sign-in page means the capture is worthless. Assert, do not guess.
      if (!info.path.includes(slug)) {
        console.log(`REDIRECTED ${slug.padEnd(20)} ${w}x${h} -> ${info.path} (capture discarded)`);
        await ctx.close();
        continue;
      }
      await page.screenshot({ path: path.join(SHOTS, `${slug}__${w}x${h}.png`), fullPage: true, animations: 'disabled' });
      n++;
      console.log(`${errs.length ? 'ERR ' : 'ok  '} ${slug.padEnd(22)} ${String(w + 'x' + h).padEnd(9)} ${tag.padEnd(11)} h:${String(info.docH).padEnd(6)} clipped:${info.clippedBelow} ${errs.length ? errs[0].slice(0, 60) : ''}`);
    } catch (e) {
      console.log(`FAIL ${slug.padEnd(22)} ${w}x${h} ${e.message.slice(0, 70)}`);
    }
    await ctx.close();
  }
}

await browser.close();
server.close();
console.log(`\n${n} screenshots -> qa/inspect/`);
