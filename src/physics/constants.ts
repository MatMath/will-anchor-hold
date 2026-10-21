/** Physical constants and unit conversions. All physics works in SI (N, m, kg, s, rad). */

export const G = 9.80665; // m/s²
export const RHO_AIR = 1.225; // kg/m³ (ISA sea level, 15 °C)
export const RHO_SEAWATER = 1025; // kg/m³
export const RHO_STEEL = 7850; // kg/m³

export const KNOT = 1852 / 3600; // m/s per knot
export const KGF = G; // N per kgf

export const DEG = Math.PI / 180;

export const knotsToMs = (kn: number): number => kn * KNOT;
export const msToKnots = (ms: number): number => ms / KNOT;
