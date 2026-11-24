// Strategies 6-10 of the gauntlet. Same rule as 1-5: each one attacks something the others do not,
// and every step re-derives the invariants instead of trusting what the page says.

const money = (s) => Number(String(s).replace(/[^\d.-]/g, '')) || 0;

const openDialog = (page, label) => page.evaluate((l) => {
  const hit = [...document.querySelectorAll('button, [data-open]')]
    .filter(e => e.offsetWidth && !e.closest('nav, .header, .drawer'))
    .find(e => ((e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26)).toLowerCase() === l.toLowerCase());
  if (!hit) return false;
  hit.click(); return true;
}, label);

const modalScope = (page) => page.evaluateHandle(() => {
  const d = [...document.querySelectorAll('.ac-bg, .ac-m, .bl-modal, .pm-modal, .pe-modal, .tp-modal, .at-modal, [class$=-modal]')].filter(x => x.offsetWidth);
  return d[d.length - 1] || document.body;
});

export async function run(ITER, api) {
  const { base, errors, checkInvariants, bad, ok, reseed } = api;
  const getPage = () => api.page;
  const P = ['billing.html', 'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html', 'admissions.html', 'payroll.html', 'attendance.html'];

  // ---------------------------------------------------------------- 6. money sequences
  if (ITER === 6) {
    await reseed();
    const page = getPage();
    await page.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const amounts = ['0.005', '1.234', '0.01', '1e9', '-5', '999999999.999', '', ' ', '12.345', '1,000'];
    for (let i = 0; i < 30; i++) {
      const before = errors.length;
      const opened = await openDialog(page, 'Record payment');
      if (!opened) { bad('billing: Record payment missing'); break; }
      await page.waitForTimeout(180);
      const amt = amounts[i % amounts.length];
      await page.evaluate((a) => {
        const d = [...document.querySelectorAll('.bl-modal, [class$=-modal]')].filter(x => x.offsetWidth).pop();
        if (!d) return;
        const f = [...d.querySelectorAll('input')].filter(e => e.offsetWidth);
        if (f[0]) { f[0].value = a; f[0].dispatchEvent(new Event('input', { bubbles: true })); }
        const btn = [...d.querySelectorAll('button')].filter(b => b.offsetWidth && /pay|record/i.test(b.textContent || '')).pop();
        if (btn) btn.click();
      }, amt);
      await page.waitForTimeout(320);
      if (errors.length > before) bad(`billing payment "${amt}" threw: ${errors[before]}`);
      const f = await checkInvariants(`billing payment ${i + 1} (${amt})`);
      // centavos must never drift: the stored sum equals the sum of the stored records
      const drift = await page.evaluate(() => {
        const l = HIS.store.get('mh_ledger', []);
        if (!Array.isArray(l) || !HIS.ledger.sums) return null;
        const s = HIS.ledger.sums();
        const total = l.reduce((a, r) => a + (Number(r.amount) || 0), 0);
        return { stored: total, module: s && (s.payments ?? s.total), ok: s && s.ok };
      });
      if (drift && drift.module !== undefined && Math.abs(money(drift.stored) - money(drift.module)) > 0.011) {
        bad(`billing payment ${i + 1}: stored ${drift.stored} vs module ${drift.module}`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(140);
      ok();
    }
  }

  // ---------------------------------------------------------------- 7. state machines
  if (ITER === 7) {
    await reseed();
    const page = getPage();
    for (let round = 0; round < 3; round++) {
      for (const pg of ['claims.html', 'admissions.html', 'pharmacy.html', 'laboratory.html']) {
        await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(240);
        // click every row action twice in a row, in a shuffled order, and leave any dialog with Escape
        const labels = await page.evaluate(() => [...new Set([...document.querySelectorAll('.ad-tr button, tr button')]
          .filter(e => e.offsetWidth).map(e => (e.textContent || '').trim().slice(0, 20)).filter(Boolean))].slice(0, 10));
        for (const label of labels) {
          const before = errors.length;
          await page.evaluate((l) => {
            const list = [...document.querySelectorAll('.ad-tr button, tr button')].filter(e => e.offsetWidth && (e.textContent || '').trim().slice(0, 20) === l);
            list.forEach(b => { try { b.click(); } catch (e) { } });
          }, label);
          await page.waitForTimeout(260);
          if (errors.length > before) bad(`${pg} row action "${label}" threw: ${errors[before]}`);
          // a dialog may be open now; fill nothing and confirm: the app must refuse in writing
          const refused = await page.evaluate(() => {
            const d = [...document.querySelectorAll('.ac-bg, [class$=-modal], [role=dialog]')].filter(x => x.offsetWidth).pop();
            if (!d) return null;
            const btn = [...d.querySelectorAll('button')].filter(b => b.offsetWidth && !/^(cancel|close|dismiss|×)$/i.test(b.textContent || '')).pop();
            if (btn) btn.click();
            return true;
          });
          await page.waitForTimeout(300);
          if (refused) {
            const said = await page.evaluate(() => ({
              alert: [...document.querySelectorAll('[role=alert], #mdErr, .ac-err, [class*=err], .bl-tip, #kit-toast')].filter(e => e.offsetWidth && (e.textContent || '').trim().length > 3).length
                + [...document.querySelectorAll(':invalid')].filter(e => e.offsetWidth && e.validationMessage).length,
              invalid: document.querySelectorAll('[aria-invalid=true]').length,
              open: [...document.querySelectorAll('.ac-bg, [class$=-modal]')].filter(d => d.offsetWidth).length,
            }));
            if (said.open && !said.alert && !said.invalid) bad(`${pg} "${label}" empty confirm refused with no written reason`);
          }
          await checkInvariants(`${pg} row action ${label}`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(120);
          ok();
        }
        // final-state consistency: a discharged admission must not hold a bed
        const beds = await page.evaluate(() => {
          try {
            const adm = HIS.admissions;
            if (!adm || !adm.beds) return null;
            const list = adm.records ? adm.records() : HIS.store.get('mh_admissions', []);
            const occupied = new Set(list.filter(r => r && r.bedId && !r.dischargedAt && r.status !== 'discharged').map(r => r.bedId));
            const bedsNow = adm.beds();
            const clashes = bedsNow.filter(b => b.occupied && !occupied.has(b.id) && !occupied.has(b.bedId));
            return { clashes: clashes.length, total: bedsNow.length };
          } catch (e) { return { error: String(e.message).slice(0, 60) }; }
        });
        if (beds && beds.clashes) bad(`${pg}: ${beds.clashes} bed(s) marked occupied with no live admission`);
      }
    }
  }

  // ---------------------------------------------------------------- 8. corrupted storage + junk URLs
  if (ITER === 8) {
    await reseed();
    const page = getPage();
    const KEYS = ['mh_ledger', 'mh_claims', 'mh_admissions', 'mh_lab', 'mh_rx', 'mh_invoices', 'mh_charge_links',
      'mh_payroll_runs', 'mh_audit', 'mh_appts_extra', 'mh_patients', 'mh_employees', 'mh_beds', 'mh_settings'];
    const shapes = ['null', '"a string"', '123', 'true', '[null,null]', '[{"id":null}]', '{"a":1}', '[[]]', '[{"amount":"x","id":{}}]', '[1,2,3]'];
    for (const key of KEYS) {
      for (const shape of shapes.slice(0, 3).concat(shapes.slice(-2))) {
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        const put = await page.evaluate(({ k, s }) => {
          try { sessionStorage.setItem(k, s); return true; } catch (e) { return false; }
        }, { k: key, s: shape });
        if (!put) continue;
        const before = errors.length;
        for (const pg of PAGES_SUBSET) {
          await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(90);
          if (errors.length > before) { bad(`corrupt ${key}=${shape.slice(0, 18)} broke ${pg}: ${errors[before]}`); break; }
        }
        if (errors.length === before) ok();
      }
    }
    // junk URLs
    for (const q of ['?id=PT-000000', '?id=@@@', '?id=' + 'x'.repeat(400), '?action=delete&id=1', '#/../../etc', '?page=<script>']) {
      const before = errors.length;
      await page.goto(`${base}/profile.html${q}`, { waitUntil: 'domcontentloaded' }).catch(() => { });
      await page.waitForTimeout(160);
      const r = await page.evaluate(() => ({ t: (document.body.innerText || '').trim().length, junk: /undefined|NaN|\[object Object\]/.test(document.body.innerText || '') }));
      if (errors.length > before) bad(`url ${q.slice(0, 26)} threw: ${errors[before]}`);
      else if (r.junk) bad(`url ${q.slice(0, 26)} rendered junk text`);
      else ok();
    }
  }

  // ---------------------------------------------------------------- 9. keyboard-only journey
  if (ITER === 9) {
    await reseed();
    const page = getPage();
    for (const pg of PAGES_SUBSET) {
      await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
      // Under parallel load a fixed sleep can still be showing the previous document, whose scroll
      // lock would then be blamed on this page. Wait for this page's own body to be live.
      await page.waitForFunction((want) => document.body && document.body.dataset && document.body.dataset.page === want.replace('.html', ''), pg, { timeout: 4000 }).catch(() => { });
      await page.waitForTimeout(160);
      const before = errors.length;
      let stuck = 0;
      for (let i = 0; i < 26; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return { body: true };
          const visible = a.offsetWidth || a.offsetHeight;
          return { body: false, visible: !!visible, tag: a.tagName };
        });
        if (info.body) stuck++;
        if (i % 4 === 3) { await page.keyboard.press('Enter'); await page.waitForTimeout(90); }
        if (i % 7 === 6) { await page.keyboard.press('Escape'); await page.waitForTimeout(90); }
      }
      if (errors.length > before) bad(`keyboard ${pg} threw: ${errors[before]}`);
      const after = await page.evaluate(() => ({
        lock: /hidden/.test(getComputedStyle(document.body).overflow),
        open: [...document.querySelectorAll('.ac-bg, [class$=-modal]')].filter(d => d.offsetWidth).length,
        focusBody: !document.activeElement || document.activeElement === document.body,
      }));
      if (after.open) bad(`keyboard ${pg}: a dialog was left open after Escape`);
      else if (after.lock) bad(`keyboard ${pg}: page left scroll-locked`);
      else ok();
    }
  }

  // ---------------------------------------------------------------- 10. concurrency
  if (ITER === 10) {
    await reseed();
    const page = getPage();
    const page2 = await api.ctx.newPage();
    page2.on('pageerror', e => errors.push('tab2: ' + String(e.message).slice(0, 120)));
    await page2.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page2.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));

    for (let i = 0; i < 6; i++) {
      await page.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
      await page2.goto(`${base}/charges.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(200);
      const before = errors.length;
      // both tabs write in the same tick
      await Promise.all([
        page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /record payment/i.test(x.textContent || '')); if (b) b.click(); }),
        page2.evaluate(() => { const b = [...document.querySelectorAll('button')].filter(x => x.offsetWidth).find(x => /assign/i.test(x.textContent || '')); if (b) b.click(); }),
      ]);
      await page.waitForTimeout(250);
      await Promise.all([
        page.evaluate(() => { const d = [...document.querySelectorAll('.bl-modal')].filter(x => x.offsetWidth).pop(); if (!d) return; const f = [...d.querySelectorAll('input')].filter(e => e.offsetWidth); if (f[0]) { f[0].value = '10.55'; f[0].dispatchEvent(new Event('input', { bubbles: true })); } const btn = [...d.querySelectorAll('button')].filter(b => b.offsetWidth && /pay|record/i.test(b.textContent || '')).pop(); if (btn) btn.click(); }),
        page2.evaluate(() => { const d = [...document.querySelectorAll('.ac-bg, [class$=-modal]')].filter(x => x.offsetWidth).pop(); if (!d) return; const btn = [...d.querySelectorAll('button')].filter(b => b.offsetWidth && /assign|save|confirm/i.test(b.textContent || '')).pop(); if (btn) btn.click(); }),
      ]);
      await page.waitForTimeout(400);
      // reload both mid-flight and check nothing was half-written
      await Promise.all([page.reload({ waitUntil: 'domcontentloaded' }), page2.reload({ waitUntil: 'domcontentloaded' })]);
      await page.waitForTimeout(320);
      if (errors.length > before) bad(`concurrency round ${i + 1} threw: ${errors[before]}`);
      const a = await checkInvariants(`concurrency round ${i + 1}`);
      const b = await page2.evaluate(() => ({ inv: HIS.ledger.invariants ? HIS.ledger.invariants() : null }));
      if (b.inv && b.inv.ok === false) bad(`concurrency round ${i + 1}: second tab sees a broken invariant`);
      else if (a.inv && a.inv.ok === false) bad(`concurrency round ${i + 1}: first tab sees a broken invariant`);
      else ok();
    }
    await page2.close();
  }
}

const PAGES_SUBSET = ['dashboard.html', 'registration.html', 'appointments.html', 'profile.html', 'billing.html',
  'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html', 'treatment.html', 'nursing.html',
  'admissions.html', 'personnel.html', 'payroll.html', 'attendance.html', 'reports.html', 'accounts.html',
  'settings.html', 'audit.html'];
