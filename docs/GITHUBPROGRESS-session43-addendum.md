# Session 43 addendum — 2026-11-22

Owner review of the live site. Everything below was reported from a real browser session, fixed,
and verified against the local server plus the domain harnesses. Read this with
`docs/PROJECT-STATUS.md`; nothing here changes the "static demonstration" limits.

## 1. The patient sign-up screen refused every new patient

**Reported:** "what's valid role?" — submitting the form answered *"Choose a valid role."*

**Cause:** `portal.html` never loaded `assets/js/rbac.js`. `HIS.accounts.create()` validates the
role against `HIS.rbac.ROLES`, so `HIS.rbac` was `undefined` and the check
`!HIS.rbac || !HIS.rbac.ROLES[input.role]` failed for the one role the form ever uses: `patient`.
The message was true and useless: the field it referred to does not exist on the screen.

**Fix:** `rbac.js` is loaded on the portal, and the sign-up screen says what it creates —
"Patient portal only. Staff accounts are issued by the hospital administrator" — so nobody looks
for a role picker again.

## 2. A duplicate patient record was a dead end

**Reported:** *"A patient record already exists for that name and date of birth (PT-99217). Enter
that patient ID, or ask registration to check for a duplicate."* — with no patient ID to enter and
no way forward.

**Fix:** the duplicate check now offers the two things a registration desk offers:

- **This is me — link PT-xxxx.** The mobile number on the record must match the one typed. If it
  does, the portal account is linked to that record. If it does not, the screen says registration
  must verify identity in person.
- **This is not me — continue.** A new record is created and flagged `attention`, the audit log
  records the possible duplicate and its ID, and Registration sees "Needs attention" in the
  registry. Blocking would strand a real patient whose namesake is already on file.

The message also clears as soon as the form is edited. It used to sit under the form and describe a
submission the patient had already changed.

## 3. "Request a correction" went nowhere

**Reported:** "where does it end up?"

**Truth:** it went into `mh_profile_requests`, a key no screen read. The copy promised an audit
entry and staff review that did not exist.

**Fix:** `assets/js/requests.js` (`HIS.requests`) owns the record now:

| Where | What happens |
|---|---|
| Portal → My profile | Field + details, then a **Your requests** table with status, date and the staff note |
| Registration → **Requests** tab | The queue, with a count badge; **Resolve** / **Dismiss** (a dismissal needs a reason the patient will read) and a link that opens the patient record with the request pinned at the top |
| Patient profile | The open request is shown above the cards, with the same two actions |
| Notifications | Registration and the Super Administrator get "Correction requests from patients" → `registration.html?tab=requests` |
| Audit log | Request created, resolved and dismissed, each with who and why |

A request survives sign-out (like the audit trail). If it did not, the message would vanish exactly
when the front desk came to read it.

## 4. The pay-period control on Payroll did nothing

**Reported:** "the pay period dropdown doesn't even work in this hr account."

**Cause:** `.pr-sel` was a `<div>` with a chevron and no handler, and the wrapper around the action
buttons covered it, so it could not even receive a click.

**Fix:** a real menu over two cut-offs. `HIS.attendancePeriod` now stores both periods (Aug 1–15 and
Aug 16–31, 2026) with their own records, timesheets and approvals; `HIS.payrollRuns` resolves the
run for the active period. Choosing a period switches attendance and payroll together, and each
period keeps its own run, version history and totals.

## 5. Fourteen staff accounts

**Reported:** "14 seems too much."

Three roles duplicated another role's work and were merged, not hidden:

| Removed | Merged into | Why |
|---|---|---|
| Hospital Administrator | Super Administrator | Same page set except Accounts |
| Receptionist | Front Desk & Registration | Same desk, same forms |
| Cashier | Billing & Finance | Same invoices, same payments |

Eleven accounts remain (ten staff + the patient). `roles-check` and `qa-nav-check` were updated to
the new roster; `claims-check` and `exhaustive-controls-check` now use the auditor as the
separation-of-duties case, because Billing & Finance legitimately holds claim approval.

## 6. The patient portal looked like a different product

**Reported:** the "M" tile is not the logo, and the portal looked like a stray next to the staff POVs.

- `assets/img/logo-mark.png` — the real mark, cropped and optimised from `logo-large.png`, used in
  the portal header, the staff header fallback and every favicon.
- The portal now wears the staff shell: the same gradient app bar, the same wordmark, a persistent
  left rail with icons and an active row, and the same card/table/badge vocabulary.
- Landing and sign-up gained the header the other public views already had.

## 7. Sidebar

**Reported:** "make the sidebar more pleasing to eyes in each POV."

312px (was 430), navy, 14px labels (was 30px Lexend), 19px icons (was 44px), grouped sections
(Overview / Patients / Clinical / Revenue / People / Organisation), an active row with an accent
bar, `aria-current`, a close button, and a pinned sign-out footer. Nothing on the stage moves: the
panel still slides over it.

## 8. Charges looked broken on a first visit

Charges are only created when someone raises one, so the screen showed "0 charges / ₱0" next to a
Billing screen holding ₱160,860. Two **unbilled** charges on open encounters now seed the queue.
They deliberately do not touch any invoice: an invoice's amount is its own stored figure and only an
assigned charge is added to it. (Seeding the invoice lines as charges was tried first and doubled
every bill — `ledger-check` caught it.)

## 9. Consistency pass

- One title style: Outfit 700, `--title`, at the same offset on every page (Registration,
  Appointments, Billing and Departments had four different sizes, weights and colours).
- One palette: the slate (`#1e293b`, `#64748b`, `#e2e8f0`…), teal (`#0f766e`) and near-black
  (`#152d47`, `#0e2a3f`) families were folded into the tokens that already existed.
- Registration tabs are a light segmented control with a clear active pill (they were four dark
  pills where the active one was barely different). The Requests tab has room; the search box moved
  right so the two no longer overlap.
- Billing and Departments carry a description under the title instead of a bare date.

## Verification

```
payroll-check      89 passed   portal-check     40 passed
roles-check       106 checks   charges-check    44 passed
revenue-check      81 passed   ledger-check     46 passed
clinical-check     53 passed   finance-check    31 passed
claims-check       43 passed   adt-boundary      65 passed
qa-nav-check      109 passed   exhaustive       36 passed
smoke             all pages clean   a11y: 0 violations   responsive: 140 checks
buttons.mjs       0 anomalies (264 controls clicked by hand-written audit too)
```

`docs/PROJECT-STATUS.md` still describes the shape of the app; the role count there (14) is now 11.

## 10. Personnel: the ninth employee overflowed the card and was not saved (2026-11-22)

**Reported:** "adding another employee makes the page glitched. and it doesnt even get saved."

Two independent defects, both reproduced in the owner's Chrome before changing anything.

1. **Geometry.** Rows were absolutely positioned at `547 + 76i` inside a card that ends at 1226.
   Eight rows end exactly at the footer (1155); a ninth ran to **1231**, over the footer text and
   past the card edge. The roster now lives in a 608px scrolling viewport (8 x 76) between the
   heading strip and the footer, and a newly added record is revealed after the re-render.
2. **Durability.** Add, Edit and Deactivate only mutated the in-memory `HIS.personnel.emps`, so a
   refresh discarded them. This was the last create flow in the app still not writing through
   `HIS.store`; it now persists to `mh_personnel`, registered in `store.js` so sign-out resets it
   with the rest of the demonstration data. The next id is taken from the highest number present,
   not from the list length.

**Verified:** `scripts/personnel-add-check.mjs` **28/28** (geometry at 1440 and 1366, add, reload
persistence, EMP-009/010 ids, edit, deactivate, search, department filter, required fields) ·
`smoke` all pages clean · `exhaustive-controls-check` 36/36 · `buttons.mjs` 0 anomalies in the
owner's Playwright Chrome. `visual-check` still reports the repo-wide drift introduced by this
session's portal rework (1.4% on unrelated pages, 71% on portal); personnel matches the other
pages' 10 hard pixels, so this change adds no new visual delta at eight rows.
