# Instructions for any AI agent working in this repo

Read `docs/START-HERE.md` FIRST (connect steps, read order, current next step). Then the newest `docs/GITHUBPROGRESS-sessionNN-addendum.md` files (sessions 12 and later are logged only in the addenda; `docs/GITHUBPROGRESS.md` stops at session 11 and is only for measured tokens of a screen you touch). `docs/HANDOFF.md` is OLD history (sessions 1 and 2) and is not the place to start.

**`docs/DESIGN-LOCK.md` is the visual contract. Read it before changing any CSS, layout or component.** It records the measured tokens, the type scale, the component geometry, the page inventory, the known design deviations, and the verification checklist. A change that moves pixels outside its intended region is a regression, not an improvement.

Short version of the rules:

1. The site must match the Figma designs exactly. Measure in Figma, do not guess. Where Figma is unreachable, `docs/DESIGN-LOCK.md` §3–§6 is the fallback authority; mark anything else `ESTIMATED`.
2. Keep handoff notes additive. Never delete earlier sections; append a dated entry to the newest addendum (or create the next one) and update the status notes. Commit a log line FIRST in every turn and the results at the end.
3. Never run `get_node_info` on the whole page `0:1` (260 children, it crashes the Figma plugin). Query single frames.
4. After every push, say what was verified and what was not. Verify on the live site with the Playwright tools (they drive the owner's real browser: remove any test records you save).
5. Put a whole page (HTML + JS + CSS) in ONE commit (`push_files`); GitHub Pages lags 10 to 30 s and caches HTML/JS/CSS in the browser (`fetch(url,{cache:'reload'})`, then `location.reload()`).
6. Run `node scripts/visual-check.mjs --check` before claiming a visual change is safe, `node scripts/roles-check.mjs` after touching `rbac.js` or any role's page list, and `node scripts/smoke.mjs` before claiming a page is clean. All need `playwright-core`; set `PW=/abs/path/to/playwright-core/index.js` if it is not local.

7. **A record has exactly one owner.** `docs/DATA-MODEL.md` lists which module writes which key and the invariants the stores enforce. Do not compute a balance, a status or a total in a second place: `HIS.ledger` owns money, `HIS.registry` owns patients, `HIS.audit` owns history. If you find code reading `bill.paid` or `employee.ded`, it is a bug — both were retired because two screens disagreed.

8. **Run the domain harness for the area you touched**, not just the visual one: `portal-check` for identity, `clinical-check` for laboratory/pharmacy, `finance-check` for money, `payroll-check` for HR, `claims-check` for the payer workflow, `ledger-check` for money movement. Each asserts rules, not rendering.

9. **Measurement is not inspection.** Three separate defects in this project passed every automated check and were only found by looking at a screenshot (a reports string bug, role cells rendering as pills, a registration form with three fields clipped into one row). Capture the screen and look at it before calling a change done.
