# Session 40 addendum — M10.4 overtime classification and work-hours audit (2026-11-18)

Branch `dev/autonomous-milestones`, from `443058a`. `main` untouched at `fd5bf9f`. Nothing deployed.

## The defect

Every hour past an employee's schedule was priced as statutory overtime. Article 87 puts the
threshold at **eight hours in the day**, not at the end of the schedule. A part-timer on a four-hour
day who worked six hours was paid two hours at 125% instead of two hours at the ordinary rate — an
overpayment, and a mislabelled entitlement. The demo has no part-time employee, which is why no
existing test caught it.

## The classification

`attendancePeriod.classify(record)` splits one day into buckets before anything is priced:

| Bucket | Meaning | Paid at |
|---|---|---|
| ordinary | scheduled hours worked | period basic |
| additional | beyond the schedule, within eight | ordinary hourly rate |
| ot | beyond eight | 125% |
| rest / restOt | first eight hours on a rest day / beyond | 130% (premium only for monthly-paid, base + premium for daily-paid) / 169% |
| holiday / holidayOt | first eight hours on a holiday / beyond | 100% premium / 260% |

No agreement grants a premium for additional hours inside eight, so `policy.additionalHoursPremium`
is 0. If one ever does, it is a contractual premium and belongs in that field — not in the overtime
calculation.

The eight-hour threshold is hard-coded in `classify()` and the tests assert that changing an
employee's schedule does not move it.

## Absence deduction: its own basis, and an honest label

The premium daily rate is not automatically the right amount to deduct for an absence, so the absence
basis is a separate policy field with its own factor. Monthly-paid employees lose
`monthly × 12 / absence.factor`; daily-paid employees lose exactly their stated day; hourly-paid
employees lose hourly × normal hours. Partial-day absence is lateness and undertime, priced per
minute.

**It is a configured assumption, not a proven practice.** No contract, manual or historical payslip
exists for this demo, and the policy record says so. `compute()` returns
`absenceBasis.status = 'configured-assumption'`. Proration for a new hire or a separation is not
modelled — there is no hire or separation date on the record.

## The 261 practice has no historical evidence

M10.3 called it "company practice". It is not. It is a configured policy assumption: no written
policy, contract, payslip or historical calculation was available to show it was ever applied. It is
**not** established that Article 100 would protect it. What would settle it:

1. a written company payroll rule or the applicable CBA/employment contract;
2. historical payslips showing the deduction and premium calculations actually applied;
3. evidence the calculation was consistent and deliberate, not incidental.

Until then it stays a labelled assumption.

## Impact by purpose

`policyImpact()` now reports, per employee, the before/after of the ordinary daily rate, the hourly
rate, two overtime hours, eight night hours, a rest day, a holiday, and one unpaid absence — with
earnings and deductions in separate blocks. The net is shown only after the components and labelled
illustrative. For the demo roster, premiums fall by more than the absence deduction falls, so the net
is negative; the note says the two effects pull in opposite directions rather than calling the change
favourable or unfavourable. It is read-only and the tests assert the released run is byte-identical
after it runs.

## Article 83: undetermined, not assumed

The health-personnel provision applies to cities or municipalities of at least 1,000,000 people, or
hospitals and clinics with at least 100 beds. MediHeal is a **60-bed** hospital and its **city is not
recorded**, so the bed test fails and the population test cannot be answered.

`art83()` returns `undetermined` with `missing: ['cityPopulation']`, and `sixthDayPremium()` refuses
to price a sixth day. The rule is implemented and prices at 30% of eight hours once applicability is
established; with a qualifying population it applies, with 500,000 people and 60 beds it does not.
The three states are tested. The premium warns that it must not be stacked on a rest-day premium for
the same day.

## Verification

| Suite | Result |
|---|---|
| `m10-4-audit.mjs` (new) | 54 passed, 0 failed |
| m10-3-audit | 75 |
| m10-2-audit | 78 |
| m10-1-audit | 77 |
| acceptance-audit | 180 |
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

No visual change: the work is inside the calculation. Payroll renders identically at 1440 and 1366.

## Remaining

* 261 is an unverified assumption; so is the 261 absence basis.
* Article 83 applicability needs the employer's city and its population, with a source and a date.
* Proration for new hires and separations is not modelled.
* Fifteen regions remain unverified; establishment-size and partial exemptions are unmodelled.
* The Pag-IBIG circulars remain unread.
