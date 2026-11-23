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

## Supabase — built, then removed (owner decision, same session)

A migration, a client adapter on `HIS.store`, a config file, a check script and `docs/SUPABASE.md`
were written and committed in `77223c6`, then removed again. The owner's intent is a **session-scoped**
store: records live in the tab, die with the tab, and a new visitor always starts from the seed. That
is what `store.js` already documents as "temporary by design" and what the README lists under
Demonstration behaviour — the layer was solving a problem the project does not have.

Nothing to do here. If persistence is ever wanted, `77223c6` contains the schema (RLS forced per
`owner_id`, append-only `audit_log`, unique idempotency index) and the adapter is a single file that
attaches to `HIS.store`, so it can be restored without touching a module.

## Deployment note

`https://leequor.github.io/mediheal-his/` is an OLD deploy (no `responsive.css`, old logo, the
sign-in bug above). The current site is `https://leequor.github.io/mediheal-his-complete/`. Either
retire the old repository or add a redirect; a link to the old one shows a broken sign-in page.

## Next steps

1. Push this revision after review (the duplicate-chart guard is the user-visible change).
2. Decide the fate of the stale `mediheal-his` deployment.
3. Remaining audit gaps, all at 1440: print/PDF output, export buttons, a second browser,
   long-content stress. Below 1440 is out of scope by owner decision.
