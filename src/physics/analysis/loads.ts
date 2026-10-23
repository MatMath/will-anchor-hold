import { DEG } from '../core/constants';
import { anchorHolding, upliftFactor } from '../materials/anchor';
import type { Equilibrium } from '../mooring/model';
import type { ScenarioInput } from './inputs';

/** Turning tensions into safety margins: % of breaking load for chain, snubber and lines; % of holding for the anchor. */

export type Status = 'green' | 'amber' | 'red';

/** Structural thresholds: amber above 30% MBL, red above 50% MBL. */
export const loadStatus = (ratio: number): Status => (ratio > 0.5 ? 'red' : ratio > 0.3 ? 'amber' : 'green');
/** Anchor holding is far less certain than a breaking load: amber above 50%, red above 80% of estimated holding. */
export const holdingStatus = (ratio: number): Status => (ratio > 0.8 ? 'red' : ratio > 0.5 ? 'amber' : 'green');

export interface ElementLoad {
  tension: number;
  mbl: number;
  ratio: number;
  status: Status;
}

export interface AnchorCheck {
  load: number;
  upliftDeg: number;
  pull: 'horizontal' | 'upward';
  holdingFlat: number;
  holding: number;
  upliftFactor: number;
  ratio: number;
  status: Status;
}

/** Loads of every element in one situation (static, fishtail extreme, or largest wave). */
export interface Loads {
  chain: ElementLoad;
  snubber: ElementLoad | null;
  lines: ElementLoad[];
  anchor: AnchorCheck;
}

export const element = (tension: number, mbl: number): ElementLoad => {
  const ratio = mbl > 0 ? tension / mbl : Infinity;
  return { tension, mbl, ratio, status: loadStatus(ratio) };
};

export function anchorCheck(inp: ScenarioInput, load: number, upliftDeg: number): AnchorCheck {
  const flat = anchorHolding(inp.anchor.mass, inp.anchor.holdingRatio, 0);
  const holding = anchorHolding(inp.anchor.mass, inp.anchor.holdingRatio, upliftDeg);
  const ratio = holding > 0 ? load / holding : Infinity;
  return {
    load,
    upliftDeg,
    pull: upliftDeg > 1e-6 ? 'upward' : 'horizontal',
    holdingFlat: flat,
    holding,
    upliftFactor: upliftFactor(upliftDeg),
    ratio,
    status: holdingStatus(ratio),
  };
}

export function loadsOf(inp: ScenarioInput, chainT: number, lineT: number[], anchorT: number, upliftDeg: number): Loads {
  return {
    chain: element(chainT, inp.chain.mbl),
    snubber: inp.snubber ? element(chainT, inp.snubber.mbl) : null,
    lines: lineT.map((t) => element(t, inp.lines.mbl * inp.lines.efficiency)),
    anchor: anchorCheck(inp, anchorT, upliftDeg),
  };
}

export const eqLoads = (inp: ScenarioInput, eq: Equilibrium): Loads =>
  loadsOf(inp, eq.rode.tensionTop, eq.lines.map((l) => l.tension), eq.rode.tensionAnchor, eq.rode.angleAnchor / DEG);

/** Element-by-element worst of several load sets. */
export function worstOf(sets: Loads[]): Loads {
  const pick = <T extends { ratio: number }>(xs: T[]): T => xs.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  return {
    chain: pick(sets.map((s) => s.chain)),
    snubber: sets[0].snubber ? pick(sets.map((s) => s.snubber!)) : null,
    lines: sets[0].lines.map((_, i) => pick(sets.map((s) => s.lines[i]))),
    anchor: pick(sets.map((s) => s.anchor)),
  };
}

