# MediHeal HIS

Hospital Information System, built from the Figma file "Overview (Dashboard, Departments)" as a
static site: plain HTML, CSS and vanilla JavaScript, no build step.

**Live site:** https://leequor.github.io/mediheal-his/ — serves an **older build**. Nothing from M5
onward has been deployed, and `main` has not moved since `fd5bf9f`.

**Start here:** [`docs/PROJECT-STATUS.md`](docs/PROJECT-STATUS.md) describes what actually works.
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains how it fits together.
[`docs/FEATURE-MATRIX.md`](docs/FEATURE-MATRIX.md) classifies every capability.

## What it is

A desktop-first demonstration of a Philippine hospital information system: **28 pages, 14 roles**,
one authoritative patient record, and a single money chain from a clinical service to an invoice.

| Area | What works |
|---|---|
| Authentication | demo email + password against a browser-local account table; per-account role, navigation and dashboard (not security — see `docs/AUTH.md`) |
| Patients | one registry read by the staff console, billing and the patient portal |
| Clinical | consultation, treatment, nursing, laboratory (order → collect → process → result → validate), pharmacy (batch stock, dispensing, expiry, returns) |
| Inpatient | admissions, 172-bed board, transfers, daily room-and-board accrual, discharge |
| Revenue | charge master, unbilled queue, invoices, payments, refunds, coverage and discounts |
| Claims | 13-state lifecycle with partial approval and capped settlement |
| HR | personnel, attendance, payroll with effective-dated statutory tables |
| Portal | six patient views, own records only, released results only |
| Configuration | charge master: effective-dated prices, per-code history, audit on every change |
| Configuration | charge master with effective-dated prices and per-code history |

Everything is synthetic and lives in `localStorage`. It does not synchronise between devices, and it
is not a hospital database. Read `docs/PROJECT-STATUS.md` §3 before treating any figure as real.

## Run locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000 and sign in with a demo account (`index.html` lists them).

## Verify

Every claim in the documentation is produced by a script in `scripts/`. They need `playwright-core`;
set `PW` to its `index.js` if it is not resolvable from the repository root.

```
export PW=/abs/path/to/playwright-core/index.js
node scripts/smoke.mjs                  # 28 pages: console errors, overflow, clickable controls
node scripts/visual-check.mjs --check   # pixel diff of all pages against qa/baseline @1440
node scripts/visual-check.mjs --width 1366 --check
node scripts/auth-check.mjs             # sign-in, session, expiry, reset, deactivation
node scripts/roles-check.mjs            # every role reaches its allowlist and is blocked elsewhere
node scripts/portal-check.mjs           # patient identity, scoping, guardians, documents
node scripts/clinical-check.mjs         # laboratory and pharmacy rules and their integration
node scripts/finance-check.mjs          # one money chain across Billing, Reports and the portal
node scripts/charges-check.mjs          # clinical activity becomes a charge, once
node scripts/revenue-check.mjs          # charge master, consultation billing, ADT, queue, returns
node scripts/payroll-check.mjs          # payroll arithmetic against hand-calculated figures
node scripts/claims-check.mjs           # claim state machine, role gates, settlement boundary
node scripts/ledger-check.mjs           # payments, refunds, coverage, idempotency, invariants
node scripts/acceptance-audit.mjs       # independent M10 acceptance
node scripts/m10-1-audit.mjs            # Pag-IBIG tiers, wage floor, corrections
node scripts/m10-2-audit.mjs            # wage conversion factors and boundaries
node scripts/m10-3-audit.mjs            # divisor policy per purpose, regional orders
node scripts/m10-4-audit.mjs            # hour classification, absence basis, Article 83
node scripts/a11y-check.mjs             # axe audit, 27 pages
node scripts/responsive-check.mjs       # 28 pages × 5 widths, no overflow
node scripts/buttons.mjs                # dead-control sweep
node scripts/mobile-audit.mjs           # rendered text size and touch targets at 5 widths
```

Run two or three at a time: a single shell loop over all of them exceeds the default timeout.

## Images

Logo, background texture and avatar are expected in `assets/img/`. See `assets/img/README.md`.

## Branches

- `dev/autonomous-milestones` — development. All work happens here.
- `main` — frozen at `fd5bf9f`. Not merged, not deployed.
