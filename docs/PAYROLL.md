# Payroll calculation

**Status: a demonstration engine, not a compliance product.** Every rate below is sourced and
dated, and every figure can be reproduced by hand, but a real deployment must have the tables
confirmed against the current issuances by a Philippine payroll practitioner. Nothing here is legal
or accounting advice.

Implementation: `assets/js/payroll-calc.js` (arithmetic), `assets/js/employees.js` (salary master),
`assets/js/attendance-period.js` (the period timesheet), `assets/js/payroll-runs.js` (run lifecycle).
Tests: `scripts/payroll-check.mjs`.

---

## 1. The M8 defect this milestone corrected

M8 reported this payslip for EMP-001:

| Line | M8 figure |
|---|---|
| Basic salary | ₱60,000.00 |
| Allowances | ₱8,000.00 |
| SSS | ₱875.00 |
| PhilHealth | ₱1,250.00 |
| Pag-IBIG | ₱100.00 |
| Taxable compensation | ₱65,775.00 |
| Withholding tax | ₱12,381.20 |
| Net pay | ₱53,393.80 |

The brief asked whether the withholding used the wrong period. It did — but the period error was
the second of two, and fixing only the table would have produced another wrong number.

**What actually happened.** `data-payroll.js` stored `basic: 60000`, which is the employee's
**monthly** salary (the same list puts an administrative officer at 26,000 and a head nurse at
35,000 — semi-monthly amounts would put them at 52,000 and 70,000 a month). `payroll-calc.js`
treated that number as the pay **for the period** and multiplied it by two to reach a "monthly
equivalent" for the contribution tables:

```
monthlyEquivalent = 60,000 x 2            = 120,000
SSS               = 35,000 x 5% / 2       =     875.00   (correct by coincidence: the cap applies)
PhilHealth        = 100,000 x 2.5% / 2    =   1,250.00   (double: should be 60,000 x 2.5% / 2)
Pag-IBIG          = 10,000 x 2% / 2       =     100.00   (correct by coincidence: the cap applies)
gross             = 60,000 + 8,000        =  68,000.00   (two months of pay in one period)
statutory         = 875 + 1,250 + 100     =   2,225.00
taxable           = 68,000 - 2,225        =  65,775.00
tax               = 4,270.70 + 25% x (65,775 - 33,333)
                                          =  12,381.20   (semi-monthly table, inflated base)
```

Two errors partly cancelled. Doubling the base raised the tax; the semi-monthly table, whose
brackets are exactly half the monthly ones, lowered it again. The result looked plausible and was
about three times too high.

The brief's alternative figure is arithmetically correct for a **monthly** ₱65,775 — Annex E's
monthly table gives 1,875.00 + 20% × (65,775 − 33,333) = **₱8,363.40** — but ₱65,775 is not a
monthly taxable amount either. It is two months of gross minus half a month of contributions.

**The corrected calculation** for the same person on a semi-monthly payroll:

```
period basic   = 60,000 / 2                     = 30,000.00
allowance      =  8,000 / 2                     =  4,000.00
gross                                           = 34,000.00
SSS            = 35,000 x 5% / 2                =    875.00
PhilHealth     = 60,000 x 2.5% / 2              =    750.00
Pag-IBIG       = 10,000 x 2% / 2                =    100.00
statutory                                       =  1,725.00
taxable        = 34,000 - 1,725                 = 32,275.00
tax            = 937.50 + 20% x (32,275 - 16,667)
                                                =  4,059.10
net            = 34,000 - 1,725 - 4,059.10      = 28,215.90
```

`scripts/payroll-check.mjs` §0 asserts both historical figures (12,381.20 and 8,363.40) so the
diagnosis stays checkable, and §1 asserts the corrected ones.

---

## 2. One salary fact, an explicit frequency

`employees.js` stores `monthlyBasic` and nothing else. The period amount is derived:

```
period basic = monthlyBasic / periodsPerMonth
monthly      = 1        semi-monthly = 2
weekly       = 52 / 12  daily        = 261 / 12
```

The withholding table follows the frequency, never a default:

| Frequency | Table | Periods a month |
|---|---|---|
| monthly | Annex E monthly | 1 |
| semi-monthly | Annex E semi-monthly | 2 |
| weekly | Annex E weekly | 52/12 |
| daily | Annex E daily | 261/12 |

`freq()` throws on an unknown key. A monthly payroll silently computed as semi-monthly would
under-withhold every period, so the failure has to be loud.

The daily rate for absences, undertime and premiums is `monthlyBasic × 12 / 261` — the DOLE factor
for a monthly-paid employee (12 months × 261 working days). Rates keep full precision until the
moment they become money; rounding a rate before multiplying it by 2 hours loses centavos.

---

## 2A. Two factors, two questions

The system uses **365** for the minimum-wage test and **261** to price a day of pay. That is not an
oversight, and it is not a claim that both are right. They answer different questions:

| Purpose | Basis | Source |
|---|---|---|
| Minimum-wage equivalency (monthly → daily) | **365** | NWPC FAQ, equivalent monthly rate of monthly-paid employees |
| Daily rate used to price pay | **261** | Company payroll policy `MH-PAY-2026.1` |
| Hourly rate | daily rate ÷ the employee's **own normal hours** | Labor Code Art. 83 (eight-hour day); a part-timer divides by four, not eight |
| Unpaid absence | one daily rate per day absent | Company policy |
| Lateness and undertime | hourly rate ÷ 60 per minute | Company policy |
| Overtime | hourly rate × statutory multiplier | Labor Code Art. 87 |
| Night differential | hourly rate × 10% | Labor Code Art. 86 |
| Holiday premium | daily rate × statutory percentage | Labor Code Art. 94 |
| Rest-day premium | daily rate × 30% | Labor Code Art. 93 |
| Leave | not converted: the period basic already pays a paid leave day | Company policy |

**Why they differ.** DOLE converts a monthly-paid employee's daily rate at `monthly × 12 / 365`. This
employer uses 261, the working-year factor, which produces a **higher** daily rate: ₱26,000 a month
is ₱1,195.40 a day rather than ₱854.79. Every premium, overtime hour and night hour is paid on that
higher figure, so the practice is more favourable than the statutory conversion. It is also why an
absence costs more per day than it would under 365.

**Non-diminution.** Moving the pay factor to 365 would reduce overtime, night differential and
holiday pay for every employee. That is a potential diminution of an established benefit under Labor
Code Art. 100, which a code change cannot settle. `HIS.payrollCalc.policyImpact()` quantifies it —
for the demo roster every employee's daily rate falls and every employee's overtime falls — and the
alternative is held as a **proposed** policy, `MH-PAY-2027.1`, effective 2027-01-01, which is never
returned by `policyFor()` until its status is changed to `active`.

**Daily- and hourly-paid employees do not round-trip.** Their daily rate is the rate on the record,
not `monthlyEquivalent × 12 / 261`. Pushing a daily rate through the annual factor and back changes
it (₱1,200 on a 313-day schedule became ₱1,439.08), so `dailyRateOf()` returns the stated rate and
`monthlyOf()` exists only to feed the statutory tables.

---

## 3. Statutory tables, sources and effective dates

| Item | Rule applied | Source | Effective |
|---|---|---|---|
| SSS | 15% of the Monthly Salary Credit; employee 5%, employer 10%; MSC floor ₱5,000, ceiling ₱35,000, brackets ₱500 wide | SSS Circular No. 2024-006 | 2025-01-01 |
| PhilHealth | 5% of monthly basic; employee 2.5%, employer 2.5%; floor ₱10,000, ceiling ₱100,000 | PhilHealth Circular No. 2024-0031 | 2025-01-01 |
| Pag-IBIG | Employee 1% at ₱1,500 or less, 2% above; employer 2%; Fund Salary Credit capped at ₱10,000 | RA 9679 §7 (rates) · HDMF Circular No. 460 (cap) | 2009-07-21 · 2024-02-01 |
| Withholding | Annex "E", RR No. 11-2018 — daily, weekly, semi-monthly, monthly and annual tables | BIR | 2023-01-01 |
| Overtime | +25% ordinary day; +30% on a rest day or holiday | Labor Code Art. 87 | 1974-11-01 |
| Night differential | +10% of the regular wage, 10:00 PM – 6:00 AM | Labor Code Art. 86 | 1974-11-01 |
| Rest day | +30% | Labor Code Art. 93 | 1974-11-01 |
| Special non-working day | +30%; +50% if it falls on the rest day | Labor Code Art. 93 | 1974-11-01 |
| Regular holiday | paid if not worked; 200% if worked | Labor Code Art. 94 | 1974-11-01 |
| Managerial exclusion | the hours-of-work chapter (Arts. 83–90) does not cover managerial employees, so no overtime or night differential | Labor Code Art. 82 | 1974-11-01 |
| 13th month | 1/12 of basic salary earned in the calendar year; allowances, overtime and premiums excluded | PD 851 §2(a), supplementary rule 4 | 1975-12-16 |
| 13th month tax | exempt up to ₱90,000; excess is taxable compensation | RA 10963 §32(B)(7)(e) | 2018-01-01 |

The BIR bracket bases are reproduced **verbatim** from the PDF, including the small rounding
differences between brackets (the semi-monthly base of 16,770.70 is not exactly
4,270.70 + 25% × (83,332 − 33,333) = 16,770.45). The published figure governs; `auditTables()`
allows a one-peso discontinuity and reports anything larger.

The daily table's sixth base is rendered in the PDF as `P 6,034.00.30`, which is `P 6,034.00`
followed by a fragment of the `+ 30%` line above it. It is encoded as 6,034.00 and the derivation
is in a comment.

### MSC bracketing

A bracket runs from `MSC − 250` to `MSC + 249.99`:

| Salary | MSC | Why |
|---|---|---|
| 12,249 | 12,000 | 11,750–12,249.99 |
| 12,250 | 12,500 | 12,250–12,749.99 |
| 12,300 | 12,500 | same bracket |
| 5,250 | 5,500 | 5,250–5,749.99 |
| 999,999 | 35,000 | ceiling |

M8 used `ceil(salary / 500) × 500`, which puts 12,249 in the 12,500 bracket. The corrected rule is
`ceil((salary − 249.99) / 500) × 500`, clamped.

### The Pag-IBIG tier, and what could not be verified

The M10 audit reported the 1% tier as missing. It is now implemented, but the evidence needs to be
stated precisely because the two circulars could not be read directly.

* **RA 9679 §7** is unambiguous and is the primary source: employees earning **not more than
  ₱1,500 a month contribute 1%**, those earning more contribute 2%, **every employer contributes
  2%**, and the maximum monthly compensation used for the computation was ₱5,000, *"Provided, That
  this maximum may be fixed from time to time by the Board of Trustees"*.
* **HDMF Circular No. 274** implements RA 9679's membership guidelines. It is the instrument that
  would have restated the tier.
* **HDMF Circular No. 460** (2024) exercised the Board's power and raised the maximum to ₱10,000.

Both circulars sit behind a reCAPTCHA on `pagibigfund.gov.ph`; the archived copies were unreachable
from this environment, so neither PDF was read. The implementation therefore rests on the statute,
which a circular cannot override: the 1% tier applies, and only the cap moved. **This should still
be confirmed against Circular 274 and 460 by HDMF or a Philippine payroll practitioner** — if 460
silently dropped the tier (there is no indication it did), the ₱1,500 boundary in
`CONFIG.pagibig.lowThreshold` is the one line to change.

The tier is decided on the **monthly compensation**, not on the capped fund salary: ₱1,500 → 1% of
₱1,500 = ₱15; ₱1,501 → 2% of ₱1,501 = ₱30.02. The employer share has no tier.

### Employee versus employer

`statutory()` returns both sides. The payslip shows the employee share as a deduction and the
employer share in a separate block, because the employer share is the hospital's cost, not money
withheld from the employee. M8 reported only the employee side and never stated which it was.

---

## 4. Attendance is the input, not a caption

`attendance-period.js` holds one record per employee per day for the pay period, plus a timesheet
status per employee. Payroll reads `summary(empId)` and **refuses to pay an employee whose timesheet
is not approved** — `summary()` returns `null` and the run lists them as blocked.

Day types that change the pay: `regular`, `rest`, `regular-holiday` (Aug 31, 2026 — National Heroes
Day), `special` (Aug 21, 2026 — Ninoy Aquino Day).

A correction never edits an approved record silently: it writes the new value, appends the previous
one to the record's history, and sets the timesheet back to `submitted`. Approval of a payroll run
re-checks every timesheet live, so reopening one after the run was built blocks the run until it is
recomputed. M10 shipped that check after a test caught the gate reading a stale snapshot.

Company policy, not statute, is marked as such in the config:

* `graceMinutes: 15` — lateness inside fifteen minutes is recorded but not docked.
* `specialDayPaidWhenNotWorked: true` — special non-working days are paid here. The Labor Code
  treats them as "no work, no pay" unless the employer grants otherwise.

---

## 5. Minimum wage

`assets/js/wage-floor.js` holds effective-dated wage orders and answers one question: on this date,
for this region and sector, what is the daily floor?

**Source.** NWPC daily minimum wage rates. Two regions are verified and enabled; the other fifteen
are registered but refused — see `docs/WAGE-ORDERS.md`.

* **NCR** — Wage Order **NCR-28**, effective **26 September 2026**: ₱755.00 non-agriculture, ₱718.00
  agriculture and the other covered categories. Wage Order **NCR-27** (25 July 2026) is marked
  `suspended` (Pasig RTC 152, Navotas RTC 287) and never applied; its announced second tranche
  (₱743.00–₱780.00 on 20 January 2027) is `contingent` and not applied on its date either.
* **Region VII** — Wage Order **ROVII-27**, effective **14 October 2026**: ₱582.00 for Class A
  (Expanded Metro Cebu: Carcar, Cebu, Danao, Lapulapu, Mandaue, Naga, Talisay; Compostela,
  Consolacion, Cordova, Liloan, Minglanilla, San Fernando) and ₱542.00 elsewhere. This order splits
  by **locality**, not by industry, which is why the module cannot use one shape for every region.

A region with no verified category mapping returns `unverified` and publishes the order's range
without applying a rate. A region whose order splits by category and whose category is missing
returns `needs-category`.

**No national rate.** `floorFor()` returns a floor only when an order matches the region *and* the
sector *and* is in force on the date. A region with no configured order returns `unknown`, never a
default. Before 26 September 2026 there is no NCR order in this file, so the August 2026 demo period
reports `unknown` and the Payroll screen says so rather than implying a floor it cannot prove.

**Conversion — corrected in M10.2.** M10.1 divided every monthly salary by 261, the factor for a
*daily-paid* employee who is not paid on Saturdays and Sundays. For a monthly-paid employee that
overstates the daily rate by about 40%: ₱20,000 was reported at ₱919.54 a day and passed a ₱755
floor, when the correct equivalent is ₱657.53 and it fails. The error let underpaid staff through.

The factors come from the NWPC FAQ, *"How is the equivalent monthly rate (EMR) of monthly-paid and
daily-paid employees computed?"*:

| Classification | Factor | Composition |
|---|---|---|
| Monthly-paid | **365** | 298 ordinary + 52 rest days + 12 regular holidays + 3 special days |
| Daily-paid, works every day including rest days | **393.50** | 298 + 24 (regular holidays at 200%) + 67.60 (rest days at 130%) + 3.90 |
| Daily-paid, not paid on Sundays | **313** (310 if special days unpaid) | 298 + 12 + 3 |
| Daily-paid, not paid on Saturdays and Sundays | **261** (258 if special days unpaid) | 246 + 12 + 3 |

```
monthly-paid    daily equivalent = monthly × 12 / 365
daily-paid      EMR              = daily rate × factor / 12
hourly-paid     daily equivalent = hourly rate × normal hours
```

The minimum wage is prescribed "for normal working hours, which shall not exceed eight hours per
day", so a part-time employee is compared against the floor prorated to their own hours
(`floor × hours / 8`), not against a full day's floor and not through a blind FTE division.

The factor follows the **basis**, never the schedule: a monthly-paid employee on a six-day week still
uses 365, because they are paid for every day of the year. `wage-floor.js` states this and
`m10-2-audit.mjs` asserts it for 5-, 6- and 7-day schedules.

**Classification is stated on the record, never inferred.** `payBasis` is `monthly`, `daily` or
`hourly`; `schedule` carries the normal day, the week and whether rest and special days are paid;
`wage` carries region, sector and any exemption. A daily- or hourly-paid employee has no
`monthlyBasic` — `HIS.payrollCalc.monthlyOf()` derives the equivalent monthly rate for the statutory
tables, which is how a daily-paid employee on ₱755/day at 261 days lands on ₱16,421.25 a month.

**Enforcement.** `payrollRuns.computeLines()` blocks an employee whose rate is below the floor — no
line is produced and the reason is shown in the run — and `approve`/`release` re-check every
employee live. An employee below the floor with a recorded exemption (`wage.exemption.code` plus a
`reference`) is reported as `exempt` instead of blocked. `unknown` is a warning, not a block.

**Not modelled:** regional wage orders other than NCR, establishment-size exemptions, partial
exemptions, and the sector definitions inside a wage order. A hospital's HR and legal team must
apply those.

---

## 6. Overtime, night differential, holidays

Premiums are **additions** to the period basic, which already pays every scheduled day including
regular holidays. A regular holiday actually worked therefore adds 100%, bringing the day to 200%.

| Situation | Total rate | Premium added |
|---|---|---|
| Rest day worked | 130% | 30% |
| Regular holiday worked | 200% | 100% |
| Special non-working day worked | 130% | 30% |
| Rest day + regular holiday | 260% | 160% |
| Rest day + special day | 150% | 50% |

| Overtime | Rate on the hourly rate |
|---|---|
| Ordinary day | 125% |
| Rest day | 169% |
| Regular holiday | 260% |
| Special non-working day | 169% |

Night differential is 10% of the hourly rate for each hour between 10:00 PM and 6:00 AM; overtime
hours worked at night carry the overtime rate, so the differential is 10% of that rate.

Managerial employees (`category: 'managerial'`) receive no overtime and no night differential
(Art. 82) but still receive holiday and rest-day premiums, which sit in a different chapter of the
Code. The payslip reports `otEligible: false` rather than silently dropping the hours.

---

## 7. 13th month and year-end

`thirteenthMonth(employee, { months })` returns `basicEarned / 12` on **basic salary only**. A rice
allowance is a de minimis benefit and is excluded; a professional allowance is excluded too, because
PD 851 excludes allowances not integrated into basic. The first ₱90,000 of 13th month pay and other
benefits is exempt; the excess is taxable.

`annualize(employee, { months, benefits, taxWithheld })`:

```
regularTaxable   = (monthlyBasic + taxableAllowances) x months
contributions    = employee statutory total x months
benefitsTaxable  = max(0, benefits - 90,000)
taxableComp      = regularTaxable - contributions + benefitsTaxable
annualDue        = Annex E annual table(taxableComp)
adjustment       = annualDue - taxWithheld      (positive = still due, negative = refund)
```

The annual table is consistent with the monthly one at every boundary: 250,000 / 12 = 20,833;
400,000 / 12 = 33,333; 800,000 / 12 = 66,667; 2,000,000 / 12 = 166,667; 8,000,000 / 12 = 666,667.

---

## 8. Worked examples (all asserted in `scripts/payroll-check.mjs`)

| Case | Monthly | Frequency | Gross | SSS | PhilHealth | Pag-IBIG | Tax | Net |
|---|---|---|---|---|---|---|---|---|
| A | 60,000 + 8,000 | semi-monthly | 34,000.00 | 875.00 | 750.00 | 100.00 | 4,059.10 | 28,215.90 |
| B | 60,000 + 8,000 | monthly | 68,000.00 | 1,750.00 | 1,500.00 | 200.00 | 8,118.40 | 56,431.60 |
| C | 26,000 | weekly | 6,000.00 | 300.00 | 150.00 | 46.15 | 104.38 | 5,399.47 |
| D | 9,000 | semi-monthly | 4,500.00 | 225.00 | 125.00 | 90.00 | 0.00 | 4,060.00 |
| E | 250,000 | semi-monthly | 125,000.00 | 875.00 | 1,250.00 | 100.00 | 28,603.30 | 94,171.70 |

Two semi-monthly periods withhold 4,059.10 × 2 = 8,118.20 against 8,118.40 monthly — a twenty-centavo
difference from the published bracket rounding, not from the model.

---

## 9. Off-cycle corrections

A released payroll is a historical record and is never edited. `assets/js/payroll-corrections.js`
adds a linked correction run:

1. pick the released run and give a reason (at least eight characters);
2. every employee in the run is recomputed from the **current approved** timesheet;
3. `difference = corrected net − original net − corrections already released for that employee`;
4. employees with no difference are skipped and listed;
5. the correction is fingerprinted from the run, the differences and the reason, so the same
   correction cannot be raised twice;
6. review → approve → release, each audited;
7. an adjustment statement per employee, downloadable as a PDF.

**Underpayment** is payable. **Overpayment** is a receivable and is **not** deducted automatically:
`release()` records it with `recovery.status = 'unrecorded'`. Turning it into a deduction needs
`authorizeRecovery()` with a written reference, and even then this demo only marks it
`authorized-pending-deduction` — there is no future run to deduct from.

The original run is never touched: the correction stores `originalRunId` and `originalVersion`, and
the test asserts the released run is byte-identical after a correction is created and released.

---

## 10. Known limitations

* The tables are dated 2025-01-01 and reviewed 2026-11-18. A new circular makes them stale;
  `verify()` reports the age and the payroll footer prints the effective date.
* **The wage floor covers NCR only**, and only the region/sector split. Regional orders, establishment
  size, partial exemptions and the sector definitions inside an order are not modelled.
* **The pay factor is a company policy, not a statutory conversion.** `MH-PAY-2026.1` uses 261 where
  DOLE publishes 365 for a monthly-paid employee's daily rate. The higher factor favours the employee
  on premiums and costs them on absences. It is documented, quantified by `policyImpact()`, and held
  in place pending a non-diminution review — see §2A.
* **Regional coverage is two of seventeen.** NCR and Region VII are verified from their orders; the
  rest are registered with their published ranges and refused. `docs/WAGE-ORDERS.md` has the plan.
* **Circulars 274 and 460 were not read directly.** The 1% Pag-IBIG tier rests on RA 9679 §7; the
  circulars could not be retrieved (reCAPTCHA, and the archived copies unreachable). See §3.
* **No off-cycle deduction.** An authorised overpayment recovery is recorded as
  `authorized-pending-deduction`; nothing deducts it, because the demo has no subsequent period.
* **Corrections are per run, not per period.** A second released run for the same period cannot
  exist, so a correction always points at the one released run.
* Overtime is paid at the statutory minimum. A CBA may provide more, and Art. 93 says the higher
  rate governs.
* Holiday premiums use the 2026 holiday list only.
* No loan amortisation schedule, no bank file, no BIR Form 2316, no alphalist.
* Attendance is keyed or seeded, not imported from a biometric device.
