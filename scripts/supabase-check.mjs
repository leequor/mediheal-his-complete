// Supabase path check (scripts/supabase-check.mjs).
//
// Verifies the real browser path, not the SQL editor: anonymous identity, hydration, a write that
// reaches Postgres, the append-only audit rule, and — the one that matters — that a SECOND visitor
// cannot see the first visitor's rows.
//
//   PW=<playwright-core/index.js> node scripts/supabase-check.mjs
//   SUPABASE_URL=... SUPABASE_ANON=... node scripts/supabase-check.mjs   (overrides the config file)
//
// Exits 0 when the configuration is empty (local demonstration mode), so the suite stays runnable
// on a clone with no backend.
import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = process.env.PW || 'playwright-core';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

let chrom;
try {
  const spec = PW.startsWith('/') || /^[A-Za-z]:[\\/]/.test(PW) ? pathToFileURL(PW).href : PW;
  const mod = await import(spec);
  chrom = mod.chromium || (mod.default && mod.default.chromium);
  if (!chrom) throw new Error('no chromium export');
} catch {
  console.error('Cannot import playwright-core. Set PW to its index.js.');
  process.exit(2);
}

const cfgSrc = await readFile(path.join(ROOT, 'assets/js/supabase-config.js'), 'utf8').catch(() => '');
const pick = (name) => {
  const m = new RegExp("'" + name + "'\\s*:\\s*'([^']*)'").exec(cfgSrc);
  return m ? m[1] : '';
};
const URL_ = process.env.SUPABASE_URL || pick('url');
const ANON = process.env.SUPABASE_ANON || pick('key');

if (!URL_ || !ANON) {
  console.log('supabase-check: not configured (assets/js/supabase-config.js is empty) — local mode, nothing to verify.');
  process.exit(0);
}

// --- serve the repo, never GitHub Pages --------------------------------------------------------
const port = Number(new URL(process.env.BASE || 'http://127.0.0.1:8799').port || 8799);
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
});
const free = await new Promise(r => {
  const probe = net.connect(port, '127.0.0.1');
  const done = v => { try { probe.destroy(); } catch {} r(v); };
  probe.once('connect', () => done(false));
  probe.once('error', () => done(true));
  probe.setTimeout(500, () => done(true));
});
if (free) await new Promise(r => server.listen(port, r));
else { await new Promise(r => server.listen(0, r)); }
const BASE = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  [' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) + ']' : '')); }
};

const browser = await chrom.launch({ channel: process.env.CHANNEL || 'chrome' });
const opened = [];
async function visitor() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate((u, k) => { window.MEDIHEAL_SUPABASE = { url: u, key: k }; }, URL_, ANON);
  await page.reload({ waitUntil: 'load' });
  const status = await page.evaluate(async () => { await HIS.db.bootstrap(); return HIS.db.status(); });
  opened.push(ctx);
  return { ctx, page, errs, status };
}

// --- 1. identity and hydration ------------------------------------------------------------------
const a = await visitor();
ok('anonymous identity was created', a.status.ready && !!a.status.uid, a.status);
ok('status reports a connected mode', a.status.mode === 'connected', a.status.mode);

// --- 2. a write reaches Postgres ----------------------------------------------------------------
const MARK = 'PT-SUPABASE-CHECK';
const wrote = await a.page.evaluate(async (mark) => {
  const rows = HIS.store.get('mh_patients', []).filter(r => r.id !== mark);
  rows.push({ id: mark, name: 'Check Patient', last: 'Patient', dob: '1990-01-01', mobile: '+63 900 000 0000', type: 'Outpatient', status: 'Waiting' });
  HIS.store.set('mh_patients', rows);
  await HIS.db.flush();
  const res = await HIS.db.client().from('patients').select('id,name').eq('id', mark);
  return { rows: res.data || [], error: res.error && res.error.message };
}, MARK);
ok('the write is mirrored to patients', wrote.rows.length === 1 && wrote.rows[0].name === 'Check Patient', wrote);

// --- 3. audit rows are append-only --------------------------------------------------------------
const audit = await a.page.evaluate(async () => {
  HIS.audit.append({ who: 'check', role: 'Check', what: 'supabase path check', entity: 'patient:' + 'PT-SUPABASE-CHECK' });
  await HIS.db.flush();
  const c = HIS.db.client();
  const ins = await c.from('audit_log').select('id,action').eq('action', 'supabase path check');
  const upd = await c.from('audit_log').update({ action: 'tampered' }).eq('id', (ins.data && ins.data[0] ? ins.data[0].id : -1));
  const del = await c.from('audit_log').delete().eq('id', (ins.data && ins.data[0] ? ins.data[0].id : -1));
  return { listed: ins.data || [], updateRefused: !!upd.error, deleteRefused: !!del.error };
});
ok('the audit row was inserted', audit.listed.length >= 1, audit.listed);
ok('updating an audit row is refused', audit.updateRefused);
ok('deleting an audit row is refused', audit.deleteRefused);

// --- 4. isolation: a second visitor must see nothing of the first -------------------------------
const b = await visitor();
const seen = await b.page.evaluate(() => HIS.db.client().from('patients').select('id').then(r => ({ n: (r.data || []).length, error: r.error && r.error.message })));
ok('a second visitor sees none of the first visitor\'s rows', seen.n === 0, seen);
ok('a second visitor has a different identity', b.status.uid !== a.status.uid, { a: a.status.uid, b: b.status.uid });

// --- 5. cleanup ---------------------------------------------------------------------------------
const cleaned = await a.page.evaluate(async (mark) => {
  const c = HIS.db.client();
  const p = await c.from('patients').delete().eq('id', mark);
  const au = await c.from('audit_log').delete().eq('action', 'supabase path check');
  const rows = HIS.store.get('mh_patients', []).filter(r => r.id !== mark);
  HIS.store.set('mh_patients', rows);
  return { patient: !p.error, audit: !au.error };
}, MARK);
ok('the check cleaned up its patient row', cleaned.patient);
ok('the audit row cannot be cleaned up by design (append-only)', cleaned.audit === false, cleaned);

ok('no script error during the check', a.errs.length === 0 && b.errs.length === 0, a.errs.concat(b.errs).slice(0, 3));

for (const ctx of opened) await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
