# Final QA report — real-browser defect pass

This pass did not add a feature. It took the application as a visitor meets it, in a browser at 100%
zoom, and fixed what was broken: a sign-in dead end, statistics that disagreed with their own tables,
one photograph for every member of staff, payroll notifications shown to a medical technologist, and
dialogs whose primary action sat below the window.

Starting HEAD `69c9a63`. Branch `dev/autonomous-milestones`. `main` untouched at `fd5bf9f`.

---

## 1. What was wrong, and what changed

| # | Defect | Where | Fix |
|---|---|---|---|
| 1 | A patient who signed out landed on the portal sign-in with no way back to the staff console; the only hint was an error message naming `index.html` | `portal.html`, `portal.js` | A **Staff sign in** row in the sign-in panel and a staff link in the landing bar; the staff-account refusal is now a link, not a sentence |
| 2 | The appointment KPIs read 1,284 / 856 / 263 / 165 / 12 against six records, and the footer said "Showing 1–6 of 1,284" with three dead page buttons | `appointments.html`, `data-records.js` | Counted from `HIS.appointments` on every render; the fifth card reports **Completed** because a walk-in has no record behind it; real pagination that appears only when there is more than one page; the hardcoded `HIS.apptotals` table is deleted |
| 3 | Every staff account showed the same profile photograph | `shell.js`, `base.css` | Initials avatars, tinted from a six-colour palette keyed on the account email, used in the header and the account menu |
| 4 | The notification panel showed the same four attendance and payroll rows to every role | `shell.js` | Derived per role from the module that owns the fact — laboratory orders, pharmacy batches, unbilled charges, invoices, claims, admissions, appointments, leave. Read state is per role and per row id |
| 5 | The medical technologist dashboard said "Not modelled yet (M6)", "Collection tracking not yet modelled", and its card descriptions were clipped mid-word | `dashboards.js`, `pages.css` | Real laboratory counts by status; a critical-results panel; the card description wraps and clamps to two lines |
| 6 | The pharmacist dashboard had the same unbuilt-module card | `dashboards.js` | Prescriptions to verify, ready to dispense, low stock, expiring batches, and a stock-watch panel |
| 7 | **Generate payslips** opened at `top:453px` with a 438px body — 891px on a 768px window, so the primary action was unreachable | `payroll.css`, `payroll.js` | Dialogs are centred in the viewport and clamped to it; a dialog taller than the window scrolls inside its own box |
| 8 | The same geometry put the payslip (748px at `top:76`) and **Assign ward and bed** (664px at `top:120`) modals past the fold | `treatment.css`, `appointments.html` | Same rule |
| 9 | The ward / bed / doctor / isolation fields were free text, and "Bed available" was a fixed sentence | `treatment.js` | Ward, bed, doctor and isolation are selects; the bed list is rebuilt from the ward and offers only beds that are free; the banner names the bed actually selected and is re-checked at submit |
| 10 | The registration form accepted any string as a bed number | `reg-form.js` | Ward → bed dependent select over the real bed inventory; the ward list is the hospital's own wards |
| 11 | The appointment editor took the patient name as free text | `appointments.html` | Select over the registry, so a visit cannot be filed against a name that exists nowhere |
| 12 | The bed board pushed the admission records and every row action below the fold | `admin-pages.css`, `admissions-page.js` | Two rows visible, the rest scroll, legend says so |
| 13 | `HIS.departments` was defined twice with different shapes — a name list and an object list — so the Departments page crashed for the department head and the dashboard's department panel read `.name` off a string | `data-records.js`, `reg-form.js`, `reg-form-out.js` | The name list is `HIS.deptNames`; `HIS.departments` is always the object list |
| 14 | Two harnesses served on port 8788. When that port was already held, Windows routed every request to the stranger and the sweep audited someone else's server — 27 pages of phantom 404s | `smoke.mjs`, `buttons.mjs` | Probe the port first; serve on an ephemeral one when it is taken |
| 15 | "not modelled" and "Partial returns are not modelled" read as build notes | `settings-page.js`, `pharmacy-page.js` | Reworded as product statements |

## 2. What was checked and found sound

Laboratory and Pharmacy at 100% zoom: columns aligned, action buttons inside their card, no clipping.
Billing line items read as services, totals align, the ledger reconciles. Claims KPI strip and
register. Reports' two KPI strips. Admissions records and actions. Audit, Accounts, Configuration,
Personnel, Attendance, Departments, Profile, Registration, Nursing, Consultation — no clipped text,
no overlap, no console error.

## 3. Verification

| Suite | Result |
|---|---|
| `qa-check.mjs` (new) | **91 / 91** |
| `qa-final-check.mjs` (new) | **68 / 68** |
| `revenue-check` | 81 / 81 |
| `charges-check` | 44 / 44 |
| `adt-boundary-check` | 65 / 65 |
| `clinical-check` | 53 / 53 |
| `finance-check` | 31 / 31 |
| `ledger-check` | 46 / 46 |
| `claims-check` | 41 / 41 |
| `portal-check` | 40 / 40 |
| `auth-check` | 25 / 25 |
| `payroll-check` | 89 / 89 |
| `acceptance-audit` | 180 / 180 |
| `m10-1 … m10-4` | 77 / 78 / 75 / 54 |
| `roles-check` | 144 checks |
| `smoke` | 28 pages clean |
| `a11y` | 27 pages, **0 violations** |
| `responsive` | 140 checks, no overflow |
| `buttons` | **0 anomalies** |
| `visual` | 28 pages, 0.000% at 1440 and 1366 |

**1,138 assertions across 17 rule-asserting harnesses, plus 144 role checks — 1,282 in all. 0 failures, 0 skips.**

`qa-check.mjs` is new and covers only what this pass changed: the two sign-in routes, patient
sign-out, appointment counts and pagination, per-account avatars, per-role notifications, dashboard
metrics against their module, the bed dialog's controlled fields and dependent list, the payslip
dialog at 1440 and 1366, and a sweep of 23 pages for build text.

## 4. Visual result

Measured against the state at `69c9a63`, captured in a throwaway worktree:

| Page | 1440 | 1366 | Cause |
|---|---|---|---|
| Admissions | 11.692% | 17.379% | Bed board capped to two visible rows |
| Appointments | 0.462% | 1.978% | KPI values and the fifth card's label |
| Settings | 0.146% | — | One note sentence reworded |
| Audit | — | 0.126% | Header identity and the bell's real unread count |
| 24 other pages | 0.000% | 0.000% | below the threshold — see below |

**What the percentage does not say.** The harness only counts pixels whose channel delta is ≥128, so a
0.000% row is not "unchanged". Compared by SHA-256 instead, only `index` is byte-identical at both
widths. The other 27 pages differ because **every shell page now draws an initials avatar where it
used to draw one shared photograph**, and the portal sign-in gained a staff link. Page *height* is
unchanged at 1440 on all 28 pages, and at 1366 only two pages reflow: Admissions (1597 → 1449 px) and
Appointments (1762 → 1738 px).


## 5. Still open, and why

- **Catalogue and bed editors.** Configuration lists the laboratory catalogue and the bed inventory
  read-only and says so. Editing them needs validation and a retirement policy for a test that
  already has orders against it.
- **Payroll proration.** New-hire and separation proration still needs an employer-policy decision.
  The deferred methodology work (Article 83, the regional wage orders, the Pag-IBIG circulars) was
  not reopened.
- **Portal views for admissions and claims.** The portal shows profile, appointments, results,
  prescriptions, invoices and payments; admissions and claims are not exposed there.
- **Credentialed integrations.** PhilHealth eClaims, HMO eligibility and payment gateways have no
  credentials and remain labelled simulations.
- **Admin tables below 1440px** stack without per-field captions. Unchanged, and shared by eight
  tables; fixing one would create a second responsive pattern.
- **`localStorage` is not a database.** The session is per browser profile with no transaction. Two
  tabs are two demonstrations, not two writers.

---

## 6. Final acceptance verification (`qa-final-check.mjs`, 68 assertions)

The provisional acceptance asked for five things to be proven end to end rather than asserted from a
distance. Each is now a test.

### 6.1 Generate payslips — the output, not the message

The dialog is opened, its stated figures checked against the run (8 payslips, ₱162,574.21 net), the
proceeding button clicked, and **every file it produces is read from disk**:

- 8 downloads, one per employee, each named `payslip-EMP-0NN-<run>.pdf`, no employee twice.
- Every file starts `%PDF-1.4` and ends `%%EOF`, contains `PAYSLIP`, contains a `NET PAY` line, and
  names its employee. Smallest is over 600 bytes — none is a stub.
- The confirmation says "8 payslips downloaded", and the dialog closes.

**Duplicate submission.** Two clicks on the proceeding button before the dialog is removed produce
**8 downloads, not 16**.

**Validation.** With `payslipPdf` forced to fail on the third employee, the confirmation says
**"7 payslips downloaded"** — the count is what happened, not a fixed sentence.

**Short window.** At 560px tall the dialog fits inside the window with no scroll and the action is
reachable. At 380px it stays inside the window, scrolls to its end, and the action still produces all
8 files after scrolling.

### 6.2 Notifications

Read one → badge falls by exactly one, exactly one row is marked read, the subtitle agrees. Mark all →
badge hidden, every row read, button disables. Switch account → the next role gets its own domain, its
own unread count, **no inherited read marks**, and no shared notification with the previous role.

### 6.3 Fresh-session isolation

Visitor A records a ₱500 payment, then signs out. A **new browser context** (a new visitor) sees an
audit trail containing only their own sign-in — the previous visitor's payment and its audit entry are
gone, and the invoice is back at its seeded amount.

Closing the tab is the other exit: a tariff change made in tab 1 is written in that tab, and a new tab
in the same browser is not signed in, has no tariff store, and starts from the seeded price list.

### 6.4 Departments as the department head

The account lands on `departments.html` with no script error, renders 8 cards, and the "Total
departments" card reads **8** — proving it counts the object list, not the old 7-entry string list.
`HIS.departments` is an array of objects with `.name`; `HIS.deptNames` is a separate array of strings.
Opening a card shows that department, Back returns to the list, and search narrows the visible cards
while the empty state stays hidden.

### 6.5 Both sign-in routes

Patient page → **Staff sign in** (on screen without scrolling) → staff console. Staff page → patient
portal → back. No redirect loop. A doctor account in the portal is refused with an actionable link; a
patient account on the staff console resolves to the `patient` role whose home is the portal.

---

## 7. Baselines — both kept

| Baseline | Manifest | State |
|---|---|---|
| Previous, accepted | `qa/baseline-previous/baseline-manifest-{1440,1366}.json` | `69c9a63` |
| Current, approved | `qa/baseline/baseline-manifest-{1440,1366}.json` | `c7ec7ce` |

Both manifests are committed; the PNGs are regenerated on demand (`DESIGN-LOCK.md` §17.4 has the exact
commands). The complete list of intentional differences is the four rows in §4 of this report plus the
two sub-threshold changes recorded in §17.1 — nothing else moved.
