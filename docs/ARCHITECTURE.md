# Architecture

A static, framework-free hospital information system. No build step, no bundler, no server. Every
page is an HTML file that loads the modules it needs and renders into a fixed 1440 px stage.

---

## 1. Shape of the application

```
index.html            sign-in
   │
   ├─ dashboard.html            one shell, fourteen role configurations (dashboards.js)
   ├─ registration*.html        patient registry and the two registration forms
   ├─ appointments*.html        booking, confirmation
   ├─ consultation.html         diagnosis capture
   ├─ treatment.html            treatment plans, laboratory and pharmacy order entry
   ├─ nursing.html              care records
   ├─ laboratory.html           order → result → validate
   ├─ pharmacy.html             stock, prescriptions, dispensing
   ├─ admissions.html           bed board, admission, transfer, discharge     (M12)
   ├─ charges.html              unbilled queue, charge ledger, open encounters (M12)
   ├─ billing.html              invoices, payments, coverage
   ├─ claims.html               13-state claim lifecycle
   ├─ reports.html              derived financial and occupancy reporting
   ├─ attendance.html / personnel.html / payroll.html / departments.html
   ├─ audit.html                audit trail
   ├─ accounts.html             user administration
   └─ portal.html               patient portal (separate shell, same auth)
```

27 pages. Each is self-contained: it declares its own `<script>` list, in dependency order, and a
single page script renders into `#stage`.

## 2. Module layers

| Layer | Modules | Rule |
|---|---|---|
| **Data (static)** | `data.js`, `data-*.js`, `data-records.js` | Literal seed arrays and Figma-derived content. Read-only at runtime. |
| **Infrastructure** | `store.js`, `audit.js`, `kit.js`, `auth.js`, `accounts.js`, `rbac.js`, `shell.js`, `fit.js` | Loaded by every page. No page-specific logic. |
| **Domain stores** | `registry.js`, `encounters.js`, `tariffs.js`, `charges.js`, `admissions.js`, `ledger.js`, `lab.js`, `pharmacy.js`, `claims.js`, `payroll*.js`, `attendance-period.js`, `wage-floor.js`, `employees.js`, `employer.js` | Own their data and their invariants. Never touch the DOM. |
| **Page scripts** | `*-page.js`, `billing.js`, `reports.js`, `portal.js`, `consultation.js`, `dashboards.js`, … | Render, bind, and call the stores. Never compute a financial total themselves. |

The rule that keeps the system honest: **a page script may not compute a number that a store owns.**
Invoice totals come from `ledger.invoiceAmount()`, charges from `charges`, occupancy from
`admissions`, payroll from `payroll-calc`. This is why Billing, Reports, Claims and the portal cannot
disagree.

## 3. Load order

Every shell page loads, in this order:

```
data.js → store.js → audit.js → kit.js → [domain seeds] → [domain stores] → icons.js
        → accounts.js → auth.js → rbac.js → shell.js → [page script]
```

`shell.js` runs the role guard before anything renders: `rbac.guard()` authenticates, then checks the
page stem against the role's allowlist and redirects to the role's home when it is out of scope.

The order matters in three places:

1. `store.js` must precede every `data-*` store that persists.
2. `accounts.js` → `auth.js` → `rbac.js` must precede `shell.js`, which reads the signed-in account.
3. `tariffs.js` and `encounters.js` must precede `charges.js`, which resolves a price and an episode.

## 4. Persistence

`HIS.store` is the only module that touches `localStorage`. It provides a typed read with a fallback,
a write that never throws, a tiny pub/sub, a snapshot and a reset. Every key is registered in one
`KEYS` table (`store.js`), so the full data surface is one readable list.

Seeding is **lazy and idempotent**: a store writes its seed only when its key is absent. A browser
that already holds records is never overwritten. There is no destructive migration.

| Key group | Stores |
|---|---|
| Identity | `mh_accounts`, `mh_patients`, `mh_guardians`, `mh_profile_requests` |
| Clinical | `mh_lab`, `mh_rx`, `mh_stock`, `mh_stock_moves`, `mh_*_state` |
| Revenue | `mh_invoices`, `mh_tx`, `mh_charges`, `mh_tariffs`, `mh_encounters` |
| Inpatient | `mh_admissions`, `mh_bed_state` |
| Workforce | `mh_attendance_period`, `mh_payroll_runs`, `mh_payroll_corrections`, `mh_thirteenth` |
| Governance | `mh_claims`, `mh_audit`, `mh_notif_read` |

`mh_regs_extra` and `mh_appts_extra` are owner-entered and survive `store.reset()`.

## 5. The money chain

This is the spine of the system. Every financial figure is derived from it.

```
encounter ──► charge ──► invoice ──► transaction
   │            │           │            │
   │            │           │            ├─ payment   (+ collected)
   │            │           │            ├─ refund    (− collected)
   │            │           │            ├─ coverage  (+ covered, not collected)
   │            │           │            ├─ discount  (+ covered)
   │            │           │            ├─ adjustment(+ covered)
   │            │           │            └─ credit    (held, never applied)
   │            │           │
   │            │           └─ opening amount (from mh_invoices)
   │            └─ price snapshot, status active|void
   └─ invoiceId (may be null → unbilled queue)
```

```
invoiceAmount(bill) = bill.amount + charges.totalFor(bill.id)
balance(bill)       = invoiceAmount − collected − covered
status(bill)        = Paid | Partial | Pending      (derived, never stored)
```

`ledger.invariants()` asserts, per invoice, that `total = collected + covered + outstanding` to the
centavo, that no balance is negative, that nothing is over-collected or over-covered, and that
refunds never exceed payments. `charges.reconcile()` asserts that every assigned charge points at an
invoice that exists and belongs to the same patient, that no key is duplicated, and that every
charge carries a price snapshot.

## 6. Money is stored in centavos

`ledger` converts pesos to integer centavos at its boundary and back only for display. `0.1 + 0.2`
cannot drift. Charges are stored in pesos rounded to two decimals because they are prices, not money,
and never participate in a running balance.

## 7. Workflow states

Every entity with a lifecycle validates its own transitions in the store, so a screen cannot skip a
step by calling the wrong function.

| Entity | States |
|---|---|
| Appointment | Requested → Confirmed → Checked-in → Completed / Cancelled |
| Encounter | open → completed / cancelled |
| Laboratory order | Ordered → Collected → In Process → Resulted → Validated; → Cancelled |
| Prescription | Pending → Verified → Partial → Dispensed; → Rejected |
| Admission | active → discharged (reversible) |
| Bed | available / occupied / cleaning / maintenance |
| Charge | active → void |
| Invoice | derived: Pending / Partial / Paid |
| Transaction | pending → posted → void |
| Claim | 13 states (see `docs/CLAIMS.md`) |
| Payroll run | draft → reviewed → approved → released |

## 8. Audit

`HIS.audit.append({who, role, what, entity, before, after})` writes to `mh_audit`. Every store calls
it on creation, material edit, status transition, reversal and financial posting. There is no delete
control anywhere in the UI, and the audit screen is read-only.

No password, verifier or session token is ever written to the audit log — `auth-check.mjs` asserts
this.

## 9. Visual architecture

The Figma frame is the source of truth and `docs/DESIGN-LOCK.md` is the derived contract. Three
patterns exist:

1. **Module pages** (`consultation`, `nursing`, `treatment`, `payroll`, `personnel`, `attendance`,
   `pharmacy`, `billing`, `departments`, `profile`) — absolutely positioned inside a child wrapper,
   reproducing the Figma frame-local coordinates.
2. **Admin pages** (`audit`, `reports`, `accounts`, `laboratory`, `pharmacy`, `claims`, `admissions`,
   `charges`) — the `.ad-*` pattern: Outfit 36 title at (68,115), KPI strip, white card with a
   toolbar and a table, `.ac-*` modal shell. This pattern is an addition (there is no Figma frame for
   these screens) built entirely from existing tokens.
3. **Dashboard** — `.kpi` cards at fixed geometry with a per-role configuration.

`assets/css/responsive.css` is the only stylesheet allowed to override the Figma geometry, and
nothing in it applies at ≥1440 px.

## 10. Testing architecture

28 harnesses in `scripts/`, all driving a real Chromium against a local static server. Each creates
its own browser context, so each starts from a clean `localStorage`. They assert rules, not
renderings — except `visual-check.mjs`, which compares pixels against `qa/baseline` at 1440 and 1366.

`PW` must point at a `playwright-core` build; it lives outside the repository (see `README.md`).

## 11. What a production system would need

- A server with a relational store; the invariants above become constraints, not JavaScript checks.
- Argon2id password hashing, HttpOnly session cookies, server-enforced RBAC, rate limiting.
- An append-only audit table outside the client's reach.
- Optimistic concurrency control on invoices, charges and stock.
- Real integrations behind a service boundary: PhilHealth eClaims, HMO eligibility, payment gateways,
  laboratory instruments, procurement.
