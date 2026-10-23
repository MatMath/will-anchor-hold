import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, resolve } from '../ui/state';
import { applyPatch } from './store';

/** The input update rules are pure, so they can be tested without a page. */
describe('applyPatch', () => {
  const base = resolve(DEFAULT_STATE);

  it('recomputes auto values from the tables', () => {
    const next = applyPatch(base, { chainD: 12 });
    expect(next.chainKgPerM).toBe(3.1);
    expect(next.chainMbl).toBe(68.6);
  });

  it('keeps a value typed over an auto one once its auto flag is off', () => {
    const next = applyPatch(base, { chainMbl: 40, chainMblAuto: false });
    expect(next.chainMbl).toBe(40);
  });

  it('switching boat type loads that type’s typical dimensions and re-estimates windage', () => {
    const cat = applyPatch(base, { boatType: 'catamaran' });
    expect(cat.beam).toBeGreaterThan(base.beam);
    expect(cat.windageItems.find((i) => i.id === 'hull')!.name).toMatch(/Hulls/);
    expect(cat.frontArea).toBeGreaterThan(base.frontArea);
  });

  it('does not overwrite windage items the user edited', () => {
    const edited = applyPatch(base, { windageItemsEdited: true, windageItems: base.windageItems.map((i) => ({ ...i, side: 1 })) });
    const longer = applyPatch(edited, { loa: 15 });
    expect(longer.windageItems.every((i) => i.side === 1)).toBe(true);
  });

  it('clamps the anchor distance to stern line + boat + chain', () => {
    const next = applyPatch(base, { anchorDistance: 500 });
    expect(next.anchorDistance).toBe(Math.floor(base.lineLength + base.loa + base.rollerOverhang + base.chainLength));
  });

  it('does not mutate its input', () => {
    const copy = JSON.stringify(base);
    applyPatch(base, { loa: 10, boatType: 'catamaran' });
    expect(JSON.stringify(base)).toBe(copy);
  });
});
