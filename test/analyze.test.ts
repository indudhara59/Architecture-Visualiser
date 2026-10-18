import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Analyzer } from '../src/core/analyze';
import { groupIntoComponents, findCycles, guessLayer } from '../src/core/graph';
import { parseJsonc } from '../src/core/resolver';
import { toMermaid } from '../src/core/mermaid';

const WASM = path.join(__dirname, '../dist/wasm');
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);
const edges = (g: { fileEdges: { from: string; to: string }[] }) => g.fileEdges.map((e) => `${e.from} -> ${e.to}`).sort();

describe('TypeScript fixture', async () => {
  const g = await new Analyzer(WASM).analyze(fixture('ts-app'));

  it('scans source files and respects .gitignore', () => {
    expect(g.files.map((f) => f.path)).not.toContain('ignored/skip.ts');
    expect(g.files).toHaveLength(10);
  });

  it('resolves relative, alias, .js-extension, dynamic, require and re-export imports', () => {
    expect(edges(g)).toEqual([
      'src/api/server.ts -> src/api/routes.ts',
      'src/api/server.ts -> src/data/models.ts',
      'src/api/server.ts -> src/services/orders.ts',
      'src/index.ts -> src/api/server.ts',
      'src/services/notify.ts -> src/services/orders.ts',
      'src/services/orders.ts -> src/data/db.ts',
      'src/services/orders.ts -> src/services/notify.ts',
      'src/services/orders.ts -> src/utils/index.ts',
      'src/ui/App.tsx -> src/data/db.ts',
      'src/ui/App.tsx -> src/ui/Button.tsx',
    ]);
    expect(g.stats.unresolved).toBe(0);
  });

  it('marks type-only imports', () => {
    expect(g.fileEdges.find((e) => e.to === 'src/data/models.ts')?.typeOnly).toBe(true);
  });

  it('classifies externals', () => {
    expect(g.externals.map((x) => `${x.kind}:${x.name}`)).toEqual(['package:express', 'builtin:fs', 'package:pg', 'package:react']);
  });

  it('detects file cycles', () => {
    expect(g.fileCycles).toEqual([['src/services/notify.ts', 'src/services/orders.ts']]);
  });

  it('groups files into components and aggregates edges', () => {
    expect(g.components.map((c) => c.label)).toEqual(['api', 'data', 'services', 'src (root)', 'ui', 'utils']);
    expect(g.components.find((c) => c.label === 'data')?.layer).toBe('data');
    const ce = g.componentEdges.map((e) => `${e.from} -> ${e.to}`).sort();
    expect(ce).toContain('c:src/ui -> c:src/data');
    expect(ce).toContain('c:src/services -> c:src/utils');
  });

  it('exports mermaid', () => {
    const m = toMermaid(g);
    expect(m).toMatch(/^flowchart LR/);
    expect(m).toContain('c_src_ui -->|1| c_src_data');
  });
});

describe('Python fixture', async () => {
  const g = await new Analyzer(WASM).analyze(fixture('py-app'));

  it('resolves absolute (src layout), relative and from-package imports', () => {
    expect(edges(g)).toEqual([
      'src/shop/api/routes.py -> src/shop/models/user.py',
      'src/shop/api/routes.py -> src/shop/services/__init__.py',
      'src/shop/api/routes.py -> src/shop/services/billing.py',
      'src/shop/main.py -> src/shop/api/routes.py',
      'src/shop/main.py -> src/shop/services/billing.py',
      'src/shop/models/user.py -> src/shop/services/billing.py',
      'src/shop/services/billing.py -> src/shop/models/user.py',
      'src/shop/services/billing.py -> src/shop/services/tax.py',
      'src/shop/services/tax.py -> src/shop/services/billing.py',
      'tests/test_billing.py -> src/shop/services/billing.py',
    ]);
  });

  it('separates stdlib from third-party packages', () => {
    const names = g.externals.map((x) => `${x.kind}:${x.name}`);
    expect(names).toEqual(expect.arrayContaining(['builtin:os', 'builtin:sys', 'builtin:dataclasses', 'package:requests', 'package:stripe', 'package:fastapi']));
    expect(names.some((n) => n.includes('__future__'))).toBe(false);
  });

  it('treats TYPE_CHECKING imports as type-only (not cycles)', () => {
    expect(g.fileEdges.find((e) => e.from === 'src/shop/models/user.py' && e.to === 'src/shop/services/billing.py')?.typeOnly).toBe(true);
  });

  it('detects the billing <-> tax cycle', () => {
    expect(g.fileCycles).toEqual([['src/shop/services/billing.py', 'src/shop/services/tax.py']]);
  });
});

describe('graph helpers', () => {
  it('splits a dominant folder adaptively', () => {
    const files = [
      'src/app/a/1.ts', 'src/app/a/2.ts', 'src/app/b/1.ts', 'src/app/b/2.ts', 'src/app/c/1.ts',
      'src/app/d/1.ts', 'src/lib/x.ts', 'src/main.ts',
    ];
    expect([...groupIntoComponents(files).keys()].sort()).toEqual(['src', 'src/app/a', 'src/app/b', 'src/app/c', 'src/app/d', 'src/lib']);
    expect([...groupIntoComponents(files, 1).keys()].sort()).toEqual(['src', 'src/app', 'src/lib']);
  });

  it('finds self loops and multi-node cycles', () => {
    const c = findCycles(['a', 'b', 'c', 'd'], [
      { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'd', to: 'd' },
    ]);
    expect(c).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('guesses layers from folder names', () => {
    expect(guessLayer('src/components/forms')).toBe('ui');
    expect(guessLayer('server/routes')).toBe('api');
    expect(guessLayer('foo/bar')).toBe('other');
  });

  it('parses JSONC', () => {
    expect(parseJsonc('{ "a": "http://x", /* c */ "b": [1,], }')).toEqual({ a: 'http://x', b: [1] });
  });
});
