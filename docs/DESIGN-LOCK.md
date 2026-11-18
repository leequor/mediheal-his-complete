# DESIGN-LOCK.md — MediHeal HIS visual contract

**Status:** authoritative for all future work.
**Established:** 2026-11-17, from the live site `https://leequor.github.io/mediheal-his/` and the local `main` checkout at `fd5bf9f`.
**Method:** every value below was read from the **rendered DOM** (`getComputedStyle` over all visible elements on all 20 pages) and cross-checked against the Figma measurements already recorded in `docs/START-HERE.md` §7 and `docs/IMPROVEMENT-PLAN.md` "Design format". Nothing here is invented.

> The Figma file is the origin of truth. This document is the *derived* contract: it records what the
> shipped site actually paints, so any change can be diffed against it. Where a value is an estimate,
> it is marked `ESTIMATED` — matching the convention already used in the CSS comments.

---

## 1. The rule

**The visual identity is locked.** Development improves behaviour, completeness, correctness and
accessibility *underneath* this design. It does not redesign it.

### Allowed
- Fix misalignment, clipping, overflow, broken layout.
- Fix rendering that demonstrably deviates from the recorded values below.
- Add missing functionality using **existing** patterns and tokens.
- Accessibility fixes that do not change the resting appearance (focus rings, ARIA, keyboard paths).
- Responsive behaviour that preserves the visual language.

### Forbidden
- New colours, gradients, fonts, radii, shadows or spacing scales.
- Replacing existing components with generic admin-template components.
- Restyling a page "to look more modern".
- Introducing a second design language for new features.
- Silently "normalising" the known deviations in §9 — those need an owner decision.

### When a decision is unresolved
Preserve the **closest existing pattern**. Do not invent. Mark the value `ESTIMATED` and log it.

---

## 2. Layout skeleton

| Element | Geometry | Source |
|---|---|---|
| Stage | `1440px` fixed width, `min-height:1120px`, centred, `position:relative` | `base.css` |
| Header | `1440x83`, `position:absolute; top:0`, z-index 20 | Figma `header-bar 239:2978` |
| Sidebar drawer | `430px` wide, full height, `position:fixed`, slides from left | Figma `Sidebar 211:1949` |
| Page background | `#f6faff` + `background.jpg` marble, `center/cover`, `z-index:-1` | Figma frame fill |
| Content origin | Stage-local coordinates equal Figma frame-local coordinates (header overlays y 0–83) | — |

### Header slots (absolute, frame-local)
| Slot | x | y | Size |
|---|---|---|---|
| Burger | 31 | 26 | 30x30 |
| Logo | 61 | 9 | 111x77 (`object-fit:contain`) |
| Brand text | 156 | 34 | Lexend 600 19/23.75 `#194182` |
| Date | 983 | 33 | Inter 600 14/17 `#eef2f7` |
| Bell | 1142 | 21 | 40x40 circle `#15405a`, badge 16px `#e0322c` |
| Separator | 1206 | 25 | 1x32 `#2a6487` |
| Profile | 1230 | 20 | h42, avatar 42px `#dff9ff`, name Inter 600 13, role Inter 500 10 uppercase |

### Module-page content pattern (Consultation, Nursing, Treatment, Payroll, Personnel, Attendance, Pharmacy)
- Page title: **Outfit 36px**, at `(68, 115)`, colour `--title`
- Description: **Inter 14px**, at `(68, 166)`, colour `--muted`
- Content lives in a **child wrapper** (`#prc`, `#pec`, `#tpc`, …) — never overwrite `#stage`
- Cards: white, stroke `#c8dcea`, radius 12–16

### Dashboard pattern (distinct)
- Greeting: **Outfit 700 45/56.7**, at `(81, 105)`
- KPI card: `336x160`, radius 12, border `#c8dcea`; icon tile `80x72` radius 24 `#dff0f8`/`#5b8db8`;
  label Inter 500 16 `#5b8db8`; value Inter 700 30 `#1b4e6b`; delta Inter 600 15 `#5b8db8`

### Sign-in pattern (distinct, `index.html`)
- Frame `1440x1024` (height driven by `fit.js`, floor 780)
- Left panel `721px`: `linear-gradient(90deg,#1b4e6b 1%,#3393c9 56.7%,#fafeff 100%)`
- Headline: Lexend 700 40/50 white at `(57, 287)`, width 506
- Sub: Lexend 400 18/22.5 white at `(57, 405)`, width 432
- Right column x `820`, width `422`
- Title: **Outfit 700 36/45.36** `#0f172a` at `(820, 298)`
- Sub: Inter 400 16/19.36 `#6f8890` at `(820, 357)`
- Input: `422x41`, radius 10, border `#8e8e8e`, Inter 400 16
- Button: `422x46`, radius 10, bg `#0f172a`, text `#d6f4fc`, Inter 700 20, at `(820, 680)`

---

## 3. Colour tokens (measured)

Canonical values from `assets/css/tokens.css`:

| Token | Value | Role |
|---|---|---|
| `--bg` | `#f6faff` | Page background |
| `--card` | `#ffffff` | Card / surface |
| `--line` | `#c8dcea` | Card border |
| `--row-line` | `#e3edf3` | Table row divider |
| `--title` | `#15405a` | Page title |
| `--section` | `#1b4e6b` | Section heading / dark accent |
| `--muted` | `#6f8890` | Secondary text |
| `--body` | `#1c2b30` | Body text |
| `--primary` | `#1c6d9c` | Primary action |
| `--navy` | `#15254c` | Sign-out / deep surface |
| `--scrim` | `rgba(11,42,61,.35)` | Modal scrim |
| `--shadow` | `0 4px 14px rgba(0,0,0,.15)` | Card shadow |
| `--header-grad` | `linear-gradient(90deg,#dff9ff 0%,#3393c9 65.9%,#1b4e6b 100%)` | Header |
| `--ok-bg` / `--ok-fg` | `#d8ffd3` / `#084d02` | Positive status |
| `--in-bg` / `--in-fg` | `#ffcba3` / `#a6460a` | In-progress status |
| `--off-bg` / `--off-fg` | `rgba(28,43,48,.16)` / `#1c2b30` | Neutral status |
| `--red-bg` / `--red-fg` | `#ffd6d3` / `#9b1c14` | Critical status |

Additional measured, in-use values not yet tokenised:

| Value | Role | Where |
|---|---|---|
| `#5b8db8` | Table head / KPI accent / meta text | dashboard, billing, registration |
| `#e8f4fb` | Highlight / hover wash | global |
| `#dff0f8` | Icon tile background | KPI cards |
| `#e3edf3` | Divider | tables |
| `#8a97a6`, `#aab4bf`, `#8aa4b6` | Tertiary muted text | tables, footers |
| `#1c506e` → `#5b8db8` | Sidebar gradient (`180deg`, 57% stop) | `.drawer` |
| `#194182` | Header brand text | `.hd .brand` |
| `#e0322c` | Notification badge | `.bell b` |
| `#3a8017` | Schedule timeline dot | dashboard |

### Frequency check (all 20 pages, visible elements)
`rgba(0,0,0,0)` 3778 · `rgb(28,43,48)` 1067 · `rgb(228,242,246)` 954 · `rgb(255,255,255)` 558 ·
`rgb(28,109,156)` 375 · `rgb(111,136,144)` 347 · `rgb(14,42,63)` 226 · `rgb(21,64,90)` 167 ·
`rgb(27,78,107)` 140 · `rgb(91,141,184)` 133

The core token set dominates. The exceptions are listed in §9.

---

## 4. Typography

Three families, three jobs. Do not introduce a fourth.

| Family | Role | Weights used |
|---|---|---|
| **Outfit** | Page titles only | 700 |
| **Lexend** | Section headings, sidebar nav, badges, card titles | 300, 400, 500, 600, 700 |
| **Inter** | Body, tables, labels, buttons, inputs, meta | 400, 500, 600, 700 |

### Measured type scale (by instance count)
| Family | Size | Weight | Line-height | Count | Typical use |
|---|---|---|---|---|---|
| Inter | 14 | 400 | 18.2 | 1107 | Body / table cell |
| Lexend | 23.4 | 500 | 29.25 | 846 | Card heading |
| Inter | 11 | 400 | 13.31 | 323 | Meta under name |
| Inter | 12 | 600 | 14.52 | 150 | Label |
| Inter | 13 | 600 | 15.73 | 131 | Label / pill |
| Inter | 13.5 | 400 | 16.34 | 113 | Table secondary |
| Inter | 13 | 500 | 18.2 | 108 | Meta |
| Inter | 12 | 400 | 14.52 | 99 | Helper |
| Inter | 14 | 600 | 17 | 90 | Button |
| Inter | 13 | 600 | 17.55 | 90 | Table head |
| Inter | 16 | 700 | 20 | 40 | Emphasis |
| Inter | 11.5 | 600 | 23.6 | 40 | Compact chip |

Documented anchors:
- Page title **Outfit 36** at `(68,115)`; dashboard greeting **Outfit 700 45**.
- Section heading **Lexend 500 20/25** (`#000` on cards, `#1b4e6b` in modals).
- Modal title **Lexend 500 18/22.5** `#1b4e6b`; subtitle Inter 12 `#6f8890`.
- Label **Inter 600 12** `#1b4e6b`; body **Inter 13** `#1c2b30`.
- Badge **Lexend 700 12**.

---

## 5. Radii, borders, shadows

| Token | Value | Use |
|---|---|---|
| Radius | `8px` | Inputs, small buttons, dropdown items |
| Radius | `10px` | Buttons, dropdown shell, checkbox |
| Radius | `12px` | KPI cards, tables |
| Radius | `14px` | Large cards, generic modal |
| Radius | `16px` | Panels, drawers |
| Radius | `999px` | Status pills, avatars |
| Border | `1px solid #c8dcea` | Card outline |
| Border | `1px solid #e3edf3` | Row divider |
| Border | `1px solid rgba(0,0,0,.3)` | Dropdown shell (Figma) |
| Shadow (card) | `0 4px 14px rgba(0,0,0,.15)` | `--shadow` |
| Shadow (inset ring) | `inset 0 0 0 1px #c8dcea` | Cards drawn with box-shadow |
| Shadow (elevated) | `0 4px 16px rgba(27,78,107,.06)` | Panels |
| Shadow (modal) | `0 20px 50px rgba(15,30,46,.25)` | `ESTIMATED` — Figma does not expose it |

---

## 6. Components

### Status badge — `.badge` (Figma `mh-badge`)
`inline-flex`, height `30px`, `min-width:93px`, padding `0 14px`, radius `999px`,
**Lexend 700 12/15**. Variants: `.ok` `.in` `.off` `.red` (§3 colours).
**Always pair colour with a text label** — colour alone is not the signal.

### Dropdown — `.dd` (Figma dropdown frames)
Shell `236x45`, items `38px` high, radius `10px`, border `rgba(0,0,0,.3)`, Inter 500 14.
`.dd.light` variant is the neutral/slate form (see §9).

### Modal — `.modal` / `.modal-bg`
Scrim `rgba(11,42,61,.35)`, card `460px` radius 14, padding 24, `--shadow`.
Actions right-aligned, gap 10. `.mbtn` height 40 radius 10; `.mbtn.out` is the outline variant.

### Figma action-modal geometry (`HIS.kit.GEOM`) — use this for new modals
- Modal `680` wide, left edge `380`
- Shells: **664** (banner 366, textarea 484, buttons 600), **568** (textarea 388, buttons 504), **368** (textarea 388, buttons 300)
- Label rows y `120 / 202 / 284 / 366` → inputs y `142 / 224 / 306 / 388`
- Columns: left `32`, right `348`; widths `300` / `616`
- Buttons: Cancel `100 @396`, OK `140 @508`

### Toast — `.kit-toast`
Fixed, centred, bottom 32, `#15405a`, radius 10, `role="status"`, `aria-live="polite"`.

### Table
Header row: Inter 600 13 `#5b8db8` (or `#64748b` on Appointments — §9). Row divider `#e3edf3`,
row height `90–94px`. Cell primary Inter 700/600 14 `#1c2b30`; secondary Inter 400 11 `#6f8890`.

---

## 7. Page inventory (20 pages)

| Page | Baseline file | Body height @1440 | Notes |
|---|---|---|---|
| `index.html` | `baseline__index__1440.png` | 900 | Sign-in, 2-column |
| `dashboard.html` | `baseline__dashboard__1440.png` | 1120 | Greeting + 4 KPI + 2 panels |
| `registration.html` | `baseline__registration__1440.png` | 1120 | Stats + table |
| `registration-form.html` | `baseline__registration-form__1440.png` | 2789 | Long form |
| `appointments.html` | `baseline__appointments__1440.png` | 1120 | §9 palette |
| `appointment-form.html` | `baseline__appointment-form__1440.png` | 1120 | Form |
| `appointment-confirmed.html` | `baseline__appointment-confirmed__1440.png` | 1120 | Confirmation |
| `outpatient-form.html` | `baseline__outpatient-form__1440.png` | 2676 | Long form |
| `profile.html` | `baseline__profile__1440.png` | 1332 | §9 palette |
| `departments.html` | `baseline__departments__1440.png` | 1420 | List + details |
| `consultation.html` | `baseline__consultation__1440.png` | 1262 | Module |
| `treatment.html` | `baseline__treatment__1440.png` | 1262 | Module |
| `nursing.html` | `baseline__nursing__1440.png` | 1262 | Module |
| `billing.html` | `baseline__billing__1440.png` | 1120 | KPI + list + invoice |
| `payroll.html` | `baseline__payroll__1440.png` | 1345 | Module |
| `personnel.html` | `baseline__personnel__1440.png` | 1262 | Module |
| `attendance.html` | `baseline__attendance__1440.png` | 1635 | Module |
| `portal.html` | `baseline__portal__1440.png` | 900 | Patient portal (addition) |
| `pharmacy.html` | `baseline__pharmacy__1440.png` | 1262 | Redirects to `treatment.html?modal=pharmacy` |
| `staff.html` | `baseline__staff__1440.png` | 1262 | Redirects to `personnel.html` |

All 20 render with **0 console errors** at 1440px and **0 horizontal overflow**.
Baseline set: `qa/baseline/` (workspace, not committed — 9 MB). Regenerate with `qa/capture.mjs`.

---

## 8. Responsive behaviour (current, as-found)

`assets/js/fit.js` scales the fixed 1440px stage with CSS `zoom = viewportWidth / 1440`
(no effect at ≥1440px; `?fit=0` disables it). The drawer is additionally zoomed when the window is
narrower than 430px, and a fixed 44px menu button appears below `0.7` scale.

**Consequence:** at 390px the effective scale is `0.27`, so 14px body text renders at ~3.8px.
This is not a real mobile layout — it is a scaled-down desktop. Recorded in §9 as a known gap;
the improvement plan already flags it as blocked on mobile Figma frames.

---

## 9. Known deviations — recorded, NOT auto-fixed

These are real inconsistencies found by measurement. They are **documented, not silently changed**,
because the Figma file is not reachable from this environment and a unilateral restyle would violate
the design lock. Each needs an owner decision.

### 9.1 Appointments uses a second palette (Tailwind slate/emerald set)
`assets/css/pages.css` (`Appointments` block) and `assets/css/components.css` `.dd.light`:

| Appointments value | Core token equivalent | Delta |
|---|---|---|
| `#1e293b` text | `#1c2b30` | Δ ~6 RGB |
| `#64748b` muted | `#6f8890` | Δ ~10 RGB |
| `#e2e8f0` border | `#c8dcea` | visible |
| `#f8fafc` table head | `#e8f4fb` | visible |
| `#f1f5f9` hover | `#e8f4fb` | visible |
| `#94a3b8` placeholder | `#8a97a6` | Δ ~6 RGB |
| `.a-pill` `#e6fdf4`/`#10b981`, `#dbeafe`/`#3b82f6`, `#fee2e2`/`#ef4444`, `#fef3c7`/`#f59e0b` | `.badge` `.ok` `.in` `.red` `.off` | **different component**: 24px vs 30px tall, Inter 13 vs Lexend 12, saturated vs pastel |

**Impact:** the Appointments status pills look materially different from every other page's badges.
**Recommendation:** confirm against Figma `23:2289`. If the Figma frame uses `mh-badge`, migrate
`.a-pill` → `.badge`. Do not do this blind.

### 9.2 Profile uses a third palette
`assets/css/profile.css`: `#1f2937` text, `#e6e9ee` borders, plus fractional type sizes
(`17.744px`, `12.525px`, `8.35px` radius) that suggest a differently-scaled Figma export.
**Impact:** low (colours are visually close); the fractional sizes are the real smell.
**Recommendation:** confirm the export scale before touching.

### 9.3 Sign-in dark values
`#0f172a` for the sign-in title and button background, where `--navy` is `#15254c`.
**Impact:** low. Both read as deep navy. Recorded for completeness.

### 9.4 Scale-based responsiveness
See §8. Text below ~11px effective size at 390px. Blocked on mobile Figma frames.

### 9.5 Deliberate estimates already logged in code
`#4f9a2b` (active dot, `personnel.css` / `treatment.css`), modal shadow, hover colours,
`Inactive` badge colours. These are **known ESTIMATED** values, not drift — leave them.

---

## 10. Adding a new screen or state

1. Reuse the tokens in §3 and the type scale in §4. No new values.
2. Reuse a shell: module-page pattern (§2) or action modal (§6).
3. Keep the stage-local coordinate system; the header overlays `y 0–83`.
4. Put page content in a child wrapper, never replace `#stage`.
5. Flag every addition in code: `// Addition (not in Figma) - <reason>`.
6. Log it in the session addendum with the geometry used.
7. Verify: 0 console errors, no overflow at 1440/1200/1000/800/390, and a visual diff against
   the baseline that shows **only the intended region changed**.

---

## 11. Verification contract

Any change ships only when all of these hold:

- [ ] `node scripts/visual-check.mjs --check` → no page exceeds the diff threshold.
- [ ] `qa/capture.mjs` (or `smoke.mjs`) → 0 console errors on all pages.
- [ ] No horizontal overflow at 1440, 1200, 1000, 800, 390.
- [ ] Visual diff vs `qa/baseline/` shows changes confined to the intended pages/regions.
- [ ] Existing flows still pass (sign-in, registration, appointment, billing, payroll sync).
- [ ] No new `mh_*` keys left behind by tests.
- [ ] Keyboard: every new control reachable, Escape closes overlays, focus returns to trigger.
- [ ] Colour is never the only carrier of meaning.

### Reading the harness output honestly

The diff runs with a per-channel tolerance of **12/255** and fails a page above **0.05%** differing
pixels. Both defaults exist because text antialiasing varies slightly between browser launches:

- A repeat capture of an unchanged page can differ by ~0.1% of pixels at deltas up to ~100/255,
  scattered across glyph edges. Measured example: `staff.html` old-vs-new = 2085 px (0.11%), max
  delta 102, **zero** pixels ≥128, images visually indistinguishable. That is renderer noise.
- **A real layout change looks different**: large contiguous regions with deltas near 255.
  Check the reported bounding box, not just the percentage.
- PNG bytes are not a reliable identity check across sessions — the same pixels can encode to
  different bytes. `baseline-manifest-1440.json` stores a `sha256` for reference, but the
  **pixel diff is authoritative**, not the hash.

---

## 12. Responsive layer and the decisions it forced (M9.2)

`assets/css/responsive.css` is **the only stylesheet allowed to override the Figma geometry**, and
nothing in it applies at ≥1440px. It is appended to in dated sections rather than rewritten, so the
reasoning behind each override stays next to it.

### The two places a colour value changed

Both are documented here because §1 of this document forbids substituting the palette.

| Location | From | To | Why |
|---|---|---|---|
| `--muted-pt` (portal local token) | `#6b7c8f` | `#607081` | 3.85:1 on `#f3f3f3` at 12px; needs 4.5:1. Same hue, 10% darker, now 4.58:1. Reported **serious** by axe. |
| Mobile sign-in brand text | `#fff` (on a panel that no longer exists below 1440) | `#1b4e6b` | White on `rgb(246,250,255)` is unreadable. `#1b4e6b` is the existing `--section` token. |

No brand colour, gradient or component surface was replaced.

### Deliberate mobile omissions

- **Sign-in marketing block** (`.si-h`, `.si-p`, `.si-ft`, `.si-fd`). The feature list was already
  hidden below 1440 in M9.1; the headline and paragraph followed in M9.2 because they were white text
  with no panel behind them. A compact brand line replaces them. Sign-in, demo credentials, password
  help and the patient-portal link all remain.
- **Table column headers** below 1440. Each row carries its own captions instead (`SHIFT`, `TIME IN`,
  `BASIC`, `NET PAY`, …), because a header that scrolls away is worse than a label on every row.

### Specificity rules to know before editing

1. `#tpc *`, `#prc *`, `#pec *`, `#atc *` set `position:static !important` on every descendant. At
   (1,0,0) this beats **any** single-class rule regardless of `!important`. Override with a
   wrapper-scoped selector (`#prc .pr-modal`), not another single class.
2. Never hide a header with `.X-th{display:none}` and then add a later `.X-a{display:block}` — if the
   element carries both classes the later rule wins. Hide with `.stage .X-th` instead. This exact bug
   shipped three times.
3. `position:static` discards `top` but **not** an inline `height`. Rows that carry inline Figma
   heights must also get `height:auto`.
4. Converting an absolutely positioned `<span>` to `static` makes it **inline** — label and value
   collapse onto one line. Force `display:block` on reflowed card children.

### Verification contract, extended

- [ ] `mobile-audit.mjs` → 0 failures, 0 undersized targets below 1440.
- [ ] `overflow-probe.mjs` → 0 elements whose content exceeds their box.
- [ ] `inspect-shots.mjs` → 0 console errors; **screenshots actually looked at**.
- [ ] `inspect-modal.mjs` → every dialog fits and every action is reachable.
- [ ] `a11y-check.mjs` → 0 axe violations, focus ring present, Escape closes, focus restored.
- [ ] `visual-check.mjs --check` → all pages match baseline.

**The last one is necessary but never sufficient.** Three separate defects in this project passed every
automated check and were only found by looking at a screenshot. Measurement proves no regression;
inspection proves it works.

---

## 13. M10 — additions on the Payroll screen, and one baseline re-capture

Two changes touch a Figma screen. Both are recorded here because §10 requires an addition to be
written down, not because the visual language moved.

### 13.1 The footer status link

`payroll.html` gains one element in the register footer, at (250, 26):

> Timesheets · 8 of 8 approved →

It is a text button using the existing `.pr-meth` size and the existing `--primary` link colour
(`#1c6d9c`), with no new background, border or icon. It opens the timesheet review dialog. Before
M10 the footer said "Absences without approved leave are deducted in Payroll" and nothing was
actually deducted; the link replaces a claim the screen could not keep with a control that works.

Nothing else on the page moved: same card at (68,207), same KPI strip at y=331, same register, same
columns, same 64px rows.

### 13.2 Dialog heights

The payslip and timesheet dialogs are taller than the Figma overlay frames (748px against 568px)
because a payslip now itemises every earning and deduction instead of printing one line of
"deduction breakdown". Width, radius, stroke, title size, field style and button geometry are
unchanged. Dialogs are overlays, not the locked page; the 1440×1345 page geometry is untouched.

While doing this, `.pr-modal` and `.pr-scrim` moved from `position:absolute` to `position:fixed`.
They were absolutely positioned inside the 1345px stage, so a dialog opened from the footer scrolled
the page and rendered off-screen. Fixed positioning keeps the overlay in the viewport; at scroll 0
the dialogs land on the same pixels as before.

### 13.3 Baseline re-capture

`qa/baseline/payroll__1440.png` was re-captured. The diff was 2.145% inside the KPI and table region
and is a **data** correction, not a layout change: M8 printed the monthly salary in a column headed
"BASIC SALARY" for a semi-monthly period. The column now shows the amount actually earned in the
period (₱30,000 for a ₱60,000 monthly salary). Same columns, same widths, same row heights.

Every other page matches its baseline at 0.000%.

---

## 14. M10.1 — correction and wage-floor overlays

No page geometry changed. The only visual additions are inside the existing Payroll dialog and the
Claims screen, and every one uses an existing class or an existing token value.

| Addition | Where | Styling |
|---|---|---|
| Wage-floor note | `Process payments` dialog, below the run status | `.pr-slip-note`, the same 11.5px muted text used elsewhere in that dialog |
| Correction runs block | `Process payments` dialog, only when the run is released | `.pr-sect` heading in the existing 12px uppercase label style, `.pr-corr-row` on the existing 12.5px body size |
| Correction detail | new overlay, 680px wide, height `300 + 52 × employees` capped at 560 | `.pr-corr-line`, `.pr-corr-due` (`#1c6d9c`), `.pr-corr-rec` (`#a6460a`, already used by the attendance warning) |
| Reason field | correction form | `.pr-fld`, same border, radius and background as `.pr-m-i` |

At 1366 the M9.2 responsive layer reflows both dialogs to 520px and stacks the internals, exactly as
it does for the payslip and timesheet dialogs. Verified at both widths: no clipping, no horizontal
overflow, no console errors.

The correction detail dialog sizes to its content (`300 + 52 × employees`, capped at 560) rather
than using one fixed height, because a one-line correction in a 560px box looked like an error.

---

## 15. M12 — Admissions and Charges, and two intended changes to existing pages

### 15.1 Three new screens (additions, not in Figma)

`admissions.html`, `charges.html` and `settings.html` have no Figma frame. They use the admin pattern established in
M2 and reused by Claims in M10 — nothing new is introduced:

| Element | Reused from |
|---|---|
| Title / description | `.ad-title` Outfit 700 36/45 at (68,115); `.ad-sub` Inter 400 14/20 at (68,166) |
| KPI strip | `.ad-kpis` / `.ad-kpi`, 4 × 1fr, 24px gap, radius 14, border `--line` |
| Card + toolbar + table | `.ad-card`, `.ad-bar`, `.ad-search`, `.ad-sel`, `.ad-btn`, `.ad-th` / `.ad-tr`, `.ad-foot`, `.ad-note` |
| Action modal | `.ac-bg` / `.ac-m` 620px, `.ac-f`, `.ac-row`, `.ac-err`, `.ac-a` — the same shell as the Accounts editor and the Laboratory dialogs |
| Queue switch | `.ad-seg`, added in M6 for the Pharmacy tabs |

New rules, all composed from existing tokens (no new colour, radius, shadow or type size):

| Rule | Purpose | Values |
|---|---|---|
| `.ad-g-adm`, `.ad-g-chg`, `.ad-g-enc`, `.ad-g-cfg` | grid tracks for the four new tables | existing `--line` row separators, existing 11px uppercase headers |
| `.bd-grid` | bed board | `repeat(auto-fill,minmax(102px,1fr))`, 10px gap, 18/20px padding |
| `.bd-bed` | one bed tile | 64px tall, radius 10, border `--line`, 13px label + 11px meta — the same two-line shape as `.ad-who` |
| `.bd-bed.occupied` | occupied | `#e8f4fb` on `#9cc4dd`, the existing in-use tint from `.ad-btn:hover` |
| `.bd-bed.cleaning` | cleaning | `#fff6ee` on `#f0c2a0`, the existing `--in-fg` family |
| `.bd-bed.maintenance` | maintenance | `#f3f5f7` on `#d6dde3`, neutral |
| `.bd-legend`, `.bd-dot` | state key | 10px swatches, same fills |
| `.ad-sum` | money strip inside a modal | `#f6fafd` on `#e3edf3`, the `.ad-note` treatment |

Colour is never the only carrier of state: every tile also prints its state or its occupant, and the
legend spells the states out.

### 15.2 Intended change — Laboratory row actions

Cancelling an order is a real capability with a billing consequence, so every non-validated row now
carries a second, ghost-styled action. The action column was widened from 134px to 232px and the Test
column narrowed to keep every row on one line.

Measured diff against the pre-M12 baseline: **4.744%, 16,173 pixels ≥128, bounding box
(187,560) 1164×408** — the table body only. No other region moved.

### 15.3 Intended change — Reports

Reports gained a second KPI strip (unbilled charges, beds occupied, beds available, active
admissions) and a "Unbilled charges by source" card, because the page previously reported revenue
without reporting revenue that had not reached a bill. Everything below the first strip therefore
moved down.

Measured diff against the pre-M12 baseline: **34.746%, bounding box (0,170) 1440×1353**. The page is
an addition (there is no Figma frame for Reports), so this is a content change, not a design change.

### 15.4 Baselines

Re-captured for all 28 pages at 1440 and, for the first time, at 1366. Every other page measured
**0.000%** against its pre-M12 baseline before the re-capture, so no existing page moved.

### 15.5 Known limitation, shared with every admin table

Below 1440px the responsive layer turns `.ad-tr` into a stacked block with no field captions. This
applies identically to Laboratory, Pharmacy, Claims, Accounts, Audit, Reports, Admissions and
Charges. The desktop layout is the design contract; adding per-field captions to one table and not
the others would be a new inconsistency, so it is recorded here rather than half-fixed.

### 15.6 Closeout — the two baselines, and how to read a "0.000%" claim

There are now two baselines, and a diff percentage means nothing without saying which one it is
against.

1. **`qa/baseline`** — the M12 state. All 28 pages match it at 1440 and 1366, which proves the
   closeout changed nothing beyond the Configuration copy it re-captured on purpose.
2. **The pre-M12 state**, regenerated on demand from `43cbf84`:

   ```
   git worktree add ../m12-original 43cbf84
   cd ../m12-original && PW=… node scripts/visual-check.mjs --capture --out qa/base-orig
   cd ../m12-original && PW=… node scripts/visual-check.mjs --width 1366 --capture --out qa/base-orig
   cd - && PW=… node scripts/visual-check.mjs --check --out ../m12-original/qa/base-orig
   ```

   Note `--out`, not `--baseline`: in check mode the harness reads the images from `OUT`.

Against the pre-M12 baseline, exactly two pre-existing pages differ, at both widths:

| Page | 1440 | 1366 |
|---|---|---|
| Laboratory | 4.744% · 16,173 px ≥128 | 1.741% · 10,657 px ≥128 |
| Reports | 34.746% · 602,238 px ≥128 | 28.383% · 638,332 px ≥128 |

Both are the additions recorded in §15.2 and §15.3. The other 22 pre-existing pages are 0.000% at
both widths. **Do not describe this milestone as "no visual change":** two pages changed by design,
and three pages (`admissions`, `charges`, `settings`) did not exist in the original.

---

## 16. Presentation polish — copy, not design

A pass over every screen removed wording that exposed the build: milestone labels on invoice lines,
source paths on the Configuration screen, "Figma" in tooltips and invoice fallbacks, a developer note
in the appointment dialog's subtitle, and "demo / synthetic / seeded" throughout. The full list is in
`PROJECT-STATUS.md` §2 "Presentation and copy".

**No design value changed.** No colour, type size, radius, shadow, spacing token or component was
altered. The two label changes are text-only:

| Change | Where | Why |
|---|---|---|
| Navigation "Staff" → "Attendance" | Drawer, all roles that can open it | The page heading and title already said Attendance; nav and page now agree |
| `staff.html` title "Staff – MediHeal HIS" → "Staff · MediHeal" | Document title | Matches every other page's separator and product name |

### 16.1 What the copy changes did to the pixels

Measured against the pre-polish M12 baseline, at **both** widths, 11 pages differ and every one is a
text change:

| Page | 1440 | 1366 | Nature |
|---|---|---|---|
| accounts | 0.989% | 0.319% | Subtitle and note |
| admissions | 0.717% | 1.567% | Note |
| audit | 1.450% | 1.756% | Subtitle, button label, note, empty state |
| billing | 0.389% | 0.222% | Invoice line-item descriptions |
| charges | 0.702% | 0.480% | Note |
| claims | 0.194% | 0.119% | Subtitle |
| dashboard | 0.253% | 0.109% | Accounts KPI and panel copy |
| index | 0.132% | 1.007% | Sign-in help and sample-accounts panel |
| laboratory | 0.792% | 0.391% | Note and report copy |
| pharmacy | 0.660% | 0.482% | Note |
| settings | 4.414% | 2.049% | Subtitle, headings, read-only descriptions, note |

Layout was verified separately by comparing page heights: at 1440 only `accounts` (−1px) and
`settings` (−37px) changed total height, and at 1366 only `admissions` (−16px) and `settings` (−32px).
All four are flow-layout reflows from shorter or longer copy, with zero horizontal overflow on any
page at either width. Every other page is pixel-identical in height.

### 16.2 Against the original pre-M12 baseline

Nine pre-existing pages now differ from the original design, and the distinction matters:

- **Two by design** — Laboratory (the Cancel action, §15.2) and Reports (the added KPI strip and
  unbilled card, §15.3).
- **Seven by copy only** — Accounts, Audit, Billing, Claims, Dashboard, Index, Pharmacy. These were
  0.000% at the M12 closeout; the polish pass changed their wording, so they now differ from the
  original by the text alone. Page height is identical to the original on 23 of the 25 pre-existing
  pages at 1440, and on 23 of 25 at 1366 (Laboratory is +2px at 1366 from the added action button).

Do not read "all pages match baseline" as "nothing changed since the original". It means the current
build matches the baseline captured *for this build*.

---

## 17. Final QA pass — what moved, and what only looks as if it moved

No design token, type size, radius, shadow or component was changed. Three pages differ from the
pre-pass baseline, all for reasons a visitor can see:

| Page | 1440 | 1366 | Cause |
|---|---|---|---|
| Admissions | 11.692% | 17.379% | The bed board is capped to two visible rows and scrolls. A 40-bed ward used to push the admission records and every action below the fold. |
| Appointments | 0.462% | 1.978% | KPI values now count the records, and the fifth card reads **Completed** instead of a walk-in count the data cannot support. |
| Settings | 0.146% | — | One note sentence reworded. |
| Audit | — | 0.126% | Header identity and the bell's real unread count. |

### 17.1 Two changes the harness cannot see

The diff metric counts pixels whose channel delta is ≥128. Two intended changes sit below that:

1. **The header avatar.** Every page now draws initials on a tint keyed to the account, replacing one
   photograph that every account shared. The tint differs by less than 128 per channel, so the sweep
   reports 0.000% on 24 pages that did in fact change. Compared by SHA-256, **only `index` is
   byte-identical** at both widths; the other 27 differ, and page height is unchanged at 1440 on all
   28 pages. Do not read "all pages match baseline" as "the header is untouched".
2. **The bed field on the registration form.** A text input became a dependent select. Placeholder
   grey and label grey are close enough that the sweep does not flag it.

### 17.2 Dialog placement, stated as a rule

Every action dialog (`.ap-modal`, `.pr-modal`, `.tp-modal`) is now positioned with
`top:50%; transform: translateY(-50%)` and `max-height: calc(100dvh - 24px); overflow-y:auto`.
The Figma frames place each dialog at a fixed `y` on a 1024-tall canvas; at a 768-tall desktop window
that put the primary action — Generate payslips, Assign bed, Confirm reschedule — outside the
viewport, where it could not be clicked. Width, radius, stroke and every inner coordinate are
unchanged. This is the only geometry change in the pass and it exists to make a control reachable.

### 17.3 The avatar

`.av-d` is a 42px disc carrying two initials, sized 38px and 36px by the two existing responsive
breakpoints. Six tints, chosen by hashing the account email, so one person keeps one colour and no two
accounts share a face. Colour is never the only signal: the initials themselves identify the person,
and the disc carries an `aria-label` with the full name.

### 17.4 Two baselines, both kept

A baseline that is only ever overwritten cannot prove anything. Both states are now preserved:

| Baseline | Where | State |
|---|---|---|
| **Previous, accepted** | `qa/baseline-previous/baseline-manifest-1440.json` and `-1366.json` | commit `69c9a63`, the build accepted before this pass |
| **Current, approved** | `qa/baseline/baseline-manifest-1440.json` and `-1366.json` | `c7ec7ce`, the build this pass ends on |

Both manifests are committed. The PNGs are not — they are ~9 MB each — so each set is regenerated on
demand, and the manifest hash tells you whether the images you regenerated are the ones that were
reviewed:

```
# previous accepted baseline
git worktree add ../qa-prev 69c9a63
cd ../qa-prev && PW=… node scripts/visual-check.mjs --capture --out qa/prev
cd ../qa-prev && PW=… node scripts/visual-check.mjs --width 1366 --capture --out qa/prev

# diff the current build against it
cd - && PW=… node scripts/visual-check.mjs --check --out ../qa-prev/qa/prev
cd - && PW=… node scripts/visual-check.mjs --width 1366 --check --out ../qa-prev/qa/prev

# current approved baseline
PW=… node scripts/visual-check.mjs --capture
PW=… node scripts/visual-check.mjs --width 1366 --capture
```

Note `--out`, not `--baseline`: in check mode the harness reads the images from `OUT`.

**The intentional differences, complete:** Admissions (bed board capped to two visible rows),
Appointments (KPI values counted from the records, fifth card relabelled Completed), Settings (one
reworded note), and Audit at 1366 only (header identity and the bell's real unread count). Everything
else is 0.000% at both widths, and the two sub-threshold changes in 17.1 are listed there so they are
not mistaken for regressions later.

---

## 18. Final pass — avatar centring and deep-link arrival

Two additions, both shared components. No colour, size, radius, shadow or spacing token changed.

### 18.1 The avatar is centred on the ink, not on the line box

`.av-d` keeps its 42 / 38 / 36 px sizes and its six tints. What changed is how the letters sit inside
the disc:

| Property | Before | After | Why |
|---|---|---|---|
| `line-height` | `1` (from the font shorthand) | **the disc height**, set inline next to the size | A line box equal to the font size puts the baseline high, so the glyphs ride up. Filling the disc with the line box centres the cap height. |
| `letter-spacing` | `.02em` | `0` | Tracking is added after the last letter, which shifts a two-letter pair about 1 px left. |
| `display` | `inline-grid` | `flex` + `align-items/justify-content: center` | Same centring, and it composes with `box-sizing: border-box`, `white-space: nowrap` and `overflow: hidden`. |

The offset is measured from rendered pixels, not from the CSS: `qa-nav-check.mjs` screenshots each
disc, decodes it to a canvas and compares the ink centroid with the centre. Four accounts × two sizes,
tolerance 1.5 CSS px.

### 18.2 Arriving at a record

`.dl-hit` is a temporary outline plus a fading flash, applied to the row a notification pointed at.
It is the only new visual state in this pass and it disappears after 2.4 s; nothing else on the page
moves. `.dl-tip` is the fallback notice when a record is no longer present.

Because the flash is a background tint and the outline is 2 px of `#1c6d9c`, the sweep still reports
0.000% — the row is only highlighted after a notification click, which the baseline capture never
performs. That is stated here so a future reader does not treat the highlight as a regression.
