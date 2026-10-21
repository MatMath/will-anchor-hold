# Worked example — check it by hand

This is the case built into the app (**"Load worked example"** button) and frozen in
`src/physics/example.ts`. The unit tests (`src/physics/*.test.ts`) check every number below.

## The situation

| Item | Value |
|---|---|
| Boat | 12.8 m monohull, 10 500 kg |
| Windage | side 30 m², front 12 m², Cd side 1.0, Cd front 0.8, centre of effort 0.3 m aft of midships |
| Wind | 30 kn from 90° (starboard beam), gust factor 1.4 |
| Depth / roller | 6.0 m water, bow roller 1.3 m above water, 0.3 m ahead of the stem |
| Chain | 40 m of 10 mm DIN 766 (Grade 30) galvanised, 2.25 kg/m |
| Anchor | 20 kg new-generation in sand, 58 m from the quay, on the centreline |
| Stern lines | 2 × 14 mm nylon 3-strand, 6.455 m each, cleats 3.36 m apart (80% of the beam) and 0.3 m forward of the transom at 1.2 m height, to two rings 4 m apart at 0.5 m height |

Earth axes: **x** from the quay towards the anchor, **y** to port. The quay face is x = 0.

---

## 1. Wind force

Wind speed: 30 kn × 0.5144 = **15.433 m/s**

Dynamic pressure: q = ½ · ρ · V² = 0.5 × 1.225 × 15.433² = **145.9 Pa**

Beam-on: F = q · Cd · A = 145.9 × 1.0 × 30 = **4 377 N ≈ 4.38 kN**

Gust: speed × 1.4 = 42 kn, so the force is × 1.4² = 1.96 → **8 578 N**.

The solver finds that the boat turns 4.4° bow-to-port, so the wind arrives at 94.4° off the bow, not 90°.
At angle θ the drag-area is CdA = 1.0·30·|sin θ| + 0.8·12·|cos θ|:

CdA(94.4°) = 30 × 0.99705 + 9.6 × 0.07672 = 29.912 + 0.737 = **30.65 m²** → F = 145.9 × 30.65 = **4 471 N**

> **Drag coefficient — is 1.0 / 0.8 right?** Yes, roughly. The reason head-on loads are much lower is mainly the **area**
> (12 m² vs 30 m²), not Cd. A yacht's bow is not very streamlined once you add the mast, rigging, furled
> genoa, pulpit and sprayhood, so head-on Cd is about 0.7–0.9. Side-on Cd is about 0.9–1.2 because the
> shape is blunt. So Cd·A head-on is about 9.6 m² against 30 m² beam-on, roughly one third.

## 2. Chain properties

| | Formula | Value |
|---|---|---|
| Submerged weight w | 2.25 kg/m × 9.807 × (1 − 1025/7850) | **19.18 N/m** |
| MBL | 320 N/mm² × 2 legs × π·10²/4 | **50.3 kN** |
| Axial stiffness EA | 85.4 · d² kN (DNV, studless) | 8.54 MN (barely matters here) |

Height from seabed to roller: Z = 6.0 + 1.3 = **7.3 m**.

## 3. Catenary at rest (H = 1 000 N pretension)

Use the classical catenary with chain lying on the seabed (EA ignored, error < 5 mm):

- Catenary parameter a = H / w = 1000 / 19.18 = **52.13 m**
- Suspended length s = √(Z² + 2·a·Z) = √(7.3² + 2 × 52.13 × 7.3) = √814.4 = **28.54 m**
- Horizontal reach of the suspended part x_s = a · asinh(s/a) = 52.13 × asinh(0.5475) = **27.28 m**
- Chain on the seabed = 40 − 28.54 = **11.46 m**
- Anchor to roller, horizontally: 11.46 + 27.28 = **38.74 m**
- Vertical force at the roller: V = w·s = 19.18 × 28.54 = **547.5 N**
- Bow tension: √(1000² + 547.5²) = **1 140 N**, leaving the roller 28.7° below horizontal

**When does the anchor start to be lifted?** The whole chain is off the seabed when s = L:

  H_lift = w · (L² − Z²) / (2Z) = 19.18 × (1600 − 53.3) / 14.6 = **2 032 N**

So with only **2 kN** of horizontal pull, this 40 m of chain is already fully lifted and the anchor feels an
upward pull. That point is reached quickly in a beam wind; see step 5.

## 4. Stern line stretch

14 mm nylon 3-strand: MBL ≈ 0.205 × 14² = **40.2 kN**. The app always takes 85% of that for knots, splices and chafe = **34.15 kN** effective.

Load–strain table for nylon 3-strand: (load/MBL → strain) 10% → 5%, 20% → 9%, 30% → 13%, linear between points.

## 5. Equilibrium at 30 kn on the beam (sustained)

The solver returns the boat pose: midships at (12.171, 3.420) m, heading +4.40°.
You can check that every force below follows from that pose, and that they balance.

**Chain.** Bow roller at (18.851, 3.934); anchor at (58, 0).
Horizontal distance = √(39.149² + 3.934²) = **39.35 m**. The catenary gives H = **7 289 N**, which is above
the 2 032 N lift threshold, so the chain is fully off the seabed:

- V at roller = 1 737.2 N, V at anchor = 969.8 N. The difference 767.4 N = w·L = 19.18 × 40 ✓
- Bow tension = √(7289² + 1737.2²) = **7 493 N** (15% of chain MBL, green)
- Uplift angle at the anchor = atan(969.8 / 7289) = **7.6°**

Chain force on the boat = 7289 × (39.149, −3.934) / 39.35 = **(+7 252, −729) N**

**Port line.** Cleat (5.960, 4.627) → ring (0, +2): horizontal 6.513 m, height drop 0.7 m → length 6.551 m.
Strain = 6.551 / 6.455 − 1 = 1.48% → load 2.97% of 34.15 kN = **1 014 N**. Force on the boat **(−922, −406) N**.

**Starboard line.** Cleat (6.218, 1.277) → ring (0, −2): horizontal 7.029 m → length 7.063 m.
Strain = 9.42% → between 20% (9%) and 30% (13%): 20% + (9.42 − 9)/(13 − 9) × 10% = 21.1% → **7 191 N**
(green, under the 30% amber limit). Force on the boat **(−6 330, −3 336) N**.

**Check the balance** (moments about midships, M = rx·Fy − ry·Fx):

| Force | Lever arm r (m) | F (N) | M (N·m) |
|---|---|---|---|
| Wind at CE | (−0.299, −0.023) | (0, +4 471.2) | −1 337.4 |
| Chain at roller | (+6.680, +0.514) | (+7 252.1, −728.7) | −8 595.3 |
| Port line | (−6.211, +1.207) | (−922.1, −406.4) | +3 637.4 |
| Starboard line | (−5.953, −2.143) | (−6 330.0, −3 336.1) | +6 295.2 |
| **Sum** | | **(0.0, 0.0)** | **0.0** |

**Load split.** Of the 4.47 kN sideways push, the chain takes 729 N (**16%**) and the stern lines take
3 742 N (**84%**). But the chain **tension** is 7.5 kN, **1.7 × the wind force**. Both chain and lines
pull almost fore-and-aft. To resist a sideways force they must swing to an angle, and the fore-aft tensions
grow until the two ends' sideways components carry the load.

**Drift.** Midships moves 3.42 m to port, the bow 3.93 m and the stern 2.95 m. The boat turns 4.4° and moves
0.39 m towards the quay.

**Anchor.** Holding when pulled flat ≈ 20 kg × 40 = 800 kgf = 7.85 kN. With a 7.6° uplift the holding drops to
62% → **4.87 kN**. The load at the anchor is 7.35 kN = **151% of the estimated holding → red: the anchor is
likely to drag**. The fix: more chain, which lowers the uplift, or a heavier/better anchor.

## 6. Gust (42 kn)

Wind 8.83 kN (including the 6.2° yaw); chain 13.3 kN; starboard line 11.8 kN (34% of effective MBL → amber);
side shift 4.0 m.

## 7. Snatch load (indicative)

Mooring stiffness along the wind at the sustained equilibrium: k ≈ 5.6 kN/m. Effective mass with sideways
added mass ≈ 10 500 × 1.99 = 20 900 kg. A 0.5 m/s sideways surge brought to a stop adds about
ΔF = v·√(m·k) = 0.5 × √(20 900 × 5 593) ≈ **5.4 kN** on top of the static load.
A sudden gust (step load) on an undamped spring can overshoot to **2 ×** the gust increment.
A nylon snubber, or longer nylon stern lines, lowers k and so lowers ΔF.
