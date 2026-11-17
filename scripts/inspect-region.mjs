// Region capture for close visual inspection: a full-page phone screenshot is 3800px tall,
// which downscales to unreadable in review. This captures a clipped band at full resolution.
//
//   PW=<path>/playwright-core/index.js node scripts/inspect-region.mjs <page> <width> <height> <y> [bandHeight] [account]
//
// Example: node scripts/inspect-region.mjs departments 390 844 600 900 superadmin

import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'qa', 'inspect');
const PORT = 8812;
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

const [slug = 'dashboard', W = '390', H = '844', Y = '0', BAND = '900', who = 'superadmin'] = process.argv.slice(2);
const EMAIL = `${who}@mediheal.test`;

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });

if (slug.split('#')[0] === 'portal') {
  // `who` = "anon" inspects the signed-out forms; anything else seeds a patient session.
  if (who !== 'anon') await ctx.addInitScript(() => {
    try {
      const e = 'patient@mediheal.test', n = 'Maria Santos';
      localStorage.setItem('mh_portal_accounts', JSON.stringify({ [e]: { email: e, name: n, hash: 'demo', mobile: '+63 917 000 0000', dob: '1990-01-01' } }));
      localStorage.setItem('mh_portal_session', JSON.stringify({ email: e, name: n, at: new Date().toISOString() }));
    } catch { /* blocked */ }
  });
} else if (who !== 'anon') {
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  const r = await p.evaluate(([e, pw]) => {
    const res = HIS.auth.attempt(e, pw, true);
    return { ok: !!res.ok, msg: res.message || '' };
  }, [EMAIL, 'MediHeal2026!']);
  await p.close();
  if (!r.ok) { console.log('sign-in failed:', EMAIL, r.msg); await browser.close(); server.close(); process.exit(1); }
}

const page = await ctx.newPage();
const [base, hash] = slug.split('#');
await page.goto(`http://127.0.0.1:${PORT}/${base}.html${hash ? '#' + hash : ''}`, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready).catch(() => {});
await page.waitForTimeout(500);
const docH = await page.evaluate(() => document.documentElement.scrollHeight);
const out = path.join(SHOTS, `region__${slug}__${W}__y${Y}.png`);
await page.screenshot({ path: out, fullPage: true, clip: { x: 0, y: +Y, width: +W, height: Math.min(+BAND, Math.max(1, docH - +Y)) }, animations: 'disabled' });
console.log(`${out}  (docH ${docH}, band ${Y}..${+Y + +BAND})`);
await browser.close();
server.close();
