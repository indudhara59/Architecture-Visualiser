import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Analyzer } from '../src/core/analyze';
import { checkRules, computeInsights, sampleRules } from '../src/core/insights';
import { detectSystem, parseCompose, parseEnvKeys } from '../src/core/system';
import { diffSnapshot, toSnapshot } from '../src/core/snapshot';

const WASM = path.join(__dirname, '../dist/wasm');
const root = path.join(__dirname, 'fixtures', 'ts-app');

describe('insights, system view, rules and snapshots', async () => {
  const g = await new Analyzer(WASM).analyze(root);

  it('records import line numbers on edges', () => {
    expect(g.fileEdges.find((e) => e.from === 'src/services/orders.ts' && e.to === 'src/data/db.ts')?.lines).toEqual([1]);
  });

  it('computes fan-in, hotspots, orphans and a health score', () => {
    const ins = computeInsights(g);
    expect(ins.metrics['src/data/db.ts']).toEqual({ fanIn: 2, fanOut: 0 });
    expect(ins.orphans).toContain('src/ui/App.tsx');
    expect(ins.orphans).not.toContain('src/index.ts');
    expect(ins.score).toBeGreaterThan(0);
    expect(ins.score).toBeLessThan(100);
    expect(ins.breakdown.map((b) => b.label)).toContain('Import cycles');
  });

  it('flags lower layers importing higher ones', () => {
    // data → ui would be a violation; fixture has ui → data which is fine.
    const ins = computeInsights(g);
    expect(ins.layerWarnings.every((w) => !(w.fromLayer === 'ui' && w.toLayer === 'data'))).toBe(true);
  });

  it('checks rules with globs, severity and except', () => {
    const v = checkRules(g, { rules: [{ name: 'no ui→data', from: 'src/ui/**', to: 'src/data/**' }] });
    expect(v).toEqual([{ rule: 'no ui→data', severity: 'error', from: 'src/ui/App.tsx', to: 'src/data/db.ts', line: 2 }]);
    expect(checkRules(g, { rules: [{ from: 'src/ui/**', to: 'src/data/**', except: 'src/data/db.ts' }] })).toEqual([]);
    expect(sampleRules(g).rules?.[0].name).toBe('UI must not access the data layer directly');
  });

  it('detects databases, caches and services from imports, compose and env files', () => {
    const sys = detectSystem(root, g);
    const pg = sys.techs.find((t) => t.name === 'PostgreSQL')!;
    expect(pg.sources.sort()).toEqual(['compose', 'env', 'import']);
    expect(pg.usedBy['c:src/data']).toBe(1);
    expect(sys.techs.find((t) => t.name === 'Redis')?.sources).toEqual(['compose']);
    expect(sys.techs.find((t) => t.name === 'Stripe')?.sources).toEqual(['env']);
    expect(sys.frameworks.map((f) => f.name).sort()).toEqual(['Express', 'React']);
  });

  it('parses compose services and env keys', () => {
    expect(parseCompose('version: "3"\nservices:\n  web:\n    image: nginx\n  worker:\n    build: .\nvolumes:\n  data:\n')).toEqual([
      { name: 'web', image: 'nginx' },
      { name: 'worker' },
    ]);
    expect(parseEnvKeys('export A_B=1\n#C=2\nlower=3\nD=')).toEqual(['A_B', 'D']);
  });

  it('diffs against a snapshot', () => {
    const snap = toSnapshot(g);
    snap.files = snap.files.filter((f) => f !== 'src/utils/index.ts');
    snap.fileEdges = snap.fileEdges.filter((e) => e.to !== 'src/utils/index.ts');
    snap.fileEdges.push({ from: 'src/ui/App.tsx', to: 'src/gone.ts' });
    const d = diffSnapshot(snap, g);
    expect(d.addedFiles).toEqual(['src/utils/index.ts']);
    expect(d.addedFileEdges).toEqual([{ from: 'src/services/orders.ts', to: 'src/utils/index.ts' }]);
    expect(d.removedFileEdges).toEqual([{ from: 'src/ui/App.tsx', to: 'src/gone.ts' }]);
  });

  it('limits the graph to a scope folder', async () => {
    const scoped = await new Analyzer(WASM).analyze(root, { scope: 'src/services' });
    expect(scoped.files.map((f) => f.path).sort()).toEqual(['src/services/notify.ts', 'src/services/orders.ts']);
    expect(scoped.fileCycles).toHaveLength(1);
  });
});
