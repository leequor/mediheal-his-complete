# Session 41 addendum — M11 billable charges (2026-11-18)

Branch `dev/autonomous-milestones`, from `eb3465f`. `main` untouched at `fd5bf9f`. Nothing deployed.

## Why this milestone

M10.4 was accepted and the payroll methodology issues are parked as documented limitations. The next
gap was not another audit: it was that **clinical work never became revenue**. A laboratory order, a
dispensed drug and a consultation were all recorded, but the invoice total was a number written by
hand in `data-billing.js`. The Billing detail table even had a "charge source" column with nothing to
put in it.

## What was built

* `assets/js/charges.js` — a charge store. A charge is a **price event**, not money: it raises what the
  invoice says is owed and never touches `collected`.
* `lab.create()` raises a charge at the catalogue tariff; `pharmacy.dispense()` raises one for the
  quantity that actually left the shelf, at the batch's retail price.
* `HIS.ledger.invoiceAmount(bill)` = opening amount + active charges. Every balance, status, total and
  reconciliation goes through it, so Billing, Reports, the portal and Claims agree.
* The Billing detail lists each charge with its source and totals them separately.

## Idempotency

Charges are keyed on `source | sourceId | code`. Re-saving an order or retrying a dispense returns the
original row. A partial dispense is keyed on the dispense event, so each quantity bills once.

## A defect the screenshots caught

Adding rows to the invoice table pushed them under the totals block, which is positioned at a fixed
Figma offset. The first render showed "Subtotal / VAT / Charges raised" printed over the last two
charge rows. The panel, totals and action row now shift down by one row height (38.8px) per charge via
a CSS variable; with zero charges the variable is 0 and the geometry is byte-identical to the frame —
which is why the visual baseline still matches.

## Verification

| Suite | Result |
|---|---|
| `charges-check.mjs` (new) | 37 passed, 0 failed |
| smoke | all pages clean |
| clinical-check | 53 |
| finance-check | 31 |
| portal-check | 40 |
| claims-check | 41 |
| ledger-check | 46 |
| payroll-check | 89 |
| roles-check | 132 |
| auth-check | 25 |
| acceptance-audit | 180 |
| m10-1 / m10-2 / m10-3 / m10-4 | 77 / 78 / 75 / 54 |
| a11y | 22 pages, 0 violations |
| responsive | 125 checks |
| visual-check | all pages match baseline |
| buttons | 0 anomalies |

Billing inspected at 1440 and 1366 with charges present: no overlap, no clipping, no console errors.

## Not done

No admission/discharge workflow, so no room-and-board accrual. No charge master, payer-specific
pricing, VAT per charge, credit notes or unbilled queue. A patient with no open invoice is not
charged.
