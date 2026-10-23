import { DEG, knotsToMs } from '../core/constants';
import { solveEquilibrium, solveRest } from '../mooring/equilibrium';
import { buildModel } from './buildModel';
import { dynamicLoads, staticLoads } from './cases';
import type { ScenarioInput } from './inputs';

export interface SweepPoint {
  windKn: number;
  chain: number;
  anchor: number;
  lines: number[];
  /** Peaks with fishtail and the largest wave (equal to the static values when both are off). */
  chainPeak: number;
  anchorPeak: number;
  linesPeak: number[];
  /** Estimated holding at the anchor's peak-load uplift, N. */
  holdingPeak: number;
  windForce: number;
  sideShift: number;
  upliftDeg: number;
  suspended: number;
}

/** Loads vs wind speed (mean speed × `speedFactor`, e.g. the gust factor), solved by continuation. */
export function sweep(inp: ScenarioInput, speedsKn: number[], speedFactor = 1, dynamics = false): SweepPoint[] {
  const model = buildModel(inp);
  const rest = solveRest(model);
  let pose = rest.pose;
  return speedsKn.map((kn) => {
    const eq = solveEquilibrium(model, knotsToMs(kn * speedFactor), inp.windFromDeg, { initial: pose });
    pose = eq.pose;
    const { peak } = dynamics ? dynamicLoads(inp, model, eq) : staticLoads(inp, eq);
    return {
      windKn: kn,
      chain: eq.rode.tensionTop,
      anchor: eq.rode.tensionAnchor,
      lines: eq.lines.map((l) => l.tension),
      chainPeak: peak.chain.tension,
      anchorPeak: peak.anchor.load,
      linesPeak: peak.lines.map((l) => l.tension),
      holdingPeak: peak.anchor.holding,
      windForce: eq.wind.force,
      sideShift: eq.pose.y - rest.pose.y,
      upliftDeg: eq.rode.angleAnchor / DEG,
      suspended: eq.rode.suspended,
    };
  });
}

