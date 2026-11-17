# Session 27 addendum — design lock, visual baseline, role-based POVs (2026-11-17)

Additive log. Nothing in earlier addenda or `GITHUBPROGRESS.md` was changed.

Work is on branch **`dev/autonomous-milestones`**, not `main`. `main` is untouched at `fd5bf9f`.

## Owner request

Comprehensive development of the HIS under a hard design-preservation rule: capture a visual
baseline of every page first, never invent a new visual identity, work in independently verifiable
milestones on a separate branch, and verify each milestone with tests and screenshots before
documenting actual results.

---

## M0 — Design lock + visual baseline (`72dceba`)

### What was done

1. **Baseline captured before any change.** All 20 pages at 1440px, full-page, from a clean clone of
   `main` served locally. Stored in `qa/baseline/` (9 MB, gitignored).
2. **`docs/DESIGN-LOCK.md`** written from measurement, not memory:
   - Extracted computed styles for every visible element on all 20 pages
     (`getComputedStyle` sweep: colour, background, border, radius, shadow, font stack/size/weight/line-height).
   - Recorded the layout skeleton, colour tokens, measured type scale (by instance count), radii,
     shadows, component geometry, page inventory and the responsive model.
   - Cross-checked against the Figma values already logged in `START-HERE.md` §7 and
     `IMPROVEMENT-PLAN.md` "Design format".
3. **`scripts/visual-check.mjs`** — capture + pixel-diff harness. Diffs on a canvas inside the
   browser, so there is no image-processing dependency beyond `playwright-core`. Reports per page the
   percentage of pixels changed and the bounding box of the change.
4. **`AGENTS.md`** — `DESIGN-LOCK.md` added to the read order as the visual contract.

### Verified

- 20 pages @1440: **0 console errors**, 0 horizontal overflow.
- Two consecutive capture runs diff at **0.000% on all 20 pages** → the harness is deterministic, so a
  later non-zero diff is a real change and not noise.
- **No page markup, CSS or JS was modified in M0.** The only changes are new files plus `AGENTS.md`.

### Known design deviations found and deliberately NOT changed

Recorded in `DESIGN-LOCK.md` §9. Summary: the site carries **three palettes** — the core tokens,
a Tailwind slate/emerald set on Appointments (`pages.css`, `.a-pill`), and a Tailwind gray set on
Profile (`profile.css`, with fractional type sizes suggesting a different Figma export scale).
Sign-in uses `#0f172a` where `--navy` is `#15254c`.

These were **not** normalised: the Figma file is not reachable from this environment, the visual
deltas are small, and mass-recolouring 40+ declarations without a reference would be exactly the
"improvement" the owner prohibited. They need an owner decision against the Figma frames.

---

## M1 — Role-based POV foundation (`assets/js/rbac.js`)

### The gap

Session 23 recorded the owner's question — *"does each login have its own POV (user/admin)?"* — and
the answer was **no**: one hardcoded identity (`Dr. Elsie Chen`), one flat 12-link nav, every page
URL-reachable by anyone. That was the largest structural gap against the brief.

### What was done

1. **`assets/js/rbac.js`** — a 14-role registry (Super Admin, Hospital Administrator, Receptionist,
   Registration & Admissions, Doctor, Nurse, Pharmacist, Laboratory, Cashier, Finance, HR,
   Department Head, Auditor, Patient). Each role carries a demo persona, a one-line scope, an allowed
   page-stem list, an ordered nav list and a home page. The nav metadata moved here from `shell.js`
   so one file owns the whole navigation model.
2. **Page guard** — `HIS.rbac.guard()` runs at the top of `mountShell()`, before anything renders.
   An out-of-scope page redirects to the role's home instead of rendering.
3. **Role-scoped drawer** — the sidebar renders `HIS.rbac.nav()` instead of the hardcoded array.
4. **Role switcher** — opens from the **existing header profile block**, so no new element is added
   to the locked header: the profile already displays the name and role it switches between. Panel
   follows the design format (white card r14, 1px `#c8dcea` ring, Lexend 16 title, Inter 13 rows,
   `#e8f4fb` hover, 3px `#1c6d9c` active bar). Keyboard: Enter/Space opens, Escape closes, focus
   returns to the trigger. The panel footer carries the **"Demo environment · synthetic data only"**
   label.
5. **Audit** — every role switch appends to `HIS.audit` with `before`/`after` role keys.
   `audit.js` now takes its default identity from the active role, falling back to `HIS.user`.
6. **`mh_role`** added to `HIS.store.KEY`; absent means `superadmin`, so a browser that has never
   used the switcher keeps the original single-identity behaviour.

### Why the resting appearance is unchanged

The default role is `superadmin`, whose demo persona is **Dr. Elsie Chen / Chief Physician** — the
exact identity the header rendered before this module existed, and whose nav list is all 12 links in
the original order. Making `.profile` interactive adds `cursor:pointer` and a focus ring only; no
element, size or position changes.

### Verified

- `scripts/visual-check.mjs --check` → **0.000% on all 20 pages**. The RBAC layer is invisible at rest.
- **Role switch works**: switching to Nurse lands on `dashboard.html`; header becomes
  `Sofia Mendoza / STAFF NURSE`; drawer becomes `Dashboard, Treatment, Nursing`; an audit row is
  written (`seq 1, "Switched role: Super Administrator → Nurse", before superadmin, after nurse`).
- **Guard works**: as Nurse, navigating to `billing.html` redirects to `dashboard.html`.
- **Responsive sweep**: 20 pages × 5 widths (1440/1200/1000/800/390) = 100 loads,
  **0 console errors, 0 horizontal overflow**.
- Test role/audit keys removed from the browser afterwards (`localStorage` left with no `mh_*` keys).

### NOT done in M1 — stated plainly

- **Dashboards are not yet role-specific.** Every role still sees the same KPI cards and panels; only
  navigation, page access and identity change. Role-tailored dashboards are the next milestone.
- **No real authorization.** `rbac.js` is a browser-side demonstration. Anyone can set
  `localStorage.mh_role` or call `HIS.rbac.set('superadmin')`. It is labelled as such in the panel and
  in the module header. It is not, and must not be presented as, a security boundary.
- **Patient role** is represented in the registry and routes to the existing `portal.html`, which keeps
  its own separate demo auth. The two identity systems are not yet unified.
- **Laboratory has no dedicated screen.** It maps to Treatment/Consultation, where test orders live.

## Next

Role-tailored dashboard content, then the audit-log viewer and reports pages (both currently listed as
"blocked on new Figma frames" in `IMPROVEMENT-PLAN.md` — they can be built as additions in the design
format).
