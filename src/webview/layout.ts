import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { NodeKind, VEdge, ViewKind, ViewModel } from './model';

export interface Point {
  x: number;
  y: number;
}

export interface LaidNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  parent?: string;
  data: any;
}

export interface LaidEdge extends VEdge {
  points: Point[];
  /** Spline edges carry Bézier control points (start, c1, c2, end, c1, c2, end…). */
  spline: boolean;
}

export interface Layout {
  nodes: LaidNode[];
  edges: LaidEdge[];
  width: number;
  height: number;
}

const elk = new ELK();

export async function layoutView(vm: ViewModel, view: ViewKind, direction: 'RIGHT' | 'DOWN'): Promise<Layout> {
  if (view === 'modules') return layoutModules(vm, direction);
  const byId = new Map(vm.nodes.map((n) => [n.id, n]));
  const elkNodes = new Map<string, ElkNode>();
  const roots: ElkNode[] = [];

  for (const n of vm.nodes) {
    const isGroup = n.kind === 'group';
    const en: ElkNode = isGroup
      ? {
          id: n.id,
          children: [],
          layoutOptions: {
            'elk.padding': n.data.kind === 'app' ? '[top=58,left=22,bottom=22,right=22]' : '[top=50,left=20,bottom=20,right=20]',
            'elk.direction': n.data.kind === 'tech' ? 'DOWN' : direction,
          },
        }
      : { id: n.id, width: n.w, height: n.h };
    elkNodes.set(n.id, en);
  }
  for (const n of vm.nodes) {
    const en = elkNodes.get(n.id)!;
    if (n.parent && elkNodes.has(n.parent)) elkNodes.get(n.parent)!.children!.push(en);
    else roots.push(en);
  }
  // ELK rejects empty compound nodes without a size.
  for (const n of vm.nodes) {
    const en = elkNodes.get(n.id)!;
    if (n.kind === 'group' && !en.children!.length) {
      en.width = 200;
      en.height = 80;
    }
  }

  const present = new Set(vm.nodes.map((n) => n.id));
  const edges: ElkExtendedEdge[] = vm.edges
    .filter((e) => present.has(e.source) && present.has(e.target) && e.source !== e.target)
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));

  // Dense graphs read better with curves; sparse ones look tidier orthogonal.
  const leafCount = vm.nodes.filter((n) => n.kind !== 'group').length || 1;
  const spline = edges.length / leafCount > 1.6 && view !== 'system';
  const spacing = view === 'system' ? { between: 90, node: 22 } : { between: 90, node: 40 };
  const graph: ElkNode = {
    id: 'root',
    children: roots,
    edges,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': spline ? 'SPLINES' : 'ORTHOGONAL',
      ...(spline ? { 'elk.layered.edgeRouting.splines.mode': 'CONSERVATIVE' } : {}),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing.between),
      'elk.spacing.nodeNode': String(spacing.node),
      'elk.spacing.edgeNode': '18',
      'elk.spacing.edgeEdge': '10',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': '60',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    },
  };

  const out = await elk.layout(graph);

  const abs = new Map<string, Point>();
  const nodes: LaidNode[] = [];
  const visit = (en: ElkNode, ox: number, oy: number) => {
    for (const c of en.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      abs.set(c.id, { x, y });
      const v = byId.get(c.id)!;
      nodes.push({ id: c.id, kind: v.kind, x, y, w: c.width ?? v.w, h: c.height ?? v.h, parent: v.parent, data: v.data });
      visit(c, x, y);
    }
  };
  abs.set('root', { x: 0, y: 0 });
  visit(out, 0, 0);

  const vEdges = new Map(vm.edges.map((e) => [e.id, e]));
  const laidEdges: LaidEdge[] = [];
  const collect = (en: ElkNode) => {
    for (const e of (en.edges ?? []) as (ElkExtendedEdge & { container?: string })[]) {
      const sec = e.sections?.[0];
      const v = vEdges.get(e.id);
      if (!sec || !v) continue;
      // Edge coordinates are relative to the edge's container node.
      const o = abs.get(e.container ?? en.id) ?? { x: 0, y: 0 };
      const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
      laidEdges.push({ ...v, points: pts, spline: spline && (pts.length - 1) % 3 === 0 });
    }
    for (const c of en.children ?? []) collect(c);
  };
  collect(out);

  // Groups first so they paint underneath their children.
  nodes.sort((a, b) => Number(b.kind === 'group') - Number(a.kind === 'group'));
  return { nodes, edges: laidEdges, width: out.width ?? 0, height: out.height ?? 0 };
}

export function edgePath(e: { points: Point[]; spline: boolean }): string {
  if (!e.spline) return roundedPath(e.points);
  const p = e.points;
  let d = `M${p[0].x},${p[0].y}`;
  for (let i = 1; i + 2 < p.length; i += 3) d += ` C${p[i].x},${p[i].y} ${p[i + 1].x},${p[i + 1].y} ${p[i + 2].x},${p[i + 2].y}`;
  return d;
}

/** SVG path through orthogonal points with rounded corners. */
export function roundedPath(pts: Point[], r = 10): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const d1 = Math.hypot(c.x - p.x, c.y - p.y);
    const d2 = Math.hypot(n.x - c.x, n.y - c.y);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a = { x: c.x - ((c.x - p.x) / d1) * rr, y: c.y - ((c.y - p.y) / d1) * rr };
    const b = { x: c.x + ((n.x - c.x) / d2) * rr, y: c.y + ((n.y - c.y) / d2) * rr };
    d += ` L${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x},${last.y}`;
}

/** Point halfway along a polyline (for labels). */
export function midpoint(pts: Point[]): Point {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (half <= seg) {
      const t = seg ? half / seg : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    half -= seg;
  }
  return pts[0];
}

const GROUP_PAD = { top: 46, side: 22, bottom: 22 };

/**
 * Module view: a flat layered layout in three partitions (importers → focus files → dependencies),
 * then a group box drawn around the focus band. Avoids ELK's compound routing, which gets messy
 * for dense file graphs.
 */
async function layoutModules(vm: ViewModel, direction: 'RIGHT' | 'DOWN'): Promise<Layout> {
  const group = vm.nodes.find((n) => n.kind === 'group');
  const leaves = vm.nodes.filter((n) => n.kind !== 'group');
  const byId = new Map(leaves.map((n) => [n.id, n]));
  const partition = (n: (typeof leaves)[number]) => (n.kind === 'neighbor' ? (n.data.role === 'dependent' ? 0 : 2) : 1);
  const edges: ElkExtendedEdge[] = vm.edges
    .filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target)
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
  const dense = edges.length / Math.max(1, leaves.length) > 1.6;
  const graph: ElkNode = {
    id: 'root',
    children: leaves.map((n) => ({ id: n.id, width: n.w, height: n.h, layoutOptions: { 'elk.partitioning.partition': String(partition(n)) } })),
    edges,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.partitioning.activate': 'true',
      'elk.edgeRouting': dense ? 'SPLINES' : 'ORTHOGONAL',
      ...(dense ? { 'elk.layered.edgeRouting.splines.mode': 'CONSERVATIVE' } : {}),
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '24',
      'elk.spacing.edgeNode': '16',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.separateConnectedComponents': 'false',
      'elk.padding': `[top=${40 + GROUP_PAD.top},left=${40 + GROUP_PAD.side},bottom=${40 + GROUP_PAD.bottom},right=${40 + GROUP_PAD.side}]`,
    },
  };
  const out = await elk.layout(graph);
  const nodes: LaidNode[] = (out.children ?? []).map((c) => {
    const v = byId.get(c.id)!;
    return { id: c.id, kind: v.kind, x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? v.w, h: c.height ?? v.h, parent: v.parent, data: v.data };
  });
  const vEdges = new Map(vm.edges.map((e) => [e.id, e]));
  const laidEdges: LaidEdge[] = [];
  for (const e of out.edges ?? []) {
    const sec = e.sections?.[0];
    const v = vEdges.get(e.id);
    if (!sec || !v) continue;
    const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint];
    laidEdges.push({ ...v, points: pts, spline: dense && (pts.length - 1) % 3 === 0 });
  }
  const focus = nodes.filter((n) => n.parent === group?.id);
  if (group && focus.length) {
    const x0 = Math.min(...focus.map((n) => n.x)) - GROUP_PAD.side;
    const y0 = Math.min(...focus.map((n) => n.y)) - GROUP_PAD.top;
    const x1 = Math.max(...focus.map((n) => n.x + n.w)) + GROUP_PAD.side;
    const y1 = Math.max(...focus.map((n) => n.y + n.h)) + GROUP_PAD.bottom;
    nodes.unshift({ id: group.id, kind: 'group', x: x0, y: y0, w: x1 - x0, h: y1 - y0, data: group.data });
  }
  return { nodes, edges: laidEdges, width: out.width ?? 0, height: out.height ?? 0 };
}
