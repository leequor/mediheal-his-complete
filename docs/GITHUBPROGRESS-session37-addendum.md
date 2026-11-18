# Session 37 addendum — M10.1 statutory edge cases, wage floor, corrections (2026-11-18)

Branch `dev/autonomous-milestones`, from `b74963d`. `main` untouched at `fd5bf9f`. Nothing deployed.

M10.1 is a remediation milestone. Five known gaps from the M10 acceptance audit, no new features
beyond closing them.

## 1. Pag-IBIG: the 1% tier, and what could not be verified

RA 9679 §7 is explicit: an employee earning **not more than ₱1,500 a month contributes 1%**, above
that 2%, **every employer contributes 2%**, and the maximum monthly compensation (₱5,000) *"may be
fixed from time to time by the Board of Trustees"*.

Circular 460 exercised that power and raised the maximum to ₱10,000. The tier is therefore statutory
and the circular only moved the cap. Implemented with two effective dates — `2009-07-21` for the
rates, `2024-02-01` for the cap.

**Not verified directly.** `pagibigfund.gov.ph` answers with a reCAPTCHA and the archived copies of
Circulars 274 and 460 were unreachable from this environment. Neither PDF was read. The
implementation rests on the statute, which a circular cannot override, and the caveat is recorded in
`docs/PAYROLL.md` §3 and §10 for HDMF or professional confirmation.

Boundaries asserted: ₱1,000 → ₱10; ₱1,500 → ₱15; ₱1,501 → ₱30.02; ₱5,000 → ₱100; ₱9,999 → ₱199.98;
₱10,000 and ₱10,001 → ₱200. Employer is 2% throughout: ₱20 at ₱1,000, ₱30 at ₱1,500.

## 2. Minimum wage

New `assets/js/wage-floor.js`. Wage Order **NCR-28**, effective **26 September 2026**: ₱755.00
non-agriculture, ₱718.00 agriculture and the other covered categories. **NCR-27** (25 July 2026) is
modelled as `suspended` — implementation awaits Pasig RTC 152 and Navotas RTC 287 — and is never
applied; its announced second tranche (₱743–₱780 on 20 January 2027) is `contingent` and is not
applied on its date either.

There is no national rate. `floorFor()` returns a floor only when an order matches the region, the
sector and the date; anything else returns `unknown` with an explanation, never a default. The demo
period is August 2026, before NCR-28, so it reports `unknown` — and the Payroll dialog says exactly
that instead of implying a floor it cannot prove.

Conversion is `monthly × 12 / 261 / FTE`, never `/ 30`. A part-timer on four hours a day is compared
on a full-time-equivalent basis.

Enforcement: `computeLines()` blocks a below-floor employee, and `approve`/`release` re-check every
employee live. An exemption with a reference reports `exempt`; `unknown` is a warning, not a block.

## 3. Off-cycle corrections

New `assets/js/payroll-corrections.js`. A released payroll is never edited; a correction is a
separate run linked by `originalRunId` and `originalVersion`.

- difference = corrected net − original net − corrections already released for that employee
- duplicates are refused by a fingerprint of the run, the differences and the reason
- underpayment is payable; overpayment is a receivable and is **not** deducted automatically
- recovery needs `authorizeRecovery()` with a written reference, and even then is only
  `authorized-pending-deduction`
- a statement per correction downloads as a PDF
- the released run is asserted byte-identical after a correction is created and released

## 4. Negative balances: the reported finding was a misreading, but the hole was real

The M10 report said "partial approval of ₱600 → invoice balance −₱600". That is not what the audit
measured: the balance **fell by** ₱600, from ₱52,800 to ₱52,200, and never went negative. The
wording in the M10 report was ambiguous and is corrected here.

The underlying question was still worth asking. Two real gaps existed:

1. `sums()` swept any transaction that was not a payment or a refund into `covered`. A `credit` row
   would have been counted as coverage and could have driven a balance negative. Kinds are now
   matched explicitly.
2. A claim approved for more than the outstanding balance was **refused** at settlement, which is
   wrong: the payer approved it, the hospital just cannot apply more than is owed. Settlement now
   posts `min(approved, outstanding)` and records the remainder as `unappliedAmount` with a reason.

`patientShare` is now measured against the outstanding balance at decision time, not the original
charge, which ignored payments already received.

Credits are recorded separately (`recordCredit`, `creditOf`) and are excluded from `collected`,
`covered` and the balance.

## Verification

| Suite | Result |
|---|---|
| `m10-1-audit.mjs` (new) | 77 passed, 0 failed |
| `acceptance-audit.mjs` | 180 passed, 0 failed |
| payroll-check | 89 |
| claims-check | 41 |
| ledger-check | 46 |
| smoke | all pages clean |
| roles-check | 132 |
| auth-check | 25 |
| clinical-check | 53 |
| finance-check | 31 |
| portal-check | 40 |
| a11y | 22 pages, 0 violations |
| responsive | 125 checks |
| visual-check | all pages match baseline |
| buttons | 0 anomalies |

Two assertions in the M10 acceptance audit were updated because M10.1 deliberately changed the rule
they encoded: the Pag-IBIG reference now applies the 1% tier, and the patient-share expectation is
measured against the outstanding balance. Both are documented here rather than silently edited.

## Remaining limitations

- Circulars 274 and 460 unread; the tier rests on RA 9679.
- Wage orders modelled for NCR only, without establishment-size or partial exemptions.
- No off-cycle deduction: an authorised recovery is recorded but never applied.
- Corrections point at a single released run per period.
- Claims remain simulated; no eClaims, eligibility or remittance matching.
