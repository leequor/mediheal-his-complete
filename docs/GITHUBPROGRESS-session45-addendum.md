# Session 45 addendum — 2026-11-25

## Start: independent website bug hunt

Owner requested review of Obsidian history followed by a comprehensive current-site audit of hidden functional, persistence and design defects. Initial application revision: `1eb973b`; working tree clean. Canonical target: https://leequor.github.io/mediheal-his-complete/ . Prior recorded fixes and test-driver failures are leads, not current proof.

Use disposable browser contexts for synthetic test writes, preserving the owner's browser data. Audit artifacts and reproducible scripts go to `C:\Users\nekoc\mediheal-audit-2026-11-25`; session memory goes to the Obsidian Sessions note `2026-11-25 MediHeal HIS — Website bug hunt`. Review all routes, roles, core write flows, persistence across reloads/account changes/tabs, negative paths, downloads and rendered desktop design. No application implementation changes or deployment are part of this audit.

Results will be appended here after independent reproduction. Existing status/architecture/matrix documents contain historical sessionStorage and role-count claims; source and observed current behavior will determine the audit verdict.

## Results: independent audit completed

User explicitly instructed **do not ship anything**. No push, deployment or release. Application HTML/JS/CSS/assets were not edited. All writes were synthetic records in disposable headless Chrome contexts; the owner's browser/profile/mouse were not controlled.

Full local report: `C:\Users\nekoc\mediheal-audit-2026-11-25\REPORT.md`; structured issue list: `findings.json`; coverage: `summary.json`. Obsidian session: `2026-11-25 MediHeal HIS — Website bug hunt`.

- **35 confirmed issues: 2 P0, 27 P1, 6 P2**, with reproduction steps, expected/observed behavior, source anchors, JSON evidence and screenshots. The two blockers are disconnected new staff registration and conflicting patient identities for one MRN.
- Core failures include discarded nursing note bodies, unshared/invalid nursing vitals, unordered medication recorded as given, profile edits/transfers/discharges that update only display overlays, self-registration rows duplicated on sign-out, missing IDs on new appointments, portal readers ignoring appointment edits, stored HTML execution through appointment names, weak action permissions, unverified payroll release, two separate attendance rosters, personnel/payroll mismatch, reset omissions, swallowed storage failures, stale-tab overwrite, negative currency parsing and invoice dialogs/PDFs missing growing charges.
- **28 routes, 12 roles, 300 page-guard checks**; **164 representative pointer controls, 95 opened dialog states**; **47 independent named scenarios**, all completed without remaining driver exceptions. Baseline had zero page exceptions and zero missing same-origin assets. This is bounded coverage, not every possible input combination.
- All **14 full existing suites** for current roles/portal/clinical/finance/ledger/charges/revenue/claims/ADT/modal stack/persistence/controls/forms/personnel passed after isolating unavailable external font requests. Auth is 24/25 because its expected roster count is stale. Payroll and acceptance drivers sign in as HR then try its now-forbidden Payroll page and crash; these were reported as harness gaps, not app defects or green tests.
- Normal HR → Accounting Compute & release → nurse's own EMP-007 payslip passed: eight PDFs in one ZIP, no second release/download/history change on repeat. Patient correction request handoff and normal invoice/profile/CSV downloads passed. At 1440×768 the payment modal scrolls into view and saves; do not repeat old clipping notes as a reproduced current blocker.
- Measured design issues: 137 unnamed controls in 23 modal states, Tab escaping the active modal into background navigation, 1.6059:1 placeholder contrast, unsupported listbox arrows, long names painting through columns. Source detector's 140 candidates are not 140 verified bugs. Existing visual identity remains the authority.

### Runtime and live corroboration

Direct network navigation is blocked by the session sandbox, including loopback (`ERR_NAME_NOT_RESOLVED` / `ERR_NETWORK_ACCESS_DENIED`). Browser interactions used the unchanged app files via Playwright request fulfillment at an isolated HTTP origin. Chrome `158.0.8127.37`; external Google Fonts unavailable, so screenshots use fallback fonts. No Figma pixel match or real-network-performance grade claimed.

The connected Awwwards tool fetched deployed scripts from Billing, Nursing, Payroll, Appointments, Portal, Profile and Personnel. **48 distinct external scripts plus the Appointments inline script, 188 comparisons, zero differences** against git application revision `1eb973b`; manifest `live-parity-all.json`. This does not prove full HTML/CSS/image parity or a direct authenticated live browser walkthrough.

### Next work, without shipping

Fix patient identity and owned clinical records first; then action permissions/HR prerequisites, attendance ownership, appointment IDs/readers, storage error handling, money parsing and ledger-derived displays. Finally paginate long exports and repair modal labeling/focus/long-content behavior while preserving the visual contract. Re-run the current domain checks and the independent next-role/content assertions after fixes. Refresh stale documentation and HR/Accounting regression drivers. These are recommendations; no application fix was made in this audit.
