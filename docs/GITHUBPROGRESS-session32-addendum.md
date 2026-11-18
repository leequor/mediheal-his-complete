# Session 32 addendum — M6 laboratory and pharmacy (2026-11-18)

Additive log. Branch `dev/autonomous-milestones`. `main` remains at `fd5bf9f`.

## The gap

`pharmacy.html` was a **redirect** to `treatment.html?modal=pharmacy`, so the drawer's Pharmacy link
dropped a pharmacist into the Treatment Plan screen. There was no laboratory module at all, no
inventory store, and no prescription record: Treatment's "Prescribe medication" added a line to a
plan, and its "Dispense medication" decremented a page-level counter (`st.stock = 240`) that no
other screen ever read.

## What was built

### `assets/js/lab.js` — orders, specimens, results, validation

Thirteen-test catalogue (hematology, chemistry, serology, imaging, cardiology) with a reference
interval and a critical threshold per test. Status machine `Ordered → Collected → In Process →
Resulted → Validated`, each transition guarded so a screen cannot skip a step.

The flag is **mechanical**, and that distinction is on the screen: it compares the entered number
against the configured critical threshold, then the reference interval. Text-only tests (ECG, MRI,
echocardiogram) are never auto-flagged, because "Normal" there is a reading, not a number. Nothing
infers a condition from a value.

Seven seeded orders, all for tests the treatment plans already name, including one critical Troponin.

### `assets/js/pharmacy.js` — batches, prescriptions, dispensing

Stock is held per **batch**, not as one quantity per drug, because that is the only way to answer
"which lot leaves the shelf" and "does it expire before the patient finishes it".

Rules enforced in the store, not the UI: no dispensing beyond the batch, none from an expired batch,
none beyond the prescription balance, stock never negative, every movement writes a stock-movement
row and an audit row. Dispensing picks first-expiry-first-out and supports partials.

12 seeded batches chosen so the demo always has a low-stock line, a near-expiry batch and an expired
one; six prescriptions seeded from the treatment plans plus one already `Verified` so the dispense
path has work in the queue.

### Two real screens

`laboratory.html` and a rebuilt `pharmacy.html`, both in the admin screen format established in M2
(KPI strip, card + toolbar + table, action-form modal). The laboratory adds a critical-result strip
that stays until the result is acknowledged. Pharmacy has two tabs — prescriptions and batch
inventory — because a pharmacist deciding whether to dispense needs both answers at once.

### Treatment now drives both queues

The Figma modals are unchanged; their submit handlers are not:

| Action | Before | Now |
|---|---|---|
| Prescribe medication | appended text to the plan | `HIS.pharmacy.createRx()` → real order, `Pending`, visible to pharmacy and portal |
| Order lab / imaging test | set the plan's next step | `HIS.lab.create()` → real order in the laboratory queue, priority mapped |
| Dispense medication | decremented `st.stock` | `HIS.pharmacy.dispense()` against the prescription the doctor raised and the first usable batch; refuses if either is missing |

A test the catalogue does not hold is **not** silently invented — the plan records it and the message
says it was not ordered.

## Verified

`scripts/clinical-check.mjs` (new): **53 / 53**.

It proves the rules, not just the rendering: a result cannot be validated before it is entered;
processing cannot start before collection; the same specimen cannot be collected twice; an in-range
value is not flagged and a text reading never is; a partial dispense leaves the prescription
`Partial` and reduces stock by exactly the quantity; a dispensed prescription cannot be dispensed
again; an expired batch is refused with a message naming the expiry; a batch of another drug is
refused; an adjustment without a reason and an adjustment that would go negative are both refused;
receiving creates a new batch; disposal zeroes an expired lot; every stock change writes a movement
row with its reason.

Then the integration: a validated result appears in the patient's own portal and an unvalidated
draft does **not**; a dispensed prescription appears in the portal with its status; prescribing in
Treatment raises a real pharmacy order with the right patient, drug and quantity; ordering a test in
Treatment creates a laboratory order with the catalogue name and mapped priority.

| Suite | Result |
|---|---|
| `clinical-check.mjs` | 53 / 53 |
| `portal-check.mjs` | 40 / 40 |
| `auth-check.mjs` | 25 / 25 |
| `roles-check.mjs` | 127 checks, 0 failures |
| `smoke.mjs` | 24 pages, 0 console errors |
| `visual-check.mjs` | all 24 pages match baseline |

## Bugs found while building this

1. **The portal rendered unvalidated laboratory drafts.** `R.medical` read `labFor(p.id)` with no
   status filter, so a result the laboratory had entered but not released appeared in the patient's
   record. Only `Validated` is shown now. The harness caught this, not inspection.
2. **The portal read the wrong field names.** It expected `o.resultValue` / `o.flag`; the laboratory
   store nests the reading under `o.result`. Every result would have rendered blank.
3. **The portal did not load `lab.js` or `pharmacy.js`** at all, so both sections said "module not
   available" while the stores existed.
4. **The critical-result strip never appeared** because the seeded Troponin was pre-acknowledged.
   The seed now leaves it open, which is also the more useful demonstration.
5. **`roles-check.mjs` had `pharmacy → treatment` in its ALIAS map**, encoding the old redirect as
   expected behaviour. The alias was removed, not worked around; the harness now expects the real
   page. `staff → personnel` stays, because that redirect still exists.

## Visual

`pharmacy.html` changed 82.5% — it went from a redirect stub to a real screen. Inspected on screen,
then rebaselined. `laboratory.html` is new and was added to the baseline (24 pages now).

## Not done in M6

* **No specimen barcode or label printing.** Collection records who and when, nothing more.
* **No reference-laboratory interface**, no analyser link. Results are typed.
* **Validation is not restricted to a second person.** In a real laboratory the person who entered a
  result cannot validate it; with one seeded technologist that rule would block every order, so the
  screen states it instead of pretending to enforce it.
* **No ward stock or unit-dose distribution.** Pharmacy issues to the patient, not to a bed.
* **Stock is not reserved** when a prescription is verified, so two pharmacists could each plan to
  dispense the same last box; the second `dispense()` would be refused at the point of writing.
