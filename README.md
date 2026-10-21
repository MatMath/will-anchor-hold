# Med-mooring loads

A single-page, offline web app that calculates the loads on a boat Med-moored with a bow anchor and one or
two stern lines to a quay or rock, when the wind blows from the side.

It gives the wind force on the boat, the chain catenary (tension at bow and anchor, uplift, chain lifted
off the seabed), the stern-line tensions, the boat's equilibrium position (sideways shift, fore-aft shift and
heading change), how the load splits between chain and lines, and safety margins against MBL and
estimated anchor holding.

## Use it

```bash
npm install
npm run build
```

`dist/index.html` is one self-contained file (≈ 95 kB, no network needed). Copy it to your laptop or phone
and open it in a browser. Your inputs are saved in that browser's `localStorage`.

> **iPhone:** the Files app preview does not run JavaScript. Open the file with an app that can show local
> HTML with JavaScript enabled, or serve it once from any web host.

For development: `npm run dev` (live reload), `npm test` (unit tests).

## Layout

| Path | What |
|---|---|
| `src/physics/` | Pure-function physics, no DOM. SI units throughout. |
| `src/physics/wind.ts` | F = ½·ρ·Cd·A·V², with A and Cd blended by apparent wind angle |
| `src/physics/windage.ts` | Windage estimator (hull, cabin, rig, bimini, dinghy…) for monohull and catamaran |
| `src/physics/catenary.ts` | Elastic catenary with seabed contact (Irvine), optional weightless snubber |
| `src/physics/chain.ts`, `rope.ts`, `anchor.ts` | Chain grades/weights/MBL, rope MBL and load–stretch curves, holding estimates |
| `src/physics/mooring.ts` | 3-DOF quasi-static equilibrium solver (damped Newton + drift fallback) |
| `src/physics/scenario.ts` | Builds the model from inputs; rest / sustained / gust cases, sweep, pretension helper |
| `src/physics/*.test.ts` | Unit tests (closed-form and ODE catenary checks, force/moment balance, symmetry, worked example) |
| `docs/worked-example.md` | A complete case to check by hand. Also shown in the app. |
| `docs/validation.md` | Catenary checked against NREL MoorPy and numerical integration; chain data and uplift curve sources |
| `src/ui/` | Plan view, side view, sweep chart, results table, inputs |

## Model and limits

Quasi-static: no waves, no inertia, no dynamic yawing; no current. Wind acts at one centre of effort,
straight downwind. Flat, frictionless seabed. Stern lines are straight. Anchor holding is a rough
guide. A gust or wave snatch load can be several times the static values. The app shows an indicative
snatch estimate, and a snubber can be modelled.
