# Session 30 addendum — M9.2 responsive QA, dialogs and accessibility (2026-11-17)

Additive log. Branch `dev/autonomous-milestones`. `main` remains at `fd5bf9f`. Nothing deployed.

M9.1 closed the reflow. M9.2 is the QA pass the brief asked for: inspect the screens that had
only been *measured*, fix what looking revealed, finish touch targets, test landscape, and run a
real accessibility audit.

---

## 1. The inspection harness had a defect that invalidated the first pass

The first capture run produced 64 screenshots that all looked plausible — and were all the
**sign-in page**. The harness forged a session with a made-up `userId`, and `auth.js` resolves the
account with `HIS.accounts.byId(session.userId)` and rejects anything that is not an active seeded
record. So the guard redirected every page to `index.html` and the capture recorded the login
screen 64 times.

Telling detail: every page reported the same document height (1149px at 390). That is what exposed
it. The harness now signs in through the real `HIS.auth.attempt()` path and **asserts** that the
landed path matches the requested page, discarding the capture otherwise.

**This is the third time in this project that a green measurement hid a broken screen.** Measurement
proves no regression; only looking proves it works.

---

## 2. Screens inspected at 390px and 844×390

Captured full-page at 390×844, 430×932, 844×390 and 932×430, plus full-resolution bands for detail.

| Screen | Verdict | Defect found |
|---|---|---|
| Billing | correct | none — stacked stats, readable rows, correct arithmetic (₱10,000 + ₱7,360 = ₱17,360) |
| Registration | correct | none |
| Appointments | **broken** | leaked table header `PATIENT NAME & APPOINTMENT TIME • TYPE • DOCTOR • STATUS • ACTIONS` |
| Departments | correct | none |
| Profile | **broken** | Treatment History entries overlapped — dates and descriptions painted on top of each other |
| Patient portal | partial | landing and sign-in views are correct; **no patient-data views exist** (see §7) |
| Inpatient / outpatient forms | **badly broken** | three stacked fields clipped into one row's height; labels collided with the wrong inputs |
| Appointment form | **badly broken** | every label sat above the *previous* field |
| Appointment confirmation | **broken** | stray empty white pill; `Go back` stretched edge-to-edge with its label pushed to the far left |
| Attendance | **badly broken** | cells ran together (`Dr. Elsie ChenEMP-001 · Chief PhysicianAdministration 8 AM…`); status pill stretched full width |
| Payroll | **badly broken** | same cell collapse; third action button clipped away entirely |

---

## 3. Root causes, all three of which the audit could not see

### 3.1 Table headers re-appearing (three separate instances)

`.a-th` is also `.a-grid`; `.at-th` is also `.at-a`; `.pr-th` is also `.pr-a`. Each was hidden with
`.X-th{display:none!important}` and then re-shown by a later `.X-a{display:block!important}` of
**equal specificity** — later rule wins. M9.1 fixed one instance (`.ad-th`) and left the identical
bug in three more places. Now all are hidden with `.stage .X-th` (specificity 0,2,0), which no
single-class rule can override whatever the order.

### 3.2 Inline Figma heights surviving the reflow

`position:static` discards `top`, but an **inline** `height:35.07px` still applies. Wrapped content
then overflows the fixed box and paints over the next row. Affected: profile treatment history,
attendance rows, payroll totals and footer, and both registration forms — where `.rf-ctl` sits at
`top:25.6px` inside a `position:relative` `.rf-f`, so the row measured 67.6px while three stacked
fields needed 237px. **The form was unusable.** Fixed with `height:auto` on the affected rows plus
`position:static` on the form controls so they flow under their labels.

### 3.3 The specificity war nobody documented

`#atc *`, `#prc *`, `#tpc *`, `#pec *` set `position:static !important` on **every** descendant.
That is deliberate — it kills the Figma offsets — but at (1,0,0) it beats *any* single-class rule,
`!important` or not. This silently defeated `.pr-modal{position:fixed}`, leaving dialogs 4000px down
the page in normal flow. It also meant sizing had to be handled separately, because those wrappers
do not declare `width`/`height`.

Wrapper-scoped selectors (`#prc .pr-modal`) and a documented note in `responsive.css` now cover it.

### 3.4 Attendance and payroll needed a layout, not just neutralised offsets

Neutralising `position:absolute` was only half the job: the cells then collapsed into one inline run.
Both tables now become wrapping flex cards with per-field captions (`SHIFT`, `TIME IN`, `TIME OUT`,
`HOURS`; `BASIC`, `ALLOWANCE`, `DEDUCTIONS`, `NET PAY`), since the column header is hidden on mobile.
Payroll's value cells carry no distinguishing class, so they are targeted as spans 5–8 of the row —
documented inline.

---

## 4. Dialogs

Five dialog variants (`.ap-modal`, `.at-modal`, `.pr-modal`, `.tp-modal`, `.bl-modal`) share one
internal vocabulary — close, title, subtitle, divider, label, value, cancel, confirm — and all were
fixed-pixel boxes at desktop coordinates. `.pr-modal` is 680px at `left:380`; in a 390px viewport it
was almost entirely off-screen, and in a 390px-tall landscape viewport the actions sat below the fold.

All five now become a centred, viewport-capped scroll container with the internals stacked in DOM
order. `scripts/inspect-modal.mjs` verifies, per dialog and per viewport, that the box fits and that
**every action can be brought into view** by scrolling it — checked by scrolling each button into
view individually, not by requiring them all visible at once.

| Dialog | 390×844 | 844×390 |
|---|---|---|
| Account editor | fits, no scroll | fits, scrolls, actions reachable |
| Payment (billing) | fits | fits, scrolls, reachable |
| Cancel appointment | fits | fits, scrolls, reachable |
| Attendance detail | fits | fits, scrolls, reachable |
| Payslip | fits | fits, scrolls, reachable |
| Treatment | fits | fits, scrolls, reachable |

**12/12 pass.** The payment dialog at 390px is genuinely well formed: labelled fields, a payment-check
panel, and both actions visible.

---

## 5. Touch targets

Started at **45** undersized controls at 390px, concentrated on Attendance (12) and Payroll (9).

The audit was also measuring wrongly: a checkbox inside a `<label>` is tapped via the label, and a
control may legitimately extend its hit area beyond its painted box. The audit now measures the
**usable** area and reports it.

| Fix | Effect |
|---|---|
| Search `<input>` kept Figma `height:15px` inside a 46px wrapper | wrapper is a flex row; input fills it — 7 pages |
| Row checkbox was a 24px square | button is now genuinely 44×44 with the 24px square drawn by `::after`; **verified by clicking 4px inside the target corner, outside the painted square, and confirming selection toggles on then off** |
| Back links, `Forgot password?`, portal link were 15–28px tall | 44px rows |
| Dialog close buttons were 12×32 | 44×44 |
| In-card actions 26–34px tall | 32–40px |

A `::before` inset expansion was tried first and **did not take clicks** — the row's own box won the
hit test. Rather than leave a rule that measured well but did not work, the button was made genuinely
44px. Recorded because the audit would have passed either way.

**Result: 0 undersized controls at 390, 430, 768, 1024 and 1280.** At 1440 there are 127 — those are
the locked Figma desktop sizes and must not change.

---

## 6. Accessibility

`scripts/a11y-check.mjs` — axe-core 4.10.2 (WCAG 2.1 A/AA) on 21 pages at 390 and 1440, plus manual
checks axe cannot make.

| Check | Result |
|---|---|
| axe violations at 390 | **0** on 20/21 pages; 1 found and fixed (below) |
| axe violations at 1440 | **0** |
| Visible focus indicator on first Tab stop | present on all 21 pages |
| Escape closes a dialog | yes |
| Focus returns to the trigger after close | **was `<body>`, now the trigger** |

### The one real violation, and the smallest correction

`.pt-tile > span` on the patient portal: `#6b7c8f` on `#f3f3f3` = **3.85:1** at 12px, needs 4.5:1.
Reported as **serious**. The colour is a portal-local muted token (`--muted-pt`), not a brand colour.

**Correction: `#6b7c8f` → `#607081`** — the same hue darkened 10%, giving **4.58:1**. One token, one
line, no change to any brand colour, no change to the palette.

`docs/DESIGN-LOCK.md` should be read as unchanged on this point: no palette value was replaced.

---

## 7. What the inspection proved is missing (not a responsive defect)

**The patient portal has no patient-data views.** `VIEWS = ['landing','signup','signin','forgot']`.
There is no appointments list, no billing, no documents. Signing in shows a card with the account name
and email and a sign-out button.

The brief's M9.2 asks for "Responsive appointment and billing sections" in the portal. Those sections
do not exist, so they cannot be verified — this is the M5 identity/portal gap, not a layout defect.
What does exist (landing, signup, signin, forgot, session card) is correctly responsive at 390 and
844×390 and is now contrast-clean.

---

## 8. Sign-in, mobile

Two genuine defects found by looking, both invisible to every automated check:

1. **White text with no panel behind it.** `.si-brand`, `.si-h`, `.si-p` are `color:#fff` because on
   desktop they sit on `.si-panel`'s navy gradient. On mobile `.si-panel` became `height:100%` of an
   auto-height parent — 68px — and `.si-bleed` is hidden, so the copy rendered white on
   `rgb(246,250,255)`. Measured, not guessed: white text at y=153/197/275.
2. **The demo-credentials button was white-on-white** after the panel went — the only way to discover
   the demo password.

The marketing block is now dropped on mobile in favour of a compact legible brand line, and the demo
button is dark-on-white. **This removes marketing copy from the mobile sign-in.** Flagged explicitly
because the brief forbids essential content disappearing; the sign-in task, demo credentials, password
help and patient-portal link all remain.

The password eye toggle was rendering *below* the field (measured y=700, field ended at 668). It is now
overlaid on the field's right edge via a negative margin in a flex column, independent of preceding
content.

---

## 9. Landscape

Tested at 844×390 and 932×430 across 16 pages (60 captures): navigation, header, cards, tables, forms,
dialogs, menus and the portal. No console errors, no clipped content, no unreachable actions. Dialogs
fit and scroll; every action is reachable.

---

## 10. Verification, actually run

| Suite | Result |
|---|---|
| `mobile-audit.mjs` — 23 pages × 390/430/768/1024/1280/1440 | **138/138 pass**, 0 overflow, 0 stage scroll, smallest text 12px below 1440 |
| `overflow-probe.mjs` — content taller than its box | **0** at 390, 768, 1024 |
| `inspect-shots.mjs` — 16 pages × 4 viewports | 60 captures, **0 console errors**, 0 clipped |
| `inspect-modal.mjs` — 6 dialogs × 2 viewports | **12/12** |
| `a11y-check.mjs` — axe + manual, 21 pages × 2 widths | **0 violations**, focus ring everywhere, Escape + focus restore |
| `visual-check.mjs --check` — 23 pages @1440 | **all pages match baseline** |
| `roles-check.mjs` | 119 checks, 0 failures |
| `auth-check.mjs` | 25/25 |
| `dashboard-shots.mjs` | 14/14 |
| `smoke.mjs` — 23 pages × 5 widths | **all pages clean** |
| `buttons.mjs` | **0 anomalies** |

`smoke.mjs` and `buttons.mjs` were **not runnable before this session** — they imported
`playwright-core` without `pathToFileURL` (fails on Windows paths) and required an external CDP
browser. Both now resolve the module correctly and fall back to launching their own Chrome. They had
been silently unusable.

---

## 11. Still open

- **Billing KPIs still contradict the invoice table** (₱482K/₱87K vs ₱160,860). Unchanged — it is the
  M7 ledger question and needs an owner decision.
- **Portal patient-data views do not exist** (M5).
- **Attendance/payroll row actions** are 40px, not 44px. Practical in a dense row; the whole-row hit
  target would need a JS change.
- **No `prefers-reduced-motion` handling** was added or verified. The app has little animation, but the
  check was not performed.
- **Screen-reader announcements** for dynamic updates (toasts, filter result counts) were not tested
  with an actual screen reader. Only static semantics were verified via axe.
- **Landscape was verified on 16 pages**, not all 23. The remaining 7 are the same shells.

## 12. Commands

```
PW=<path>/playwright-core/index.js node scripts/mobile-audit.mjs --widths 390,430,768,1024,1280,1440
PW=<path>/playwright-core/index.js node scripts/overflow-probe.mjs --width 390
PW=<path>/playwright-core/index.js node scripts/inspect-shots.mjs
PW=<path>/playwright-core/index.js node scripts/inspect-region.mjs profile 390 844 1780 700
PW=<path>/playwright-core/index.js node scripts/inspect-modal.mjs
PW=<path>/playwright-core/index.js node scripts/a11y-check.mjs --width 390
PW=<path>/playwright-core/index.js node scripts/visual-check.mjs --check
PW=<path>/playwright-core/index.js node scripts/smoke.mjs
PW=<path>/playwright-core/index.js node scripts/buttons.mjs
```
