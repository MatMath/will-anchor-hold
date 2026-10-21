import { LINE_EFFICIENCY, type CaseResult, type Equilibrium, type ScenarioResult } from '../physics';
import { badge, deg, force, m, pct, type Units } from './format';
import type { AppState } from './state';

type Cell = string;
type Row = [label: string, rest: Cell, sustained: Cell, gust: Cell];

const restCase = (r: ScenarioResult): Equilibrium => r.rest;

export function resultsTable(s: AppState, r: ScenarioResult): string {
  const u = s.units as Units;
  const A = r.sustained;
  const B = r.gust;
  const R = restCase(r);
  const F = (n: number): string => force(n, u);
  const both = (fn: (c: CaseResult) => string): [string, string] => [fn(A), fn(B)];
  const groups: Array<{ title: string; rows: Row[] }> = [];

  groups.push({
    title: 'Wind',
    rows: [
      ['Wind speed', '0 kn', `${A.windKn.toFixed(1)} kn`, `${B.windKn.toFixed(1)} kn`],
      ['Apparent angle on the boat', '—', ...both((c) => deg(c.eq.wind.angleDeg))],
      ['Projected area · effective Cd', '—', ...both((c) => `${c.eq.wind.area.toFixed(1)} m² · ${c.eq.wind.cd.toFixed(2)}`)],
      ['Wind force on the boat', '—', ...both((c) => `<strong>${F(c.eq.wind.force)}</strong>`)],
    ],
  });

  const chainRows: Row[] = [
    ['Horizontal tension H', F(R.rode.h), ...both((c) => F(c.eq.rode.h))],
    ['Tension at the bow', F(R.rode.tensionTop), ...both((c) => `<strong>${F(c.chain.tension)}</strong>`)],
    ['Chain load / MBL', pct(R.rode.tensionTop / (s.chainMbl * 1000)), ...both((c) => badge(c.chain.status, pct(c.chain.ratio)))],
    ['Tension at the anchor', F(R.rode.tensionAnchor), ...both((c) => F(c.eq.rode.tensionAnchor))],
    ['Rode angle at the bow (below horizontal)', deg((R.rode.angleTop * 180) / Math.PI), ...both((c) => deg((c.eq.rode.angleTop * 180) / Math.PI))],
    ['Uplift angle at the anchor', deg((R.rode.angleAnchor * 180) / Math.PI), ...both((c) => deg(c.anchor.upliftDeg))],
    ['Chain lifted off the seabed', m(R.rode.suspended, 1), ...both((c) => m(c.eq.rode.suspended, 1))],
    ['Chain still on the seabed', m(R.rode.grounded, 1), ...both((c) => m(c.eq.rode.grounded, 1))],
    ['Touchdown, from the anchor', R.rode.grounded > 0 ? m(R.rode.touchdownX, 1) : '—', ...both((c) => (c.eq.rode.grounded > 0 ? m(c.eq.rode.touchdownX, 1) : 'none — fully lifted'))],
    ['Pull on the anchor', R.rode.vAnchor > 0 ? 'upward' : 'horizontal', ...both((c) => (c.anchor.pull === 'upward' ? '<strong>upward ⚠</strong>' : 'horizontal'))],
    ['Anchor → roller distance', m(R.rode.x, 2), ...both((c) => m(c.eq.rode.x, 2))],
  ];
  groups.push({ title: 'Bow anchor chain', rows: chainRows });

  if (A.snubber && B.snubber) {
    groups.push({
      title: 'Snubber',
      rows: [
        ['Tension', F(R.rode.tensionTop), F(A.snubber.tension), F(B.snubber.tension)],
        ['Load / MBL', pct(R.rode.tensionTop / (s.snubberMbl * 1000)), badge(A.snubber.status, pct(A.snubber.ratio)), badge(B.snubber.status, pct(B.snubber.ratio))],
        ['Stretch', `${(R.rode.snubberStrain * 100).toFixed(1)}%`, ...both((c) => `${(c.eq.rode.snubberStrain * 100).toFixed(1)}%`)],
      ],
    });
  }

  const effMbl = s.lineMbl * 1000 * LINE_EFFICIENCY;
  const lineName = (i: number): string => (s.lineCount === 1 ? 'Stern line' : i === 0 ? 'Port line' : 'Starboard line');
  const lineRows: Row[] = [];
  R.lines.forEach((l, i) => {
    const n = lineName(i);
    lineRows.push([`${n} — tension`, F(l.tension), ...both((c) => `<strong>${F(c.lines[i].tension)}</strong>`)]);
    lineRows.push([`${n} — load / effective MBL`, pct(l.tension / effMbl), ...both((c) => badge(c.lines[i].status, pct(c.lines[i].ratio)))]);
    lineRows.push([`${n} — stretch`, `${(Math.max(0, l.strain) * 100).toFixed(1)}% · ${l.length.toFixed(2)} m`, ...both((c) => `${(Math.max(0, c.eq.lines[i].strain) * 100).toFixed(1)}% · ${c.eq.lines[i].length.toFixed(2)} m`)]);
  });
  groups.push({ title: 'Stern lines', rows: lineRows });

  groups.push({
    title: 'Load split (share of the wind force resisted)',
    rows: [
      ['Chain', '—', ...both((c) => pct(c.eq.shareChain))],
      ['Stern lines', '—', ...both((c) => pct(c.eq.shareLines))],
      ['Chain tension ÷ wind force', '—', ...both((c) => `${(c.chain.tension / Math.max(1, c.eq.wind.force)).toFixed(2)} ×`)],
    ],
  });

  groups.push({
    title: 'Boat movement (from the at-rest position)',
    rows: [
      ['Sideways shift (midships)', '0', ...both((c) => `<strong>${sideways(c.drift.dy)}</strong>`)],
      ['Sideways shift — bow / stern', '0', ...both((c) => `${sideways(c.drift.bowDy)} / ${sideways(c.drift.sternDy)}`)],
      ['Fore-aft shift (+ = seaward)', '0', ...both((c) => m(c.drift.dx))],
      ['Heading change (+ = bow to port)', '0°', ...both((c) => deg(c.drift.dPsiDeg))],
    ],
  });

  groups.push({
    title: 'Anchor holding (rough estimate)',
    rows: [
      ['Holding when pulled flat', F(A.anchor.holdingFlat), F(A.anchor.holdingFlat), F(B.anchor.holdingFlat)],
      ['Reduction for uplift', '—', ...both((c) => `× ${c.anchor.upliftFactor.toFixed(2)}`)],
      ['Estimated holding', '—', ...both((c) => F(c.anchor.holding))],
      ['Anchor load / holding', pct(R.rode.tensionAnchor / A.anchor.holdingFlat), ...both((c) => badge(c.anchor.status, pct(c.anchor.ratio)))],
    ],
  });

  groups.push({
    title: `Dynamic — indicative only (surge ${s.snatchSpeed} m/s)`,
    rows: [
      ['Mooring stiffness along the wind', '—', ...both((c) => `${(c.snatch.k / 1000).toFixed(1)} kN/m`)],
      ['Effective mass (incl. added mass)', '—', ...both((c) => `${Math.round(c.snatch.mEff).toLocaleString('en')} kg`)],
      ['Extra load if a surge is stopped', '—', ...both((c) => F(c.snatch.force))],
    ],
  });

  const body = groups
    .map(
      (g) =>
        `<tbody><tr class="grp"><th colspan="4" scope="colgroup">${g.title}</th></tr>${g.rows
          .map(([l, a, b, c]) => `<tr><th scope="row">${l}</th><td>${a}</td><td>${b}</td><td>${c}</td></tr>`)
          .join('')}</tbody>`,
    )
    .join('');
  return `<table class="results"><thead><tr><th></th><th scope="col">At rest</th><th scope="col">Sustained</th><th scope="col">Gust</th></tr></thead>${body}</table>`;
}

const sideways = (dy: number): string => (Math.abs(dy) < 0.005 ? '0.00 m' : `${Math.abs(dy).toFixed(2)} m ${dy > 0 ? 'to port' : 'to stbd'}`);
