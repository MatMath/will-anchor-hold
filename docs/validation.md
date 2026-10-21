# Validation of the chain calculation

What was checked, against what, and what was found (October 2026). Both data issues found here
have since been **fixed** in the app: chain data now comes from the published DIN 766 table, and the
uplift curve is the yacht-derived one in section 3.

## Summary

| Item | Result |
|---|---|
| Catenary equations (chain on the seabed, fully lifted, nearly straight) | **Confirmed.** Matches NREL MoorPy to 1 part in 10¹⁰ and an independent numerical integration to < 1 µm |
| Submerged weight factor 0.869 | **Confirmed** (steel 7850 kg/m³ in seawater 1025 kg/m³) |
| Chain axial stiffness EA | **Confirmed** within 1.4% of the DNV studless formula; it barely affects results anyway |
| DIN 766 chain weight | Was 3.2 kg/m at 12 mm vs 3.1 published. **Fixed:** the app now uses the published table |
| DIN 766 chain MBL | Was 2.5–5.5% too high (unsafe side). **Fixed:** the app now uses the published table |
| Anchor holding vs uplift angle | Was far harsher than any published source. **Fixed:** yacht-derived curve, see section 3 |
| Yacht example (Peter Smith, 12 mm × 48 m in 8 m) | Qualitatively **consistent** |

## 1. Catenary — two independent checks

**NREL MoorPy.** MoorPy's `catenary()` (a port of Jason Jonkman's FAST/MAP catenary with seabed contact,
friction coefficient CB = 0) was run on 21 cases: three chains (8 mm × 30 m in 5 m, 10 mm × 40 m in
7.3 m, 12 mm × 60 m in 15 m), each from just-taut through chain partly on the seabed to fully lifted
and stretched beyond straight. Worst differences against the app:

| Quantity | Worst difference |
|---|---|
| Horizontal tension H | 2.8 × 10⁻¹¹ (relative) |
| Vertical tension at the roller | 3.3 × 10⁻¹² (relative) |
| Vertical (uplift) force at the anchor | 4 × 10⁻¹² N |
| Length of chain on the seabed | 4 × 10⁻¹² m |

A sample of those cases (10 mm chain, 40 m, 7.3 m from seabed to roller):

| Anchor → roller (m) | H (N) | On the seabed (m) | Uplift force at anchor (N) |
|---|---|---|---|
| 36.01 | 64.9 | 29.9 | 0 |
| 38.33 | 549.9 | 18.3 | 0 |
| 39.03 | 1 685 | 3.5 | 0 |
| 39.33 | 5 771 | 0 | 689 |
| 39.38 | 11 721 | 0 | 1 790 |

**Numerical integration.** `src/physics/validation.test.ts` integrates the chain's equilibrium
equations (dV/ds = w, dx/ds = H/T·(1 + T/EA), dz/ds = V/T·(1 + T/EA)) from the anchor with RK4 and
checks that the chain arrives exactly at the roller. It does, to < 1 µm, for all three chains across
the whole range. This checks the algebra of the closed form without relying on it.

**Lift-off rule of thumb.** The whole chain leaves the seabed when H ≥ w·(L² − Z²)/(2Z). This follows
from the catenary and is what the app shows; it is also why chain lifts so early in shallow water.

**Yacht cross-check (Peter Smith, petersmith.net.nz).** 12 mm chain, 48 m, 8 m from seabed to
roller (6:1). He reports that at 320 daN part of the chain still lies on the seabed and that at
2 000 daN the catenary has "all but disappeared". With 12 mm DIN 766 chain the app gives:

| Bow tension | On the seabed | Uplift at anchor | Rode angle at bow |
|---|---|---|---|
| 3 200 N | 4.7 m | 0° | 20.9° |
| 20 000 N | 0 m (fully lifted) | 7.8° | 11.4° |

Both match his description. The chain fully lifts at about 3.7 kN horizontal.

## 2. Chain data

**DIN 766 (Grade 3), Certex datasheet "Chain DIN 766A":**

| d (mm) | Published MBL (kN) | Old app MBL (kN) | Difference | Published weight (kg/m) | Old app weight (kg/m) |
|---|---|---|---|---|---|
| 6 | 17.65 | 18.10 | +2.5% | 0.75 | 0.75 |
| 8 | 31.38 | 32.17 | +2.5% | 1.35 | 1.35 |
| 10 | 49.00 | 50.27 | +2.6% | 2.25 | 2.25 |
| 12 | 68.64 | 72.38 | **+5.4%** | 3.1 | **3.2** |
| 16 | 123.56 | 128.68 | +4.1% | 5.8 | (5.8 by d² scaling from 14 mm: 5.75) |

The app's formula (320 N/mm² × 2 legs × πd²/4) overestimates the breaking load, most at 12 mm.
A UK retailer (GS Products) lists the same breaking loads (8 mm 3 000 kg, 12 mm 7 000 kg) with
slightly different weights (8 mm 1.4, 12 mm 3.4 kg/m), so weights vary by supplier by a few percent.
**Fixed:** the app uses the published DIN 766 table for Grade 30. Sizes not in the table (13, 14 mm)
are scaled by d² from the nearest listed size. Grade 40 / 70 values remain nominal (grade stress × 2 legs × area): check the
supplier's certificate.

**Axial stiffness.** DNV-OS-E302 (as given in the SINTEF SIMA/RIFLEX manual) has studless chain
EA = c·π·d² kN with c ≈ 27 − 0.02d for grade R3: 8.42 MN for 10 mm. The app uses 85.4·d² kN = 8.54 MN
(+1.4%). With fully lifted chain this changes the tension by well under 1%.

## 3. Anchor holding vs uplift angle

The app used to reduce holding to 75% at 5°, 50% at 10°, 30% at 15° and 20% at 20° of uplift. That
curve was a conservative rule of thumb and **was not supported by the sources found**:

| Uplift at anchor | Old app curve | API RP 2SK App. D (offshore drag anchors) | Yacht curve (now in the app) |
|---|---|---|---|
| 0–3° | 100% → 85% | 100% | 100% |
| 5° | 75% | 98% | 94% |
| 10° | 50% | 95% | 78% |
| 15° | 30% | 89% | 62% |
| 20° | 20% | 81% | 46% |

- **API RP 2SK Appendix D**, as tabulated in ABS (2013) *Offshore Anchor Data for Preliminary Design
  of Anchors of Floating Offshore Wind Turbines*, Table 6.2. It is for large, deeply buried offshore
  anchors (Vryhof, Bruce), under extreme conditions only. Yacht anchors bury much less deeply, so
  this is an upper bound.
- **US Navy mooring manual** (quoted in OTC 7491, *Vertical Loads on Drag Embedment Anchors*): up to 3°
  of line angle at the seabed causes no loss of anchor performance.
- **Sailing Foundation anchor tests (Fryer, 1995)**, based on Robert Smith's tests: "At 5:1 about 80%
  of each anchor's holding power should be achieved compared to 10:1 scope". With a nylon rode
  (nearly straight under load) that is an angle at the anchor of about 11.5° vs 5.7°. A straight line
  through "no loss up to 3°" that fits this 80% ratio loses about 3.15% per degree beyond 3°. That
  gives the "yacht data" column. It rests on one rule of thumb from scope tests, so treat it as indicative.

**Fixed:** the app now uses the yacht-derived curve: no loss up to 3°, then −3.15% per degree, with a
floor at 10%. It sits between the offshore standard and the old curve, and
the yacht tests support it. For the worked example (7.6° uplift) the holding factor went from 0.62 to
0.86, so the anchor ratio dropped from 151% to 110% — still red.

## Sources

- NREL MoorPy, `moorpy.Catenary.catenary` (Jonkman catenary with seabed contact): https://moorpy.readthedocs.io/
- MoorDyn catenary documentation (origin of the routine): https://moordyn.readthedocs.io/en/latest/doxygen/html/_q_slines_8hpp.html
- Certex, *Chain DIN 766A* datasheet: https://www.certex.dk/en_GB/download/productpage/39537
- GS Products, DIN 766 Grade 30 galvanised chain: https://gsproducts.co.uk/8mm-galvanised-steel-short-link-chain, https://www.gsproducts.co.uk/12mm-galvanised-steel-short-link-chain/
- SINTEF SIMA/RIFLEX, chain cross-section (DNV-OS-E302 EA formula): https://sima.sintef.no/docs/latest/riflex/sima/context/ChainCrossSection.html
- ABS (2013), *Offshore Anchor Data for Preliminary Design of Anchors of Floating Offshore Wind Turbines*, Table 6.2: https://www.osti.gov/servlets/purl/1178273
- OTC 7491 (1994), *Vertical Loads on Drag Embedment Anchors*: https://stewart-usa.com/wp-content/uploads/2018/10/OTC-7491-Vertical-Loads-on-Drag-Embedment-Anchors-1994.pdf
- The Sailing Foundation (1995), *Anchor Tests, Puget Sound* (D. Fryer): https://www.ussailing.org/wp-content/uploads/2018/04/anchor-study.pdf
- Peter Smith, *Anchor rode catenary*: https://petersmith.net.nz/boat-anchors/catenary.php
