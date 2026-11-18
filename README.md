# MediHeal HIS

Hospital Information System UI, converted from the Figma file "Overview (Dashboard, Departments)".

Live site: https://leequor.github.io/mediheal-his/

**AI agents: read [`AGENTS.md`](AGENTS.md) and [`docs/START-HERE.md`](docs/START-HERE.md) first.**
The visual contract is [`docs/DESIGN-LOCK.md`](docs/DESIGN-LOCK.md); the record shapes are in
[`docs/DATA-MODEL.md`](docs/DATA-MODEL.md); the authentication model and its limits are in
[`docs/AUTH.md`](docs/AUTH.md).

Plain HTML, CSS and vanilla JS. No build step, so it runs on GitHub Pages as-is. Layout is a fixed 1440px stage that mirrors the Figma frames.

## What it does

24 pages across 14 signed-in roles. Each account signs in with its own email and resolves its own
role, navigation and dashboard — there is no role picker.

| Area | State |
|---|---|
| Authentication | demo email + password against a browser-local account table (not security — see `docs/AUTH.md`) |
| Roles | 14, each with its own dashboard, navigation and page allowlist |
| Patients | one authoritative registry; the staff console and the patient portal read the same record |
| Clinical | consultation, treatment, nursing, laboratory (order → collect → process → result → validate), pharmacy (batch stock, dispensing, expiry) |
| Finance | invoices, a transaction ledger, coverage and discounts, PhilHealth / HMO payer records, reports |
| HR | personnel, attendance, payroll with effective-dated statutory tables |

Everything is synthetic and lives in the browser. It does not synchronise between devices and it is
not a hospital database.

## Run locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000

## Verify

Every claim in the documentation is produced by a script in `scripts/`. Each needs `playwright-core`
(set `PW=/abs/path/to/playwright-core/index.js` if it is not local) and a running server on :8788.

```
node scripts/smoke.mjs            # every page: console errors, overflow, clickable controls
node scripts/visual-check.mjs --check   # pixel diff of all pages against qa/baseline
node scripts/auth-check.mjs       # sign-in, session, expiry, reset, deactivation
node scripts/roles-check.mjs      # every role reaches its allowlist and is blocked elsewhere
node scripts/portal-check.mjs     # patient identity, scoping, guardians, documents
node scripts/clinical-check.mjs   # laboratory and pharmacy rules, and their integration
node scripts/finance-check.mjs    # one money chain across Billing, Reports and the portal
node scripts/payroll-check.mjs    # payroll arithmetic against hand-calculated figures
node scripts/claims-check.mjs     # claim state machine, role gates, settlement boundary
node scripts/ledger-check.mjs     # payments, refunds, coverage, idempotency, invariants
node scripts/acceptance-audit.mjs # independent M10 acceptance: attendance, statutory, claims, payslips
node scripts/m10-1-audit.mjs      # Pag-IBIG tiers, wage floor, corrections, negative balances
node scripts/m10-2-audit.mjs      # wage conversion factors, classifications, boundary cases
node scripts/m10-3-audit.mjs      # divisor policy per purpose, eight compensation types, regional orders
node scripts/mobile-audit.mjs     # rendered text size and touch targets at 5 widths
```

## Images

Logo, background texture and avatar must be exported from Figma and added to `assets/img/`. See `assets/img/README.md`.

## Conversion status

See the table in `docs/HANDOFF.md`. Done (rebuilt from Figma measurements): sidebar and header, Dashboard, Registration, Appointments. Everything else is a stub that names its Figma node.

Data lives in memory, so it resets on refresh.
