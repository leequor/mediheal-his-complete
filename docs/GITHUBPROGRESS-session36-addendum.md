# Session 36 addendum — M10 claims, payroll correctness and attendance (2026-11-18)

Additive log. Branch `dev/autonomous-milestones`. `main` remains at `fd5bf9f`. Nothing deployed.

M10 was an audit before it was a build. The first two hours went into reproducing M8's arithmetic and
M7's ledger by hand, and both turned out to be wrong in ways their own tests could not see.

## The payroll defect, and why the old test passed

M8's harness asserted that a "period basic" of 60,000 became a monthly equivalent of 120,000. That
expectation *was* the bug: `data-payroll.js` holds monthly salaries (26,000 for an administrative
officer, 35,000 for a head nurse — semi-monthly amounts would put them at 52,000 and 70,000), and the
calculator multiplied each by two before applying the contribution tables.

The reported 12,381.20 is reproducible, and so is the brief's 8,363.40: the first is the semi-monthly
table applied to a taxable amount of 65,775 that was itself derived from two months of pay; the second
is the monthly table applied to the same inflated figure. Neither is the tax on the employee's pay.
The corrected figure is **4,059.10** on a semi-monthly period, or 8,118.40 on a monthly one.

Full derivation, tables and worked examples: `docs/PAYROLL.md`.

## What was built

| Area | Before | Now |
|---|---|---|
| Salary model | `basic` per row, ambiguous period | `monthlyBasic` in `employees.js`; period derived from the frequency |
| Withholding | semi-monthly table only | Annex E daily / weekly / semi-monthly / monthly / annual, selected by frequency |
| Contributions | monthly amount halved unconditionally | monthly base, apportioned by `periodsPerMonth`; employer share reported separately |
| Attendance | a single-day register, never read by payroll | 128 period records, day types, OT/ND hours, timesheet approval, corrections with history |
| Payroll run | rows edited in place | draft → reviewed → approved → released, one run per period, version history |
| Payslip | 6 fields and one line of breakdown | every earning and deduction line, employer block, printable PDF |
| Overtime / ND / holiday | not implemented | Labor Code Arts. 82, 86, 87, 93, 94 with the day-type matrix |
| 13th month | not implemented | PD 851 basis, ₱90,000 exemption, year-end annualisation |
| Claims | a coverage amount on an invoice | 13-state lifecycle, documents, history, role-gated transitions, settlement through the ledger |
| Ledger | balance arithmetic only | idempotency by key and source id, `invariants()`, `reconcile()` |

## Three defects the tests could not have caught

1. **The approval gate read a snapshot.** `run.blocked` was computed when the run was created. Reopen a
   timesheet afterwards and the run still approved. The harness caught it because it reopened a
   timesheet *after* creating the run; the fix compares a fingerprint of each line's attendance with
   the live summary at approval time.
2. **`withholding(x, 'annual')` silently used the semi-monthly table.** `freq()` fell back to
   semi-monthly for any unknown key, so the annual reconciliation was withholding at half the correct
   bracket. `freq()` now throws, and `'annual'` is handled explicitly.
3. **The seeded settlement moved the demo's billing totals.** Seeding a settled claim posted ₱1,500 of
   coverage, which changed Billing, Reports and the portal by a figure nobody asked for. The seed now
   settles nothing; settlement is a deliberate action on the screen. `visual-check` found this — the
   Reports page differed by 0.125%.

Two more were found by looking at screenshots, not by measuring: the claims KPI cards rendered label
and value on one line because the helper emitted `<span>` into a block layout, and the claims table had
no click handler at all — `data-open` was decoration. A third: rewriting `.pr-modal` to `position:fixed`
dropped its `width`, collapsing the card to 0px.

## Verification

| Suite | Result |
|---|---|
| `scripts/payroll-check.mjs` | 89 passed, 0 failed |
| `scripts/claims-check.mjs` | 41 passed, 0 failed |
| `scripts/ledger-check.mjs` | 46 passed, 0 failed |
| `scripts/smoke.mjs` | all pages clean |
| `scripts/roles-check.mjs` | 132 checks, allowlists complete |
| `scripts/auth-check.mjs` | 25 passed |
| `scripts/clinical-check.mjs` | 53 passed |
| `scripts/finance-check.mjs` | 31 passed |
| `scripts/portal-check.mjs` | 40 passed |
| `scripts/a11y-check.mjs` | 0 violations (claims added to the sweep) |
| `scripts/responsive-check.mjs` | 125 checks, no overflow |
| `scripts/visual-check.mjs --check` | all pages match baseline |
| `scripts/buttons.mjs` | 0 anomalies |

The payroll baseline was re-captured. The 2.145% diff is the data correction described in
`docs/DESIGN-LOCK.md` §13.3 — same columns, same geometry.

## What M10 did not do

* No real PhilHealth or HMO integration. The screen says so, and `docs/CLAIMS.md` §6 lists what one
  would require.
* No claim-to-remittance matching; settlement is recorded, not reconciled against a bank file.
* Attendance is seeded and corrected, not imported from a biometric device.
* Overtime is paid at the statutory minimum; no CBA rates, no regional wage orders.
* No BIR Form 2316, no alphalist, no loan amortisation, no bank file.
* Still client-side, still browser storage, still no security boundary. `docs/AUTH.md` is unchanged.

---

## M10 acceptance audit (independent pass)

A separate audit harness (`scripts/acceptance-audit.mjs`, 180 assertions) re-derives every figure
from the published rule instead of reusing the M10 fixtures. It found four defects.

### 1. Claim ids grew without bound and eventually collided — fixed

`nextId()` stripped every non-digit from the previous id, so `CLM-2026-0005` became `20260005` and
the next id was `CLM-2026-20260006`, then `CLM-2026-202620260007`. Within a handful of creates the
number passed `Number.MAX_SAFE_INTEGER`, two claims received the same id, and `get()` returned
whichever came first — so a transition could act on the wrong claim. The sequence is now the last
hyphen-separated segment. Twelve consecutive creates are asserted to stay unique and short.

### 2. A stale run could be released — fixed

The live attendance check ran on `approved` only. Approve a clean run, reopen a timesheet, release:
it went through. Both transitions now share `staleEmployees()`.

### 3. A changed timesheet left an approved run with no recovery path — fixed

`recompute()` refused `approved`, so once approval was given there was no way to pick up a
correction — the error message pointed at a "correction run" that did not exist. `recompute()` now
accepts an approved run, archives the approved version, clears the approval stamp, records
`approval invalidated` in the history and returns the run to draft. A **released** run stays final,
and the message now says so instead of promising something the demo cannot do.

### 4. Two audit expectations were wrong, not the code

Settlement was read from a copy captured before the transition, and `File appeal` was expected to
land in `under-review` when the table says `Appeal requested`. Both corrected in the harness.

### Regulatory re-check (November 2026)

| Rule | Status | Source |
|---|---|---|
| SSS 15%, MSC ₱5,000–₱35,000, employee 5% | unchanged for 2026 | SSS Circular 2024-006 |
| PhilHealth 5%, floor ₱10,000, ceiling ₱100,000 | unchanged for 2026 | PhilHealth Circular 2024-0031 |
| Pag-IBIG 2% / 2%, fund salary cap ₱10,000 | unchanged | HDMF Circular 460 |
| BIR Annex E tables | no superseding issuance found; still "2023 and onwards" | RR 11-2018 |
| NCR minimum wage | **moved**: ₱718.00–₱755.00 a day | Wage Order NCR-28, 26 Sep 2026 |

Open for professional review: the Pag-IBIG 1% tier, the absence of any wage-floor enforcement, the
2026 holiday list, and the whole table set against the next issuance.

### Acceptance results

| Section | Result |
|---|---|
| Attendance → payroll (absence, leave, late, undertime, OT, ND, premiums, gates, versions) | 39/39 |
| Statutory rules against an independently encoded Annex E | 14/14 |
| Claims: 13 statuses × 17 actions, role gates, financial integrity | 27/27 |
| Payslips: 7 cases, every line hand-checked | 99/99 |
| Console errors | 0 |

Full suite after the fixes: smoke clean · roles 132 · auth 25 · clinical 53 · finance 31 · portal 40
· payroll 89 · claims 41 · ledger 46 · a11y 22 pages 0 violations · responsive 125 · visual all match
· buttons 0 anomalies.
