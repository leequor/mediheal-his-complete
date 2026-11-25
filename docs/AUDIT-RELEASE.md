# Audit fixes and release verification - 2026-11-25

This change addresses the 35 reproduced issues from the independent website audit, then adds adversarial checks of record ownership, persistence, numeric boundaries, old browser records and role handoffs. It preserves the existing visual design.

## Reproduced issues

| ID | Original issue | Result |
|---|---|---|
| HIS-001 | A newly registered patient cannot enter the shared clinical workflow | Fixed |
| HIS-002 | The same patient ID names two different people | Fixed |
| HIS-003 | Save note discards the progress-note body | Fixed |
| HIS-004 | Saved nursing vitals never reach the shared vitals record or doctor | Fixed |
| HIS-005 | Nursing accepts impossible vital signs as successfully saved | Fixed |
| HIS-006 | An unordered medicine is counted as given without an administration record | Fixed |
| HIS-007 | Editing patient details changes only a profile overlay | Fixed |
| HIS-008 | Profile Transfer reports success without moving the admission or bed | Fixed |
| HIS-009 | Profile Discharge leaves the stay active and drops the summary | Fixed |
| HIS-010 | Signing out duplicates self-registered patient records | Fixed |
| HIS-011 | Status changes to newly booked appointments vanish on refresh | Fixed |
| HIS-012 | The patient's portal ignores saved appointment edits | Fixed |
| HIS-013 | An identical patient/doctor/date/time booking can be submitted twice | Fixed |
| HIS-014 | A patient name is executed as HTML when its saved appointment renders | Fixed |
| HIS-015 | Accounting can verify its own cut-off as HR Officer | Fixed |
| HIS-016 | Process payments bypasses the HR verification gate | Fixed |
| HIS-017 | The Auditor can release payroll with ordinary buttons | Fixed |
| HIS-018 | A Department Head can alter another department's personnel | Fixed |
| HIS-019 | A laboratory account can save a physician diagnosis | Fixed |
| HIS-020 | The daily clock register never updates the attendance that payroll uses | Fixed |
| HIS-021 | A verified cut-off still permits clock edits without invalidating verification | Fixed |
| HIS-022 | Added personnel cannot receive attendance or payroll | Fixed |
| HIS-023 | Editing a full name leaves the directory and profile heading unchanged | Fixed |
| HIS-024 | Three employees have different jobs in Personnel and Payroll | Fixed |
| HIS-025 | Reset sample data leaves two clinical/configuration stores behind | Fixed |
| HIS-026 | A failed storage write is reported as a successful payment | Fixed |
| HIS-027 | Saving in a second nursing tab erases the first tab's changes | Fixed |
| HIS-028 | Negative payment and coverage amounts become positive transactions | Fixed |
| HIS-029 | The payment dialog omits newly raised charges from its balance | Fixed |
| HIS-030 | A long invoice exports its totals below the only PDF page | Fixed |
| HIS-031 | Clinical and administrative dialog fields have no accessible names | Fixed |
| HIS-032 | Tab escapes a modal and enters the obscured page navigation | Fixed |
| HIS-033 | Long patient names paint through every appointment column | Fixed |
| HIS-034 | Custom listboxes do not support expected arrow-key selection | Fixed |
| HIS-035 | Appointment placeholders have only 1.61:1 contrast | Fixed |

## Additional defects from the second scan

- Pending prescriptions could dispense; infinite stock quantities, negative prices and invalid expiry dates could persist.
- Charges accepted nonfinite totals and nonexistent/mismatched encounters. Lab orders and claims accepted another patient's encounter/invoice.
- Payroll recovery lacked an Accounting writer check. HR had no accessible cut-off reopening path; leave changes did not reach payroll attendance.
- Older nursing IDs and saved daily attendance needed migrations. Reserved MRNs could collide with legacy registrations.
- Treatment bed/discharge actions changed display state without updating the admission. Read-only clinical roles could trigger writer actions.
- Migrated patients without registration metadata could crash two role dashboards, unknown ages printed undefined, and patient lookup interpolated names as HTML.

Related writes now stage together and roll back ordinary quota failures. Cross-tab races and crash recovery still require a server database; this remains a localStorage demonstration with client-side authorization.

## Repeatable checks

Use an installed playwright-core package and Chrome. Each new suite starts headless with its own storage. PW may name an absolute package path. OUT selects an evidence directory. OFFLINE=1 fulfills the repository's local requests directly and omits unavailable Google Fonts.

~~~powershell
$env:PW = 'C:/path/to/playwright-core/index.js'
node scripts/audit-regression.cjs
node scripts/integrity-check.cjs
node scripts/adversarial-check.cjs
node scripts/hardening-check.cjs
node scripts/dialog-check.cjs
~~~

The existing domain suites still test arithmetic and workflow rules. Their fixtures now perform required verification, use a combined-role test account where one fixture crosses HR/Accounting or physician/pharmacy boundaries, and keep role denial checks separate. Numeric expectations are unchanged.

## Final evidence

All 21 domain suites passed (1,275 assertions/checks in aggregate). The new audit suite adds 59 assertions, integrity 15, adversarial input 16 and role/persistence hardening 23. The integrity run inserted 120 patients, checked unique IDs, references, invoice reconciliation, stock, schema keys, reset behavior and legacy-ID collisions. Fresh route coverage: 28 routes, 12 roles and 300 access guards, with zero page exceptions or missing local assets. The modal census exercised 174 representative controls and 97 dialog states with zero missing field names or click errors. A smoke sweep checked 28 pages at five widths.

The old visual state was reconstructed from b6964c6 and compared at 1440 and 1366 in the same browser/font conditions. Expected changes cover placeholder contrast; workforce job labels; canonical patient/contact/admission data; larger shared registries; and readable clinical row metadata at narrower widths. Desktop clinical lists and payroll rows scroll before their fixed footers, preserving the locked card geometry. Expected visual differences are documented rather than silently accepted as an unchanged baseline. Official baseline manifests are retained: network restrictions prevented Google Fonts loading, so fallback-font screenshots cannot replace the approved font baseline.

HR adds personnel and verifies attendance. Accounting sets missing salary/category through the new Set pay action, then recomputes payroll. HR personnel forms do not expose salaries. Auditor Billing and Charges controls and their domain APIs reject money/charge mutations.

Release: local commit and authorized push are the next steps. GitHub Pages runs automatically on main pushes; live deployment is not yet verified.

PDF output paginates and supports WinAnsi text. Unsupported non-Latin characters become question marks; full Unicode PDF typography is not implemented.
