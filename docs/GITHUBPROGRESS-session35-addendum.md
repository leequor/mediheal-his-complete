# Session 35 addendum — M9 desktop consolidation and final QA (2026-11-18)

Additive log. Branch `dev/autonomous-milestones`. `main` remains at `fd5bf9f`.

## Consolidation

### A regression the M7 ledger introduced in the dashboards

`dashboards.js` still compared `paidOf(b)` against `b.amount` to decide whether an invoice was open.
Once coverage became a real reduction of the charge, an invoice a payer had partly settled would
have been called open in every role dashboard. Now every dashboard uses `HIS.ledger.balanceOf()`,
so Billing, Reports, the dashboards and the portal answer the same question the same way.

### The 12px floor now covers the admin screens

The laboratory, pharmacy, accounts, audit and reports screens introduced 11–11.5px meta text
(`.ad-who small`, `.ad-kv dt`, `.ac-hint`, `.ac-edit`, `.ac-you`). That is the Figma label size at
1440 and stays there, but below 1440 the floor from DESIGN-LOCK §12 applies like everywhere else.
Caught by `mobile-audit` at 1280 and 1366 — **6 pages failing, now 0**.

### Documentation

`README.md` rewritten from "a UI conversion" to what the application actually is, with the state of
each area and the command that verifies it. `AGENTS.md` gained three rules that this work kept
proving: a record has exactly one owner, run the domain harness for the area you touched, and
measurement is not inspection.

## Full verification, this branch

| Suite | Result |
|---|---|
| `smoke.mjs` — 24 pages | 0 console errors, 0 overflow |
| `visual-check.mjs --check` | **all 24 pages match baseline** |
| `auth-check.mjs` | 25 / 25 |
| `roles-check.mjs` | 127 checks, 0 failures |
| `portal-check.mjs` | 40 / 40 |
| `clinical-check.mjs` | 53 / 53 |
| `finance-check.mjs` | 31 / 31 |
| `payroll-check.mjs` | 45 / 45 |
| `dashboard-shots.mjs` | 14 / 14 |
| `mobile-audit.mjs` @1280/1366/1920 | 72 / 72 |
| `mobile-audit.mjs` @390/430/768/1024/1280/1440 | 138 / 138 |

**321 assertions across eight harnesses**, plus 48 pixel comparisons.

## Milestones on this branch

| Commit | Milestone |
|---|---|
| `72dceba` | M0 design lock + visual baseline |
| `1f49c7c` | M1 role foundation |
| `82fcc99`, `adb1677` | M2 audit log + reports |
| `ed39ade` | M3 email auth, 14 accounts, account management |
| `82e9a09` | M4 fourteen role dashboards |
| `4a8147c` | auth-aware responsive harness |
| `4e8097b` | mobile hotfix: zoom removed |
| `d59ceeb` | M9.1 responsive completion |
| `58bb326` | M9.2 visual QA, dialogs, touch targets, a11y |
| `9a6ee9d` | **M5 unified patient identity, portal, ledger** |
| `a570544`, `1a5a098` | **M6 laboratory + pharmacy** |
| `826a7f3` | **M7 one money chain** |
| `0125c4f` | **M8 payroll arithmetic** |

## What is genuinely complete

* One patient identity. Staff screens and the portal read the same record; a login is not a patient
  ID and a guardian link is the only way to read another patient's record.
* Clinical flow that closes: doctor orders → laboratory collects, processes, results, validates →
  the validated result appears in the patient's own record and an unvalidated draft does not.
  Doctor prescribes → pharmacy verifies, dispenses from a named batch → stock falls by exactly what
  was given, an expired batch cannot be given, and the prescription appears in the portal.
* One money chain. A balance is computed in one place; coverage and discounts are not collections;
  an electronic payment is pending until a cashier confirms the provider reference.
* Payroll that calculates rather than transcribes, against sourced and dated tables, verified with
  hand-worked examples.
* A visual baseline that has been held through every one of these changes, with each intentional
  diff inspected on screen first and recorded with its reason.

## What is NOT complete — read this before describing the project as finished

1. **No claim lifecycle.** PhilHealth and HMO member data, eligibility, documentation and the
   covered amount are real and enforced. A claim record with submission status, approval status and
   a follow-up owner does not exist. There is no eClaims or HMO integration and none is simulated.
2. **No attendance-to-payroll link.** `days` and `hours` are stored and displayed; payroll does not
   recompute basic pay from attendance, so an absence does not reduce pay. No night differential,
   overtime, holiday premium or 13th-month accrual.
3. **The payroll table is not verified against a live issuance.** It is dated 2025-01-01 and was
   read from secondary summaries in August 2026. It must be confirmed against the current SSS,
   PhilHealth, HDMF and BIR issuances and reviewed by a Philippine accountant. Nothing here is a
   compliance claim.
4. **No security.** Client-side authentication against a non-cryptographic digest, on a public
   static site, with the session in localStorage. `docs/AUTH.md` states this and lists what a real
   deployment needs. Do not present the role restrictions as a security boundary.
5. **No shared database.** Browser storage only. Two staff on two computers do not see each other's
   work. `docs/DATA-MODEL.md` §7 lists what a backend would need.
6. **Seven screens are still mobile-reflowed-but-not-designed.** M9.1/M9.2 made all 24 pages usable
   at 390px without zoom and above a 12px floor, but Billing, Registration, Appointments,
   Departments, Profile, the portal and the registration forms were reflowed from a fixed desktop
   layout rather than designed for a phone. Desktop is the target; this is not a mobile product.
7. **No accessibility audit since M9.2.** Contrast, focus order and dialog focus were checked then
   and the axe run was clean, but the laboratory, pharmacy and the M7/M8 screens have not been
   re-run through axe.
8. **Not deployed.** `main` is untouched and the live site still serves the pre-M5 build.

## Deploying

Nothing here is deployed and the owner has not authorised it. To deploy: merge
`dev/autonomous-milestones` into `main` and let GitHub Pages publish, then re-run
`smoke.mjs`, `visual-check.mjs` and `roles-check.mjs` against
`https://leequor.github.io/mediheal-his/` — the local checks prove the build, not the deployment.
