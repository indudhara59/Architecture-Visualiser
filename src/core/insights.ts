import * as path from 'node:path';
import picomatch from 'picomatch';
import { ArchGraph, FileMetric, HealthBreakdown, Insights, LayerTag, LayerWarning, RuleViolation, RulesConfig } from './types';

/**
 * Rough dependency direction: higher layers may depend on lower ones, not the reverse.
 * Layers missing here (test, config, other) are never flagged.
 */
const LAYER_RANK: Partial<Record<LayerTag, number>> = { ui: 4, api: 4, service: 3, data: 2, util: 1 };

/** Files that are commonly entry points, so having no importers is expected. */
const ENTRY_RE =
  /(^|\/)(index|main|app|server|cli|bin|__main__|__init__|manage|setup|conftest|wsgi|asgi|worker|extension|background|content|popup|preload|layout|page|route|middleware|loading|error|not-found|_app|_document)\.[^/]+$|(^|\/)(pages|app|routes|bin|scripts|migrations|examples?|benchmarks?|docs)\/|\.(config|setup|test|spec|stories|d)\.[^/]+$|(^|\/)(test_[^/]+|[^/]+_test)\.py$|(^|\/)(tests?|__tests__|spec|e2e)\//;

export function computeInsights(graph: ArchGraph, rules?: RulesConfig): Insights {
  const metrics: Record<string, { fanIn: number; fanOut: number }> = {};
  for (const f of graph.files) metrics[f.path] = { fanIn: 0, fanOut: 0 };
  for (const e of graph.fileEdges) {
    metrics[e.from].fanOut++;
    metrics[e.to].fanIn++;
  }
  const asList: FileMetric[] = Object.entries(metrics).map(([p, m]) => ({ path: p, ...m }));
  const hotspots = asList.filter((m) => m.fanIn >= 3).sort((a, b) => b.fanIn - a.fanIn).slice(0, 12);
  const fanOutHeavy = asList.filter((m) => m.fanOut >= 8).sort((a, b) => b.fanOut - a.fanOut).slice(0, 12);
  const orphans = asList
    .filter((m) => m.fanIn === 0 && !ENTRY_RE.test(m.path))
    .map((m) => m.path)
    .sort();

  const compLayer = new Map(graph.components.map((c) => [c.id, c.layer]));
  const fileComp = new Map(graph.files.map((f) => [f.path, f.component]));
  const warnings = new Map<string, LayerWarning>();
  for (const e of graph.fileEdges) {
    if (e.typeOnly) continue;
    const from = fileComp.get(e.from)!;
    const to = fileComp.get(e.to)!;
    if (from === to) continue;
    const fl = compLayer.get(from)!;
    const tl = compLayer.get(to)!;
    const fr = LAYER_RANK[fl];
    const tr = LAYER_RANK[tl];
    if (fr === undefined || tr === undefined || fr >= tr) continue;
    const key = `${from}\u0000${to}`;
    const w = warnings.get(key);
    if (w) w.count += e.count;
    else warnings.set(key, { from, to, fromLayer: fl, toLayer: tl, example: { from: e.from, to: e.to, line: e.lines[0] ?? 1 }, count: e.count });
  }
  const layerWarnings = [...warnings.values()].sort((a, b) => b.count - a.count);

  const ruleViolations = rules ? checkRules(graph, rules) : [];

  const totalLines = graph.files.reduce((a, f) => a + (f.lines ?? 0), 0);
  const langMap = new Map<string, { language: any; files: number; lines: number }>();
  for (const f of graph.files) {
    const l = langMap.get(f.language) ?? { language: f.language, files: 0, lines: 0 };
    l.files++;
    l.lines += f.lines ?? 0;
    langMap.set(f.language, l);
  }

  // Health: start at 100 and subtract capped penalties, so one problem can't zero the score.
  const n = Math.max(1, graph.files.length);
  const inCycles = new Set(graph.fileCycles.flat()).size;
  const breakdown: HealthBreakdown[] = [];
  const add = (label: string, penalty: number, detail: string) => {
    if (penalty > 0.5) breakdown.push({ label, penalty: Math.round(penalty), detail });
  };
  add('Import cycles', Math.min(35, (inCycles / n) * 150 + graph.fileCycles.length * 2), `${graph.fileCycles.length} cycles across ${inCycles} files`);
  add('Layering', Math.min(20, layerWarnings.length * 4), `${layerWarnings.length} lower layers importing higher ones`);
  add('Rule violations', Math.min(25, ruleViolations.filter((v) => v.severity === 'error').length * 5 + ruleViolations.filter((v) => v.severity === 'warning').length * 2), `${ruleViolations.length} imports break your rules`);
  const godFiles = asList.filter((m) => m.fanOut >= 20 || m.fanIn >= Math.max(25, n * 0.3)).length;
  add('Highly coupled files', Math.min(10, godFiles * 2), `${godFiles} files with very high fan-in or fan-out`);
  add('Unused files', Math.min(10, (orphans.length / n) * 40), `${orphans.length} files nothing imports`);
  add('Unresolved imports', Math.min(10, (graph.stats.unresolved / Math.max(1, graph.stats.imports)) * 100), `${graph.stats.unresolved} imports could not be resolved`);
  const score = Math.max(0, Math.round(100 - breakdown.reduce((a, b) => a + b.penalty, 0)));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';

  return {
    score,
    grade,
    breakdown: breakdown.sort((a, b) => b.penalty - a.penalty),
    totalLines,
    languages: [...langMap.values()].sort((a, b) => b.lines - a.lines),
    hotspots,
    fanOutHeavy,
    orphans,
    layerWarnings,
    ruleViolations,
    metrics,
  };
}

function toList(v: string | string[] | undefined): string[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

export function checkRules(graph: ArchGraph, cfg: RulesConfig): RuleViolation[] {
  const ignored = picomatch(cfg.ignore?.length ? cfg.ignore : ['\u0000'], { dot: true });
  const out: RuleViolation[] = [];
  for (const [i, r] of (cfg.rules ?? []).entries()) {
    const from = picomatch(toList(r.from), { dot: true });
    const to = picomatch(toList(r.to), { dot: true });
    const except = toList(r.except).length ? picomatch(toList(r.except), { dot: true }) : () => false;
    const name = r.name ?? `${toList(r.from).join(', ')} must not import ${toList(r.to).join(', ')}`;
    for (const e of graph.fileEdges) {
      if (e.typeOnly || ignored(e.from) || ignored(e.to)) continue;
      if (from(e.from) && to(e.to) && !except(e.to) && !except(e.from)) {
        for (const line of e.lines) out.push({ rule: name || `rule ${i + 1}`, severity: r.severity ?? 'error', from: e.from, to: e.to, line });
      }
    }
  }
  return out;
}

/** A starter rules file built from the detected components. */
export function sampleRules(graph: ArchGraph): RulesConfig & { $comment: string } {
  const byLayer = (l: LayerTag) => graph.components.filter((c) => c.layer === l && c.folder).map((c) => `${c.folder}/**`);
  const ui = byLayer('ui');
  const data = byLayer('data');
  const util = byLayer('util');
  const rules: NonNullable<RulesConfig['rules']> = [];
  if (ui.length && data.length) rules.push({ name: 'UI must not access the data layer directly', from: ui, to: data, severity: 'error' });
  if (util.length) {
    const higher = graph.components.filter((c) => ['ui', 'api', 'service'].includes(c.layer) && c.folder).map((c) => `${c.folder}/**`);
    if (higher.length) rules.push({ name: 'Utilities must stay independent', from: util, to: higher, severity: 'warning' });
  }
  if (!rules.length) {
    const comps = graph.components.filter((c) => c.folder);
    if (comps.length >= 2) {
      rules.push({ name: `${path.posix.basename(comps[0].folder)} must not import ${path.posix.basename(comps[1].folder)}`, from: `${comps[0].folder}/**`, to: `${comps[1].folder}/**`, severity: 'warning' });
    }
  }
  return {
    $comment: 'Architecture-Visualiser rules. Each rule forbids imports from files matching "from" to files matching "to" (glob patterns, workspace-relative). Violations appear in the diagram and the Problems panel.',
    rules,
    ignore: ['**/*.test.*', '**/*.spec.*', '**/tests/**'],
  };
}
