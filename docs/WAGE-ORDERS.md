# Wage-order coverage and expansion plan

`assets/js/wage-floor.js` applies a minimum wage only for a region whose **category mapping has been
read from the order itself**. Two regions meet that bar. Fifteen do not, and are refused rather than
approximated.

Last reviewed: 2026-11-18 against <https://nwpc.dole.gov.ph/>.

---

## 1. What is enabled

| Region | Order | Effective | Split | Rates |
|---|---|---|---|---|
| NCR | NCR-28 | 2026-09-26 | Industry | ₱755.00 non-agriculture · ₱718.00 agriculture, retail-service |
| Region VII | ROVII-27 | 2026-10-14 | **Locality** | ₱582.00 Class A (Expanded Metro Cebu) · ₱542.00 elsewhere |

Two details that the module has to carry because the orders carry them:

* **NCR-27** (25 July 2026) is *suspended* — implementation awaits Pasig RTC 152 and Navotas RTC 287.
  It is modelled, never applied, and its announced second tranche (₱743.00–₱780.00 on 20 January
  2027) is `contingent`: not applied on its date, and not at all unless the suspension is lifted.
* **ROVII-27** keeps Negros Oriental and Siquijor under RTWPB VII until the Negros Island Region
  board is constituted. A Region VII employee in those provinces is covered by this order.

## 2. What is registered but refused

The NWPC publishes one headline range per region. The endpoints only mean something once they are
mapped to the categories *inside* the order — and that mapping has not been read for these. Applying
the top of the range to every employer would overstate the floor for most of them; applying the
bottom would understate it. Both would be invented.

| Region | Order | Effective | Published range | Note |
|---|---|---|---|---|
| CAR | CAR-24 | 2025-12-30 | ₱505.00 | Single rate published; order text not yet read |
| Region I | RB1-24 | 2025-11-19 | ₱480.00–₱505.00 | |
| Region II | RTWPB 2-24 | 2025-11-05 | ₱500.00 | |
| Region III | RBIII-26 | 2025-10-30 | ₱475.00–₱600.00 | Second tranche ₱515.00–₱600.00 from 2026-04-16 |
| Region IV-A | IVA-23 | 2026-10-26 | ₱550.00–₱645.00 | |
| Region IV-B | MIMAROPA-13 | 2026-01-01 | ₱455.00 | |
| Region V | RBV-23 | 2026-04-08 | ₱455.00–₱480.00 | Second tranche ₱480.00 from 2026-12-01 |
| Region VI | VI-30 | 2026-11-20 | ₱565.00–₱590.00 | |
| Region VIII | RB VIII-25 | 2025-12-08 | ₱422.00–₱470.00 | Second tranche ₱440.00–₱470.00 from 2026-06-01 |
| Region IX | RIX-24 | 2026-01-01 | ₱426.00–₱464.00 | Second tranche ₱451.00–₱464.00 from 2026-06-01 |
| Region X | RX-24 | 2026-01-16 | ₱471.00–₱500.00 | Second tranche ₱485.00–₱500.00 from 2026-05-01 |
| Region XI | RB XI-24 | 2026-03-13 | ₱515.00–₱540.00 | Second tranche ₱525.00–₱540.00 from 2026-09-01 |
| Region XII | XII-26 | 2026-11-22 | ₱459.00–₱501.00 | Second tranche ₱484.00–₱501.00 from 2027-01-01 |
| Region XIII | RXIII-20 | 2026-01-03 | ₱455.00–₱475.00 | Second tranche ₱475.00 from 2026-05-01 |
| BARMM | BARMM-05 | 2026-08-06 | ₱401.00–₱461.00 | Second tranche ₱426.00–₱461.00 from 2026-12-01 |

A second tranche is a **future** rate. It must not be applied before its date, and several of these
orders are still within their first tranche.

## 3. Expansion plan

Priority is by exposure — how many staff a region would cover — and by how much work the order needs.

| Priority | Region | Work required | Why this order |
|---|---|---|---|
| 1 | Region IV-A | Read IVA-23; it splits by locality (the ₱550–₱645 range suggests at least two areas) | Largest workforce outside NCR |
| 2 | Region III | Read RBIII-26 including the April 2026 tranche | Large industrial base, two tranches already in force |
| 3 | Region VI | Read VI-30; two rates, likely locality or industry | Large hospital sector |
| 4 | Region VII | **Done** | — |
| 5 | CAR, II, IV-B | Single published rate — confirm the order has no second category | Cheap to verify |
| 6 | I, V, VIII, IX, X, XI, XII, XIII, BARMM | Read each order and map its categories; most have a second tranche | Long tail |

For each region the work is the same four steps:

1. Download the order PDF from the NWPC regional page.
2. Read Section 2 (the rate table) and record every category and its rate.
3. Record the effectivity clause — several say "15 days after publication", which is how the NWPC
   summary date is derived.
4. Record any second tranche as a separate effective-dated entry, never as the current rate.

### A known obstacle

Some orders are published as image scans. `CAR-24` returned no extractable text during this review,
so it could not be verified. Those orders need OCR or a manual read before they can be enabled —
another reason not to guess.

## 4. What the module refuses to do

* Apply one national rate.
* Apply the top or bottom of a published range without knowing which category it belongs to.
* Apply a suspended order, or a tranche before its effective date.
* Apply an exemption without an authorisation reference on the employee record.
* Model establishment-size rules, partial exemptions, or the sector definitions inside an order —
  those remain a determination for a hospital's HR and legal team.

**This is not a compliance determination.** It is a validation that refuses to guess.
