// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

/**
 * UI regression ("golden master") test: boots the whole app in jsdom with preset inputs and snapshots
 * what it renders. Any change to the calculations or the markup shows up as a snapshot diff.
 */

const PRESETS: Record<string, Record<string, unknown>> = {
  defaults: {},
  workedKgf: { units: 'kgf', windKn: 30, sideArea: 30, frontArea: 12, ceX: -0.3, windageAuto: false },
  swingWavesFishtail: { lineCount: 0, wavesOn: true, waveHs: 0.4, fishtailOn: true, fishtailAmp: 25, viewCase: 'gust' },
  medWavesSnubber: { wavesOn: true, waveHs: 0.5, snubberOn: true, sweepMode: 'pct' },
  catOneLine: { boatType: 'catamaran', beam: 7, lineCount: 1, singleAttach: 'port', planZoom: 'boat' },
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function boot(state: Record<string, unknown>): Promise<Record<string, string>> {
  globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame ??= ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
  localStorage.clear();
  localStorage.setItem('anchorForce.state.v1', JSON.stringify(state));
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await import('./main');
  await sleep(2500); // full compute, sweeps and the background peak sweep
  const html = (sel: string): string => document.querySelector(sel)?.innerHTML ?? '';
  return {
    status: html('#status'),
    results: html('#results'),
    warnings: html('#warnings'),
    facts: html('#facts'),
    plan: html('#plan'),
    side: html('#side'),
    sweep: html('#sweep'),
  };
}

describe('app renders the same output (golden master)', () => {
  for (const [name, state] of Object.entries(PRESETS)) {
    it(name, { timeout: 20000 }, async () => {
      const out = await boot(state);
      expect(out.status.length).toBeGreaterThan(50);
      for (const [part, markup] of Object.entries(out)) expect(markup).toMatchSnapshot(part);
    });
  }
});
