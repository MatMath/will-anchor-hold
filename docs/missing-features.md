# Missing features — what would make this a better simulator

What the model leaves out today, why it matters, and where it would fit in the code
(see [architecture.md](architecture.md) for the extension points). Nothing here is implemented yet.

**Priority**: High = changes answers people rely on in common situations · Medium = matters in some
situations · Low = refinement. **Effort**: S (days) · M (a week or two) · L (a research-grade piece of work).

## Summary

| # | Missing | Priority | Effort |
|---|---|---|---|
| 1 | Laid moorings (lazy lines to a ground chain) instead of an own anchor | High | M |
| 2 | Current (tide, river) | High | S |
| 3 | Sloping seabed | High | M |
| 4 | Anchor dragging and re-setting | High | M |
| 5 | Deck hardware and the weakest link (roller, cleats, shackles, windlass) | High | S |
| 6 | Real yaw dynamics for fishtailing (sailing at anchor) | High | L |
| 7 | Chain dynamics (inertia and drag of the chain itself) | High | L |
| 8 | Wind force coefficients by angle (side force, yaw moment) | Medium | M |
| 9 | Irregular sea: wave spectrum, wave groups, statistics over a storm | Medium | M |
| 10 | Swell from a different direction than the wind | Medium | S |
| 11 | Slow-drift (low-frequency) wave forces and surge resonance | Medium | M |
| 12 | Heave, pitch and roll dynamics (RAOs, resonance) | Medium | L |
| 13 | Tide range: depth and quay height change during the stay | Medium | S |
| 14 | Mixed rodes: chain + rope, kellet, two sizes of chain, catamaran bridle | Medium | M |
| 15 | Rope behaviour under cycling: hysteresis, wet vs dry, creep, sag of long lines | Medium | M |
| 16 | Seabed friction on the lying chain | Low | S |
| 17 | Neighbouring boats and the quay: shelter, fenders, contact, stern hitting the quay | Medium | M |
| 18 | Multiple anchors (two bow anchors, Bahamian moor) | Low | M |
| 19 | Wind: gust spectrum, wind gradient with height, turbulence | Low | M |
| 20 | Fatigue and wear (cyclic loads, chafe, age) | Low | M |
| 21 | Uncertainty and sensitivity analysis | Medium | M |
| 22 | Comparison with measured loads (load-cell import) | Medium | S |

## 1. Laid moorings (lazy lines to a ground chain) — High, M

Most Mediterranean marinas don't use the boat's own anchor: a lazy line from the quay leads to a heavy
ground chain or block, and the bow line is tied to it. Today the app only models an own anchor and chain.

- **Model**: bow line (rope, possibly with a short chain) from bow cleat to a fixed point on a ground chain
  at a set distance and depth; the ground chain is effectively an anchor with very high holding but a
  catenary of its own. The bow line is usually short and steep, so it behaves like a stiff stern line.
- **Fits**: a new contributor in `mooring/forces.ts` (like `sternLinesOnCleats`), an input for "bow:
  own anchor / laid mooring" in `analysis/inputs.ts` and `buildModel`.

## 2. Current — High, S

No current is applied, so the water exerts no steady force. Tidal or river current pushes the underwater
hull and keel, often at an angle to the wind (wind against tide), and changes the heading of a boat
swinging at anchor.

- **Model**: drag on the underwater profile, ½·ρw·Cd·A·U², with lateral area (hull + keel + rudder) and
  frontal area by angle, like the wind; current also adds hydrodynamic damping.
- **Fits**: a `currentOnHull` contributor in `mooring/forces.ts`; inputs speed and direction. The
  equilibrium, stiffness, waves and animation pick it up automatically.

## 3. Sloping seabed — High, M

Med-mooring harbours usually shoal towards the quay: the anchor lies in deeper water than the boat. The
catenary assumes a flat seabed, which mis-states the chain length lying on the bottom and the uplift angle.

- **Model**: catenary with the touchdown on an inclined plane (closed forms exist; MoorPy and MoorDyn
  support sloped seabeds), with water depth at the anchor and at the boat as inputs.
- **Fits**: `mooring/catenary.ts` (generalise `Rode` with a seabed slope) and the side view.

## 4. Anchor dragging and re-setting — High, M

The anchor is a fixed point; a load above its holding only shows red. In reality the anchor drags, which
lengthens the effective scope, lowers the uplift and can re-set — or it pulls out and the boat goes free.

- **Model**: anchor as a node with a load–displacement law (no slip below holding, then dragging with a
  soil-dependent resistance; break-out when uplift exceeds a threshold). Holding builds with drag distance
  as it digs in.
- **Fits**: anchor position becomes a state in `dynamics/` (quasi-static: iterate equilibrium with the
  anchor moving until load ≤ holding); results report drag distance and whether it re-sets.

## 5. Deck hardware and the weakest link — High, S

Margins are checked for chain, snubber, lines and anchor holding only. The bow roller, cleats, chain
stopper, windlass, shackles and swivels are often the weakest link, especially under snatch loads.

- **Model**: optional working-load / breaking-load inputs per fitting; report the lowest margin in the
  load path (chain → shackle → swivel → roller/stopper → cleat).
- **Fits**: `analysis/loads.ts` (add elements) and a results group in `ui/results.ts`.

## 6. Real yaw dynamics for fishtailing — High, L

Fishtailing is quasi-static: the boat is held at ±A° that the user chooses, and the period only times the
animation. Real sheering is a self-excited oscillation: the topsides act as a sail, the keel as a foil,
and the rode as the restoring spring. Practical Sailor's tests suggest the quasi-static model overstates
loads at moderate yaw (±30° → 2.3× in the app vs 1.3–1.6× measured).

- **Model**: 3-DOF time simulation (surge, sway, yaw) with wind lift and drag by angle (item 8), keel and
  hull lift and drag (low-aspect foil), added mass and yaw inertia, damping; predicts amplitude and period
  from the boat's windage distribution, keel and rode. Riding sails and bridles become inputs.
- **Fits**: `dynamics/` (a yaw solver using `rk4Step`), replacing `fishtailExtreme`; Alain Fraysse's
  "yawing and swinging" pages describe this kind of model.

## 7. Chain dynamics — High, L

The chain is a quasi-static catenary: it reaches its new shape instantly. The chain's own mass and its
drag through the water damp snatch loads; without them, wave peaks on a nearly straight all-chain rode are
probably overstated.

- **Model**: lumped-mass chain (nodes with mass, added mass, drag, axial springs, seabed contact), as in
  NREL MoorDyn; integrate with the boat's surge.
- **Fits**: a dynamic rode in `dynamics/` used by `waveResponse` and the animation instead of the
  quasi-static `mooringInWave`. MoorDyn's documented equations are a good reference.

## 8. Wind force coefficients by angle — Medium, M

Wind force = drag only, straight downwind, with area and Cd blended as A·|sin θ| + A·|cos θ|. Real hulls
and rigs also make side force (lift) and a yaw moment that moves with angle, and the centre of effort
shifts with the wind angle.

- **Model**: Cx(θ), Cy(θ), Cn(θ) curves (OCIMF-style for ships; published wind-tunnel data for yachts
  and catamarans); the centre of effort derived from the yaw-moment coefficient.
- **Fits**: `environment/wind.ts` and `windOnHull` in `mooring/forces.ts`; needed for item 6.

## 9. Irregular sea — Medium, M

Wave loads use one regular wave of 1.86·Hs (the largest in about 1000 waves). Real seas are irregular:
peaks depend on the wave spectrum, wave groups and how long the blow lasts.

- **Model**: JONSWAP spectrum (Hs, Tp, γ); time series by superposing components; extremes from
  simulations or Rayleigh / Weibull statistics over a chosen storm duration.
- **Fits**: `environment/waves.ts` (spectrum, synthesis) and `dynamics/waveResponse.ts`.

## 10. Swell from a different direction — Medium, S

Waves always come from the wind direction. Swell often comes from elsewhere, and a beam swell on a
Med-moored boat is the classic uncomfortable (and high-load) case.

- **Model**: separate wave direction (and optionally a second wave system).
- **Fits**: wave direction in `MooringModel.waves` instead of the wind direction (`waveDriftOnHull`,
  `waveSetup`).

## 11. Slow-drift wave forces — Medium, M

Only the mean wave drift is included. Wave groups produce slowly varying drift forces at the difference
frequencies, which can excite the boat's long natural surge period on its mooring (10–15 s here) —
a known cause of large loads on moored vessels.

- **Model**: Newman's approximation of the difference-frequency force from the mean-drift coefficient
  and the wave envelope.
- **Fits**: `dynamics/surge.ts` forcing term, with item 9.

## 12. Heave, pitch and roll dynamics — Medium, L

Bow motion comes from fitting a rigid hull to the wave (quasi-static): no heave or pitch resonance, no
roll. Near resonance, real bow motions — and so chain jerks — are larger.

- **Model**: response amplitude operators (RAOs) for heave and pitch from simple strip theory or
  published small-craft data; roll affects stern line geometry slightly.
- **Fits**: `environment/waveLoads.ts` (`rigidHullResponse` replaced by RAOs).

## 13. Tide range — Medium, S

Depth and quay height are fixed. With tide, stern lines and chain go slack or bar-tight over the stay;
pretension set at low water can become dangerous at high water.

- **Model**: tide range; solve at low and high water and report both.
- **Fits**: `analysis/cases.ts` (extra cases) and `buildModel`.

## 14. Mixed rodes — Medium, M

The rode is one chain (plus an optional snubber). Many boats use chain + rope, a kellet (weight on the
rode), two chain sizes, or a two-leg bridle on a catamaran.

- **Model**: multi-segment catenary (segments of different weight and stiffness, point masses), as in
  MoorPy line segments; bridle as two legs meeting at a point.
- **Fits**: `mooring/catenary.ts` (segment list instead of chain + snubber).

## 15. Rope behaviour under cycling — Medium, M

Ropes use one static load–stretch curve. Nylon is stiffer under fast cyclic loading, softer and weaker
wet, shows hysteresis (energy absorbed per cycle) and creeps; long stern lines also sag.

- **Model**: dynamic stiffness and hysteresis loop per rope type; wet / dry factors; catenary sag for
  long lines.
- **Fits**: `materials/rope.ts`, and the line contributor in `mooring/forces.ts`.

## 16. Seabed friction — Low, S

The lying chain slides freely. In reality friction holds part of the load before it reaches the anchor,
which slightly lowers the anchor load and adds damping.

- **Model**: Coulomb friction along the grounded length (the Jonkman catenary used by MoorPy has a CB
  friction coefficient).
- **Fits**: `mooring/catenary.ts`.

## 17. Neighbours and the quay — Medium, M

The boat is alone. In a marina, neighbours shelter it from the wind, fenders push on it when it moves
sideways, and the stern can hit the quay (today only a warning).

- **Model**: wind shelter factor; fender contact as one-sided springs to neighbouring hulls; quay contact
  as a one-sided spring at the transom.
- **Fits**: contributors in `mooring/forces.ts`.

## 18. Multiple anchors — Low, M

One bow anchor only. Two bow anchors in a V, or a Bahamian moor, share the load and limit swinging.

- **Model**: several rodes, each with its own anchor and catenary.
- **Fits**: `MooringModel.rode` → a list of rodes; `chainOnBow` → one contribution per rode.

## 19. Wind detail — Low, M

Uniform wind at one speed, synthetic gusts in the animation. No wind gradient with height (the rig sees
more wind than the hull), and no gust spectrum.

- **Model**: logarithmic or power-law wind profile applied per windage item height; gust spectrum (e.g.
  Frøya / NPD or Kaimal) for time series.
- **Fits**: `environment/wind.ts`, windage items with heights, `dynamics/gusts.ts`.

## 20. Fatigue and wear — Low, M

Only peak loads are checked. Long blows load chain and ropes thousands of times; nylon loses strength with
cycling, ropes chafe at fairleads, chain wears at the links and the roller.

- **Model**: load cycles from the animation or a spectrum; S–N curves or rope fatigue data; chafe and age
  factors on MBL.
- **Fits**: `analysis/` (from time series), `materials/`.

## 21. Uncertainty and sensitivity — Medium, M

Several inputs are uncertain: holding ratio, Cd, windage, rope stretch, wave height. Results are single
numbers.

- **Model**: Monte Carlo over input ranges, or one-at-a-time sensitivity ("±20% Cd → ±x% chain load");
  show ranges or which input matters most.
- **Fits**: `analysis/` (repeated `runScenario` calls; the physics is pure so this is straightforward).

## 22. Comparison with measured loads — Medium, S

Validation uses published figures. Owners with load cells could compare their own logs directly.

- **Model**: import a CSV of time and load (and wind); overlay on the animation chart; compare peaks.
- **Fits**: `ui/animChart.ts` and a small import in `app/`.
