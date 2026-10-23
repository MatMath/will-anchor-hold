/**
 * Public API of the physics engine. Layers (each only uses the ones above it):
 *   core         constants, numerics (root finding, nonlinear solver, RK4), plane geometry
 *   materials    chain, rope, anchor data
 *   environment  wind, windage, waves and how waves load a hull
 *   mooring      catenary, force contributors, equilibrium, stiffness
 *   dynamics     surge in waves, fishtailing, gust timeline
 *   analysis     inputs → model → cases, peaks, sweep, rigging helpers, animation
 */
export * from './core/constants';
export * from './core/vec';
export * from './materials/chain';
export * from './materials/rope';
export * from './materials/anchor';
export * from './environment/wind';
export * from './environment/windage';
export * from './environment/waves';
export * from './environment/waveLoads';
export * from './mooring/catenary';
export * from './mooring/model';
export * from './mooring/forces';
export * from './mooring/equilibrium';
export * from './mooring/stiffness';
export * from './dynamics/surge';
export * from './dynamics/waveResponse';
export * from './dynamics/fishtail';
export * from './dynamics/gusts';
export * from './analysis/inputs';
export * from './analysis/buildModel';
export * from './analysis/loads';
export * from './analysis/cases';
export * from './analysis/sweep';
export * from './analysis/rigging';
export * from './analysis/animation';
export * from './analysis/example';
