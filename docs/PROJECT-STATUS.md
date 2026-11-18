# Project status — MediHeal HIS

**As of:** M12 (revenue integration, admissions and bed management).
**Branch:** `dev/autonomous-milestones`. **`main`:** untouched at `fd5bf9f`. **Deployed:** no.
**Surface:** 28 static pages, 62 JavaScript modules, 19 stylesheets, 29 test harnesses.
**Data:** fictitious only. Held in `sessionStorage` — it survives navigation and refresh within the
tab and is gone when the tab closes. No server, no network calls, no real patient data.

This document describes what the code actually does. It is written from the repository, not from
earlier progress reports. Where a capability is simulated, it says so.

---

## 1. What the system is

A desktop-first demonstration of a Philippine hospital information system, built as a static site
with no build step. It runs from any static host and from `file://`-equivalent local serving.

Every screen is a page; every workflow is a JavaScript store plus a page script. There is no
framework, no bundler and no server. Persistence is `localStorage`, so two browser profiles are two
hospitals and a cleared cache is a new one. That is a demonstration property, not a defect to fix
inside this architecture.

## 2. Verified working

The following were exercised end to end by the test harnesses in this repository (§6) and by
inspection of rendered screenshots.

### Identity and access
- 14 roles, one seeded demo account each, email + password sign-in, session persistence (30-day
  "keep me signed in", 12-hour tab session otherwise), sign-out, audit of sign-in and failure.
- Page-level and navigation-level role scope. A role that is not allowed a page is redirected to its
  home before render.
- Account administration: create, edit, deactivate, reset password. The last active Super
  Administrator cannot be demoted or deactivated.

### Patient identity
- One patient registry (`mh_patients`) that `HIS.patients` is re-pointed at, so no module can see a
  different list. 7 seeded patients.
- Registration with duplicate detection (same surname + date of birth = probable; same full name or
  same mobile = possible). Nothing merges automatically.
- Portal accounts link through `account.patientId`; guardian links live in their own table with an
  authorisation scope. Surname and phone number are explicitly not authorisation.

### Clinical
- Appointments: book, confirm, reschedule, cancel.
- Consultation: queue, patient summary, diagnosis dialog, saved diagnosis persisted per patient.
- Treatment plans and nursing care records.
- Laboratory: order → collect → process → result → validate → release, with mechanical
  abnormal/critical flagging, critical acknowledgement, cancellation with a stated billing policy,
  and corrected results that archive the released value.
- Pharmacy: batch-level stock, first-expiry-first-out, prescription verify/reject/dispense, partial
  dispensing, returns that reverse one dispensing event, expired-batch disposal, stock movements.

### Inpatient (M12)
- Admission with diagnosis, attending, payer and bed assignment; one active admission per patient.
- 172 configured beds across six wards; occupancy derived from the active admission.
- Transfer with history; discharge with final accrual, bed release and encounter completion;
  discharge reversal when the bed is still free.
- Room-and-board and nursing accrual per billable day, idempotent, at the bed rate in force at the
  noon cutoff.

### Revenue (M11 + M12)
- Charge master with effective dates for consultation, room and nursing; laboratory prices in the
  laboratory catalogue with the same date field.
- Every charge names an encounter, carries a price snapshot, and is either assigned to an invoice or
  in the unbilled queue.
- Assignment and unassignment are audited and require a reason; assignment to another patient's
  invoice is refused; double assignment is refused.
- Invoices are persistent and can be opened for an episode.
- Payments, partial payments, electronic intents awaiting confirmation, refunds, credits, coverage
  and discounts — each its own transaction kind, never conflated.
- One invoice total definition (`ledger.invoiceAmount`) read by Billing, Reports, Claims and the
  portal.

### Claims (M10)
- 13-state lifecycle with role-gated transitions, document checklist, follow-up dates, partial
  approval, denial and appeal.
- Settlement posts coverage once, keyed by claim id, capped at the outstanding balance, with the
  excess recorded as unapplied.

### Workforce (M8–M10.4)
- Salary master with pay basis, schedule and effective-dated policy.
- Attendance register with day types, overtime, night differential, timesheet approval and
  corrections that reopen the timesheet.
- Payroll runs: draft → reviewed → approved → released, version history, blocked list, printable
  payslips, off-cycle correction runs linked to a released run.
- Statutory tables with a cited source and an effective date for every rule.

### Reporting and portal
- Reports derive every figure from the owning module: invoices and collections from the ledger,
  unbilled value from charges, occupancy from admissions.
- Patient portal: six views, own records only, released laboratory results only, no staff notes, no
  audit rows.

### Administration
- Accounts, departments, laboratory catalogue, pharmacy stock, tariffs, beds.
- **Configuration screen** (`settings.html`): the charge master, and a read-only inventory of what is
  seeded from code.

#### What an administrator can actually do

The Configuration screen administers **one** thing: service tariffs. Everything else on it is
reported, not editable. This table is the contract; the screen states the same boundary in its
subtitle and its card headings.

| Setting | Create | Edit | Deactivate | View | Where |
|---|---|---|---|---|---|
| **Service tariff price** | append a new effective-dated row | ✗ — a row is never edited | ✗ — a price is superseded, never deleted | ✓ current price + full per-code history | Configuration |
| **Tariff code** | ✗ from the screen (`tariffs.setPrice()` accepts one; the dialog only offers existing codes) | ✗ | ✗ | ✓ | — |
| Laboratory catalogue | ✗ | ✗ | ✗ | ✓ count, read-only | `assets/js/lab.js` `CATALOG` |
| Bed inventory | ✗ | ✗ | ✗ | ✓ count, read-only | `assets/js/admissions.js` `WARDS` |
| Payroll policy | ✗ | ✗ | ✗ | ✓ count, read-only | `assets/js/payroll-calc.js` `POLICIES` |
| Departments | ✗ | ✗ | ✗ | ✓ count, read-only | `assets/js/data-departments.js` |
| User accounts | ✓ | ✓ | ✓ deactivate (never delete) | ✓ | Accounts |
| Patient records | ✓ | ✓ | ✗ | ✓ | Registration |
| Pharmacy stock | ✓ receive a batch | ✓ adjust | ✓ dispose an expired batch | ✓ | Pharmacy |
| Bed state | n/a | ✓ cleaning / maintenance / available | n/a | ✓ | Admissions |
| Bed assignment | ✓ admit | ✓ transfer | ✓ discharge | ✓ | Admissions |

**Why the catalogue and the beds are not editable here.** Adding a laboratory test or a bed is a
change to a fixed property of this demonstration facility, not a routine operational setting. Making
them editable would require a catalogue editor, validation, and a decision about what happens to
orders already placed against a retired test — none of which exists. Rather than half-build it, the
screen lists them with their counts and names the file each one lives in, so the boundary between
"administrable" and "compiled in" is visible instead of implied. This is recorded as the top item in
`docs/COMPLETION-ROADMAP.md` §2.1.

**Tariff changes are effective-dated and never rewrite history.** A price change appends a row with
an `effectiveFrom` date. `priceFor(code, date)` returns the latest row in force on that date, and
every charge copies the resolved price into its own `priceSnapshot`. `revenue-check.mjs` §9 proves
all four properties after a change through the real dialog: the earlier price is unchanged, the new
price applies from its date, an existing charge keeps its snapshot, and a charge raised afterwards
uses the new price.

### Presentation and copy

Every screen was audited for wording that exposed the build rather than the product. Removed:

- **Milestone labels in the UI** — invoice lines read "from Consultation (M2)" and "from Ward / bed
  assignment (M3)"; they now read "Consultation — Dr. L. Laureta", "Room and board — private, 3 days".
- **Source paths on screen** — the Configuration screen printed `assets/js/lab.js · CATALOG` against
  each read-only row; it now describes what the setting is.
- **"Figma" in user-facing text** — the invoice fallback said "not in the main Figma frame", the
  Departments and Profile buttons carried tooltips reading "Opens a state frame in Figma; not built
  yet" (both buttons do work), and a consultation tooltip said "not drawn in Figma".
- **Developer notes in dialogs** — the appointment editor's subtitle read "Temporary form. Figma has
  no edit screen yet."
- **"Demo" / "synthetic" / "seeded"** — replaced throughout with "sample" and, where a disclosure is
  genuinely needed, a plain sentence: *"Sample data · all records fictitious"*.
- **An implementation note on Accounts** that described the password digest and pointed at
  `docs/AUTH.md`, rewritten as a product note about deactivation and the audit log.

Two labels were aligned with their pages: the navigation item **Staff** became **Attendance** (the
page heading and title already said Attendance), and the page title of `staff.html` no longer reads
"Staff – MediHeal HIS".

Internal documentation, source comments and test scripts were left intact — the audit applies to what
a visitor sees.

## 3. Simulated, and labelled as such

| Capability | What actually happens |
|---|---|
| Authentication | FNV-1a digest compared in the browser. A session can be forged from devtools. |
| Authorisation | A JavaScript allowlist. Not a security boundary. |
| Insurer submission | A claim state machine. Nothing reaches PhilHealth eClaims. |
| Payments | Rows in `localStorage`. No bank, no gateway, no settlement file. |
| Payroll | Reproducible from published rules; not reviewed by a Philippine practitioner; not a compliance claim. |
| Laboratory results | Typed by a person. The flag is a comparison against a printed range, not an interpretation. |
| Stock | A local batch table. No procurement, no supplier feed. |

## 4. Not implemented

These are honest gaps, not bugs:

- **Payroll proration** for new hires and separations — no hire/separation date on the record.
- **Article 83 sixth-day premium** — undetermined; the employer's city population is not on record.
- **15 regional wage orders** — registered but refused as `unverified`.
- **Pag-IBIG Circulars 274/460** — primary sources unread (the site is behind a reCAPTCHA).
- **Partial pharmacy returns** — refused rather than approximated.
- **Charge credit notes** — reversal is a void, not a negative line.
- **VAT per charge line** — the invoice's opening VAT is unchanged by charges.
- **Payer-specific price tiers** — one price per code.
- **Bed reservation, housekeeping workflow, inter-facility transfer.**
- **Real-time multi-user concurrency** — impossible in `localStorage`.

## 5. Known defects and limitations

| Item | Effect | Status |
|---|---|---|
| Client-side auth | Anyone can forge a session | Documented, not fixable in a static demo |
| `sessionStorage` | Per-tab, ~5 MB, no transactions | Architectural — see §5.1 and §5.2 |
| Admin tables below 1440px | Stack into unlabelled blocks | Shared with Laboratory, Pharmacy, Claims, Accounts, Audit, Reports, Admissions, Configuration |
| Laboratory tariff lives in `lab.js` | Not in the charge master | Deliberate: the catalogue already holds a price per test |
| Two seeded admissions | Room and board already inside their invoice opening amount | Marked `legacyBilledThrough`; accrual skips those dates |
| Demo clock | `HIS.today` = 31 Aug 2026, pinned 14:00 for admissions | Real timestamps are still used for event `at` fields elsewhere |

### 5.1 Concurrency — what this store cannot do

**`sessionStorage` is not a database.** Every store write is a read-modify-write of one JSON blob:
`get(key)`, mutate in memory, `set(key)`. There is no lock, no transaction, no compare-and-swap and
no server to serialise writers. The last write wins.

The consequence, stated plainly:

- **Within one tab, duplicate bed assignment is rejected.** `admit()` and `transfer()` both check
  `occupantOf(bedId)` before writing, and `adt-boundary-check.mjs` §8 proves a second admission and a
  transfer into an occupied bed are both refused. That guard is a check followed by a write, which is
  sufficient because a single tab cannot interleave with itself.
- **Across tabs, there is nothing to conflict over.** Demonstration data is tab-scoped, so two tabs
  are two independent hospitals with independent datasets. `adt-boundary-check.mjs` §12 asserts that
  an admission made in one tab is invisible to the other.
- **This is isolation, not concurrency control.** It works because there is exactly one user. The
  application does **not** claim that simultaneous real users cannot double-book a bed: with a shared
  store, two writers reading before either writes would both pass the check.

A production system needs a server, a transaction around the occupancy check, and a unique constraint
on `(bed_id) WHERE status = 'active'` — none of which exists here. `docs/ARCHITECTURE.md` §11 lists
the rest of what a real deployment would need.

### 5.2 Where the data lives, and what survives

| Moment | What happens |
|---|---|
| First visit / new tab | The seeded dataset is written to `sessionStorage` on first read |
| Navigating between pages | Everything is preserved for the tab |
| Refresh | Everything is preserved |
| Sign out | Session ends; every record is restored to the seeded dataset; the audit trail is carried across so the session stays readable |
| "Reset sample data" in the account menu | Same reset, without signing out |
| Closing the tab | `sessionStorage` is discarded; the next visit starts from the seed |

The only thing that can outlive the tab is the sign-in itself: ticking **Keep me signed in** stores a
session token in `localStorage` for 30 days. It holds a user id, an email and an expiry — no patient,
clinical, financial or payroll record. Leaving the box unticked (the default) keeps the session in
`sessionStorage` too, so nothing at all persists.

## 6. Verification

Run with `PW=<path to playwright-core>` set (see `README.md`). Counts are the actual output.

| Harness | Assertions | Proves |
|---|---|---|
| `smoke.mjs` | 28 pages | No console errors, no overflow, no dead controls |
| `roles-check.mjs` | 144 | Every role reaches its allowlist, blocked elsewhere |
| `auth-check.mjs` | 25 | Sign-in, session, expiry, audit |
| `clinical-check.mjs` | 53 | Laboratory and pharmacy rules, integration with treatment |
| `finance-check.mjs` | 31 | One money chain across Billing, Reports and the portal |
| `portal-check.mjs` | 40 | Patient identity, guardians, documents |
| `payroll-check.mjs` | 89 | Payroll arithmetic against hand-calculated figures |
| `claims-check.mjs` | 41 | Claim machine, role gates, settlement boundary |
| `ledger-check.mjs` | 46 | Payments, refunds, coverage, idempotency, invariants |
| `charges-check.mjs` | 44 | Clinical activity becomes a charge, once; unbilled persistence |
| `revenue-check.mjs` | 81 | Charge master, consultation billing, ADT, accrual, queue, returns, tariff change |
| `adt-boundary-check.mjs` | 65 |
| `qa-check.mjs` | 91 | Sign-in routes, appointment counts, avatars, role notifications, dashboard sources, bed dialog, payslip modal, build-text sweep |
| `qa-final-check.mjs` | 68 | Payslip output inspected byte-for-byte, duplicate submit, notification read/read-all/switch, fresh-session isolation, Departments as dept head, both sign-in routes | Noon cutoff edges, transfer pricing, idempotency, reopen, reload, derived occupancy, two-tab lost update |
| `acceptance-audit.mjs` | 180 | Independent M10 acceptance |
| `m10-1-audit.mjs` | 77 | Pag-IBIG tiers, wage floor, corrections, negative balances |
| `m10-2-audit.mjs` | 78 | Wage conversion factors and boundaries |
| `m10-3-audit.mjs` | 75 | Divisor per purpose, compensation types, regional orders |
| `m10-4-audit.mjs` | 54 | Hour classification, absence basis, Article 83 |
| `a11y-check.mjs` | 27 pages | 0 axe violations |
| `responsive-check.mjs` | 140 | 28 pages × 5 widths, no overflow |
| `visual-check.mjs` | 28 pages | Pixel diff against `qa/baseline` at 1440 and 1366 |
| `buttons.mjs` | all pages | 0 dead controls |

**Total: 1,138 assertions across 17 rule-asserting harnesses, plus 144 role checks — 1,282 in all.**, plus a 28-page smoke sweep, a 27-page axe audit, 140 responsive checks and 56 visual baselines (28 pages × 2 widths).

## 7. Where to start reading

| Document | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | How the modules fit together, load order, the money chain |
| `docs/FEATURE-MATRIX.md` | Every feature and its real state |
| `docs/COMPLETION-ROADMAP.md` | What remains, in priority order |
| `docs/CHARGES.md` | Charge model, encounter association, unbilled queue |
| `docs/ADMISSIONS.md` | Admission, beds, transfers, discharge, the noon cutoff |
| `docs/CLAIMS.md` | Claim lifecycle and the financial boundary |
| `docs/PAYROLL.md` | Statutory tables, divisor policy, hour classification |
| `docs/DATA-MODEL.md` | Every store, record shape and invariant |
| `docs/DESIGN-LOCK.md` | The visual contract |
| `docs/AUTH.md` | What the demo's auth is and is not |
