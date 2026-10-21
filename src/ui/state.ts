import {
  HOLDING_RATIO,
  LINE_EFFICIENCY,
  WORKED_EXAMPLE,
  chainEA,
  chainMbl,
  chainWeightPerMetre,
  estimateWindageItems,
  ropeMbl,
  sternCleatSpacing,
  sumWindage,
  type AnchorType,
  type Bottom,
  type BoatType,
  type ChainGrade,
  type RopeType,
  type ScenarioInput,
  type WindageItem,
} from '../physics';

/** Everything the user can set, in display units (m, mm, kg, kN, kn, °, %). Persisted to localStorage. */
export interface AppState {
  boatType: BoatType;
  loa: number;
  beam: number;
  freeboard: number;
  displacement: number;
  mastHeight: number;
  rollerHeight: number;
  rollerOverhang: number;

  windageAuto: boolean;
  /** The user edited individual windage items: stop regenerating them from the boat dimensions. */
  windageItemsEdited: boolean;
  windageItems: WindageItem[];
  sideArea: number;
  frontArea: number;
  ceX: number;
  cdSide: number;
  cdFront: number;

  windKn: number;
  windDir: number;
  gustFactor: number;

  depth: number;
  chainD: number;
  chainGrade: ChainGrade;
  chainKgAuto: boolean;
  chainKgPerM: number;
  chainMblAuto: boolean;
  chainMbl: number;
  chainLength: number;

  snubberOn: boolean;
  snubberType: RopeType;
  snubberD: number;
  snubberLength: number;
  snubberMblAuto: boolean;
  snubberMbl: number;

  anchorType: AnchorType;
  anchorMass: number;
  bottom: Bottom;
  holdingAuto: boolean;
  holdingRatio: number;
  anchorDistance: number;
  anchorOffset: number;

  lineCount: 1 | 2;
  lineType: RopeType;
  lineD: number;
  lineMblAuto: boolean;
  lineMbl: number;
  lineLength: number;
  pretensionTarget: number;
  cleatInset: number;
  cleatHeight: number;
  shoreSpread: number;
  shoreHeight: number;
  crossed: boolean;
  singleAttach: 'port' | 'centre' | 'starboard';

  snatchSpeed: number;

  // View preferences
  units: 'kN' | 'kgf';
  viewCase: 'rest' | 'sustained' | 'gust';
  exaggeration: number;
  planZoom: 'all' | 'boat';
  vExag: number;
  sweepMode: 'kN' | 'pct';
  sweepGust: boolean;
}

export type Key = keyof AppState;

const STORAGE_KEY = 'anchorForce.state.v1';

export function boatDefaults(type: BoatType, loa: number): Partial<AppState> {
  const k = loa / 12.8;
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  return type === 'monohull'
    ? { beam: r1(4.2 * k), freeboard: r1(1.4 * k), displacement: Math.round(10500 * k ** 3 / 100) * 100, mastHeight: r1(18 * k), rollerHeight: r1(1.3 * k), rollerOverhang: 0.3, cleatHeight: r1(1.2 * k) }
    : { beam: r1(7.0 * k), freeboard: r1(1.4 * k), displacement: Math.round(11000 * k ** 3 / 100) * 100, mastHeight: r1(19 * k), rollerHeight: r1(1.0 * k), rollerOverhang: 0, cleatHeight: r1(1.1 * k) };
}

const ex = WORKED_EXAMPLE;

export const DEFAULT_STATE: AppState = {
  boatType: 'monohull',
  loa: 12.8,
  beam: 4.2,
  freeboard: 1.4,
  displacement: 10500,
  mastHeight: 18,
  rollerHeight: 1.3,
  rollerOverhang: 0.3,

  windageAuto: true,
  windageItemsEdited: false,
  windageItems: estimateWindageItems({ type: 'monohull', loa: 12.8, beam: 4.2, freeboard: 1.4, mastHeight: 18 }),
  sideArea: 30,
  frontArea: 12,
  ceX: -0.3,
  cdSide: 1.0,
  cdFront: 0.8,

  windKn: 25,
  windDir: 90,
  gustFactor: 1.4,

  depth: 6,
  chainD: 10,
  chainGrade: 'G30',
  chainKgAuto: true,
  chainKgPerM: 2.25,
  chainMblAuto: true,
  chainMbl: 50.3,
  chainLength: 40,

  snubberOn: false,
  snubberType: 'nylon3',
  snubberD: 14,
  snubberLength: 5,
  snubberMblAuto: true,
  snubberMbl: 40.2,

  anchorType: 'newgen',
  anchorMass: 20,
  bottom: 'sand',
  holdingAuto: true,
  holdingRatio: 40,
  anchorDistance: 58,
  anchorOffset: 0,

  lineCount: 2,
  lineType: 'nylon3',
  lineD: 14,
  lineMblAuto: true,
  lineMbl: 40.2,
  lineLength: ex.lines.length,
  pretensionTarget: 1.0,
  cleatInset: 0.3,
  cleatHeight: 1.2,
  shoreSpread: 4,
  shoreHeight: 0.5,
  crossed: false,
  singleAttach: 'centre',

  snatchSpeed: 0.5,

  units: 'kN',
  viewCase: 'sustained',
  exaggeration: 1,
  planZoom: 'all',
  vExag: 2,
  sweepMode: 'kN',
  sweepGust: false,
};

/** Fill in every "auto" value from the tables. Pure. */
export function resolve(s: AppState): AppState {
  const out = { ...s };
  if (out.windageAuto) {
    const t = sumWindage(out.windageItems);
    out.sideArea = round(t.side, 1);
    out.frontArea = round(t.front, 1);
    out.ceX = round(t.ceX, 2);
  }
  if (out.chainKgAuto) out.chainKgPerM = round(chainWeightPerMetre(out.chainD), 2);
  if (out.chainMblAuto) out.chainMbl = round(chainMbl(out.chainGrade, out.chainD) / 1000, 1);
  if (out.snubberMblAuto) out.snubberMbl = round(ropeMbl(out.snubberType, out.snubberD) / 1000, 1);
  if (out.lineMblAuto) out.lineMbl = round(ropeMbl(out.lineType, out.lineD) / 1000, 1);
  if (out.holdingAuto) out.holdingRatio = HOLDING_RATIO[out.anchorType][out.bottom];
  // The anchor can be no further out than stern line + boat + chain pulled straight.
  const maxD = out.lineLength + out.loa + out.rollerOverhang + out.chainLength;
  if (out.anchorDistance > maxD) out.anchorDistance = Math.floor(maxD);
  return out;
}

export const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

export function toScenario(s: AppState): ScenarioInput {
  return {
    loa: s.loa,
    displacement: s.displacement,
    rollerHeight: s.rollerHeight,
    rollerOverhang: s.rollerOverhang,
    windage: { sideArea: s.sideArea, frontArea: s.frontArea, cdSide: s.cdSide, cdFront: s.cdFront },
    ceX: s.ceX,
    windKn: s.windKn,
    windFromDeg: s.windDir,
    gustFactor: s.gustFactor,
    depth: s.depth,
    chain: { kgPerM: s.chainKgPerM, length: s.chainLength, mbl: s.chainMbl * 1000, ea: chainEA(s.chainD) },
    snubber: s.snubberOn ? { rope: s.snubberType, length: s.snubberLength, mbl: s.snubberMbl * 1000 } : null,
    anchor: { mass: s.anchorMass, holdingRatio: s.holdingRatio, distance: s.anchorDistance, offset: s.anchorOffset },
    lines: {
      count: s.lineCount,
      rope: s.lineType,
      mbl: s.lineMbl * 1000,
      efficiency: LINE_EFFICIENCY,
      length: s.lineLength,
      cleatSpacing: sternCleatSpacing(s.boatType, s.beam),
      cleatInset: s.cleatInset,
      cleatHeight: s.cleatHeight,
      shoreSpread: s.shoreSpread,
      shoreHeight: s.shoreHeight,
      crossed: s.crossed,
      single: s.singleAttach,
    },
    snatchSpeed: s.snatchSpeed,
  };
}

/** The app state that reproduces docs/worked-example.md exactly. */
export function workedExampleState(current: AppState): AppState {
  const e = WORKED_EXAMPLE;
  return resolve({
    ...DEFAULT_STATE,
    units: current.units,
    windageAuto: false,
    sideArea: e.windage.sideArea,
    frontArea: e.windage.frontArea,
    ceX: e.ceX,
    windKn: e.windKn,
    windDir: e.windFromDeg,
    lineLength: e.lines.length,
    chainMblAuto: true,
    lineMblAuto: true,
  });
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppState>;
      const merged = { ...DEFAULT_STATE, ...saved };
      if (!Array.isArray(merged.windageItems)) merged.windageItems = DEFAULT_STATE.windageItems;
      return resolve(merged);
    }
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return resolve(DEFAULT_STATE);
}

let saveTimer: number | undefined;
export function saveState(s: AppState): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ignore: private mode or quota */
    }
  }, 250);
}

export function clearSaved(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
