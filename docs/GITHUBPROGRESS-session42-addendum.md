# Session 42 — M12: revenue integration and the inpatient lifecycle

**Branch:** `dev/autonomous-milestones` · **Start:** `43cbf84` · **End:** `070bff3`
**`main`:** `fd5bf9f`, untouched · **Deployed:** no · **Working tree:** clean

Four commits. 45 files, +4,422 / −203.

| Commit | One line |
|---|---|
| `a04bddc` | Encounters, charge master, unbilled queue, admissions and bed management |
| `38ec458` | Revenue harness, updated charge assertions, re-captured baselines |
| `b1a983e` | Project status, architecture, feature matrix, completion roadmap, module docs |
| `070bff3` | Configuration screen for the charge master |

---

## 1. The two gaps this closed

### The revenue loop stopped one step short

M11 let clinical work become a charge, but a charge found its invoice by asking for *"the patient's
oldest invoice with a balance"*. Two failures followed:

- A patient with a closed clinic visit and an open admission would have today's ward order billed to
  last month's clinic bill.
- A patient with no open invoice had the charge **discarded**. The service was recorded and the money
  vanished. `charges-check.mjs` §3 asserted that behaviour as correct, which is how it survived.

Now the chain is explicit: `patient → encounter → invoice → charge`. `charges.add()` resolves the
invoice from the charge's encounter. No invoice means the charge is still created, with
`billingStatus: 'unbilled'` and a reason, and waits in a queue. `assign()` moves it, requires a
reason, refuses a wrong-patient invoice, refuses a double assignment, and audits both directions.

### There was no inpatient half at all

`Patient` carried `ward`, `bed` and `admittedAt` — three strings — plus a cosmetic "Final statement"
button. No admission record, no bed board, no transfer, no room-and-board accrual, no discharge.

`admissions.js` now models the episode, 172 configured beds across six wards, transfers as history,
daily accrual, and a discharge that runs a final accrual, releases the bed and completes the
encounter. **Occupancy is derived** from the active admission, so a bed cannot be double-booked and a
transfer cannot leave two records claiming one bed.

## 2. The rule that took the most thought

> A day is billable when the patient was in the bed at **12:00 Asia/Manila**. The admission day
> always counts. The discharge day counts only if the patient left after noon.

The first version applied the cutoff to the admission day too, which meant a patient admitted at
16:00 generated no charge at all — correct by the letter, useless in practice, and it made the demo
look broken. The admission day is now always billable, which is the "first day" convention and is
stated on the screen and in `docs/ADMISSIONS.md`.

The rate is the rate of the bed occupied **at that day's cutoff**, so a transfer after noon changes
the rate from the next day and a posted day never has to be re-priced.

## 3. The demo clock

`new Date()` is 18 November 2026; the application's header says 31 August 2026. Admissions is the one
module where that gap is not cosmetic: a two-night stay seeded in August reported **78 billable days**
because accrual projected to the wall clock.

`admissions.clock()` now returns `HIS.today` pinned to 14:00, and admission, accrual, discharge and
the stay-length column all read it. The two seeded admissions report 3 days and 2 days, which is what
their invoices already say.

## 4. What the screenshot caught that the harness could not

Four defects, all found by looking:

1. **The bed board ate the page.** 172 tiles pushed the admission records two screens down. The board
   now opens on one ward; the selector is right there.
2. **The action column clipped.** "Post charges / Transfer / Discharge" ran past the card edge. Column
   widened 168 → 252 px.
3. **The ward filter leaked into the admission table**, so the second active admission silently
   disappeared from a list that said "1 of 2".
4. **`Admitted at` defaulted to the wall clock**, so the demo-clock fix in the store was undone by the
   form the moment a user submitted it.

Same lesson as M2, M4 and M9.2: measurement proves no regression; only looking proves it works.

## 5. Verification

| Suite | Result |
|---|---|
| `revenue-check.mjs` (new) | **80 / 80** |
| `charges-check.mjs` | 44 / 44 |
| `clinical-check.mjs` | 53 / 53 |
| `roles-check.mjs` | 144 checks |
| `auth-check.mjs` | 25 / 25 |
| `finance-check.mjs` | 31 / 31 |
| `portal-check.mjs` | 40 / 40 |
| `claims-check.mjs` | 41 / 41 |
| `ledger-check.mjs` | 46 / 46 |
| `payroll-check.mjs` | 89 / 89 |
| `acceptance-audit.mjs` | 180 / 180 |
| `m10-1..4` | 77 / 78 / 75 / 54 |
| `smoke.mjs` | 28 pages clean |
| `a11y-check.mjs` | 27 pages, 0 violations |
| `responsive-check.mjs` | 140 checks, no overflow |
| `visual-check.mjs` | 28 pages, 0.000% at 1440 **and** 1366 |
| `buttons.mjs` | 0 anomalies |

**1,057 assertions** across the rule-asserting harnesses.

### Two assertions were changed, deliberately

`charges-check.mjs` §3 asserted that a charge with no open invoice is **discarded**. That is exactly
what the brief forbids, so the section now asserts the stronger contract: the charge is recorded,
marked unbilled, names its encounter, records why, moves no invoice total, and appears in the queue.
§6's counts follow. Nothing was weakened — the replaced section tests more, not less.

### Two pages changed, both intended

- **Laboratory 4.744%**, bounding box (187,560) 1164×408 — the added Cancel action, table body only.
- **Reports 34.746%**, bounding box (0,170) 1440×1353 — the added KPI strip and unbilled card.

Every other page measured **0.000%** before re-capture, so nothing else moved. Baselines are now
committed at both 1440 and 1366 for the first time.

### An audit that had never run

`a11y-check.mjs` never listed `laboratory` or `pharmacy`. Neither had ever been audited. Both are in
the list now, with the three new screens: 27 pages, 0 violations.

## 6. Still open

- **Catalogue and bed configuration** are read-only on the Configuration screen; adding a test or a
  bed still means editing a file.
- **Payroll proration** for hires and separations — no hire date on the record, and the basis is a
  policy decision, not a code fix.
- **Portal** has no dedicated admission or claim view; both are implied by the statement.
- Everything in `docs/COMPLETION-ROADMAP.md` §3 (external credentials) and §4 (deliberately deferred).
- Admin tables below 1440 px still stack without field captions — shared with Laboratory, Pharmacy,
  Claims, Accounts, Audit and Reports, recorded in `DESIGN-LOCK.md` §15.5 rather than half-fixed.

## 7. Assessment

**Functionally complete with deferred features.** Every major supported workflow runs end to end and
is covered by a harness: registration → appointment → consultation → orders → charge → invoice →
payment; order → specimen → result → release → charge; admission → bed → accrual → transfer →
discharge → final bill. What remains is configuration convenience, one payroll policy decision, and
the external integrations that cannot be built without credentials.

No new milestone is needed to finish this. The remaining items are listed, sized and ranked in
`docs/COMPLETION-ROADMAP.md`.
