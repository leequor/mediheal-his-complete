# Session 28 addendum — email authentication, individual accounts (2026-11-17)

Additive log. Nothing in earlier addenda was changed. Branch: **`dev/autonomous-milestones`**.
`main` remains at `fd5bf9f`; nothing was merged or deployed.

## Owner request

Replace the M1 role switcher with real email/password sign-in. Each of the 14 roles gets its own
account; the account decides the role. Add a Super Administrator account-management screen. Remove
every user-facing role selector. Preserve the design.

---

## M3 — Email authentication and account management

### The role switcher is gone

- `assets/js/rbac.js`: the `set()` role-switching function and the `mh_role` storage key were
  **removed**. `key()` now resolves from `HIS.auth.account().role`; `current()` falls back to a
  `GUEST` role that allows nothing; `person()` reads the account record.
- `assets/js/shell.js`: the M1 `roleSwitcher()` block was replaced by `accountMenu()` — identity
  (name, email, role, department), a *Manage accounts* link for the Super Administrator only, and
  **Sign out**. No role list, no role selection anywhere in the signed-in UI.
- `assets/js/store.js`: `mh_role` dropped from the key registry; `mh_accounts` added.

### New modules

| File | Role |
|---|---|
| `assets/js/accounts.js` | Account store: seeding, normalisation, create/update/reset, `stats()`, guard rails |
| `assets/js/auth.js` | Credential check, session persistence, sign-out, `requireAuth()`, home resolution |
| `assets/js/signin.js` | Sign-in screen behaviour: validation, show/hide password, demo list, password help |
| `assets/js/accounts-page.js` | Super Administrator account management |
| `accounts.html` | The account screen (addition, design format) |
| `docs/AUTH.md` | What this system is, what it is not, and what real auth would need |

### Sign-in screen

The Figma layout is unchanged. Three additions, all flagged `Addition (not in Figma)` in the markup:

1. **Show/hide password** inside the existing field (`y558`); the input gains `padding-right:46px` so
   text never runs under the control.
2. **Inline status row** at `y650`, between the forgot link and the button — used for validation,
   invalid credentials, disabled accounts, loading and success.
3. **"Demo accounts & password"** disclosure at the bottom of the blue panel, opening a modal list of
   the 14 accounts with *Copy* and *Use* buttons. It is a **reference list, not a role selector**: it
   only fills the form, and the account still decides the role.

The Figma *"Reset link sent"* state (`4031:9586`) was **removed**. It claimed an email had been sent,
which a static site cannot do. In its place: an honest password-help screen explaining that recovery
is a Super Administrator action.

### Sign-in behaviour

- Email is trimmed and lower-cased before matching, so `  Doctor@MediHeal.TEST  ` signs in.
- Distinct messages for: empty email, malformed email, unknown account, wrong password, deactivated
  account. The password field is marked `bad` and selected on a password failure.
- Loading: button disabled, label `Signing in…` for 260 ms. Success: `Signed in`, then a 420 ms beat
  and a redirect. Neither pretends to contact a server.
- `?next=` is honoured only when the signed-in role can actually open that page.
- Already signed in → straight to the role's home.

### Sessions

`localStorage.mh_session` (30 days) when *Keep me signed in* is checked, otherwise
`sessionStorage.mh_session_tab` (12 hours, dies with the tab). Refresh keeps the session either way.
`expiresAt` is enforced on read, and `account()` re-reads the account record, so a deactivated account
loses its session immediately.

### Guard rails (verified)

- Duplicate emails refused, case-insensitively (`NURSE@mediheal.test` vs `nurse@mediheal.test`).
- Unknown roles refused.
- The last active Super Administrator cannot be demoted **or** deactivated.
- No delete: accounts are deactivated so history stays attributable.
- Every account action is audited; **no password or verifier is ever written to the audit log**.

### Verified

`scripts/auth-check.mjs` — **25 assertions, 25 passed**:

empty credentials · malformed email · unknown account · wrong password · empty password ·
uppercase + whitespace email · identity resolves from account · refresh keeps session ·
sign-out blocks protected pages · expired session refused · remember-me writes localStorage ·
duplicate refused · invalid role refused · creation adds exactly one record · new account signs in ·
password reset · old password stops working · new password works · role change applies to the next
session · deactivated account blocked · seed count restored to 14 · sign-in audited ·
failed sign-in audited · sign-out audited · no password material audited.

`scripts/roles-check.mjs` — **119 checks, 0 failures**. All 14 accounts reach their home without a
redirect, every allowlisted page opens, out-of-scope pages redirect, and an unauthenticated request
to `dashboard.html` lands on `index.html?next=dashboard.html`.

`scripts/visual-check.mjs` — re-baselined to **23 pages**; `--check` reports **0.000% on all 23**.

### Visual impact, measured

Diffing the new capture against the pre-M3 baseline (per-channel tolerance 12):

| Page | Diff | Pixels ≥128 | Verdict |
|---|---|---|---|
| `index` | 0.591% | 797 | **intended** — the three sign-in additions |
| `dashboard` | 0.062% | **0** | renderer noise |
| `appointments` | 0.038% | 0 | renderer noise |
| all other existing pages | ≤ 0.049% | 0 | renderer noise |
| `accounts` | new | — | new page |

No existing page changed materially. The harness threshold was raised from 0.05% to **0.1%** and now
prints a `hard:` count (pixels differing by ≥128), because 0.062% of text antialiasing was tripping
a threshold that a real change (0.591%) clears six times over.

### Harness changes

- `visual-check.mjs` seeds a real session for `superadmin@mediheal.test` before capturing protected
  pages, and uses a session-free context for `index` and `portal`. Without this every page would
  redirect to the login screen and the baseline would be 23 copies of it.
- `roles-check.mjs` seeds `mh_session` instead of `mh_role`, and the anonymous-access check now uses
  its **own** context — reusing the authenticated one tested a signed-in request by mistake.

### NOT done in M3 — stated plainly

- **No server.** Credentials are checked in the browser against a non-cryptographic digest. Anyone
  can forge a session. Documented at length in `docs/AUTH.md`.
- **No email.** Password recovery is an administrator action; the UI says so.
- **Dashboards are still identical for every role** (M4).
- The patient account carries a `patientId` but the portal still has its own separate demo auth (M5).

---

## M4 — Fourteen distinct role dashboards

### The gap this closes

M1–M3 changed identity, navigation and page access, but every role still landed on the same
dashboard. The brief is explicit that this is not sufficient.

### Approach: vary the content, never the grammar

`dashboard.html` is now a thin shell. `assets/js/dashboards.js` holds one configuration per role and
renders it through the **existing Figma components**:

| Element | Geometry | Unchanged? |
|---|---|---|
| Greeting | `.dash-title`, Outfit 700 45 at (81,105) | yes |
| KPI cards | `.kpi` at `(24 + 355i, 195)`, 336×160, r12, `#c8dcea` | yes |
| Panel A | `.card-lg` at (38,405), 873 wide, `.dhead` + `.dr` rows | yes |
| Panel B | `.card-lg` at (991,405), 424 wide, `.tl`/`.dot`/`.si` timeline | yes |
| Pills | `.badge` `.ok`/`.in`/`.off`/`.red` | yes |

Only the *content* changes: greeting text, four KPI figures, the table columns and rows, and the
timeline items. No new colour, font, radius, shadow or spacing value was introduced.

### Per-role content

| Role | Greeting | Panel A | Panel B |
|---|---|---|---|
| Super Administrator | System overview | Accounts by role | Recent activity |
| Hospital Administrator | Hospital overview | Departments (beds, occupancy, revenue) | Operational activity |
| Receptionist | Welcome back, Maricel! | Appointments today | Upcoming check-ins |
| Registration | Welcome back, Joel! | Recent registrations | Admission queue |
| Doctor | Welcome back, Dr. Laurice! | Consultation queue | Today's schedule |
| Nurse | Welcome back, Sofia! | Assigned patients (ward, bed, next vitals) | Medication schedule |
| Pharmacist | Welcome back, Miguel! | Dispensing queue | Stock watch |
| Laboratory | Welcome back, Daniel! | Test orders | Specimens |
| Cashier | Welcome back, Aileen! | Invoices to settle | Collection notes |
| Finance | Financial overview | Collection by invoice type | Reconciliation |
| HR | Welcome back, Carmela! | Employees + payroll status | Payroll actions |
| Department Head | Welcome back, Dr. Marc! | Department staff | Department workload |
| Auditor | Compliance overview | Recent activity | Change trail (before → after) |
| Patient | — | routed to `portal.html` (no staff dashboard by design) | — |

### Where the numbers come from

Every figure is derived at render time from the demo stores — `HIS.patients`, `HIS.appointments`,
`HIS.billing.bills`, `HIS.payroll.emps`, `HIS.personnel.emps`, `HIS.nursing.pts`,
`HIS.treatment.plans`, `HIS.departments`, `HIS.accounts`, `HIS.audit`. Nothing is hardcoded.

Examples verified on screen: Finance shows ₱160,860 billed / ₱100,700 collected / ₱60,160
outstanding / ₱40,215 average — the same ledger the Billing and Reports screens read. HR shows
8 headcount, 8 payroll records, 4 paid. Cashier shows 2 open invoices and 1 partial payment.
Department Head scopes to the signed-in head's own department (Orthopedics) and shows its 85%
occupancy.

**The Figma placeholder statistics (12,480 patients / 133 inpatients / 1,046 visits / 87
appointments) are no longer displayed anywhere.** They were sample data in the frame, not figures
from the store. This is a deliberate, documented change: the brief forbids hardcoded unrelated
statistics.

### Honest gaps inside the dashboards

Laboratory and Pharmacy have **no order or inventory store yet** (that is M6). Their dashboards
derive what genuinely exists — procedures and medications from `HIS.treatment.plans` — and their
fourth KPI reads `—` with the delta *"Not modelled yet (M6)"*. Their feed panel says the same in
words instead of inventing stock levels or specimen counts.

### Defects found by screenshot inspection and fixed

1. **Role cells rendered as grey pills.** The renderer treats any array cell as `[label, kind]`; a
   single-element array was silently becoming a badge. Role is now a plain string.
2. **Long values overflowed the 873px panel** (Laboratory: `scrollWidth` 1476 vs 1440). Two causes:
   `.dr .c` has `white-space:nowrap`, and `.kpi .d` is nowrap in a 200px box. Fixed with a
   `.dc-clamp` ellipsis class scoped to the new cells, per-column max widths, and shorter KPI deltas.
3. **Names wrapped** because `.dr .who` is a fixed 100px. Now set per column via inline width.
4. **`LAST SIGN-IN` header wrapped onto two lines** and collided with the first row → `LAST LOGIN`.
5. **`Registration & Admissions` truncated into the next column** → the account table uses the
   registry's `short` label.

### Verified

- `scripts/dashboard-shots.mjs` (new): signs in as each of the 14 accounts in its own context,
  screenshots the dashboard, and asserts no console error, no horizontal overflow, and a non-empty
  greeting. **14/14 pass, 0 console errors, 0 overflow.**
- `scripts/auth-check.mjs`: **25/25**.
- `scripts/roles-check.mjs`: **119 checks, 0 failures**.
- `scripts/visual-check.mjs`: re-baselined to 23 pages, **`--check` clean on all 23**.

### NOT done in M4

- Patient dashboard content lives in `portal.html`, which still uses its own separate demo auth.
  Unifying the two identity systems is M5.
- No dashboard period selector, no per-department drill-down from a KPI card.
- Laboratory and Pharmacy dashboards remain partly placeholder until M6.
