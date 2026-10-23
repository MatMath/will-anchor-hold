# Architecture

Two halves with one rule between them: **`src/physics/` never touches the page**, and the app never does
physics. Physics is pure TypeScript (SI units in, plain objects out) and is tested on its own; the app
turns user inputs into a `ScenarioInput`, runs the analysis, and draws the results.

```
user input ──► app/store ──► AppState ──► ui/state.toScenario ──► physics.runScenario ──► results ──► app/render ──► ui views
                 (pure rules)   (persisted)                          (pure, tested)           (ctx)        (markup functions)
```

## Physics engine — `src/physics/`

Layered: each folder only imports from the folders above it. `index.ts` is the public API.

| Layer | Files | What it holds |
|---|---|---|
| `core/` | `constants`, `numeric`, `vec` | Units, root finding (Brent), the generic nonlinear solver (damped Newton + drift fallback), RK4, plane geometry and poses |
| `materials/` | `chain`, `rope`, `anchor` | Data tables and material laws: DIN 766 chain, rope MBL and stretch curves, anchor holding and uplift |
| `environment/` | `wind`, `windage`, `waves`, `waveLoads` | What acts on the boat: wind force by angle, windage estimate, sea state, wave drift and hull–wave motion |
| `mooring/` | `catenary`, `model`, `forces`, `equilibrium`, `stiffness` | The mooring itself: elastic catenary, the model types, one **force contributor** per effect, quasi-static equilibrium, stiffness |
| `dynamics/` | `surge`, `waveResponse`, `fishtail`, `gusts` | Things that move: the surge equation in waves (shared), peak wave loads, fishtail extremes, gust timeline |
| `analysis/` | `inputs`, `buildModel`, `loads`, `cases`, `sweep`, `rigging`, `animation`, `example` | From user inputs to answers: model building, safety margins, the scenario pipeline, wind sweep, slider helpers, the gust animation |

### How a scenario is computed (`analysis/cases.ts`)

1. `validateInput` — reject impossible geometry.
2. `buildModel` — inputs → physical model (cleat and shore points, rode, waves).
3. `solveRest` — equilibrium with no wind.
4. `evaluateCase` for the sustained wind and the gust — equilibrium → drift from rest → element loads →
   (optionally) `dynamicLoads`: fishtail extreme, wave response on top, element-by-element peak.
5. `WARNINGS` — a list of small rules, each returning a message or nothing.

### How an equilibrium is found (`mooring/equilibrium.ts`)

`solveEquilibrium` chooses the unknowns (x, y, ψ — or x, y with the heading held), picks a starting pose
(head to wind when swinging at anchor), and hands the residual to the generic `solveNonlinear` in
`core/numeric`. The residual is `evaluateForces` — the sum of the force contributors in `mooring/forces.ts`.

### How waves are simulated (`dynamics/`)

`surge.ts` holds the one equation of motion, `m·ẍ = m·a_w + c·(u_w − ẋ) − (F(x, ζ) − F0)`, and the
mooring-in-a-wave evaluation. `waveResponse.ts` integrates it with RK4 on a pre-computed mooring table for
the peak analysis; `analysis/animation.ts` integrates the same equation step by step for the animation.

## Web app — `src/app/` and `src/ui/`

| Module | Responsibility |
|---|---|
| `main.ts` | Bootstrap only: mount the layout, bind events, first compute and render |
| `app/context.ts` | The single shared context: `state` (inputs), derived results, animation run, drag state |
| `app/store.ts` | **The only way inputs change.** `applyPatch` (pure: boat defaults, windage re-estimate, auto values) and `update` (persist + schedule) |
| `app/scheduler.ts` | When and what to compute: fast static analysis on the next frame, then waves / fishtail, sweeps, slider hints and a background peak sweep once input settles |
| `app/render.ts` | Orchestrates rendering from `ctx` through the `ui/` view functions. No calculation |
| `app/interactions.ts` | Events → state patches: form controls, buttons (`ACTIONS`), wind dial, dragging the anchor and the water depth |
| `app/animation.ts` | Gust animation controller (start / tick / stop) |
| `app/layout.ts` | Page markup, one function per block |
| `ui/state.ts` | `AppState` (display units), defaults, `resolve` (auto values), persistence, `toScenario` |
| `ui/*.ts` | View functions: plan and side views (lists of drawing **layers**), results table (list of **groups**), charts, status bar, notices, controls, formatting |
| `styles/*.css` | One file per component, imported in cascade order by `styles/index.css` |

## Extending

| To add… | Do this |
|---|---|
| A force on the boat (current, second anchor, riding sail) | Write a contributor in `mooring/forces.ts` returning `{ applied, …diagnostics }` and add it to `evaluateForces`. Equilibrium, stiffness, waves and the animation pick it up. Add its input to `analysis/inputs.ts` and `buildModel` |
| A warning | Add a rule to `WARNINGS` in `analysis/cases.ts` |
| A peak-load effect (like waves or fishtail) | Compute it in `dynamics/`, add it to `dynamicLoads` in `analysis/cases.ts`; `worstOf` folds it into the peaks |
| An input | Add the key to `AppState` and `DEFAULT_STATE` (`ui/state.ts`), map it in `toScenario`, and add one `num(...)`/`select(...)` line to a section in `app/layout.ts`. Binding, syncing and persistence are automatic |
| A results row group | Write a builder in `ui/results.ts` and add it to `GROUPS` |
| Something drawn in the plan or side view | Write a layer function and add it to `LAYERS` in `ui/planView.ts` / `ui/sideView.ts` |
| A button | Give it an `id` in the layout and an entry in `ACTIONS` (`app/interactions.ts`) |

## Tests

| File | Covers |
|---|---|
| `physics/basics.test.ts` | Wind, windage, chain, rope, anchor data and laws |
| `physics/catenary.test.ts`, `validation.test.ts` | Catenary against closed forms, an independent ODE integration, Rocna/Peter Smith cases |
| `physics/mooring.test.ts` | Equilibrium balance, symmetry, slack moorings, swinging at anchor, rigging helpers, worked example |
| `physics/waves.test.ts` | Wave kinematics, drift force, surge vs linear theory, fishtail and snatch vs Practical Sailor, animation |
| `physics/core.test.ts` | Generic solver, RK4, Jacobian, geometry, force contributors |
| `app/store.test.ts` | The pure input update rules |
| `app.test.ts` | Golden-master snapshots of the rendered app (jsdom) for five preset inputs |

Run `npm test`. A change that alters any result or any rendered markup shows up as a failing assertion or a
snapshot diff; update snapshots with `npx vitest run -u` only when the change is intended.
