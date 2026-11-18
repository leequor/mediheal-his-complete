# Session 33 addendum — M7 Philippine healthcare finance (2026-11-18)

Additive log. Branch `dev/autonomous-milestones`. `main` remains at `fd5bf9f`.

## The inconsistency, resolved

Before M7 the same money was computed four times:

| Screen | Source |
|---|---|
| Billing KPI strip | **hardcoded** Figma sample text: ₱482K billed / ₱395K collected / ₱87K outstanding |
| Billing invoice panel | `b.paid` on the invoice, or `status === 'Paid' ? amount : 0` |
| `billing-modal.js` | the same expression, copied |
| `reports.js` | a third copy |

The four invoices under the strip total ₱160,860. The strip had **no relationship to them at all** —
it was sample text in the frame. There was also no transaction record anywhere: recording a payment
overwrote a number on the invoice, so "what was received, when, by whom, by what method" did not
exist.

## The model

```
invoice ── charge lines
        └─ transactions ── payment    money received
                        ├─ refund     money returned
                        ├─ coverage   a payer settles part of the charge  ← NOT a collection
                        ├─ discount   an authorised reduction
                        └─ adjustment a correction
balance = amount − (payments − refunds) − (coverage + discounts + adjustments)
status  = derived
```

Amounts are integers in **centavos** inside the ledger, converted once at the boundary.

`HIS.ledger` is now the only place any of this is computed. `billing.js`, `billing-modal.js`,
`reports.js`, `dashboards.js` and the patient portal all call it. The four copies became one.

### The KPI strip

Derived: **₱160,860 billed / ₱100,700 collected / ₱60,160 outstanding**, and the fourth card's label
changed from "Bills today" (Figma sample `12`, and no invoice is dated Aug 31) to **"Invoices on
file"** = 4.

### Coverage and discounts

Recorded as their own transaction kinds, never as payments. `totals()` therefore reports
`collected` and `covered` separately, and `byMethod()` counts only money received — otherwise
"Maxicare" would appear as a payment channel. `byPayer()` is the payer mix.

The Coverage modal now reads the payer details from the **patient record** (PhilHealth number and
category, HMO provider and LOA) instead of hardcoded text, and defaults the amounts to zero: a
PhilHealth case rate and an HMO approval are decisions made by those payers, and this screen records
them rather than inventing them. A discount without an OSCA / PWD / authorisation number in the line
is refused.

### Electronic payments

`GCash`, `Maya`, `QR Ph`, `Bank transfer`, `Debit card`, `Credit card` land as **pending** and need a
provider reference. A pending row does not move the balance; a cashier confirms it after checking
the reference, which is the only honest way to represent this in a static demo with no gateway.

## Verified

`scripts/finance-check.mjs` (new): **31 / 31**.

* coverage reduces the balance, is **not** counted as collected, and is reported in its own bucket
* a discount without an authorisation number is refused; a documented one is accepted
* paying more than the remaining balance is refused; paying exactly it is accepted and the invoice
  reads `Paid` once coverage plus payment cover it
* the ledger splits received (₱42,800) from covered (₱10,000) on the same invoice
* an electronic payment without a reference is refused, lands `pending`, does **not** move the
  balance, and moves it on confirmation
* a void removes the payment from the balance; a refund cannot exceed what was received and
  increases the balance
* **Billing's KPI strip and Reports show the same three figures**, and
  `billed = collected + covered + outstanding` holds exactly
* the patient portal's statement shows the same balance the ledger holds
* an unconfirmed electronic method is absent from the collection mix and present after confirmation;
  the payer mix lists the payer and the method mix does not

| Suite | Result |
|---|---|
| `finance-check.mjs` | 31 / 31 |
| `clinical-check.mjs` | 53 / 53 |
| `portal-check.mjs` | 40 / 40 |
| `visual-check.mjs` | all 24 pages match baseline |

## Not done in M7

* **No claim lifecycle screen.** Member information, eligibility, documentation and the covered
  amount are represented (patient record + coverage transaction + mandatory reference), but there is
  no `claim` record with a submission status, approval status and follow-up owner. That is the
  remaining half of "complete PhilHealth / HMO".
* **No eClaims or HMO portal integration**, and none is simulated. No case rate is hardcoded,
  because a rate table that goes stale silently is worse than an empty field.
* **No invoice aging or daily/monthly collection report.** `totals()` supports a date filter; no
  screen uses it yet.
* **No refund authorisation workflow.** A cashier can refund; nothing requires a second approval.
