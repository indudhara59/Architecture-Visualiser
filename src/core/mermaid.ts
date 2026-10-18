import { ArchGraph } from './types';

function safeId(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_') || 'root';
}

function label(s: string): string {
  return s.replace(/"/g, '#quot;');
}

/** Component-level flowchart; edges carrying a file-level import cycle are drawn red. */
export function toMermaid(graph: ArchGraph, opts: { includeExternals?: boolean } = {}): string {
  const lines = ['flowchart LR'];
  for (const c of graph.components) {
    lines.push(`  ${safeId(c.id)}["${label(c.label)}<br/><small>${c.files.length} files</small>"]`);
  }
  const red: number[] = [];
  graph.componentEdges.forEach((e, i) => {
    // linkStyle indexes links in declaration order.
    if (e.cyclic) red.push(i);
    lines.push(`  ${safeId(e.from)} -->|${e.count}| ${safeId(e.to)}`);
  });
  if (opts.includeExternals) {
    for (const x of graph.externals.filter((x) => x.kind === 'package')) {
      const id = safeId(`ext_${x.name}`);
      lines.push(`  ${id}(["${label(x.name)}"])`);
      for (const comp of Object.keys(x.usedBy)) lines.push(`  ${safeId(comp)} -.-> ${id}`);
    }
  }
  for (const i of red) lines.push(`  linkStyle ${i} stroke:#e5484d,stroke-width:2px`);
  const layers = new Map<string, string[]>();
  for (const c of graph.components) layers.set(c.layer, [...(layers.get(c.layer) ?? []), safeId(c.id)]);
  const colors: Record<string, string> = {
    ui: '#4f8cff', api: '#a66cff', service: '#22a06b', data: '#e5a50a', util: '#8a8f98', config: '#6b7280', test: '#c2410c', other: '#5b6b7f',
  };
  for (const [layer, ids] of layers) {
    lines.push(`  classDef ${layer} fill:${colors[layer]}22,stroke:${colors[layer]}`);
    lines.push(`  class ${ids.join(',')} ${layer}`);
  }
  return lines.join('\n') + '\n';
}
