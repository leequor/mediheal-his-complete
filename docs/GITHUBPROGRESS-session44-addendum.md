# Session 44 addendum — 2026-11-23

Additive log. Nothing above this file was removed.

## What this turn did

A verification pass (every harness in the repo) plus four defects found outside the harnesses,
the two harnesses that had gone stale, and a Supabase data layer.

## Defects found and fixed

1. **Sign-in form fell below the fold on every screen narrower than 1440** (`responsive.css`).
   The white plate behind the form (`.si-card`, 502×540, positioned for the 1440 frame) survived the
   responsive switch: it became a static 540px block of empty white and pushed the email field, the
   password field and the Sign in button about 300px down. On a 1366×768 laptop the page looked like
   it had no inputs; at 390 the button sat at y=1084. Fixed by hiding the plate below 1440 and giving
   the flow 20px side padding (measured: button at y=544 on a 390 phone, y=525 on a 1366 laptop,
   1440 unchanged).
2. **Notification badge clipped and detached from the bell** (`base.css`, `responsive.css`).
   `.bell b` is absolutely positioned but `.bell` had no `position`, so the badge anchored to the
   header: at <1440 it sat at the screen edge with its top 2px outside the viewport, and
   `.hd{overflow:hidden}` cut it further. `.bell` is now `position:relative` at every width; the
   responsive header block resets the frame's `left/top` so flex placement still wins.
3. **Staff registration created duplicate patient charts silently** (`registry.js`, `reg-form.js`,
   `reg-form-out.js`). `HIS.registry.duplicates()` existed and the patient portal already asked
   before creating a near-duplicate, but both staff forms wrote straight to `mh_regs_extra`. The
   check now spans both stores (`duplicatesAcross`, which normalises ISO vs dd/mm/yyyy dates and
   mobile digits) and the forms raise the shared modal — "That patient is already registered" — with
   Cancel / "Register anyway". A confirmed duplicate is saved with `attention: true`. Verified:
   override saves and redirects, Cancel keeps the registrar on the form, a genuinely new patient
   saves with no dialog.
4. **Two stale harnesses.** `auth-check.mjs` still created an account with `role: 'cashier'` (removed
   when the roster went from 14 accounts to 11), so `create` refused it and the run crashed on
   `made.account.id`; it now uses `finance` and asserts the restored roster is the seeded 11.
   `acceptance-audit.mjs` asserted "a cashier cannot record a payer decision" against the finance
   account, contradicting `claims-check.mjs` and `claims.js`; it now asserts finance *can* and a
   nurse cannot.

## Verification status

`smoke`, `a11y-check`, `responsive-check`, `buttons`, `roles-check`, `revenue-check`, `charges-check`,
`ledger-check`, `claims-check`, `payroll-check`, `clinical-check`, `finance-check`, `portal-check`,
`auth-check`, `adt-boundary-check`, `acceptance-audit`, `qa-nav-check`, `exhaustive-controls-check`,
`claims-modal-stack-check`, `personnel-add-check`, `m10-1..4-audit`, `qa-final-check` — all green
after the changes. `deployed-check` green against `mediheal-his-complete`.

**Not verified:** the Supabase path (no project credentials yet). Nothing visual was checked against
Figma for the two CSS fixes beyond the 1440 regression measurement.

## Supabase (new)

`supabase/migrations/0001_init.sql`, `assets/js/db.js`, `assets/js/supabase-config.js` (empty by
default), `scripts/supabase-check.mjs`, `docs/SUPABASE.md`.

The adapter sits on `HIS.store`, the single boundary the modules already share: row arrays mirror to
typed tables (`patients`, `invoices`, `ledger_transactions`, `claims`, …) with the whole record in
`data jsonb`, documents mirror to `module_state`, history inserts into append-only `audit_log`.
Identity is Supabase anonymous sign-in; RLS (`owner_id = auth.uid()`) is forced on every table, and
`audit_log` refuses UPDATE and DELETE by trigger. Credentials (`mh_accounts`, session) are in
`LOCAL_ONLY` and never leave the browser. With the config empty the site behaves exactly as before.

## Deployment note

`https://leequor.github.io/mediheal-his/` is an OLD deploy (no `responsive.css`, old logo, the
sign-in bug above). The current site is `https://leequor.github.io/mediheal-his-complete/`. Either
retire the old repository or add a redirect; a link to the old one shows a broken sign-in page.

## Next steps

1. Create the Supabase project, run the migration, paste URL + anon key into
   `assets/js/supabase-config.js`, enable anonymous sign-in, run `scripts/supabase-check.mjs`.
2. Decide the fate of the stale `mediheal-his` deployment.
3. Optional: normalise `module_state` (payroll, attendance) into tables once reporting needs it.
