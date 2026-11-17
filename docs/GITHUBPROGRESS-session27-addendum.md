# Session 27 addendum — design lock, visual baseline, role-based POVs (2026-11-17)

Additive log. Nothing in earlier addenda or `GITHUBPROGRESS.md` was changed.

Work is on branch **`dev/autonomous-milestones`**, not `main`. `main` is untouched at `fd5bf9f`.

## Owner request

Comprehensive development of the HIS under a hard design-preservation rule: capture a visual
baseline of every page first, never invent a new visual identity, work in independently verifiable
milestones on a separate branch, and verify each milestone with tests and screenshots before
documenting actual results.

---

## M0 — Design lock + visual baseline (`72dceba`)

### What was done

1. **Baseline captured before any change.** All 20 pages at 1440px, full-page, from a clean clone of
   `main` served locally. Stored in `qa/baseline/` (9 MB, gitignored).
2. **`docs/DESIGN-LOCK.md`** written from measurement, not memory:
   - Extracted computed styles for every visible element on all 20 pages
     (`getComputedStyle` sweep: colour, background, border, radius, shadow, font stack/size/weight/line-height).
   - Recorded the layout skeleton, colour tokens, measured type scale (by instance count), radii,
     shadows, component geometry, page inventory and the responsive model.
   - Cross-checked against the Figma values already logged in `START-HERE.md` §7 and
     `IMPROVEMENT-PLAN.md` "Design format".
3. **`scripts/visual-check.mjs`** — capture + pixel-diff harness. Diffs on a canvas inside the
   browser, so there is no image-processing dependency beyond `playwright-core`. Reports per page the
   percentage of pixels changed and the bounding box of the change.
4. **`AGENTS.md`** — `DESIGN-LOCK.md` added to the read order as the visual contract.

### Verified

- 20 pages @1440: **0 console errors**, 0 horizontal overflow.
- Two consecutive capture runs diff at **0.000% on all 20 pages** → the harness is deterministic, so a
  later non-zero diff is a real change and not noise.
- **No page markup, CSS or JS was modified in M0.** The only changes are new files plus `AGENTS.md`.

### Known design deviations found and deliberately NOT changed

Recorded in `DESIGN-LOCK.md` §9. Summary: the site carries **three palettes** — the core tokens,
a Tailwind slate/emerald set on Appointments (`pages.css`, `.a-pill`), and a Tailwind gray set on
Profile (`profile.css`, with fractional type sizes suggesting a different Figma export scale).
Sign-in uses `#0f172a` where `--navy` is `#15254c`.

These were **not** normalised: the Figma file is not reachable from this environment, the visual
deltas are small, and mass-recolouring 40+ declarations without a reference would be exactly the
"improvement" the owner prohibited. They need an owner decision against the Figma frames.

---

## M1 — Role-based POV foundation (`assets/js/rbac.js`)

### The gap

Session 23 recorded the owner's question — *"does each login have its own POV (user/admin)?"* — and
the answer was **no**: one hardcoded identity (`Dr. Elsie Chen`), one flat 12-link nav, every page
URL-reachable by anyone. That was the largest structural gap against the brief.

### What was done

1. **`assets/js/rbac.js`** — a 14-role registry (Super Admin, Hospital Administrator, Receptionist,
   Registration & Admissions, Doctor, Nurse, Pharmacist, Laboratory, Cashier, Finance, HR,
   Department Head, Auditor, Patient). Each role carries a demo persona, a one-line scope, an allowed
   page-stem list, an ordered nav list and a home page. The nav metadata moved here from `shell.js`
   so one file owns the whole navigation model.
2. **Page guard** — `HIS.rbac.guard()` runs at the top of `mountShell()`, before anything renders.
   An out-of-scope page redirects to the role's home instead of rendering.
3. **Role-scoped drawer** — the sidebar renders `HIS.rbac.nav()` instead of the hardcoded array.
4. **Role switcher** — opens from the **existing header profile block**, so no new element is added
   to the locked header: the profile already displays the name and role it switches between. Panel
   follows the design format (white card r14, 1px `#c8dcea` ring, Lexend 16 title, Inter 13 rows,
   `#e8f4fb` hover, 3px `#1c6d9c` active bar). Keyboard: Enter/Space opens, Escape closes, focus
   returns to the trigger. The panel footer carries the **"Demo environment · synthetic data only"**
   label.
5. **Audit** — every role switch appends to `HIS.audit` with `before`/`after` role keys.
   `audit.js` now takes its default identity from the active role, falling back to `HIS.user`.
6. **`mh_role`** added to `HIS.store.KEY`; absent means `superadmin`, so a browser that has never
   used the switcher keeps the original single-identity behaviour.

### Why the resting appearance is unchanged

The default role is `superadmin`, whose demo persona is **Dr. Elsie Chen / Chief Physician** — the
exact identity the header rendered before this module existed, and whose nav list is all 12 links in
the original order. Making `.profile` interactive adds `cursor:pointer` and a focus ring only; no
element, size or position changes.

### Verified

- `scripts/visual-check.mjs --check` → **0.000% on all 20 pages**. The RBAC layer is invisible at rest.
- **Role switch works**: switching to Nurse lands on `dashboard.html`; header becomes
  `Sofia Mendoza / STAFF NURSE`; drawer becomes `Dashboard, Treatment, Nursing`; an audit row is
  written (`seq 1, "Switched role: Super Administrator → Nurse", before superadmin, after nurse`).
- **Guard works**: as Nurse, navigating to `billing.html` redirects to `dashboard.html`.
- **Responsive sweep**: 20 pages × 5 widths (1440/1200/1000/800/390) = 100 loads,
  **0 console errors, 0 horizontal overflow**.
- Test role/audit keys removed from the browser afterwards (`localStorage` left with no `mh_*` keys).

### NOT done in M1 — stated plainly

- **Dashboards are not yet role-specific.** Every role still sees the same KPI cards and panels; only
  navigation, page access and identity change. Role-tailored dashboards are the next milestone.
- **No real authorization.** `rbac.js` is a browser-side demonstration. Anyone can set
  `localStorage.mh_role` or call `HIS.rbac.set('superadmin')`. It is labelled as such in the panel and
  in the module header. It is not, and must not be presented as, a security boundary.
- **Patient role** is represented in the registry and routes to the existing `portal.html`, which keeps
  its own separate demo auth. The two identity systems are not yet unified.
- **Laboratory has no dedicated screen.** It maps to Treatment/Consultation, where test orders live.

## Next

Role-tailored dashboard content, then the audit-log viewer and reports pages (both currently listed as
"blocked on new Figma frames" in `IMPROVEMENT-PLAN.md` — they can be built as additions in the design
format).

---

## M2 — Audit log + Reports POVs

### What was done

Two screens that `IMPROVEMENT-PLAN.md` listed as "blocked on new Figma frames", built instead as
additions in the design format (`DESIGN-LOCK.md` §2 module-page pattern + §10 addition rules).
Both are flagged `Addition (not in Figma)` in the HTML and in the module header.

1. **`audit.html` + `assets/js/audit-page.js`** — read-only viewer over `HIS.audit` (`mh_audit`),
   newest first. Columns: `# · When · Who · Role · Action · Change (before → after)`.
   - Times rendered in **Asia/Manila** (`en-PH`, `timeZone:'Asia/Manila'`).
   - Live search across who/role/action/entity, plus an activity-type filter
     (role / billing / payroll / registration / clinical / other) derived from the entry text.
   - **Export CSV** builds a real Blob download of the current filtered set.
   - **Clear demo log** appears only for the Super Administrator role — the first place the RBAC
     layer gates an *action* rather than a page. It goes through the shared confirm modal.
   - Empty state explains how entries are created instead of showing a blank table.
   - A footer note states plainly that the log is local, not tamper-evident, not server-side and not
     a compliance trail.
2. **`reports.html` + `assets/js/reports.js`** — billing and collection summary.
   - **Every figure is derived** from `assets/js/data-billing.js`; nothing is hardcoded. Total billed
     ₱160,860 · collected ₱100,700 · outstanding ₱60,160 · 63% collection rate · average ₱40,215.
   - Per-invoice table with billed / collected / balance / derived status, plus a by-invoice-type
     breakdown (Inpatient 2 invoices 93%, Outpatient 2 invoices 7%).
   - Status is **derived** from `paid` vs `amount`, never read from a stored field, so it cannot
     drift from the money.
   - The page states its scope explicitly and explains why it does **not** reuse the Billing screen's
     KPI cards (see the discrepancy below).
3. **`assets/css/admin-pages.css`** — shared styles for both. Every value is an existing token or a
   measured in-use value; no new colours, fonts or type sizes.
4. **`rbac.js`** — `reports` and `audit` added to the nav model; granted to Super Admin,
   Hospital Administrator, Finance (reports) and Auditor (both). Auditor's home is now the audit log.
5. **`icons.js`** — added `chart` and `shield` glyphs in the existing 24px stroke style.

### Verified

- **Reports arithmetic** checked by hand against the ledger: 17,360 + 4,200 + 86,500 + 52,800 =
  160,860 billed; 10,000 + 4,200 + 86,500 + 0 = 100,700 collected; 60,160 outstanding; 63% rate;
  Inpatient 103,860/96,500/7,360 = 93%; Outpatient 57,000/4,200/52,800 = 7%. All correct on screen.
- **Audit filters**: 3 seeded test entries → type filter `payroll` returns 1 row; search `aileen`
  returns 1 row; count reads `1 of 3 entries`. Newest-first ordering correct (seq 3, 2, 1).
- **Null `before`** renders as `— → PT-99214` rather than "null".
- **Action gating**: `Clear demo log` absent for Auditor, present for Super Administrator.
- **Role flow**: switching to Auditor from Reports lands on `audit.html` (home redirect) and the
  switch itself appears as the first audit entry with correct before/after keys.
- **Responsive**: 22 pages × 5 widths (1440/1200/1000/800/390) = 110 loads, **0 console errors,
  0 horizontal overflow**. At 1000px the KPI strip reflows to 2 columns and the tables stay readable.
- **Visual regression**: re-baselined to 22 pages; `--check` then reports **0.000% on all 22**.
- Test entries and role key removed from the browser afterwards.

### Bug found and fixed during this milestone

`reports.js` rendered a literal `Same ' + bills.length + ' invoices` in the second card header — a
string built with the wrong quote type. Caught by screenshot inspection, fixed, re-verified.
Recorded here rather than silently corrected because the milestone log should show what inspection
actually caught.

### Data-integrity finding (documented, not changed)

The **Billing** page's four KPI cards show ₱482K billed / ₱395K collected / ₱87K outstanding (Figma
values, whole month), while its own table lists four invoices totalling ₱160,860. Both cannot
describe the same set. Reports states its scope as the four-invoice ledger and does not reuse those
cards. Reconciling the two bases is Phase 6.1 of `IMPROVEMENT-PLAN.md` ("one money chain") and needs
an owner decision on whether the KPI cards should become derived values — changing them would move
pixels on a Figma-locked screen.

### NOT done in M2 — stated plainly

- No PhilHealth, HMO or discount breakdown report; those amounts exist per invoice but are not
  modelled as their own ledger.
- No period selector; Reports covers the whole demo ledger only.
- No payroll reconciliation report.
- Audit entries are not cryptographically chained or tamper-evident.

---

## Verification summary for the branch

| Milestone | Visual | Functional | Responsive | Console |
|---|---|---|---|---|
| M0 | baseline captured, deterministic (0.000% twice) | n/a — no code changed | 20 × 1440 | 0 errors |
| M1 | 0.000% on all 20 pages | role switch, guard, audit, nav all exercised | 20 × 5 widths, 0 overflow | 0 errors |
| M2 | 0.000% on all 22 pages | reports arithmetic, audit filters, CSV, action gating | 22 × 5 widths, 0 overflow | 0 errors |

### `scripts/roles-check.mjs` (added at the end of M2)

Automated reachability check for the RBAC layer. For every role it asserts three things:
the role's home page loads **without** redirecting (catches a redirect loop or a home that is not in
its own allowlist); **every** page in the role's allowlist opens without redirecting; and a page
**outside** the allowlist redirects away.

Result: **14 roles, 117 checks, 0 failures.**

Two bugs in the harness itself were found and fixed while writing it, both worth recording because
they are easy to repeat:

1. It wrote `localStorage.mh_role` as a bare string. `HIS.store.get()` runs `JSON.parse`, so a bare
   string parses as corrupt, returns the fallback, and **every role silently behaved as
   superadmin** — the check reported 16 false failures against a product that was working. The role
   must be written with `JSON.stringify`.
2. It normalised URLs as `.replace(/\.html$/,'').split('?')[0]`, so `treatment.html?modal=pharmacy`
   never matched `.html$` and resolved to `treatment.html`. Strip the query first.

The product was not changed for either; both were test defects.

`main` was never modified. All work is on `dev/autonomous-milestones`; nothing was merged or pushed
to `main`, so the live site at `https://leequor.github.io/mediheal-his/` still serves `fd5bf9f`.
