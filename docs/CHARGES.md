# Billable charges

A charge is a **price event**: "this patient incurred ₱350 for a CBC". It is not money. It raises what
the invoice says is owed and never touches the ledger's collected figure.

Implementation: `assets/js/charges.js`. Tests: `scripts/charges-check.mjs`.

## Why it exists

Before M11 the invoice total was a number written by hand in `data-billing.js`. A laboratory order, a
dispensed drug and a consultation were all recorded, but none of them became billable — the revenue
loop stopped at the ward. The Billing screen's detail table already had a "charge source" column; it
had nothing to put in it.

## The model

```
{ id:'CH-0001', key:'pharmacy|RX-0001#1|Aspirin 81 mg tablet',
  invoiceId, patientId, source, sourceLabel, sourceId, code,
  description, qty, unitPrice, amount, at, by, status:'active'|'void',
  voidedAt, voidedBy, voidReason }
```

`amount = qty × unitPrice`, rounded to centavos. `status` is `active` or `void`; a voided charge stays
in the store for the trail and is excluded from every total.

### Sources

| Source | Raised by | Priced from |
|---|---|---|
| `laboratory` | `HIS.lab.create()` | `CATALOG[test].price` |
| `pharmacy` | `HIS.pharmacy.dispense()` | the batch's retail `price` × quantity dispensed |
| `consultation`, `room`, `nursing`, `manual` | reserved, not wired | — |

## Idempotency

A charge is keyed on `source | sourceId | code`. Re-saving an order, re-rendering a screen or retrying
a dispense cannot bill the same event twice: `add()` returns the original row with `duplicate: true`.
A partial dispense is keyed on the dispense event (`RX-0002#1`, `RX-0002#2`), so each quantity bills
once and only once.

## Where a charge lands

`openInvoiceFor(patientId)` returns the patient's oldest invoice that still has a balance. If the
patient has none — every invoice is settled — no charge is raised and the clinical record says so
(`order.billing = 'No open invoice for …'`). Charging a settled invoice would reopen it and misstate
what is owed.

## How it reaches the money

`HIS.ledger.invoiceAmount(bill) = bill.amount + HIS.charges.totalFor(bill.id)`. Every balance, status,
total and reconciliation goes through that function, so Billing, Reports, the patient portal and
Claims all see the same figure.

```
total      = opening amount + active charges
outstanding = total - collected - covered
```

A charge therefore raises the balance without raising `collected`. The identity still holds to the
centavo and `ledger.invariants()` proves it.

## Voiding

`void(id, reason)` requires a reason, refuses a second void, records who and when, and writes an audit
row. The invoice total falls by exactly the voided amount.

## What is not modelled

* No charge master with effective dates, payer-specific prices or VAT treatment per line.
* No credit notes or charge refunds.
* The invoice's opening VAT is unchanged by charges; they are added to the grand total, not taxed.
* No unbilled queue: a patient with no open invoice simply is not charged.
* No room-and-board accrual, because there is no admission/discharge workflow yet.
