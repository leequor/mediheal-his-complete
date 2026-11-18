# Session 38 addendum — M10.2 wage conversion and final payroll accuracy (2026-11-18)

Branch `dev/autonomous-milestones`, from `0268f34`. `main` untouched at `fd5bf9f`. Nothing deployed.

## The defect

M10.1 computed every employee's daily equivalent as `monthly × 12 / 261`. 261 is the NWPC factor for
a **daily-paid** employee who is not paid on Saturdays and Sundays. Applied to a **monthly-paid**
employee it overstates the daily rate by about 40%, because a monthly-paid employee is paid for all
365 days of the year.

The consequence was not cosmetic: ₱20,000 a month was reported at ₱919.54 a day and passed a ₱755
floor. The correct equivalent is ₱657.53, and it fails. Every monthly-paid employee between roughly
₱16,422 and ₱22,965 was silently passing the wage-floor check when they should have failed it. None
of the demo employees are in that band (the lowest is ₱26,000 → ₱854.79), which is exactly why the
defect survived M10.1's tests: they were written against the same wrong formula.

## The correction

NWPC FAQ, *"How is the equivalent monthly rate (EMR) of monthly-paid and daily-paid employees
computed?"* (https://nwpc.dole.gov.ph/faqs/):

| Classification | Factor | Composition |
|---|---|---|
| Monthly-paid | **365** | 298 ordinary + 52 rest + 12 regular holidays + 3 special days |
| Daily-paid, works every day | **393.50** | 298 + 24 + 67.60 + 3.90 |
| Daily-paid, no Sundays | **313** (310 unpaid special days) | 298 + 12 + 3 |
| Daily-paid, no weekends | **261** (258 unpaid special days) | 246 + 12 + 3 |

```
monthly-paid   daily equivalent = monthly × 12 / 365
daily-paid     EMR              = daily × factor / 12
hourly-paid    daily equivalent = hourly × normal hours
part-time      floor prorated to normal hours: floor × h / 8
```

The factor follows the basis, not the schedule: a monthly-paid employee on a six-day week still uses
365.

## Classification on the record

`employees.js` now states, per person:

```
payBasis: 'monthly' | 'daily' | 'hourly'
monthlyBasic | dailyRate | hourlyRate
schedule: { daysPerWeek, hoursPerDay, paidRestDays, paidSpecialDays }
wage:     { region, sector, category, effectiveFrom, exemption? }
```

The basis is never inferred from the salary. `HIS.payrollCalc.monthlyOf()` converts a daily- or
hourly-paid employee to the equivalent monthly rate for the statutory tables, so a daily-paid
employee on ₱755/day at 261 days is ₱16,421.25 a month and a semi-monthly basic of ₱8,210.63.

## Boundary results

| Monthly | Daily equivalent (365) | vs ₱755 |
|---|---|---|
| 16,000 | 526.03 | fails |
| 20,000 | 657.53 | fails (passed at 919.54 under 261) |
| 22,000 | 723.29 | fails |
| 22,964 | 754.98 | fails |
| 22,964.58 | 755.00 | passes |
| 23,000 | 756.16 | passes |
| 26,100 | 858.08 | passes |
| 35,000 | 1,150.68 | passes |

Daily-paid: ₱755 at 5 days → ₱16,421.25 EMR; at 6 days → ₱19,690.42; at 7 days → ₱24,757.71.
₱718 agriculture → ₱15,616.50 at 5 days. Part-time 4 h: ₱377.50 a day clears, ₱377.49 fails.

## What did not change

Pag-IBIG keeps the RA 9679 §7 tiers (1% at ≤₱1,500, 2% above, employer 2%) and the ₱10,000 cap, with
the circulars still documented as unread. NCR-28 (26 September 2026, ₱755 / ₱718) is unchanged;
NCR-27 remains suspended and its January 2027 tranche is not applied.

## A divergence left open

The payroll engine's absence and premium rates still use `monthly × 12 / 261` (`dailyRate()` in
`payroll-calc.js`), while the floor check now uses 365 for monthly-paid staff. They answer different
questions — what a day of absence costs versus whether the monthly rate meets the daily minimum — but
the divergence is real and is recorded in `docs/PAYROLL.md` §10 for professional review. The floor
check is the one that decides compliance.

## Verification

| Suite | Result |
|---|---|
| `m10-2-audit.mjs` (new) | 78 passed, 0 failed |
| `m10-1-audit.mjs` (wage expectations updated to 365) | 77 passed, 0 failed |
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

No visual change: the wage note in the Payroll dialog changed one sentence, and the page baseline is
untouched.
