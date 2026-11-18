# Admissions, beds, transfers and discharge

The inpatient half of the hospital. An admission opens an episode, occupies a bed, accrues room and
board, can move between beds, and closes through a controlled discharge that releases the bed and
completes the final bill review.

Implementation: `assets/js/admissions.js` (store), `assets/js/admissions-page.js` (screen).
Screen: `admissions.html`. Tests: `scripts/revenue-check.mjs` §3.

## Why it exists

Before M12 the application had `Patient.ward`, `Patient.bed` and `Patient.admittedAt` — three strings
on a patient record — plus a cosmetic "Final statement" button on Billing. There was no admission
record, no bed board, no transfer history, no room-and-board accrual and no discharge. An inpatient
could not actually be admitted, and nothing stopped two patients being placed in the same bed.

## The model

```
admission { id:'ADM-0001', patientId, encounterId, status:'active'|'discharged',
            admittedAt, attending, dept, ward, bedId, bedLabel, bedType,
            diagnosis, reason, payer:{type,reference},
            transfers:[ { at, from, to, by, reason } ],
            legacyBilledThrough, discharge:{at,by,disposition,summary,note},
            dischargeHistory:[] }
```

**Occupancy is derived, never stored.** A bed is occupied when an active admission names it
(`occupantOf(bedId)`). There is no second `occupied` flag that can drift out of agreement with the
record. `mh_bed_state` holds only the states that are not a patient — cleaning and maintenance.

The bed inventory is 172 beds across six wards, generated from an explicit `WARDS` configuration. The
per-ward split (private / semi-private / ward) is stated rather than calculated, because the patient
registry already names two beds (`C-204`, `N-112`) and their type has to agree with the invoices the
demo already carries.

## The daily billing cutoff — one rule, everything else follows

> A calendar day is billable when the patient was in the bed at **12:00 Asia/Manila** on that day.
> The **admission day is always billable**. The discharge day counts only if the patient left after
> noon.

Consequences, all of them deliberate:

| Situation | Days billed |
|---|---|
| Admitted 08:00 Mon, discharged 15:00 Mon | 1 |
| Admitted 16:00 Mon, discharged 10:00 Tue | 1 (Mon only — left before Tuesday noon) |
| Admitted 16:00 Mon, discharged 15:00 Tue | 2 |
| Admitted 09:00 Mon, still in at 13:00 Wed | 3 |

The **rate is the rate of the bed occupied at that day's cutoff**, so a transfer after noon changes
the rate from the next day and an already-posted day never has to be re-priced. A transfer before
noon on a day whose cutoff has not yet passed is therefore also safe.

`legacyBilledThrough` marks an episode whose room and board is already inside its invoice's opening
amount. Accrual skips those dates, so the demo's two seeded admissions are not billed twice.

## Accrual is explicit and audited

`accrue(admissionId, {asOf})` posts one room line and one nursing line per billable day that has no
charge yet. It is **not** a page-load side effect: the screen offers a "Post charges" action, the
admit dialog runs it once for day one, and discharge runs it a final time. Each day is keyed
`room|<admissionId>|R&B:<date>`, so re-running posts nothing twice and the audit log records only
real postings.

A missing tariff is never invented: if a bed type has no configured rate, the day is reported in
`missing[]` and nothing is posted.

## Transfers

`transfer(admissionId, {bedId, reason})` validates that the destination is free and in service,
appends a row to `transfers` (never overwrites the previous bed), updates the registry's current
location, and writes an audit row. Overlapping bed assignments are impossible because occupancy is
derived from the single active admission, and a transfer is one atomic write.

## Discharge

`discharge(admissionId, {disposition, summary, at})` requires a disposition from the configured list
and a non-empty summary. It then:

1. records the discharge on the admission;
2. runs a final accrual through the discharge time;
3. moves the bed to `cleaning` so it cannot be reassigned while dirty;
4. clears the patient's ward/bed on the registry;
5. completes the encounter;
6. returns the unbilled charge count, the invoice id and its balance, so the screen can show what is
   still outstanding.

It does **not** delete the admission, the charges or the encounter. `cancelDischarge(id, reason)`
reopens a discharge recorded in error — the original stays in `dischargeHistory`, and the bed is
re-occupied only if nobody else has taken it.

## What is not modelled

* No ward round, nursing acuity or bed-request queue.
* No housekeeping workflow beyond the `cleaning` state.
* No inter-facility transfer.
* No bed reservation or planned admission.
* No insurance pre-authorisation gate on admission.
* Room and board is a flat daily rate per bed type: no proration for a partial day, no package rates,
  no professional fees.
* The demo clock is `HIS.today` (31 August 2026, pinned to 14:00). Admissions, accrual and discharge
  all read that clock, so a new admission is dated the same day the header shows.
