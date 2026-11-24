// The invoice total is the number the hospital gets paid, so it must add up in the way the screen
// presents it: subtotal + VAT describe the invoice, charges raised afterwards are added once, and
// paid + balance must equal the grand total. A screen that shows 580 + 70 + 650 over a 650 total is
// arithmetically wrong even though every individual number is "right".
//
//   PW=... node scripts/billing-math-check.mjs

import { startServer, openBrowser, signIn } from './_harness.mjs';

const { server, base } = await startServer(8946);
const { browser } = await openBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message).slice(0, 120)));

let pass = 0;
const problems = [];
const ok = () => { pass++; };
const bad = (w) => problems.push(w);
const cent = (n) => Math.round((Number(n) || 0) * 100);

await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(220);
await signIn(page);

// Attach one charge to each invoice, plus one voided charge that must not count, so the screen is
// exercised in the state that exposed the double count.
await page.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(350);
await page.evaluate(() => {
  const KEY = HIS.charges.KEY || 'mh_charges';
  const rows = HIS.store.get(KEY, []) || [];
  window.__qa = [];
  HIS.billing.all().forEach((b, i) => {
    const a = HIS.charges.add({ patientId: b.patientId, encounterId: b.encounterId, description: 'Nursing - wound dressing', source: 'nursing', sourceId: 'QA-N-' + i, qty: 1, unitPrice: 650 });
    window.__qa.push(['add', JSON.stringify(a).slice(0, 90)]);
    const cid = a && (a.charge ? a.charge.id : a.id);
    if (cid) window.__qa.push(['assign', JSON.stringify(HIS.charges.assign(cid, b.id, 'Billing math check')).slice(0, 90)]);
    const v = HIS.charges.add({ patientId: b.patientId, encounterId: b.encounterId, description: 'Voided test', source: 'laboratory', sourceId: 'QA-L-' + i, qty: 1, unitPrice: 900 });
    const vid = v && (v.charge ? v.charge.id : v.id);
    if (vid) { HIS.charges.assign(vid, b.id, 'Billing math check'); HIS.charges.void(vid, 'QA: must not count'); }
    window.__qa.push(['after', HIS.charges.totalFor(b.id)]);
  });
});

console.log('injection:', JSON.stringify(await page.evaluate(() => window.__qa.slice(0, 4))));
for (const inv of await page.evaluate(() => HIS.billing.all().map(b => b.id))) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(320);
  const shown = await page.evaluate((id) => {
    const row = document.querySelector(`.bl-row[data-id="${id}"]`);
    if (row) row.click();
    return null;
  }, inv);
  await page.waitForTimeout(260);
  const screen = await page.evaluate(() => {
    const out = {};
    [...document.querySelectorAll('.bl-tot > div')].forEach(d => {
      const label = (d.querySelector('span') || {}).textContent || '';
      const value = (d.querySelector('b') || {}).textContent || '';
      out[label.trim()] = Number(String(value).replace(/[^\d.-]/g, '')) || 0;
    });
    return out;
  });
  const model = await page.evaluate((id) => {
    const b = HIS.billing.all().filter(x => x.id === id)[0];
    return {
      amount: b.amount, items: !!b.items, subtotal: b.subtotal, vat: b.vat,
      charges: HIS.charges.totalFor(id), total: HIS.ledger.invoiceAmount(b),
      paid: HIS.ledger.paidOf(b), balance: HIS.ledger.balanceOf(b),
    };
  }, inv);

  const sub = screen['Subtotal'] || 0;
  const vat = screen['VAT (12%)'] || 0;
  const chg = screen['Charges raised (1)'] || 0;
  const grand = screen['Grand total'] || 0;
  const paid = screen['Paid'] || 0;
  const bal = screen['Balance due'] || 0;

  if (cent(sub) + cent(vat) !== cent(model.amount)) bad(`${inv}: subtotal ${sub} + VAT ${vat} != invoice amount ${model.amount}`);
  else if (cent(sub) + cent(vat) + cent(chg) !== cent(grand)) bad(`${inv}: ${sub} + ${vat} + ${chg} != grand total ${grand}`);
  else if (cent(grand) !== cent(model.total)) bad(`${inv}: grand total ${grand} != ledger ${model.total}`);
  else if (cent(paid) + cent(bal) !== cent(grand)) bad(`${inv}: paid ${paid} + balance ${bal} != grand total ${grand}`);
  else if (cent(model.charges) !== cent(650)) bad(`${inv}: voided charge counted (charges total ${model.charges})`);
  else ok();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${problems.length} failed | page errors: ${errors.length}`);
problems.forEach(p => console.log(' - ' + p));
process.exitCode = problems.length ? 1 : 0;
