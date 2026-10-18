import type { Component, LayerTag, Payload, TechNode } from '../core/types';
import { basename, TECH_GROUPS } from './theme';

export type ViewKind = 'system' | 'components' | 'modules';

export interface ViewOptions {
  view: ViewKind;
  focus?: string;
  showPackages: boolean;
  showTests: boolean;
  hiddenLayers: LayerTag[];
  showDiff: boolean;
}

export type NodeKind = 'component' | 'file' | 'neighbor' | 'tech' | 'package' | 'group';

export interface VNode {
  id: string;
  kind: NodeKind;
  w: number;
  h: number;
  parent?: string;
  data: any;
}

export interface VEdge {
  id: string;
  source: string;
  target: string;
  classes: string[];
  count: number;
  weight: number;
}

export interface ViewModel {
  nodes: VNode[];
  edges: VEdge[];
}

export const SIZES = {
  component: [236, 86],
  file: [212, 50],
  neighbor: [204, 52],
  tech: [206, 58],
  package: [156, 34],
} as const;

const key = (a: string, b: string) => `${a}\u0000${b}`;

/** 1.4px for a single import, up to ~3.8px for the heaviest edges (log scale, so small projects stay thin). */
function edgeWeight(count: number, max: number): number {
  return 1.4 + 2.4 * Math.min(1, Math.log2(count) / Math.log2(Math.max(8, max)));
}

/** Lookups derived once per payload. */
export class Index {
  readonly comp = new Map<string, Component>();
  readonly fileComp = new Map<string, string>();
  readonly fileLines = new Map<string, number>();
  readonly fileLang = new Map<string, string>();
  readonly cycleOf = new Map<string, number>();
  readonly compsWithCycles = new Set<string>();
  readonly violationFileEdges = new Set<string>();
  readonly violationCompEdges = new Set<string>();
  readonly compsWithViolations = new Set<string>();
  readonly addedFiles = new Set<string>();
  readonly addedFileEdges = new Set<string>();
  readonly addedCompEdges = new Set<string>();
  readonly compFanIn = new Map<string, number>();
  readonly compFanOut = new Map<string, number>();
  readonly compLines = new Map<string, number>();

  constructor(readonly p: Payload) {
    const g = p.graph;
    for (const c of g.components) this.comp.set(c.id, c);
    for (const f of g.files) {
      this.fileComp.set(f.path, f.component);
      this.fileLines.set(f.path, f.lines ?? 0);
      this.fileLang.set(f.path, f.language);
      this.compLines.set(f.component, (this.compLines.get(f.component) ?? 0) + (f.lines ?? 0));
    }
    g.fileCycles.forEach((c, i) =>
      c.forEach((f) => {
        this.cycleOf.set(f, i);
        this.compsWithCycles.add(this.fileComp.get(f)!);
      }),
    );
    for (const v of p.insights.ruleViolations) {
      this.violationFileEdges.add(key(v.from, v.to));
      const a = this.fileComp.get(v.from)!;
      const b = this.fileComp.get(v.to)!;
      this.compsWithViolations.add(a);
      if (a !== b) this.violationCompEdges.add(key(a, b));
    }
    for (const w of p.insights.layerWarnings) this.violationCompEdges.add(key(w.from, w.to));
    for (const e of g.componentEdges) {
      this.compFanOut.set(e.from, (this.compFanOut.get(e.from) ?? 0) + 1);
      this.compFanIn.set(e.to, (this.compFanIn.get(e.to) ?? 0) + 1);
    }
    if (p.diff) {
      p.diff.addedFiles.forEach((f) => this.addedFiles.add(f));
      p.diff.addedFileEdges.forEach((e) => this.addedFileEdges.add(key(e.from, e.to)));
      p.diff.addedComponentEdges.forEach((e) => this.addedCompEdges.add(key(e.from, e.to)));
    }
  }

  isTest(path: string): boolean {
    return /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/.test(path);
  }

  fileCyclic(a: string, b: string): boolean {
    return this.cycleOf.has(a) && this.cycleOf.get(a) === this.cycleOf.get(b);
  }
}

function visibleComponents(ix: Index, o: ViewOptions): Component[] {
  return ix.p.graph.components.filter((c) => !o.hiddenLayers.includes(c.layer) && (o.showTests || c.layer !== 'test'));
}

function componentNode(ix: Index, c: Component, o: ViewOptions, parent?: string, compact = false): VNode {
  const added = o.showDiff ? c.files.filter((f) => ix.addedFiles.has(f)).length : 0;
  const [w, h] = SIZES.component;
  return {
    id: c.id,
    kind: 'component',
    w,
    h: compact ? 64 : h,
    parent,
    data: {
      c,
      files: c.files.length,
      lines: ix.compLines.get(c.id) ?? 0,
      fanIn: ix.compFanIn.get(c.id) ?? 0,
      fanOut: ix.compFanOut.get(c.id) ?? 0,
      cycle: ix.compsWithCycles.has(c.id),
      violation: ix.compsWithViolations.has(c.id),
      added,
      compact,
    },
  };
}

export function buildView(ix: Index, o: ViewOptions): ViewModel {
  if (o.view === 'system') return systemView(ix, o);
  if (o.view === 'modules' && o.focus && ix.comp.has(o.focus)) return moduleView(ix, o, o.focus);
  return componentView(ix, o);
}

function componentView(ix: Index, o: ViewOptions): ViewModel {
  const g = ix.p.graph;
  const comps = visibleComponents(ix, o);
  const ids = new Set(comps.map((c) => c.id));
  const nodes: VNode[] = comps.map((c) => componentNode(ix, c, o));
  const maxCount = Math.max(1, ...g.componentEdges.map((e) => e.count));
  const edges: VEdge[] = [];
  for (const e of g.componentEdges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const k = key(e.from, e.to);
    const classes = e.cyclic ? ['cycle'] : ix.violationCompEdges.has(k) ? ['violation'] : [];
    if (o.showDiff && ix.addedCompEdges.has(k)) classes.push('added');
    edges.push({ id: `${e.from}->${e.to}`, source: e.from, target: e.to, classes, count: e.count, weight: edgeWeight(e.count, maxCount) });
  }
  if (o.showDiff && ix.p.diff) {
    for (const e of ix.p.diff.removedComponentEdges) {
      if (ids.has(e.from) && ids.has(e.to)) edges.push({ id: `rm:${e.from}->${e.to}`, source: e.from, target: e.to, classes: ['removed'], count: 0, weight: 1.5 });
    }
  }
  if (o.showPackages) {
    const pkgs = g.externals
      .filter((x) => x.kind === 'package')
      .map((x) => ({ x, users: Object.entries(x.usedBy).filter(([c]) => ids.has(c)) }))
      .filter((p) => p.users.length)
      .sort((a, b) => sum(b.users) - sum(a.users))
      .slice(0, 30);
    for (const { x, users } of pkgs) {
      const id = `pkg:${x.name}`;
      nodes.push({ id, kind: 'package', w: SIZES.package[0], h: SIZES.package[1], data: { name: x.name, count: sum(users) } });
      for (const [c, n] of users) edges.push({ id: `${c}->${id}`, source: c, target: id, classes: ['package'], count: n, weight: 1 });
    }
  }
  return { nodes, edges };
}

function sum(users: [string, number][]): number {
  return users.reduce((a, [, n]) => a + n, 0);
}

function moduleView(ix: Index, o: ViewOptions, focus: string): ViewModel {
  const g = ix.p.graph;
  const comp = ix.comp.get(focus)!;
  const own = new Set(comp.files.filter((f) => o.showTests || !ix.isTest(f)));
  const groupId = `group:${focus}`;
  const nodes: VNode[] = [{ id: groupId, kind: 'group', w: 0, h: 0, data: { label: comp.label, sub: comp.folder || '/', layer: comp.layer, kind: 'focus' } }];
  const prefix = comp.folder ? comp.folder + '/' : '';
  const metrics = ix.p.insights.metrics;
  for (const f of own) {
    const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;
    const slash = rel.lastIndexOf('/');
    nodes.push({
      id: f,
      kind: 'file',
      w: SIZES.file[0],
      h: SIZES.file[1],
      parent: groupId,
      data: {
        path: f,
        name: basename(f),
        sub: slash >= 0 ? rel.slice(0, slash) : '',
        lang: ix.fileLang.get(f),
        lines: ix.fileLines.get(f) ?? 0,
        fanIn: metrics[f]?.fanIn ?? 0,
        fanOut: metrics[f]?.fanOut ?? 0,
        cycle: ix.cycleOf.has(f),
        isNew: o.showDiff && ix.addedFiles.has(f),
      },
    });
  }

  const edges: VEdge[] = [];
  const agg = new Map<string, VEdge>();
  const neighborFiles = new Map<string, Set<string>>();
  for (const e of g.fileEdges) {
    const fromOwn = own.has(e.from);
    const toOwn = own.has(e.to);
    if (!fromOwn && !toOwn) continue;
    const k = key(e.from, e.to);
    const cyc = !e.typeOnly && ix.fileCyclic(e.from, e.to);
    const viol = ix.violationFileEdges.has(k);
    const added = o.showDiff && ix.addedFileEdges.has(k);
    if (fromOwn && toOwn) {
      const classes = [cyc ? 'cycle' : viol ? 'violation' : '', e.typeOnly ? 'type-only' : '', added ? 'added' : ''].filter(Boolean);
      edges.push({ id: `${e.from}->${e.to}`, source: e.from, target: e.to, classes, count: e.count, weight: 1.4 });
      continue;
    }
    const other = fromOwn ? e.to : e.from;
    const cid = ix.fileComp.get(other)!;
    if (cid === focus) continue;
    const oc = ix.comp.get(cid)!;
    if (o.hiddenLayers.includes(oc.layer) || (!o.showTests && (oc.layer === 'test' || ix.isTest(other)))) continue;
    const nid = `n:${cid}`;
    if (!neighborFiles.has(cid)) neighborFiles.set(cid, new Set());
    neighborFiles.get(cid)!.add(other);
    const source = fromOwn ? e.from : nid;
    const target = fromOwn ? nid : e.to;
    const ek = `${source}->${target}`;
    const cur = agg.get(ek);
    if (cur) {
      cur.count += e.count;
      if (cyc && !cur.classes.includes('cycle')) cur.classes = ['cycle'];
      else if (viol && !cur.classes.length) cur.classes = ['violation'];
    } else agg.set(ek, { id: ek, source, target, count: e.count, weight: 1.2, classes: cyc ? ['cycle'] : viol ? ['violation'] : ['neighbor'] });
  }
  for (const [cid, files] of neighborFiles) {
    const c = ix.comp.get(cid)!;
    const nid = `n:${cid}`;
    // Components that only import us sit before the focus band; anything we import sits after it.
    const isDependency = [...agg.values()].some((e) => e.target === nid);
    nodes.push({ id: nid, kind: 'neighbor', w: SIZES.neighbor[0], h: SIZES.neighbor[1], data: { c, linked: files.size, role: isDependency ? 'dependency' : 'dependent' } });
  }
  for (const e of agg.values()) {
    e.weight = edgeWeight(e.count, 16);
    edges.push(e);
  }
  return { nodes, edges };
}

function systemView(ix: Index, o: ViewOptions): ViewModel {
  const sys = ix.p.system;
  const comps = visibleComponents(ix, o);
  const ids = new Set(comps.map((c) => c.id));
  const nodes: VNode[] = [
    {
      id: 'group:app',
      kind: 'group',
      w: 0,
      h: 0,
      data: { label: ix.p.scope ? basename(ix.p.scope) : basename(ix.p.graph.root) || 'Application', sub: 'Your code', kind: 'app', chips: sys.frameworks.map((f) => f.name) },
    },
  ];
  for (const c of comps) nodes.push(componentNode(ix, c, o, 'group:app', true));

  const edges: VEdge[] = [];
  const maxUse = Math.max(1, ...sys.techs.flatMap((t) => Object.values(t.usedBy)));
  for (const grp of TECH_GROUPS) {
    const techs = sys.techs.filter((t) => grp.categories.includes(t.category));
    if (!techs.length) continue;
    const gid = `group:${grp.id}`;
    nodes.push({ id: gid, kind: 'group', w: 0, h: 0, data: { label: grp.label, sub: `${techs.length}`, kind: 'tech' } });
    for (const t of techs) {
      const used = Object.keys(t.usedBy).some((c) => ids.has(c));
      nodes.push({ id: t.id, kind: 'tech', w: SIZES.tech[0], h: SIZES.tech[1], parent: gid, data: { t, declared: !used } as { t: TechNode; declared: boolean } });
      for (const [c, n] of Object.entries(t.usedBy)) {
        if (!ids.has(c)) continue;
        edges.push({ id: `${c}->${t.id}`, source: c, target: t.id, classes: ['tech'], count: n, weight: edgeWeight(n, maxUse) });
      }
    }
  }
  // Keep component-to-component structure faintly visible inside the app box.
  for (const e of ix.p.graph.componentEdges) {
    if (ids.has(e.from) && ids.has(e.to)) {
      edges.push({ id: `${e.from}->${e.to}`, source: e.from, target: e.to, classes: e.cyclic ? ['cycle'] : ['neighbor'], count: e.count, weight: 1 });
    }
  }
  return { nodes, edges };
}
