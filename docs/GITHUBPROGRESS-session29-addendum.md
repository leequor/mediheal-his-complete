# Session 29 addendum — mobile usability hotfix (2026-11-17)

Additive log. Branch `dev/autonomous-milestones`. `main` remains at `fd5bf9f`.

## The defect

`fit.js` v3 scaled the fixed 1440px stage with CSS `zoom = width / 1440`. At 390px that is
**0.2708**, so a 16px label painted at 4.3px. Measured on the live build before this change:

| Metric at 390px | Before |
|---|---|
| Smallest rendered text anywhere | **2.6px** |
| Median rendered text | **3.5px** |
| 10th-percentile | **3.0px** |
| Pages with any text below 12px | **18 of 23** |

The previous responsive harness passed because it only checked horizontal overflow. Overflow-free
is not readable.

## The fix

### 1. Zoom removed entirely
`fit.js` v4 no longer scales anything. It now only:
- sets `data-viewport` on `<html>` (phone / mobile / tablet / desktop)
- keeps the sign-in panel filling the window height (780px floor)
- removes any stale floating menu button (the header burger is now in flow and touch-sized)

`?fit=0` is meaningless and ignored.

### 2. `assets/css/responsive.css` — a real responsive layer
Linked on all 23 pages. **Nothing in it applies at ≥1440px**, so the Figma desktop is untouched
(verified: `visual-check.mjs` reports `all pages match baseline`).

Reflowed properly:
| Screen | Treatment |
|---|---|
| Sign in | two columns → single column; full-width fields and button |
| Dashboard | KPI row → auto-fit grid → 2-up on phone; both panels stack; table rows become stacked cards; timeline becomes a plain list |
| Accounts / Audit / Reports | KPI strip reflows; table header hidden; each record becomes a labelled block |
| Module pages (Treatment, Nursing, Consultation, Personnel, Pharmacy, Attendance) | `#tpc`/`#prc`/`#pec` wrappers become flow columns; `.tp-a` blocks stack; cards keep surface, radius and shadow |
| Header | absolute overlay → sticky flex bar; date/separator hidden; profile shows avatar only below 700px (name, role and email stay in the account menu) |

**Interim containment** for Billing, Registration, Appointments, Departments, Profile, Portal and the
two long registration forms: those still place content with fixed 1440px coordinates. Until they are
reflowed, the *stage* is the horizontal scroll container, so the document stays 100% wide and text
keeps its real size instead of being shrunk. This is explicitly a stop-gap, not the finished state.

### 3. Type floor
Every 11px label/meta class across the module stylesheets is lifted to **12px** below 1440px —
no new type size is introduced, since 12px already exists throughout the design (badges, table
heads, helper text).

## Verified

`scripts/mobile-audit.mjs` (new) measures the **actual rendered** size of every visible text node —
declared size × the zoom chain — plus touch-target dimensions.

| Width | Pages failing |
|---|---|
| 1440 | 0 (locked Figma desktop; its 11px labels are design, not defect) |
| 1200 | **0** |
| 1000 | **0** |
| 800 | **0** |
| 390 | **0** |

- **Smallest rendered text anywhere below 1440: 12px** (was 2.6px).
- Median at 390px: **13px** (was 3.5px).
- Desktop regression: `visual-check.mjs --check` → **all 23 pages match baseline**.

## Defects found while doing this

1. `.ad-th{display:none}` was being re-shown by a later `.ac-g{display:block}` rule of equal
   specificity — both `!important`, later won. The grid reset is now scoped to `.ad-tr` only.
2. The header overflowed 390px by 4px: burger + logo + brand + bell + profile text exceeded the
   width. Profile text now hides below 700px; the account menu still carries name, role and email.
3. `.profile small` was set to 9.5px during the first pass — below the floor. Raised to 12px.
4. The audit initially failed every page at 1440 because the design's own 11px labels were counted
   as defects. The floor is now enforced **below** 1440 only; overflow and console errors always fail.

## Honest status

- **Not a full mobile redesign.** Six screens are genuinely reflowed; seven are contained with
  horizontal panning inside the card. The brief's target — stacked, readable layouts everywhere —
  is met for the reflowed screens and **not yet met** for Billing, Registration, Appointments,
  Departments, Profile, Portal and the registration forms.
- Touch targets: 22 controls on Attendance and 19 on Payroll are still under 32px at 390px.
  The audit reports them; they are not yet fixed.
- No accessibility audit (contrast, focus order, screen-reader labels) was performed in this pass.

## Commands

```
PW=<path>/playwright-core/index.js node scripts/mobile-audit.mjs
PW=<path>/playwright-core/index.js node scripts/visual-check.mjs --check
PW=<path>/playwright-core/index.js node scripts/responsive-check.mjs
```

---

## M9.1 — responsive completion (follow-up)

### What changed since the hotfix

The hotfix left seven screens using an interim "stage scrolls horizontally" workaround. Those are now
genuinely reflowed, and the workaround is **gone**: the audit asserts `stage.scrollWidth <= stage.clientWidth`
on every page at every width.

| Screen | Reflow |
|---|---|
| Billing | stats stack (label above value), bill rows become cards, invoice lines become a 2-column grid, totals become flex rows, actions full-width |
| Registration | stat cards stack, `.rrow` grid collapses to blocks, table head hidden |
| Appointments | KPI cards stack, controls wrap, `.a-row` collapses, pagination and icon buttons enlarge to 40px |
| Departments | cards stack, mini-stats become 2-up, tag rows wrap, progress tracks become fluid |
| Profile | identity card stacks, `.pf-row` becomes a flex label/value pair |
| Inpatient / Outpatient forms | `.rf-sec` cards full-width, every `.rf-row` becomes one column, inputs 46px tall, actions full-width |
| Appointment form + confirmation | `.f-*` and `.c-*` fully stacked, dropdowns and buttons full-width |

Also handled: the shared `.dd` dropdown (was fixed at 236px), `#bllist`/`#blinv` 0×0 wrappers,
`#atc` (Attendance's wrapper — previously only `#tpc`/`#prc`/`#pec` were covered), and every
`position:relative` conversion that still honoured its original `left` offset.

### Bugs found by inspecting screenshots (not by the audit)

1. **Inline collapse.** Converting an absolutely positioned `<span>` to `static` makes it *inline*, so
   `Total billed (Aug)` and `₱482K` collapsed onto one line and overlapped. The audit passed — text
   size and overflow were fine. Only the screenshot showed it. Fixed by forcing `display:block` on
   every reflowed card's text children.
2. **Collapsed list.** `#bllist` is a 0×0 positioning wrapper; once its children became static the
   entire bill list collapsed. Fixed by giving it real dimensions.
3. **`position:relative` keeps `left`.** `.bl-search` kept `left:1138px` and sat 1124px off-screen.
   Same class of bug on `.rf-chip` and `.f-in`/`.f-l` (which never received `position:static` at all).

### Verified

| Check | Result |
|---|---|
| `mobile-audit.mjs`, 23 pages × 390/430/768/1024/1280/1440 | **138 / 138 pass** — 0 failures |
| Stage horizontal scroll | **0 pages** (workaround removed) |
| Smallest rendered text below 1440 | **12px** |
| `visual-check.mjs --check` | all 23 pages match baseline (desktop untouched) |
| `roles-check.mjs` | 119 checks, 0 failures |

### Honest status

- **Touch targets are improved but not compliant.** The drawer exit link went 25px → 44px. Dense table
  controls on Attendance and Payroll remain **24px**, not 44px: 44px breaks the row layout. The
  correct fix is making the whole row the hit target, which needs a JS change — **not done**.
  The audit still reports 21 and 18 such controls.
- **Visual inspection covered Billing in detail.** The other reflowed screens were checked by
  measurement and by the audit, not by eye at 390px. Given that the audit missed two real
  layout breaks on Billing, the remaining screens should be inspected the same way before this
  milestone is called finished.
- **No accessibility audit yet** — contrast, focus order, screen-reader labels, reduced motion.
- Landscape mobile (844×390) was not tested.

### Commands

```
PW=<path>/playwright-core/index.js node scripts/mobile-audit.mjs --widths 390,430,768,1024,1280,1440
PW=<path>/playwright-core/index.js node scripts/visual-check.mjs --check
PW=<path>/playwright-core/index.js node scripts/roles-check.mjs
```
