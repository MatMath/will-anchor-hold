import type { Pose, Vec2 } from '../core/vec';
import type { HullWater } from '../environment/waveLoads';
import type { WaveSpec } from '../environment/waves';
import type { Windage, WindLoad } from '../environment/wind';
import type { RopeType } from '../materials/rope';
import type { Rode, RodeState } from './catenary';

/**
 * The resolved physical model of one mooring (SI units), built from the user's inputs by
 * analysis/buildModel.ts, and the result types of evaluating it.
 */

export interface SternLine {
  /** Attachment (cleat) on the boat, boat frame, m. */
  attach: Vec2;
  /** Cleat height above water, m. */
  attachHeight: number;
  /** Shore point, earth frame, m. */
  shore: Vec2;
  /** Shore point height above water, m. */
  shoreHeight: number;
  /** Unstretched length cleat → shore point, m. */
  length: number;
  rope: RopeType;
  /** Effective MBL (catalogue MBL × knot/splice efficiency), N. */
  mbl: number;
}

export interface MooringModel {
  loa: number;
  /** Bow roller position in the boat frame (u, m). */
  bowX: number;
  windage: Windage;
  /** Centre of effort of the side area, u (m). */
  ceX: number;
  rode: Rode;
  /** Anchor position, earth frame, m. */
  anchor: Vec2;
  lines: SternLine[];
  /** Displacement, kg (snatch, wave and fishtail dynamics). */
  displacement: number;
  /** Waves from the wind direction, or null when off. Only act when there is wind. */
  waves?: { spec: WaveSpec; hull: HullWater; depth: number } | null;
}

/** The wind (and the waves it raises) acting on the boat. */
export interface Environment {
  /** Wind speed, m/s. */
  windSpeed: number;
  /** Direction the wind comes FROM, degrees clockwise from the at-rest bow. */
  windFromDeg: number;
}

export interface LineResult {
  cleat: Vec2;
  shore: Vec2;
  /** Stretched length, m. */
  length: number;
  strain: number;
  tension: number;
  /** Horizontal force on the boat, N. */
  force: Vec2;
  slack: boolean;
}

/** Every force on the boat at one pose (not necessarily in balance). */
export interface ForceState {
  pose: Pose;
  windSpeed: number;
  windFromDeg: number;
  wind: WindLoad & { vector: Vec2; point: Vec2 };
  /** Mean wave drift force, N (0 without waves), and its vector. */
  waveDrift: number;
  waveDriftVector: Vec2;
  bow: Vec2;
  rode: RodeState;
  /** Horizontal chain force on the boat, N. */
  chainForce: Vec2;
  lines: LineResult[];
}

/** A pose where the forces balance, with solver diagnostics and the load split. */
export interface Equilibrium extends ForceState {
  converged: boolean;
  iterations: number;
  /** Force residual, N (should be ~0). */
  residual: number;
  /** Fraction of the wind (+ wave drift) force carried by the chain / by the stern lines (projected on the wind direction). */
  shareChain: number;
  shareLines: number;
}
