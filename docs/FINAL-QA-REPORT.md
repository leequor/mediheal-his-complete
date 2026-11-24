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

### Sequence and edge sweeps (later pass)

| Suite | What it proves | Result |
|---|---|---|
| `sequences-check.mjs` | payment → duplicate submit → overpayment → refund → void refund; assign → void charge; timesheet change → payroll re-run; claim draft → docs → verify → submit → deny → appeal → approve → settle; discharge → reopen → transfer; lab order → collect → process → result → validate → cancel refused; prescription → verify → partial dispense → over-dispense refused → return. The ledger, charge, bed and stock invariants are re-derived after **every** step. | **101 / 101** |
| `edge-check.mjs` | payroll arithmetic at the extremes (zero hours, one hour, half shift, full period, max overtime, every-day lateness, 31-day month), determinism, statutory monotonicity, centavo round-trip, twenty one-cent payments totalling exactly n × 0.01, and a write while `sessionStorage` is nearly full. | **67 / 67** |

Both run the same way as the other suites: `PW=<playwright-core> node scripts/sequences-check.mjs`.

### Function sweep — every callable (`function-check.mjs`)

The page suites prove the screens work; this one walks the API itself. It discovers the surface in
the running app (**330 callables across 27 namespaces**), then calls each with no arguments, `null`,
`{}`, a junk record and junk primitives — **1,519 calls** — failing on any function that throws where
the app's convention is `return {ok:false}`, and on any call that breaks the ledger, charge, stock or
bed invariants.

It found five genuine defensive gaps, now fixed with one-line guards in the codebase's own style
(`input = input || {}`):

| Function | Was | Now |
|---|---|---|
| `accounts.create` | `TypeError` reading `.email` of undefined | returns `{ok:false, error:'Enter a valid email address.'}` |
| `registry.duplicates` | `TypeError` reading `.last` | returns empty duplicate sets |
| `requests.create` | `TypeError` reading `.text` | returns `{ok:false, error:'Describe the change…'}` |
| `admissions.bedAt` / `stayDays` / `billableDates` | `Invalid time value` on a half-built admission | `null` / `0` / `[]` |
| `wageFloor.equivalentDaily` / `equivalentMonthly` | `TypeError` reading `.monthlyBasic` | `0` |

Two groups still throw **by contract**, and the suite documents them explicitly so a new thrower
fails the build instead of hiding: `kit.dropdown`/`kit.row` (DOM builders — call sites always pass
options/cells), `store.update` (third argument is a callback) and `attendancePeriod.classify` (needs
an approved period's settings). The 23 **record readers** (`ledger.pendingOf`, `lab.cancelPolicy`,
`pharmacy.remaining`, `claims.can`, `pdf.*`, `payrollCalc.compute`, `payrollRuns.totalsOf`, …) take a
record by contract; the suite calls every one with a real record pulled from the app and fails if it
throws.

Also verified: pages survive `payrollRuns.reset()`, `claims.reset()`, `lab.save([])`,
`charges.reset()` and `attendancePeriod.reset()` followed by a reload — they re-seed, with no error.

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

---

## 8. Final pass — profiles, avatar centring, actionable notifications

Three defects, all reported from real use, all fixed at the shared component rather than per page.

### 8.1 The initials were not centred

**Cause, measured rather than guessed.** The disc was centred on its *line box*, and two things put
the glyphs off centre inside that box:

- `letter-spacing: .02em` adds the tracking *after* the last letter, so a two-letter pair sits about
  1 px left of centre.
- `line-height: 1` makes the line box equal to the font size, so the baseline lands high and the ink
  rides up. The offset grows with the disc.

**Fix.** `line-height` is now set to the disc height inline (it is already set inline per size), which
puts the baseline at `(height + ascent − descent) / 2` — the cap height lands centred — and the
tracking is zero. `display:flex` with `align-items/justify-content: center`, `box-sizing: border-box`,
`white-space: nowrap` and `overflow: hidden` complete the component. Nothing about the colours,
sizes or the profile component changed.

**Proof.** `qa-nav-check.mjs` screenshots each avatar, hands the PNG back to the page, decodes it to a
canvas and computes the **ink centroid** against the disc centre. Tolerance 1.5 CSS px. Four accounts
× two sizes (header 42 px, dropdown 44 px), at 3× device pixels.

### 8.2 Notifications were not shortcuts

Clicking a notification marked it read and did nothing else. Every notification now carries a page and
a record id, and clicking it navigates there.

- `assets/js/deeplink.js` — one shared resolver. `?focus=<id>` locates the row (by `data-id`, then by
  an exact cell match, then by row text), scrolls it into view, flashes it, and clears the parameter
  with `replaceState` so a refresh does not replay the arrival.
- Only a read-only action is opened automatically (the laboratory "View report"). Nothing that
  changes a record is ever clicked by the arrival, because arriving at a task is not doing it.
- Appointments gained stable ids (`APT-0001…`) so a notification points at one appointment rather
  than at a status filter.
- **Reading is not completing.** The suite snapshots the underlying record before the click and
  compares after: the laboratory order is still unacknowledged, the prescription still pending, the
  invoice still unpaid, the leave still pending.

Destinations wired: laboratory orders, pharmacy prescriptions and batches, invoices, charges,
claims, admissions, appointments, attendance, audit.

### 8.3 A download that lied

Chrome throttles a burst of automatic downloads. "Generate payslips" fired eight `<a download>` clicks
in a loop and the browser delivered **three to five** of them while the message said eight.

Fixed by packaging: `HIS.pdf.zip()` writes a stored-mode archive (no compressor, no dependency) and
the action downloads **one ZIP containing one PDF per employee**. The confirmation now reports the
number of entries actually written. The test unzips it and checks every entry is a `%PDF-1.4` file
carrying `PAYSLIP`, a `NET PAY` line and the employee's name.

### 8.4 Harness races fixed

`auth-check` was intermittently 24/25. Two real races: it waited a fixed 800 ms for a redirect, and
the URL commits *before* the destination's scripts mount the header. It now waits for the outcome
(dashboard, or an error on the form) and then for `#profile .nm`. 25/25 three runs in a row.

### 8.5 Results

| Suite | Result |
|---|---|
| `qa-nav-check.mjs` (new) | **115 / 115** |
| `qa-check` | 91 / 91 |
| `qa-final-check` | 73 / 73 |
| `revenue` · `charges` · `adt-boundary` | 81 · 44 · 65 |
| `clinical` · `finance` · `ledger` | 53 · 31 · 46 |
| `claims` · `portal` · `auth` | 41 · 40 · 25 |
| `payroll` · `acceptance` | 89 · 180 |
| `m10-1 … m10-4` | 77 · 78 · 75 · 54 |
| `roles` | 144 checks |
| smoke · a11y · responsive · buttons | 28 pages · 27 pages 0 violations · 140 · 0 |
| visual | 0.000% at 1440 and 1366 against the approved baseline |

**1,258 assertions across 18 rule-asserting harnesses, plus 144 role checks — 1,402 in all. 0 failures.**

Visual: every page still matches the approved baseline at both widths. The avatar correction and the
row highlight are both below the harness's 128-level pixel threshold, which is why they do not appear
as diffs; they are recorded here rather than implied.

---

## 9. Release — published to `mediheal-his-complete`

The completed tree is published to a new, independent public repository with its own GitHub Pages
deployment. The original `leequor/mediheal-his` is untouched: same remote, same `main` (`fd5bf9f`),
no pushes, no deployment changes.

| | |
|---|---|
| Repository | https://github.com/leequor/mediheal-his-complete |
| Visibility | public |
| Default branch | `main` |
| Live site | https://leequor.github.io/mediheal-his-complete/ |
| Source commit | the tip of `dev/autonomous-milestones` at release time |
| Deployment | `.github/workflows/deploy-pages.yml`, triggered by pushes to `main` |

**The artifact is the website, not the repository.** The workflow copies the HTML pages and `assets/`
into `_site` and uploads only that. The test harnesses, QA reports, design documentation and baseline
manifests stay in the repository, where they are useful, but a visitor never downloads them. The
workflow also fails the build if a root-absolute path (`src="/…"` or `href="/…"`) ever appears,
because such a path resolves on a local server and only breaks once served from
`/mediheal-his-complete/`.

`scripts/deployed-check.mjs` verifies the **deployed** site over HTTPS rather than the local copy:
29 assertions covering the root response, asset loading, console errors, staff sign-in, the profile
menu, the notification deep link, the patient portal, direct page loads by URL, refresh, and a deep
link after a cold load.

---

## 10. Visual acceptance — every page, looked at

The whole site was rendered at **1440×900, 1366×768 and 1280×800** (84 screenshots) and inspected
page by page, with a measurement pass alongside it for the things the eye misses: text clipped by its
own box, children wider than their container, controls outside the window, a button overlapping a
sibling, rows shorter than their content.

`scripts/eyeball.mjs` produces both: the screenshots and `report.json`.

### 10.1 Found and fixed

| Defect | Where | Fix |
|---|---|---|
| Provider name truncated to "Dr. Jeremias Esp…" | Laboratory, Pharmacy, Admissions | First grid column widened to fit a name, not just an id |
| Calendar icon overlapping "dd/mm/yyyy" | Inpatient registration | 28 px left padding on date inputs |
| Patient meta line wrapping onto a second line | Patient profile header | Fixed width replaced by auto + nowrap + ellipsis |
| Selected patient lost their status dot | Treatment, Consultation, Nursing, Personnel | Dot always drawn; the tint and left accent already mark selection |
| Active registry filter indistinguishable from the others | Patient registry | Active pill takes the darker navy |
| "Staff sign in" invisible on the blue header | Patient portal | Header link inherits the bar's white |

### 10.2 Measured, then judged

The measurement pass flagged 87 "small text" hits and 6 "off-screen" hits. Both were examined and
dismissed: 11 px uppercase column labels and the 10 px badge numeral are the project's own type
scale, and the off-screen elements are the closed navigation drawer. Reporting them as defects would
have meant changing the design to satisfy a rule that does not apply.

One real hit remains: bed tiles ellipsis the occupant's name. A 102 px tile cannot hold a full name;
this is recorded as intentional in `DESIGN-LOCK` §19.1.

### 10.3 Result

| Suite | Result |
|---|---|
| qa-check · qa-final-check · qa-nav-check | 91 · 73 · 115 |
| revenue · charges · adt · clinical · finance · ledger · claims | 81 · 44 · 65 · 53 · 31 · 46 · 41 |
| portal · auth · payroll · acceptance | 40 · 25 · 89 · 180 |
| m10-1…4 · roles | 77 · 78 · 75 · 54 · 144 |
| smoke · a11y · responsive · buttons | 28 pages · 27 pages **0 violations** · 140 · **0** |
| visual | 0.000% at 1440 and 1366 after re-capture |

**1,258 assertions across 18 harnesses + 144 role checks = 1,402. 0 failures.**

Six pages moved against the release baseline, all for the reasons above: Admissions 0.963 %,
Laboratory 1.730 %, Pharmacy 1.156 %, Registration 0.209 % at 1440; Treatment 7.963 %,
Nursing 8.017 %, Consultation 7.177 %, Registration 0.458 % at 1366 (where those three reflow, so a
one-element change moves everything below it). Everything else is pixel-identical.

---

## 11. Exhaustive control audit

`scripts/exhaustive-controls-check.mjs` — 36 assertions across five groups.

### 11.1 Census

| | |
|---|---|
| Pages | 28 |
| Controls rendered | **1,430** (749 buttons, 582 links, 8 selects, 91 inputs) |
| Action-bearing elements (`data-act`, `data-open`, `data-tab`, `data-close`, `data-note`, `data-doc`, `data-more`) | **184** |
| Controls with no handler | **0** |

Every action string rendered on a page is resolved against that page's own scripts. An orphan control
— rendered, clickable, wired to nothing — fails the suite.

### 11.2 Targeting

Row actions are clicked on the **last** row that offers them, and the record that changes must be
that row's id:

- Laboratory: the clicked order is the only one whose status moves.
- Pharmacy: the clicked prescription is the only one verified.
- Appointments: the last visit is the only one cancelled.

### 11.3 The claim dialog

Nine geometry assertions across 1440×900, 1366×768 and 1280×800: the footer is inside the dialog, no
control escapes it, and the body scrolls independently. Three state assertions: `under-review` offers
approval, partial, denial and a request for information; `approved` offers settlement and not
approval; `denied` offers no approval of any kind. Four outcome assertions:

- **Add note** records the note, leaves the status unchanged, moves no money.
- **Close** changes nothing at all and removes the dialog.
- **Approve** moves the claim to approved, records the amount, adds one history entry, and posts
  **nothing** to the ledger — neither cash nor coverage. Settlement is what posts coverage.
- Exactly one decision is marked primary, and the four sit on one row.

### 11.4 Repeat and permission

- A second dispense does not dispense again.
- A cashier is not offered claim approval, and `HIS.claims.transition` refuses it even when called
  directly — the UI is not the only guard.

### 11.5 Defect found

The claim dialog's action row was pinned with `position:sticky; bottom:-26px` inside its own scroll
container: the last status-history line was hidden behind the footer with no sign that more existed,
and the footer's bottom edge was clipped. It is now a fixed header, a scrolling body and an anchored
footer. See `DESIGN-LOCK` §20.

---

## 12. Nested modal stacking — the defect the earlier passes missed

### Root cause

| Overlay | z-index |
|---|---|
| `.cl-bg` — claim detail | **2500** |
| `.ac-bg` — page editors | 2500 |
| `.modal-bg` — `HIS.kit.modal()`, used by every claim action | **60** |

A claim action created its form at 60 under a parent at 2500. The form existed, was focusable by
script, and could not be seen or clicked by a person. A hit test at its centre returned `.cl-docs`, a
cell of the parent dialog.

**Why the previous pass passed:** it clicked the button node with `element.click()`, which ignores
stacking. Every assertion was true and the feature was unusable. `claims-modal-stack-check.mjs` now
uses real Playwright clicks — which fail when anything covers the target — and hit-tests the centre of
each dialog.

### Fix

One stack in `assets/js/kit.js`, one layer scale, a `MutationObserver` that registers every overlay
regardless of which file created it, Escape bound to the top overlay only, and a submission contract
where `onSave` can return `false` to keep the form open. Details in `DESIGN-LOCK` §21.

### Verified

`scripts/claims-modal-stack-check.mjs` — **76 assertions**:

| Group | What is proven |
|---|---|
| All four decisions + note | form above the parent (4020 vs 4010), pointer lands inside it, field accepts typing, submit moves the claim, history grows, no cash recorded, exactly one dialog remains |
| Validation | an out-of-range amount keeps the form open, shows the reason inside it, preserves the typed value, leaves the claim untouched, and still accepts a corrected value |
| Closing | Cancel, Escape and backdrop each remove only the child; a second Escape closes the parent; no overlay, scroll lock or stack entry survives; the register still works afterwards |
| Add note | empty note refused; valid note recorded; claim status and money unchanged; the note is visible in the still-open dialog |
| Viewports | 1440×900, 1366×768, 1280×800 — above the parent, inside the window, pointer reaches the form |
| Elsewhere | the pharmacy dispense form joins the same managed layer |

### Totals

**1,370 assertions across 20 harnesses + 144 role checks = 1,514. 0 failures.**
smoke 28 pages · a11y 27 pages 0 violations · responsive 140 · buttons 0 anomalies (388 clicks) ·
visual 0.000% at 1440 and 1366.

---

## Pass 7 — form boundaries, error signalling and target sizes

Two new harnesses, plus fixes for what they found.

### `scripts/forms-check.mjs` — 34 assertions

Every entry form in the app, in both directions. **Three page forms** (registration, outpatient,
appointment — driven with explicit values because they use custom listboxes) and **ten modals**
(charges assign, claims create, laboratory order, pharmacy prescription, billing payment, admissions
admit, personnel add, settings price, attendance request, treatment prescribe).

For each form the suite asserts:

| Rule | Why |
|---|---|
| An empty or hostile submit never writes to the store | junk must not become a record |
| A refusal always states a reason in text (`role=alert`, toast, or the browser's own constraint message) | a red border alone is a colour-only error: invisible to a screen reader and to a colour-blind user |
| A successful submit leaves no `NaN`, `undefined`, `[object Object]`, whitespace-only value or junk email | typed data has to survive the trip |
| No uncaught page error at any point | the form path must not throw |

### Defects found and fixed

**1. `attendance.js` threw on submit** — `Cannot read properties of null (reading 'value')`:
`submitnew` read `#atn3/4/5` directly, but the modal re-renders on every keystroke in the search box,
so a field can be gone by the time submit lands. Missing fields now read as empty and fall through to
the existing validation instead of throwing.

**2. Registration and outpatient forms signalled invalid input by colour alone** — the only feedback
was `.err` (a red border) plus focus. No text, no `aria-invalid`. Both forms now mark every invalid
field with `aria-invalid="true"`, clear it on the next attempt, and announce the first problem through
the app's own toast (a `role=status` live region): *Check "First Name" — it is highlighted in red.*

**3. Target sizes under 24px** (WCAG 2.5.8) — the payslip link and row checkbox on payroll, the
Details link on attendance, and the back links on the two registration forms and the profile page.
Each keeps its exact Figma pixels and gains an invisible `::before`/`::after` expander: measured hit
area 15px → 24px, 16px → 26px, 18px → 25px, with zero layout movement (visual baseline still 0.000%).

### `scripts/design-lint.mjs` — 26 pages, 0 findings

Objective design defects, measured rather than judged: duplicate visible ids, controls with no
accessible name, images without alt text, targets under 24×24 (measuring the area that really
receives the pointer, so an expander counts, and scrolling off-screen rows into view first), same-row
control misalignment, text painted over text, mixed date formats, inconsistent money decimals.

Two false positives were eliminated rather than "fixed" in the app: stacked label lines overlapping by
a few pixels of line-height, and a bed-board element from a closed panel sharing coordinates with the
"Admission records" heading. The detector now requires most of both boxes to be shared and hit-tests
the element for real visibility.
