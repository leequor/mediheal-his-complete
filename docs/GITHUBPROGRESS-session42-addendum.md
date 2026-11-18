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

---

# M12 closeout

A focused acceptance pass. No new milestone, no new feature area: verify what shipped, fix what the
verification exposed, and write down what is still limited.

## 1. Configuration — what is actually administrable

The screen said "Configuration" and showed a bed count, which implied more than it delivers. The
subtitle now states the boundary in one sentence, the KPI reads "Beds in service · read-only", and
the second card is headed "Seeded from code — not editable here". `PROJECT-STATUS.md` §2 carries the
same boundary as a create / edit / deactivate / view table.

| Setting | Create | Edit | Deactivate | View |
|---|---|---|---|---|
| Service tariff price | append an effective-dated row | never | never — superseded, not deleted | current + full history |
| Tariff code | not from the screen | no | no | yes |
| Laboratory catalogue, beds, payroll policy, departments | no | no | no | count only, read-only |
| User accounts | yes | yes | deactivate | yes |
| Pharmacy stock | receive | adjust | dispose | yes |
| Bed state / assignment | admit | transfer, cleaning, maintenance | discharge | yes |

The catalogue and the bed inventory are **not** made editable here. Adding a test or a bed needs a
catalogue editor, validation, and a decision about orders already placed against a retired test;
half-building that would be worse than an honest boundary. It stays as `COMPLETION-ROADMAP.md` §2.1.

Effective dating is verified, not asserted: after a change made through the real dialog, the earlier
price is unchanged, the new price applies from its date, an existing charge keeps its snapshot, and a
charge raised afterwards uses the new price (`revenue-check.mjs` §9, 6 assertions).

## 2. The defect the boundary tests found

`bedAt()` answered "which bed was the patient in at this instant?" by starting from
`admission.bedId` — but that field is overwritten by every transfer. So after a transfer, re-accruing
an earlier day priced it at the **destination** rate. A Private→Ward step-down made the first night
bill at ₱1,200 instead of ₱2,800.

The existing suites could not see it: they posted the early days *before* transferring, so the
duplicate guard skipped them and the wrong rate was never computed. The new suite transfers first and
accrues afterwards, which is the ordering a back-dated accrual or a late discharge produces.

Fixed by making the base segment `transfers[0].from`. `adt-boundary-check.mjs` §4 now pins both
directions: a transfer at 11:00 changes that same day's rate, a transfer at 15:00 does not.

## 3. Boundary and idempotency coverage — `adt-boundary-check.mjs`, 59 assertions

One fresh browser context per case, so no case can inherit another's store.

| Case | Asserts |
|---|---|
| Admission day | billable at 09:00 and at 15:00, at the admitting bed rate |
| Noon cutoff | not billable at 11:59, billable at 12:01, and only the new day posts |
| Discharge day | 11:00 discharge → not billable; 13:00 discharge → billable |
| Transfer before cutoff | that day is re-rated to the destination bed |
| Transfer after cutoff | that day keeps its rate; the new rate starts the next day |
| Repeated accrual | 2nd and 3rd post nothing, report skips, one room charge per date |
| Repeated discharge | refused, no extra charge, status unchanged |
| Reopen | bed back to occupied, original discharge kept in history |
| Reload ×3 | same admission, same bed, no new charge, occupancy unchanged |
| Duplicate bed | second admission and transfer into an occupied bed both refused |
| Derived occupancy | removing the admission frees the bed with no other write; the bed-state store never holds "occupied" |
| Invoice association | pre-link charges stay unbilled; post-link charges land on the invoice; total is exact |
| History | transfer keeps `from`/`to`; day-one charge untouched by the move and the discharge |

## 4. Concurrency — stated, not glossed

`localStorage` has no lock, no transaction and no compare-and-swap. Every write is
`get → mutate → set` on one JSON blob, last write wins.

- Within one tab the duplicate-bed guard is real, and §8 above proves it.
- Across two tabs it is not. §12 of the suite holds a snapshot in tab A, admits a patient in tab B,
  writes A's stale snapshot back, and shows **tab B's admission is gone**.

So the project does not claim that simultaneous users cannot double-book a bed. `PROJECT-STATUS.md`
§5.1 states this, `docs/ADMISSIONS.md` repeats it, and the test demonstrates the failure rather than
asserting safety.

## 5. Visual results — 1440 and 1366, reported separately

Two baselines exist now and they answer different questions.

**A. Against the M12 baseline (the state this milestone left):** all 28 pages match at **both**
1440 and 1366 — 0.000%, 0 hard pixels. This proves the closeout changed nothing except the
Configuration copy, which was re-captured deliberately.

**B. Against the ORIGINAL pre-M12 baseline** (captured from `43cbf84` in a throwaway worktree, so the
comparison is reproducible rather than remembered):

| Page | 1440 | 1366 |
|---|---|---|
| **Laboratory** | **4.744%**, 16,173 px ≥128, box (187,560) 1164×408 | **1.741%**, 10,657 px ≥128, box (0,1121) 1366×1423 |
| **Reports** | **34.746%**, 602,238 px ≥128, box (0,170) 1440×1353 | **28.383%**, 638,332 px ≥128, box (0,68) 1366×2000 |
| 22 other pre-existing pages | 0.000% | 0.000% |
| admissions, charges, settings | no original baseline — new screens | no original baseline — new screens |

The two differences are intentional and were reviewed on screen:

- **Laboratory** — a ghost "Cancel" action on every non-validated row, with a stated billing
  consequence. The action column widened 134 → 232 px and the Test column narrowed so every row stays
  on one line. The diff box is the table body only; the header, KPI strip and critical-result strip
  are unchanged.
- **Reports** — a second KPI strip (unbilled charges, beds occupied, beds available, active
  admissions) and an "Unbilled charges by source" card, because the page reported revenue without
  reporting revenue that had not reached a bill. Everything below the first strip therefore moved
  down, which is why the percentage is large.

**Not claimed:** that every page has zero visual differences. Two pages differ from the original
design by design, and three pages did not exist in the original.

**Known layout limitation, unchanged.** At 1366 the admin tables (Laboratory, Pharmacy, Claims,
Accounts, Audit, Reports, Admissions, Configuration) stack into blocks without per-field captions.
It is measured, it is in `DESIGN-LOCK.md` §15.5, and it was not fixed here: adding captions to one
table and not the others would create a second responsive pattern, which the design contract
forbids.

## 6. Final regression

| Suite | Result |
|---|---|
| `adt-boundary-check.mjs` (new) | **59 / 59** |
| `revenue-check.mjs` | 81 / 81 |
| `charges-check.mjs` | 44 / 44 |
| `clinical-check.mjs` | 53 / 53 |
| `finance-check.mjs` | 31 / 31 |
| `ledger-check.mjs` | 46 / 46 |
| `claims-check.mjs` | 41 / 41 |
| `portal-check.mjs` | 40 / 40 |
| `auth-check.mjs` | 25 / 25 |
| `payroll-check.mjs` | 89 / 89 |
| `acceptance-audit.mjs` | 180 / 180 |
| `m10-1..4` | 77 / 78 / 75 / 54 |
| `roles-check.mjs` | 144 checks |
| `smoke.mjs` | 28 pages clean |
| `a11y-check.mjs` | 27 pages, 0 violations |
| `responsive-check.mjs` | 140 checks, no overflow |
| `buttons.mjs` | 0 anomalies |
| `visual-check.mjs` | 28 pages, 0.000% at 1440 and 1366 |

**1,117 assertions across 16 rule-asserting harnesses. 0 failures, 0 skips** (the only "skips" are
the three new pages having no pre-M12 baseline to compare against, which is expected).

## 7. Repository state

`dev/autonomous-milestones` · `main` still `fd5bf9f` · not merged · not deployed · nothing pushed.

---

# Final presentation pass

A polish pass over the finished application. No new features, no redesign: remove everything that
exposed the build, make the naming agree, make the demonstration data genuinely temporary, and verify
the whole site at both desktop widths.

## 1. What was removed from the product

An audit of every rendered page, every dialog and every tooltip found these build artefacts:

| Artefact | Where it was visible | Now |
|---|---|---|
| "from Consultation (M2)", "from Ward / bed assignment (M3)" | Billing invoice line items | "Consultation — Dr. L. Laureta", "Room and board — private, 3 days" |
| `assets/js/lab.js · CATALOG`, `assets/js/admissions.js · WARDS` | Configuration, read-only rows | Plain descriptions of what each setting is |
| "not in the main Figma frame (estimated summary)" | Billing, invoices without items | "Itemised lines are not recorded for this invoice" |
| "Opens a state frame in Figma; not built yet" | Departments "Add doctor", Profile "Edit / Transfer / Discharge" | Removed — both controls open a working dialog, so the tooltip was both stale and wrong |
| "Visit history is not drawn in Figma" | Consultation tooltip | "Visit history is not available in this view" |
| "Temporary form. Figma has no edit screen yet." | Appointment editor subtitle | "Update the details below and save to keep the appointment." |
| "Demonstration identity system… non-cryptographic digest… see `docs/AUTH.md`" | Accounts note | A product note about deactivation and the audit log |
| "Demo accounts", "Demo environment · synthetic data only", "Demonstration data", "seeded" | Sign-in, account menu, Laboratory, Pharmacy, Admissions, Charges, Settings, Reports, Portal, Audit | "Sample accounts", "Sample data · all records fictitious", "About these results", etc. |

Also fixed: the `aria-label` on the header profile block read *"Account and demo role: …"* on all 28
pages, and `staff.html` used a different title separator and product name.

**Kept deliberately:** the honest disclosures. A hospital demonstration must say its records are
fictitious, that a claim is not cash, and that a critical flag is a comparison rather than a
diagnosis. Those are product statements, not build artefacts.

## 2. Naming

- Drawer item **Staff** → **Attendance**. The page heading and document title already said Attendance;
  the navigation was the odd one out.
- `staff.html` title → `Staff · MediHeal`.
- Every other navigation label already matched its page heading.

## 3. Temporary data, actually temporary

The demonstration data moved from `localStorage` to **`sessionStorage`**:

- survives navigation and refresh within the tab;
- is discarded when the tab closes, so a new visitor always starts from the seed;
- is restored immediately on **sign out** and on the new **Reset sample data** action in the account
  menu (the audit trail is carried across the reset so the session stays readable).

The only thing that can outlive the tab is an explicitly remembered sign-in token — a user id, an
email and an expiry, no hospital record. Unticked (the default) nothing persists at all.

Two consequences worth stating rather than hiding:

- **Two tabs are two independent demonstrations.** That is isolation, not concurrency control. The
  duplicate-bed guard is real within a tab (`adt-boundary-check.mjs` §8) and there is no shared store
  to race over (§12 asserts the isolation). The project still does not claim that simultaneous real
  users could not double-book a bed, because there is no server and no transaction.
- **A role switch ends the demonstration.** Signing out restores the seed, so the harnesses that
  switch identity mid-scenario now call `HIS.auth.clear()` instead of `signOut()` — the session ends,
  the data does not. `auth-check` still covers a real sign-out end to end.

## 4. Verification

Every suite was re-run after the changes; three needed updating for the new behaviour, none weakened:

- `auth-check` — the unknown-account assertion matched the old copy ("No demo account…"); it now
  matches the new message. 25/25.
- `clinical-check` — the portal check opened a second tab, which is now a separate dataset; it signs
  in on the same tab, which is what a visitor does. 53/53.
- `claims`, `ledger`, `acceptance`, `m10-1` — role switches use `clear()` rather than `signOut()`.
- `adt-boundary-check` §12 was rewritten from "lost update across tabs" to "two tabs are two
  demonstrations", plus a new §13 proving sign-out restores the seed. 65/65.

| Suite | Result |
|---|---|
| `adt-boundary-check` | 65 / 65 |
| `revenue-check` | 81 / 81 |
| `charges-check` | 44 / 44 |
| `clinical-check` | 53 / 53 |
| `finance-check` | 31 / 31 |
| `ledger-check` | 46 / 46 |
| `claims-check` | 41 / 41 |
| `portal-check` | 40 / 40 |
| `auth-check` | 25 / 25 |
| `payroll-check` | 89 / 89 |
| `acceptance-audit` | 180 / 180 |
| `m10-1..4` | 77 / 78 / 75 / 54 |
| `roles-check` | 144 checks |
| `smoke` | 28 pages clean |
| `a11y` | 27 pages, 0 violations |
| `responsive` | 140 checks, no overflow |
| `buttons` | 0 anomalies |
| `visual` | 28 pages, 0.000% at 1440 and 1366 after re-capture |

**1,123 assertions across 16 rule-asserting harnesses, 0 failures.**

## 5. Visual result

Copy changes moved pixels on 11 pages. Each was verified to be text-only before the baseline was
re-captured: page heights were compared separately, and at 1440 only `accounts` (−1px) and `settings`
(−37px) changed total height; at 1366 only `admissions` (−16px) and `settings` (−32px). No horizontal
overflow on any page at either width. Details and per-page percentages are in `DESIGN-LOCK.md` §16.

Against the **pre-M12 original**, nine pre-existing pages differ: Laboratory and Reports by design,
and seven (Accounts, Audit, Billing, Claims, Dashboard, Index, Pharmacy) by wording alone. Height is
identical to the original on 23 of the 25 pre-existing pages at both widths.
