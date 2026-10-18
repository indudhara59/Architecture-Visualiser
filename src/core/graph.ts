import * as path from 'node:path';
import { Component, ComponentEdge, FileEdge, LayerTag } from './types';

const MAX_COMPONENTS = 14;
const MIN_COMPONENTS = 4;
/** A group holding more than this share of all files gets split into its subfolders. */
const SPLIT_SHARE = 0.25;
/** Folders that are kept as one box: splitting them adds noise, not architecture. */
const NO_SPLIT = new Set([
  'test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'fixtures', '__fixtures__', 'testdata', 'examples', 'example',
  'samples', 'benchmarks', 'benchmark', 'bench', 'docs', 'scripts', 'perf-measures', 'runtime-tests', 'runtime_tests',
]);

function dirOf(p: string): string {
  const d = path.posix.dirname(p);
  return d === '.' ? '' : d;
}

/** Longest directory prefix shared by every file. */
export function commonDir(files: string[]): string {
  if (!files.length) return '';
  let parts = dirOf(files[0]).split('/').filter(Boolean);
  for (const f of files) {
    const fp = dirOf(f).split('/').filter(Boolean);
    let i = 0;
    while (i < parts.length && i < fp.length && parts[i] === fp[i]) i++;
    parts = parts.slice(0, i);
    if (!parts.length) break;
  }
  return parts.join('/');
}

/** Key of the direct child folder of `folder` containing `file`, or `folder` itself if the file sits there. */
function childKey(file: string, folder: string): string {
  const rest = folder ? file.slice(folder.length + 1) : file;
  const slash = rest.indexOf('/');
  if (slash < 0) return folder;
  const seg = rest.slice(0, slash);
  return folder ? `${folder}/${seg}` : seg;
}

/**
 * Groups files into components by folder. With depth 0 it adapts: it starts from the
 * top-level folders and keeps splitting the biggest folder while it dominates the project.
 */
export function groupIntoComponents(files: string[], depth = 0): Map<string, string[]> {
  const base = commonDir(files);
  const groups = new Map<string, string[]>();
  const add = (key: string, f: string) => {
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  };

  if (depth > 0) {
    for (const f of files) {
      const segs = dirOf(f.slice(base ? base.length + 1 : 0)).split('/').filter(Boolean);
      add([base, ...segs.slice(0, depth)].filter(Boolean).join('/'), f);
    }
    return groups;
  }

  for (const f of files) add(childKey(f, base), f);
  // Folders already split (their direct files stay in the folder's own group).
  const split = new Set<string>([base]);

  for (;;) {
    let best: string | undefined;
    let bestSize = 0;
    for (const [key, list] of groups) {
      if (split.has(key) || NO_SPLIT.has(path.posix.basename(key).toLowerCase())) continue;
      const hasSubfolders = list.some((f) => dirOf(f) !== key);
      if (hasSubfolders && list.length > bestSize) {
        best = key;
        bestSize = list.length;
      }
    }
    if (!best) break;
    const dominates = bestSize > files.length * SPLIT_SHARE;
    if (!(groups.size < MIN_COMPONENTS || (dominates && groups.size < MAX_COMPONENTS))) break;

    const list = groups.get(best)!;
    const children = new Map<string, string[]>();
    for (const f of list) {
      const k = childKey(f, best);
      children.set(k, [...(children.get(k) ?? []), f]);
    }
    if (groups.size - 1 + children.size > MAX_COMPONENTS * 1.5 && groups.size >= MIN_COMPONENTS) break;
    groups.delete(best);
    split.add(best);
    for (const [k, l] of children) groups.set(k, l);
  }
  return groups;
}

const LAYER_WORDS: [LayerTag, string[]][] = [
  ['test', ['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'fixtures', '__mocks__', 'mocks', 'testing']],
  ['ui', ['ui', 'components', 'component', 'views', 'pages', 'screens', 'widgets', 'frontend', 'client', 'web', 'layouts', 'templates', 'hooks', 'styles', 'app', 'webview']],
  ['api', ['api', 'apis', 'routes', 'router', 'routers', 'controllers', 'controller', 'handlers', 'endpoints', 'server', 'graphql', 'rest', 'http', 'middleware', 'middlewares', 'cli', 'commands']],
  ['service', ['services', 'service', 'domain', 'core', 'usecases', 'use-cases', 'business', 'logic', 'jobs', 'workers', 'tasks', 'features', 'modules', 'engine']],
  ['data', ['models', 'model', 'db', 'database', 'repositories', 'repository', 'repos', 'entities', 'entity', 'schema', 'schemas', 'migrations', 'store', 'stores', 'dao', 'prisma', 'orm', 'data', 'persistence', 'storage']],
  ['util', ['utils', 'util', 'helpers', 'helper', 'common', 'shared', 'lib', 'libs', 'tools', 'support', 'types', 'interfaces']],
  ['config', ['config', 'configs', 'configuration', 'settings', 'constants', 'env', 'scripts']],
];

export function guessLayer(folder: string): LayerTag {
  const segs = folder.toLowerCase().split('/').filter(Boolean).reverse();
  for (const seg of segs) {
    for (const [tag, words] of LAYER_WORDS) if (words.includes(seg)) return tag;
  }
  return 'other';
}

export function buildComponents(files: string[], depth = 0): Component[] {
  const groups = groupIntoComponents(files, depth);
  const base = commonDir(files);
  const comps: Component[] = [];
  for (const [folder, list] of groups) {
    let label = base && folder.startsWith(base + '/') ? folder.slice(base.length + 1) : folder;
    if (folder === base) label = base ? `${path.posix.basename(base)} (root)` : '(root)';
    comps.push({ id: `c:${folder}`, folder, label, layer: guessLayer(folder), files: list.sort() });
  }
  return comps.sort((a, b) => a.label.localeCompare(b.label));
}

/** Tarjan's strongly-connected-components algorithm (iterative, so deep graphs don't overflow). */
export function stronglyConnected(nodes: string[], adj: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  for (const start of nodes) {
    if (idx.has(start)) continue;
    const work: { node: string; i: number }[] = [{ node: start, i: 0 }];
    idx.set(start, index);
    low.set(start, index++);
    stack.push(start);
    onStack.add(start);

    while (work.length) {
      const frame = work[work.length - 1];
      const succ = adj.get(frame.node) ?? [];
      if (frame.i < succ.length) {
        const w = succ[frame.i++];
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index++);
          stack.push(w);
          onStack.add(w);
          work.push({ node: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, idx.get(w)!));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
        }
        if (low.get(frame.node) === idx.get(frame.node)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== frame.node);
          result.push(scc);
        }
      }
    }
  }
  return result;
}

/** SCCs that are real cycles: more than one node, or a node that imports itself. */
export function findCycles(nodes: string[], edges: { from: string; to: string }[]): string[][] {
  const adj = new Map<string, string[]>();
  const selfLoops = new Set<string>();
  for (const e of edges) {
    if (e.from === e.to) selfLoops.add(e.from);
    const l = adj.get(e.from);
    if (l) l.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  return stronglyConnected(nodes, adj)
    .filter((scc) => scc.length > 1 || selfLoops.has(scc[0]))
    .map((scc) => scc.sort());
}

export function aggregateComponentEdges(fileEdges: FileEdge[], componentOf: Map<string, string>): ComponentEdge[] {
  const agg = new Map<string, ComponentEdge>();
  for (const e of fileEdges) {
    const from = componentOf.get(e.from);
    const to = componentOf.get(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    const cur = agg.get(key);
    if (cur) cur.count += e.count;
    else agg.set(key, { from, to, count: e.count });
  }
  return [...agg.values()];
}

/** Flags component edges that carry at least one file edge inside a file-level cycle. */
export function markCyclicComponentEdges(
  fileCycles: string[][],
  fileEdges: FileEdge[],
  componentOf: Map<string, string>,
  componentEdges: ComponentEdge[],
): void {
  const cycleOf = new Map<string, number>();
  fileCycles.forEach((c, i) => c.forEach((f) => cycleOf.set(f, i)));
  const cyclicPairs = new Set<string>();
  for (const e of fileEdges) {
    if (e.typeOnly || !cycleOf.has(e.from) || cycleOf.get(e.from) !== cycleOf.get(e.to)) continue;
    cyclicPairs.add(`${componentOf.get(e.from)}\u0000${componentOf.get(e.to)}`);
  }
  for (const ce of componentEdges) ce.cyclic = cyclicPairs.has(`${ce.from}\u0000${ce.to}`);
}
