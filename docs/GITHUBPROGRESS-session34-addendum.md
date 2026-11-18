# Session 34 addendum — M8 payroll correctness (2026-11-18)

Additive log. Branch `dev/autonomous-milestones`. `main` remains at `fd5bf9f`.

## What was wrong

`payroll.js` did not calculate payroll. It read a stored `ded` figure and then reverse-engineered it
with invented rates so the payslip would appear to agree:

```js
p = Math.round(e.basic * 0.025);
s = Math.min(1350, Math.round(e.basic * 0.0225));
g = 750;
t = e.ded - p - s - g;      // the tax is whatever is left over
```

The tax was the residual, so the "breakdown" could never disagree with the number it was meant to
check. `1350` and `750` are not rates from any issuance; `2.25%` is not the SSS employee share. The
stored deductions (₱8,800 on ₱68,000 of gross for a physician on ₱120,000 a month) were far too low
and nothing on screen could reveal it.

## What it does now

`assets/js/payroll-calc.js` — one effective-dated configuration, every rule carrying its source:

| Rule | Value | Source |
|---|---|---|
| SSS | 15% total, **employee 5%**, MSC floor ₱5,000, ceiling ₱35,000, ₱500 steps | SSS Circular No. 2024-006, effective Jan 2025 |
| PhilHealth | 5% total, **employee 2.5%**, salary floor ₱10,000, ceiling ₱100,000 | UHC Act premium schedule |
| Pag-IBIG | **2%** of fund salary, capped at ₱10,000 (max ₱200/month) | HDMF Circular No. 460 |
| Withholding tax | BIR semi-monthly graduated table | TRAIN law as amended (RA 10963, RA 11956) |

The demo period is **semi-monthly**, so each monthly contribution is computed on the monthly
equivalent and halved — which is how a semi-monthly payroll actually withholds them.

`ded` is no longer read anywhere. `payroll.js` gets net pay, deductions and the breakdown from
`HIS.payrollCalc.compute()`. The screen now states the table's effective date so a stale config is
visible rather than silent, and `verify()` reports how old it is.

### A rule the hand calculation exposed

A ₱1 gross produced a **negative** payslip: ₱250 of contributions against ₱1 of pay. You cannot
withhold more than the employee earned, so below the floor the employee share is scaled to the pay
and the employer carries the remainder. The result carries `capped: true` so a payslip can say so.

## Verified against hand-calculated figures

`scripts/payroll-check.mjs` (new): **45 / 45**. The expected values were worked out by hand from the
published rules, not read back from the implementation.

| Case | Gross | SSS | PhilHealth | Pag-IBIG | Tax | Deductions | Net |
|---|---|---|---|---|---|---|---|
| ₱60,000 + ₱8,000 (₱120k/mo) | 68,000 | 875 | 1,250 | 100 | 12,381.20 | 14,606.20 | 53,393.80 |
| ₱26,000 + ₱2,500 (₱52k/mo) | 28,500 | 875 | 650 | 100 | 2,979.10 | 4,604.10 | 23,895.90 |
| ₱8,000 (₱16k/mo) | 8,000 | 400 | 200 | 100 | 0 | 700 | 7,300 |
| ₱4,000 (₱8k/mo, floor) | 4,000 | 200 | 125 | 80 | 0 | 405 | 3,595 |

Worked example for the first row: monthly ₱120,000 → MSC capped at ₱35,000 → SSS ₱1,750/mo →
**₱875**; PhilHealth capped at ₱100,000 → ₱2,500/mo → **₱1,250**; Pag-IBIG capped → ₱200/mo →
**₱100**. Gross ₱68,000 less ₱2,225 of contributions = taxable ₱65,775; BIR semi-monthly bracket
₱33,333–₱83,333 gives ₱4,270.70 + 25% × (₱65,775 − ₱33,333) = **₱12,381.20**.

Also asserted: MSC ceiling and floor, PhilHealth floor and ceiling, Pag-IBIG cap, the first BIR
bracket being exempt, the table rising monotonically, net pay never negative, the payslip showing
the same deductions and net the engine computed and itemising all four, gross = deductions + net
across the whole payroll, and the net-payroll KPI equalling the sum of net pay.

Releasing payroll now writes an audit row with the headcount, net amount and period.

## Visual

`payroll.html` changed 0.850% — the KPI strip and the Deductions / Net pay columns now show computed
figures instead of the stored ones. Inspected on screen (₱366,000 earnings, ₱71,241.65 deductions,
₱294,758.35 net; EMP-001 at ₱14,606.20 / ₱53,393.80, exactly the hand calculation), then rebaselined.

## Not done in M8

* **No attendance → payroll link.** `days` and `hours` are stored per employee and displayed; the
  payroll does not recompute basic pay from attendance, so an absence does not reduce pay. The page
  says "Hours from Attendance" and that is currently only true as a label.
* **No night differential, overtime or holiday premium.** The brief lists them; the config has no
  rule for them and inventing one would be worse than omitting it.
* **No 13th-month accrual**, no leave conversion, no separation pay.
* **No payroll approval workflow** — an HR officer can release funds in one click; there is no
  second approver, and no period locking after release.
* **Contributions are not remitted** anywhere, and the employer share is not computed or reported.
* **The config is not verified against a live issuance.** It is dated 2025-01-01 and was read from
  secondary summaries of the circulars in August 2026. It must be confirmed against the current SSS,
  PhilHealth, HDMF and BIR issuances and reviewed by a Philippine accountant before any real use.
  Nothing in this build is a compliance claim.
