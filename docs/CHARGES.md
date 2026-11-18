# Billable charges

A charge is a **price event**: "this patient incurred ₱350 for a CBC". It is not money. It raises what
the invoice says is owed and never touches the ledger's collected figure.

Implementation: `assets/js/charges.js`. Charge master: `assets/js/tariffs.js`. Episodes:
`assets/js/encounters.js`. Tests: `scripts/charges-check.mjs`, `scripts/revenue-check.mjs`.

## Why it exists

Before M11 the invoice total was a number written by hand in `data-billing.js`. A laboratory order, a
dispensed drug and a consultation were all recorded, but none of them became billable — the revenue
loop stopped at the ward. The Billing screen's detail table already had a "charge source" column; it
had nothing to put in it.

## The model

```
{ id:'CH-0001', key:'pharmacy|RX-0001#1|Aspirin 81 mg tablet',
  patientId, encounterId, invoiceId,
  billingStatus:'assigned'|'unbilled', unbilledReason,
  source, sourceLabel, sourceId, code, description, qty, unitPrice, amount,
  priceSnapshot:{ unitPrice, tariffCode, effectiveFrom, capturedAt },
  at, by, status:'active'|'void',
  assignedAt, assignedBy, assignmentReason,
  voidedAt, voidedBy, voidReason }
```

`amount = qty × unitPrice`, rounded to centavos. `status` is `active` or `void`; a voided charge stays
in the store for the trail and is excluded from every total.

### Sources

| Source | Raised by | Priced from |
|---|---|---|
| `laboratory` | `HIS.lab.create()` | `CATALOG[test].price`, dated `2026-01-01` |
| `pharmacy` | `HIS.pharmacy.dispense()` | the batch's retail `price` × quantity actually dispensed |
| `consultation` | saving a diagnosis in Consultation | `tariffs` → `CONS-<dept>` |
| `room` | `HIS.admissions.accrue()` | `tariffs` → `ROOM-PRIVATE` / `ROOM-SEMI` / `ROOM-WARD` |
| `nursing` | `HIS.admissions.accrue()` | `tariffs` → `NURSE-DAY` |
| `procedure`, `manual` | reserved, not wired | — |

## Idempotency

A charge is keyed on `source | sourceId | code`. Re-saving an order, re-rendering a screen or retrying
a dispense cannot bill the same event twice: `add()` returns the original row with `duplicate: true`.
A partial dispense is keyed on the dispense event (`RX-0002#1`, `RX-0002#2`), so each quantity bills
once and only once. A daily room charge is keyed on `room|<admission>|R&B:<date>`, so re-running the
accrual posts nothing twice.

## Where a charge lands — the M12 change

M11 attached a charge to "the patient's oldest invoice that still has a balance". That is a guess, and
it had two failures:

* A patient with a closed clinic visit and an open admission would have today's ward order billed to
  last month's clinic bill.
* A patient with no open invoice had the charge **discarded**. The service was recorded and the
  revenue vanished.

Now the chain is explicit:

```
patient → encounter → invoice (optional) → charge
```

`charges.add()` resolves `invoiceId` from the charge's **encounter**. If the encounter has no invoice,
the charge is still created, with `billingStatus:'unbilled'` and an `unbilledReason`, and it waits in
the queue. Nothing is guessed and nothing is lost.

Moving a charge out of the queue is `charges.assign(chargeId, invoiceId, reason)`:

* refused if the charge is already on an invoice;
* refused if the invoice belongs to a different patient;
* refused without a reason;
* writes an audit row with the operator and the reason.

`charges.unassign(chargeId, reason)` puts it back, and is audited the same way. The Charges screen
(`charges.html`) is the queue's interface.

## Price snapshots

Every charge copies the price it was raised at into `priceSnapshot`. A tariff change afterwards
changes the next charge, not this one. `tariffs.priceFor(code, date)` resolves the latest row whose
`effectiveFrom` is on or before that date, so a price can be scheduled in advance without moving any
existing figure.

## How it reaches the money

`HIS.ledger.invoiceAmount(bill) = bill.amount + HIS.charges.totalFor(bill.id)`. Every balance, status,
total and reconciliation goes through that function, so Billing, Reports, the patient portal and
Claims all see the same figure.

```
total       = opening amount + active charges assigned to the invoice
outstanding = total - collected - covered
```

A charge therefore raises the balance without raising `collected`. The identity still holds to the
centavo and `ledger.invariants()` proves it.

## Voiding and reversal

`void(id, reason)` requires a reason, refuses a second void, records who and when, and writes an audit
row. The invoice total falls by exactly the voided amount. The row keeps its price snapshot.

`voidForSource(source, sourceId, reason)` voids every active charge raised by one event. Two clinical
modules use it:

* **Laboratory.** Cancelling before collection voids the charge (no service was rendered); cancelling
  after collection keeps it (consumables and bench time were used). The policy is stated on the order
  and shown in the cancel dialog before the operator commits.
* **Pharmacy.** Returning a dispensing event in full voids that event's charge, puts the stock back as
  its own movement, and records the return beside the original dispense. Partial returns are refused
  rather than approximated.

## Reconciliation

`charges.reconcile()` reports, by code: `duplicate-key`, `orphan-invoice`, `wrong-patient`,
`status-mismatch`, `negative-charge`, `missing-snapshot`, `invoice-charge-total`. It also counts
charges with no encounter (`withoutEncounter`). The Charges screen shows a red strip when any of them
is non-zero; `revenue-check.mjs` asserts the list is empty after a full workflow.

## What is not modelled

* No payer-specific price tiers: one price per code for everyone.
* No VAT treatment per line. The invoice's opening VAT is unchanged by charges; they are added to the
  grand total, not taxed.
* No credit notes — a reversal is a void, not a negative line.
* No charge refunds to a patient.
* Laboratory prices live in `lab.js` `CATALOG` rather than `tariffs.js`, because that catalogue already
  carries a price per test and a second copy would be two sources for one number. They carry the same
  `effectiveFrom` field and the same snapshot behaviour.
