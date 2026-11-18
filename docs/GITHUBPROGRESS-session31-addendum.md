# Session 31 addendum — M5 unified patient identity (2026-11-18)

Additive log. Branch `dev/autonomous-milestones`. `main` remains at `fd5bf9f`.

## The gap

The patient portal had its own account store (`mh_portal_accounts`), its own session key, and **no
link to any patient record**. Its views were `landing / signup / signin / forgot` plus a "you're
signed in" card showing a name and an email. Meanwhile the staff side had five Figma patient rows,
billing referenced `PT-99215` which was not among them, and both registration forms worked around
the hole by computing `max(id)+1` over a union of two lists.

Two identities for the same person, and neither could see a record.

## What was built

### `assets/js/registry.js` — the authoritative patient table

* Seven records: the five Figma rows verbatim (so Registration still renders the same people), plus
  `PT-99215` and `PT-99214`, which were already referenced by Billing and by the forms' own comments.
* Full demographics: name parts, DOB, sex, civil status, mobile, email, Philippine address
  (street / barangay / city / province / region / postal), emergency contact, blood type, allergies,
  PhilHealth membership, HMO cover.
* `HIS.patients` is re-pointed at the registry with a **getter**, so `consultation.js`, `nursing.js`,
  `treatment.js`, `profile.js`, `dashboards.js` and both reg-forms cannot see a different list.
* `duplicates()` distinguishes *probable* (same surname **and** same DOB) from *possible* (same full
  name or same mobile). Neither merges automatically — the brief forbids it.
* `linkAccount()` refuses a second account claiming a patient already owned.
* `addGuardian()` / `revokeGuardian()` / `dependentsOf()`. A guardian row is the only way one account
  may read another patient's record; surname and phone number are explicitly not authorisation.

### The portal is rebuilt on the shared identity

`portal.js` no longer has an account store. Sign-in is `HIS.auth.attempt()` against `mh_accounts`, and
the session resolves through `account.patientId`. Six signed-in views:

| View | Reads |
|---|---|
| Overview | next appointment, ledger balance, medications from the treatment plan, validated lab count |
| Appointments | `registry.appointmentsFor()` with a real All/Upcoming/Past filter |
| Medical record | the same consultation, treatment plan and nursing record the clinical screens read |
| Billing | invoices + **payment history from the ledger**, per-invoice line items and balance |
| Documents | generates a real PDF (appointment slip, statement, receipt, treatment summary) |
| My profile | demographics, address, emergency contact, coverage, dependants, correction request |

A staff account is refused at the portal and its session is cleared immediately: this screen shows
one patient's clinical record.

### Billing stops lying about money

`assets/js/ledger.js` makes transactions the source of truth:

```
paid    = sum(posted transactions)
balance = amount − paid
status  = derived, never stored
```

The four demo invoices already carried a `paid` figure, so each got one `seeded: true` opening
transaction for exactly that amount. **No on-screen total moved** — only its provenance changed.
`billing.js`, `billing-modal.js`, `reports.js`, `dashboards.js` and the portal now all call
`HIS.ledger`; four copies of the same expression became one.

The KPI strip is derived: **₱160,860 billed / ₱100,700 collected / ₱60,160 outstanding**. The Figma
placeholders (₱482K / ₱395K / ₱87K) are gone. The fourth card's label changed from "Bills today"
(Figma sample `12`, and no invoice is dated Aug 31) to **"Invoices on file"** — 4.

### Accounts screen

New "Patient portal access" panel: one row per patient with a portal account or an active guardian,
the linked account, its authorised guardians with a Revoke action, and a Manage action that opens
the account editor. The editor gained a **Linked patient record** picker, shown only for the patient
role, which disables a record already owned by a different account.

## Verified

| Suite | Result |
|---|---|
| `scripts/portal-check.mjs` (new) | **40 / 40** |
| `scripts/auth-check.mjs` | 25 / 25 |
| `scripts/roles-check.mjs` | 119 checks, 0 failures |
| `scripts/dashboard-shots.mjs` | 14 / 14 |
| `scripts/smoke.mjs` | 23 pages, 0 console errors |
| `scripts/visual-check.mjs` | all 23 pages match the new baseline |

`portal-check.mjs` proves, per assertion: the login resolves to one record; **no other patient's
name appears anywhere on the portal**; appointments and invoices are scoped; a staff account is
refused and its session cleared; a private view without a session redirects; a refresh keeps the
session; sign-out ends it; a guardian link grants and a revoke removes access; a second account
cannot claim a patient; a downloaded statement is a real `%PDF` file named after the invoice.

## Two visual diffs, both intended

| Page | Change | Why |
|---|---|---|
| `billing.html` | 0.303% (2,971 hard px, box 72,219 1121×53) | the KPI strip now shows ledger figures instead of Figma sample text |
| `registration.html` | 10.6% (whole table) | the registry has 7 patients, not 5; the KPI cards recompute to 7 / 2 / 5 / 3 |

Both were inspected on screen before rebaselining. Nothing else moved.

## Bugs found while building this

1. **The router hid the whole app.** The six signed-in views are sub-views rendered into `#pt-stage`
   inside one `#app` section, but the router toggled `.pt-view` by hash name, so `#appts` matched no
   element and the shell stayed `display:none`. Found because the harness could not click a button
   that the DOM contained.
2. **`page.goto()` to an identical URL does not navigate**, so a test read stale DOM after revoking
   a guardian and reported a false failure. The harness now reloads.
3. **`innerText` applies `text-transform`**, so an assertion looking for "Chief complaint" failed
   against a label rendered "CHIEF COMPLAINT". Assertions are case-insensitive now.
4. `initials('Isabel Geliz V. Ramos')` produced `IG` (first two words). Now first + last → `IR`.

## Not done in M5

* **Online self-booking is not implemented.** The portal says so and gives the front-desk number
  instead of rendering a booking button that does nothing.
* **No staff-side "patient accounts" search by patient name/ID.** The panel lists patients that
  already have access; finding an unlinked patient is done from the account editor's picker, which
  is a `<select>` over the whole registry — workable at 7 patients, not at 7,000.
* **Profile correction requests are recorded, not actioned.** They land in `mh_profile_requests` and
  the audit log with status `open`; no screen resolves them.
* **Portal data does not refresh while open.** Another tab changing a record is not pushed; a
  reload picks it up.
