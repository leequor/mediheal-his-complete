# Completion roadmap

What is left, in priority order, with the reason each item is still open. M12 closed the two largest
gaps — the revenue loop and the inpatient lifecycle — so what remains is smaller, and most of it is
either blocked on something outside this repository or deliberately deferred.

---

## 1. Closed in M12

| Gap | Outcome |
|---|---|
| Charges attached to "the oldest invoice with a balance" | Replaced by an explicit encounter → invoice chain |
| A charge with no invoice was discarded | Persistent unbilled queue with an audited assignment step |
| No invoice could ever be created | `mh_invoices` is writable; Billing can open a bill for an episode |
| No consultation billing | Saving a diagnosis raises the configured fee, once per encounter |
| A cancelled laboratory order left a live charge | Stated billing policy: void before collection, retain after |
| No way to reverse a dispense | Full return of one dispensing event, stock restored, charge voided |
| No admission, bed board, transfer, accrual or discharge | Full ADT module, 172 beds, noon cutoff, final accrual on discharge |
| No charge master | `tariffs.js` with effective-dated rows and price snapshots |
| Reports ignored unbilled revenue and occupancy | Both derived and shown |

### 1.1 Closed in the M12 closeout

| Item | Outcome |
|---|---|
| The Configuration screen implied more than it administers | Subtitle, KPI and card headings now state that only tariffs are editable; the boundary is also a table in `PROJECT-STATUS.md` §2 |
| **A transfer mis-priced earlier days** | `bedAt()` used the *current* bed as the base for times before the first transfer, so re-accruing an earlier day after a transfer charged the destination rate. The base is now the admitting bed (`transfers[0].from`). Found by `adt-boundary-check.mjs` §4, not by the existing suites — they had already posted those days, so the duplicate guard hid it |
| Boundary and idempotency behaviour was untested | `adt-boundary-check.mjs`: 59 assertions over the admission day, the noon cutoff, the discharge day, transfers either side of the cutoff, repeated accrual, repeated discharge, reopen, reload, derived occupancy, duplicate bed assignment, invoice association and history preservation |
| Concurrency was described loosely | `PROJECT-STATUS.md` §5.1 states what the store cannot do, and §12 of the boundary suite demonstrates the lost update rather than asserting safety |

## 2. Highest value next

### 2.1 Catalogue and bed configuration screens
M12 added `settings.html`, so tariffs are now administrable: a price change is an appended,
effective-dated row, with a per-code history and an audit entry. The **laboratory catalogue** and the
**bed inventory** are still seeded from code (`lab.js` CATALOG, `admissions.js` WARDS) and are only
listed read-only on that screen — the screen and `PROJECT-STATUS.md` §2 now say so explicitly rather
than leaving it to be discovered. **Why it is not done:** adding a test or a bed needs a catalogue
editor, validation, and a decision about orders already placed against a retired test. Half-building
it would be worse than the current honest boundary. It remains the last configuration gap.

### 2.2 Proration for hires and separations
`employees.js` has no hire date or separation date, so a mid-period joiner is paid a full period and
a leaver is paid as if present all month. **Why it is not done:** the proration basis is an
employer-policy question (calendar days vs working days vs the 261 divisor), and the payroll
methodology is explicitly parked. It needs a policy decision before it needs code.

### 2.3 Portal views for admission and claims
The portal shows appointments, results, bills and documents. An inpatient cannot see their admission
or their claim status as its own view; both are only implied by the statement. **Why it is not
done:** lower value than the revenue work, and the portal's authorisation model is already in place,
so this is a rendering job rather than a design question.

## 3. Blocked on something outside the repository

| Item | Blocked by |
|---|---|
| PhilHealth eClaims submission | No credential, no authorisation, no test environment |
| HMO eligibility and LOA verification | No payer API access |
| Payment gateway / bank settlement | No merchant account; electronic payments are recorded intents |
| Government payroll filing | No authorisation |
| SMS and email delivery | No gateway |
| Laboratory instrument interfaces | No equipment, no ASTM/HL7 endpoint |
| Procurement / supplier ordering | No supplier system |

Each is represented in the demo as a labelled simulation or a stated placeholder, never as a
connection.

## 4. Deliberately deferred

| Item | Reason |
|---|---|
| Article 83 sixth-day premium | The employer's city population is not on record with a source. Pricing it would be inventing a legal fact. |
| 15 regional wage orders | The NWPC headline range cannot be mapped to a wage category without reading each order. CAR-24 is an image scan. |
| Pag-IBIG Circulars 274/460 | The primary sources are behind a reCAPTCHA and were never read. The rule rests on RA 9679, which a circular cannot override. |
| The 261 divisor as "company practice" | There is no contract, manual or historical payslip. It is labelled a configured assumption. |
| Partial pharmacy returns | A half-returned batch has no honest single price. Refused rather than approximated. |
| Charge credit notes | Reversal is a void, which is auditable and sufficient for the demo. |

## 5. Architectural limits that will not be fixed here

- **Client-side authentication.** A session can be forged from devtools. `docs/AUTH.md` describes what
  a real deployment needs.
- **`localStorage` as the database.** Per-browser, ~5 MB, no transactions, no concurrency. Two tabs are
  two writers with no locking.
- **No server-side authorisation.** Every restriction is a JavaScript allowlist.
- **Admin tables below 1440 px.** They stack into unlabelled blocks. Shared with Laboratory, Pharmacy,
  Claims, Accounts, Audit and Reports; the desktop layout is the design contract.

## 6. Suggested order if work continues

1. Tariff / catalogue / bed administration screen (§2.1) — closes three partial capabilities.
2. Portal admission and claim views (§2.3) — small, self-contained, visible.
3. Payroll proration (§2.2) — only after a policy decision on the proration basis.
4. Anything in §3 — only when a credential or an authorisation actually exists.

Do not open a new milestone to re-research the payroll methodology. Those questions are recorded in
`docs/PAYROLL.md` §10 and need a Philippine practitioner, not another audit.
