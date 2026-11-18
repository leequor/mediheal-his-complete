# Session 39 addendum — M10.3 divisors, compensation basis, regional orders (2026-11-18)

Branch `dev/autonomous-milestones`, from `3746dce`. `main` untouched at `fd5bf9f`. Nothing deployed.

## The question, and the answer

M10.2 left one thing open: the wage-floor test uses 365 and the payroll engine uses 261. Are they the
same question answered twice?

No. They are two questions:

* **365** answers *"does this monthly salary meet the daily minimum wage?"* — the NWPC conversion for
  a monthly-paid employee.
* **261** answers *"what is a day of this employee's pay worth?"* — used for absence, lateness,
  undertime, overtime, night differential and premiums.

DOLE's conversion for a monthly-paid daily rate is 365. This employer uses 261, which is **higher**
(₱26,000 → ₱1,195.40 a day rather than ₱854.79), so premiums are more generous and absences cost more.
Aligning to 365 would cut overtime, night differential and holiday pay for every employee — a
potential diminution of an established benefit under Labor Code Art. 100, which is a policy decision,
not a code fix.

So the factor is now an **effective-dated policy** (`MH-PAY-2026.1`) that states the basis for each
purpose, and the 365 alignment is held as a **proposed** policy (`MH-PAY-2027.1`) that `policyFor()`
never returns. `policyImpact()` quantifies the change per employee: every one of the eight demo
employees would see their daily rate and overtime fall.

## Two defects found while testing

1. **Part-time hourly rate.** The hourly rate divided by a fixed 8 hours. A part-timer paid ₱13,050 a
   month for four-hour days has a ₱600 daily rate; dividing by 8 gave ₱75 an hour instead of ₱150, so
   every overtime and night hour they worked was paid at half. It now divides by the employee's own
   normal hours.
2. **Daily-paid round-trip.** A daily-paid employee's rate was converted to a monthly equivalent
   (using their own 313-day factor) and back (using the policy's 261), turning ₱1,200 into ₱1,439.08.
   `dailyRateOf()` now returns the stated rate; the monthly equivalent exists only to feed the
   statutory tables.

## Compensation configuration

Every record now states `payBasis`, the rate for that basis, `schedule` (days per week, normal hours,
normal workdays per month, paid rest and special days), `payPolicy`, `payEffectiveFrom` and the wage
order fields. No employment contract or payroll manual exists for this demo, so the records carry an
explicit demonstration assumption rather than an inferred one.

## Regional coverage

Two regions are verified from their orders and enabled:

| Region | Order | Effective | Split | Rates |
|---|---|---|---|---|
| NCR | NCR-28 | 2026-09-26 | industry | 755 non-agriculture / 718 agriculture, retail-service |
| Region VII | ROVII-27 | 2026-10-14 | **locality** | 582 Class A / 542 elsewhere |

Region VII was read from the order PDF: it splits by geographic area, not industry, and keeps Negros
Oriental and Siquijor under RTWPB VII. That is why the module cannot use one shape for every region.

The other fifteen regions are **registered but refused**: the NWPC publishes a headline range, but the
endpoints only mean something once mapped to the categories inside the order. `floorFor()` returns
`unverified` with the published range, and `needs-category` when an order splits and the category is
missing. `docs/WAGE-ORDERS.md` carries the register and a prioritised plan. CAR-24 returned no
extractable text — some orders are image scans — so it could not be verified either.

## Verification

| Suite | Result |
|---|---|
| `m10-3-audit.mjs` (new) | 75 passed, 0 failed |
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

No visual change: the policy work is internal, and the Payroll screen renders identically at 1440 and
1366.

## Remaining ambiguity

* The 261 pay factor is a company practice, not a DOLE conversion. It is defensible only as a more
  favourable established practice, and only until a non-diminution review settles it.
* Fifteen regions unverified; establishment-size and partial exemptions unmodelled everywhere.
* The Pag-IBIG circulars remain unread (RA 9679 §7 carries the tiers).
