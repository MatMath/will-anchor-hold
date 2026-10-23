/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Architecture rules (see docs/architecture.md), checked on the source so they can't erode:
 *  - physics layers only import from layers above them;
 *  - physics never touches the page or imports app / ui code;
 *  - ui view modules don't call into app modules (type imports are fine).
 */

const ROOT = dirname(fileURLToPath(import.meta.url));
const LAYER_RANK: Record<string, number> = { core: 0, materials: 1, environment: 1, mooring: 2, dynamics: 3, analysis: 4 };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__snapshots__' ? [] : sources(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

const physicsFiles = sources(join(ROOT, 'physics'));

describe('architecture', () => {
  it('physics layers only depend on lower layers', () => {
    const violations: string[] = [];
    for (const file of physicsFiles) {
      const layer = file.split(/[\\/]physics[\\/]/)[1].split(/[\\/]/)[0];
      if (!(layer in LAYER_RANK)) continue;
      for (const m of readFileSync(file, 'utf8').matchAll(/from '\.\.\/(\w+)\//g)) {
        const dep = m[1];
        if (LAYER_RANK[dep] > LAYER_RANK[layer] || (LAYER_RANK[dep] === LAYER_RANK[layer] && dep !== layer)) violations.push(`${file} → ${dep}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('physics has no DOM access and no app / ui imports', () => {
    const offenders = physicsFiles.filter((f) => /\bdocument\.|\bwindow\.|from '(\.\.\/)+(ui|app)\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('ui view modules do not call into app modules', () => {
    const offenders = sources(join(ROOT, 'ui')).filter((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .some((l) => l.includes("from '../app/") && !l.startsWith('import type')),
    );
    expect(offenders).toEqual([]);
  });
});
