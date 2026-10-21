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
| Rocna KB "Scope vs catenary" depth chart, simulations and wind loads | **Reproduced**: 7.51:1 vs 7.5:1 at 7 ft; 16 m wind loads −6% beam-on (section 4) |

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


## 4. Rocna Knowledge Base: "Scope vs catenary"

The Rocna KB article (by Peter Smith, Rocna's designer; same material as petersmith.net.nz) makes its
case with static simulations. Every claim with numbers reproduces with the app's model:

**Depth chart.** 8 mm chain, 500 daN in the system, constant 6.6° pull on the anchor. The Rocna
text only says the need for scope decreases with depth; the same chart on petersmith.net.nz gives the
end points: scope "decreases from 7.5:1 in 7′ water to less than 4:1 in nearly 100′". App,
8 mm DIN 766 chain (1.35 kg/m), scope measured from seabed to bow roller as the article defines it:

| Depth | 7 ft | 15 ft | 30 ft | 60 ft | 95 ft | 100 ft |
|---|---|---|---|---|---|---|
| Scope for 6.6° at 500 daN | **7.51:1** | 6.70:1 | 5.76:1 | 4.76:1 | 4.11:1 | 4.04:1 |
| Same with 1.6 kg/m (heavier 5/16″ US chain) | 7.36:1 | 6.48:1 | 5.52:1 | 4.51:1 | **3.88:1** | 3.82:1 |

The 7 ft value matches exactly; near 100 ft the app gives 3.9–4.1:1 depending on the chain weight
assumed (the article does not state it).

**20 kn vs 50 kn simulations.** 48 m of 12 mm chain, 8 m from seabed to roller (6:1), 320 daN and
2 000 daN. The article: at 20 kn the catenary is "obvious"; at 50 kn it "has all but disappeared".

| Horizontal load | On the seabed | Uplift at anchor | Largest gap between chain and straight line |
|---|---|---|---|
| 3 200 N | 3.3 m | 0° | 2.27 m |
| 3 700 N | 0 m (just fully lifted) | 0° | 1.99 m |
| 10 000 N | 0 m | 6.0° | 0.74 m |
| 20 000 N | 0 m | 7.8° | 0.37 m |

This also bears out its main point: the load that lifts all the chain is low (3.7 kN here, about
the 20 kn load), so in a real blow the chain's weight no longer protects the anchor.

**Angles for a straight rode.** "At 8:1 … just over 7°": asin(1/8) = 7.18°. "The scope must be
doubled in order to halve the angle": 5:1 → 11.5°, 10:1 → 5.7°.

**Wind loads.** The article's loads scale exactly with V² (2 000 / 320 = (50/20)²). With the app's
windage estimator and beam-on wind, a 16 m monohull gives 302 daN at 20 kn and 1 884 daN at 50 kn
(article: 320 and 2 000, −6%). A 10 m boat at 40 kn gives 600 daN beam-on and 524 daN with the wind
30° off the bow (article: 500 daN). The article's figures therefore correspond to a boat yawing well
off the wind, not lying head to wind (head-on the app gives about a third of that).

Both the app and the article are static; neither includes snatch loads.

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
- Rocna Knowledge Base, *Scope vs catenary*: https://kb.rocna.com/kb/Scope_vs_catenary
