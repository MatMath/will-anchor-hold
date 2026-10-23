import type { Vec2 } from '../core/vec';
import { hullWater } from '../environment/waveLoads';
import { submergedWeight } from '../materials/chain';
import type { MooringModel, SternLine } from '../mooring/model';
import type { ScenarioInput } from './inputs';

/** Turn the inputs into the physical model: geometry of the cleats and shore points, rode properties, waves. */
export function buildModel(inp: ScenarioInput): MooringModel {
  const L = inp.loa;
  return {
    loa: L,
    bowX: L / 2 + inp.rollerOverhang,
    windage: inp.windage,
    ceX: inp.ceX,
    rode: {
      length: inp.chain.length,
      w: submergedWeight(inp.chain.kgPerM),
      ea: inp.chain.ea,
      z: inp.depth + inp.rollerHeight,
      snubber: inp.snubber ?? undefined,
    },
    anchor: [inp.anchor.distance, inp.anchor.offset],
    lines: sternLines(inp),
    displacement: inp.displacement,
    waves:
      inp.waves && inp.waves.hs > 0
        ? { spec: { hs: inp.waves.hs, tp: inp.waves.tp }, hull: hullWater(inp.boatType, inp.loa, inp.beam), depth: inp.depth }
        : null,
  };
}

/** Stern lines: two from the quarters to two shore points (optionally crossed), one from a chosen cleat, or none. */
function sternLines(inp: ScenarioInput): SternLine[] {
  const ln = inp.lines;
  const sternU = -inp.loa / 2 + ln.cleatInset;
  const half = ln.cleatSpacing / 2;
  const spread = ln.shoreSpread / 2;
  const line = (attach: Vec2, shore: Vec2): SternLine => ({
    attach,
    attachHeight: ln.cleatHeight,
    shore,
    shoreHeight: ln.shoreHeight,
    length: ln.length,
    rope: ln.rope,
    mbl: ln.mbl * ln.efficiency,
  });
  if (ln.count === 0) return [];
  if (ln.count === 2) {
    const portShore: Vec2 = [0, ln.crossed ? -spread : spread];
    const stbdShore: Vec2 = [0, ln.crossed ? spread : -spread];
    return [line([sternU, half], portShore), line([sternU, -half], stbdShore)];
  }
  const v = ln.single === 'port' ? half : ln.single === 'starboard' ? -half : 0;
  return [line([sternU, v], [0, 0])];
}
