# MediHeal HIS

A hospital information system, built as a static website: plain HTML, CSS and vanilla JavaScript.
No build step, no backend, no database.

**Live demonstration:** https://leequor.github.io/mediheal-his-complete/

The design is taken from the Figma file *"Overview (Dashboard, Departments)"*. The visual contract —
tokens, type scale, component geometry — is recorded in [`docs/DESIGN-LOCK.md`](docs/DESIGN-LOCK.md)
and is not changed casually.

---

## What it is

A complete demonstration of hospital operations across fourteen staff roles and a patient portal,
driven by synthetic data. Every screen is real markup and real logic: a charge raised in a
consultation lands on an invoice, a dispensed prescription decrements a batch, a discharged admission
posts its room charges and closes the bill.

It is **not** a production hospital system. See [Limitations](#limitations).

## Features

| Area | What works |
|---|---|
| **Authentication** | Staff sign-in and a separate patient portal, fourteen staff roles with per-role page allowlists, remember-me or tab-scoped sessions, password reset through the Accounts screen |
| **Dashboards** | One per role, every figure derived from the module that owns it |
| **Patient management** | Registry, registration (outpatient and inpatient), patient records |
| **Appointments** | Booking, editing, cancelling, rescheduling, status and doctor filters, pagination |
| **Clinical** | Consultations, treatment plans, orders, diagnoses, nursing observations |
| **Laboratory** | Order → collection → processing → result → validation → release, with critical-result acknowledgement |
| **Pharmacy** | Prescription → verification → batch selection → dispensing, stock receiving, adjustment, disposal, returns, low-stock and expiry tracking |
| **Admissions** | Ward and bed management, transfer, discharge, room charges from the tariff in force at the time |
| **Billing** | Charges, invoices, payments, coverage, refunds, ledger reconciliation |
| **Claims** | Submission, review, approval, denial, settlement simulation |
| **Attendance** | Clock records, leave requests, timesheet review |
| **Payroll** | Attendance-driven payroll runs, corrections, approval, release, payslip archive |
| **Reports** | Revenue, collections, departmental summaries |
| **Configuration** | Tariffs with effective dates, catalogue, hospital settings |
| **Accounts** | Account creation, role assignment, password reset, deactivation |
| **Audit** | Every state change is recorded with who, what and when |
| **Patient portal** | Own profile, appointments, released results, prescriptions, invoices, payments |
| **Notifications** | Per-role, derived from live records, each one a deep link to the exact record |

## Technology

- HTML, CSS and vanilla JavaScript — no framework, no bundler
- Browser storage only: `sessionStorage` for demonstration records (they die with the tab) and
  `localStorage` for an explicitly remembered sign-in token
- SVG icons inline, fonts from Google Fonts, PDFs written by a small built-in PDF 1.4 writer

## Running it locally

Any static file server works. From the repository root:

```bash
python -m http.server 8000
# then open http://127.0.0.1:8000/
```

or

```bash
npx serve .
```

Opening `index.html` directly from the filesystem will not work: the app relies on `sessionStorage`
and on script order that needs an HTTP origin.

## Demonstration accounts

All accounts use the sample password **`MediHeal2026!`**. These are demonstration credentials written
into the source; they are not secure authentication.

| Account | Role |
|---|---|
| `superadmin@mediheal.test` | Super Administrator |
| `admin@mediheal.test` | Hospital Administrator |
| `reception@mediheal.test` | Receptionist |
| `admissions@mediheal.test` | Admissions Officer |
| `doctor@mediheal.test` | Doctor |
| `nurse@mediheal.test` | Nurse |
| `pharmacy@mediheal.test` | Pharmacist |
| `laboratory@mediheal.test` | Medical Technologist |
| `cashier@mediheal.test` | Cashier |
| `finance@mediheal.test` | Finance Officer |
| `hr@mediheal.test` | HR Officer |
| `department.head@mediheal.test` | Department Head |
| `auditor@mediheal.test` | Auditor |
| `patient@mediheal.test` | Patient (portal only) |

## Demonstration behaviour

- Sample records are created on first load and held in **`sessionStorage`**.
- Changes survive navigation and refresh within the tab, and are lost when the tab closes.
- **Sign out** and **Reset sample data** both restore the original sample set.
- A new tab is a new demonstration: it never inherits another visitor's payments, edits or audit
  entries.
- "Keep me signed in" writes a token to `localStorage` so the session survives closing the browser;
  that token is the only thing that outlives the tab, and signing out removes it.

## Limitations

- **Static demonstration.** There is no server and no database. Records live in the browser tab and
  are not durable, shareable or auditable in any real sense.
- **Not for real patients.** It must not be used to store real patient records or to operate a
  hospital.
- **Authentication is a demonstration.** Passwords are compared in the browser against seeded values.
  There is no transport security, no server-side enforcement and no real identity provider.
- **Permissions are UI-level.** Role allowlists decide which pages render; they are not a security
  boundary.
- **Integrations are simulated.** PhilHealth eClaims, HMO eligibility and payment gateways have no
  credentials and are represented by local simulations only.
- **Payroll proration is not modelled.** New-hire and separation proration needs an employer policy
  decision; the deferred statutory research was not reopened.
- **Catalogue and bed inventories are read-only** in Configuration; editing them needs a retirement
  policy for records that already reference them.

## Repository layout

```
*.html                 one file per screen
assets/css/            tokens, base, per-module styles, responsive
assets/js/             data modules, domain logic, page controllers
assets/img/            logo and icons
docs/                  design lock, architecture, data model, feature matrix, QA reports
scripts/               Playwright test harnesses
qa/baseline*/          accepted visual baselines (manifests committed, images regenerated on demand)
.github/workflows/     GitHub Pages deployment
```

## Tests

The suites are Playwright scripts run against a local static server:

```bash
PW=<path-to-playwright-core> node scripts/qa-check.mjs
```

`smoke`, `a11y-check`, `responsive-check`, `buttons`, `visual-check` and the domain suites
(`revenue-check`, `charges-check`, `ledger-check`, `claims-check`, `payroll-check`, `adt-boundary-check`,
`clinical-check`, `finance-check`, `portal-check`, `auth-check`, `roles-check`, `acceptance-audit`,
`m10-1..4-audit`, `qa-final-check`, `qa-nav-check`) follow the same pattern. Current results are in
[`docs/FINAL-QA-REPORT.md`](docs/FINAL-QA-REPORT.md).

## Deploying

Pushing to `main` triggers `.github/workflows/deploy-pages.yml`, which stages only the HTML pages and
`assets/`, checks that no root-absolute path has crept in, and publishes the artifact to GitHub Pages.
Documentation, tests and QA artefacts stay in the repository but are not part of the website.
