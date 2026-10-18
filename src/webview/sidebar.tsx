import {
  ArrowRight, Camera, CheckCircle2, Eye, EyeOff, FileWarning, Flame, GitCompareArrows, Ghost, Layers, Lightbulb,
  Repeat, ShieldAlert, Share2, Trash2, TriangleAlert,
} from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { LayerTag, Payload } from '../core/types';
import { post } from './api';
import type { Index } from './model';
import { basename, dirname, fmt, LANG_META, LAYER_COLORS, LAYER_LABELS, TECH_META } from './theme';

export type SidebarTab = 'overview' | 'insights' | 'layers';

export interface SidebarActions {
  showCycle(i: number): void;
  showLayerWarning(i: number): void;
  revealFile(path: string): void;
  openFile(path: string, line?: number): void;
  selectComponent(id: string): void;
  selectTech(id: string): void;
}

interface Props {
  p: Payload;
  ix: Index;
  tab: SidebarTab;
  setTab(t: SidebarTab): void;
  open: boolean;
  hiddenLayers: LayerTag[];
  toggleLayer(l: LayerTag): void;
  showTests: boolean;
  setShowTests(v: boolean): void;
  showPackages: boolean;
  setShowPackages(v: boolean): void;
  showDiff: boolean;
  setShowDiff(v: boolean): void;
  actions: SidebarActions;
}

export function Sidebar(props: Props) {
  const { p, tab, setTab, open } = props;
  const problems = p.graph.fileCycles.length + p.insights.ruleViolations.length + p.insights.layerWarnings.length;
  return (
    <aside class={`sidebar ${open ? '' : 'closed'}`}>
      <div class="tabs">
        <button class={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button class={tab === 'insights' ? 'active' : ''} onClick={() => setTab('insights')}>
          Insights <span class={`count ${problems ? 'bad' : ''}`}>{problems}</span>
        </button>
        <button class={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}>Layers</button>
      </div>
      <div class="panel-scroll">
        {tab === 'overview' && <Overview {...props} />}
        {tab === 'insights' && <InsightsTab {...props} />}
        {tab === 'layers' && <LayersTab {...props} />}
      </div>
    </aside>
  );
}

function HealthRing({ score, grade }: { score: number; grade: string }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const color = score >= 80 ? 'var(--ok)' : score >= 60 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div class="ring">
      <svg width="84" height="84">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--surface-3)" stroke-width="8" />
        <circle
          cx="42" cy="42" r={r} fill="none" stroke={color} stroke-width="8" stroke-linecap="round"
          stroke-dasharray={circ} stroke-dashoffset={circ * (1 - score / 100)} style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div class="value">
        <div>
          <b style={{ color }}>{score}</b>
          <span>grade {grade}</span>
        </div>
      </div>
    </div>
  );
}

function Overview({ p, ix, showDiff, setShowDiff }: Props) {
  const { graph, insights, system } = p;
  const grade = insights.grade;
  const verdict =
    grade === 'A' ? 'Clean, well-layered codebase.' : grade === 'B' ? 'Healthy, with a few things to tidy.' : grade === 'C' ? 'Some structural debt worth addressing.' : 'Significant structural issues.';
  const langTotal = insights.languages.reduce((a, l) => a + l.lines, 0) || 1;
  const topPkgs = graph.externals
    .filter((x) => x.kind === 'package')
    .map((x) => ({ name: x.name, n: Object.values(x.usedBy).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const maxPkg = Math.max(1, ...topPkgs.map((t) => t.n));
  const d = p.diff;
  const changes = d ? d.addedFileEdges.length + d.removedFileEdges.length + d.addedFiles.length + d.removedFiles.length : 0;

  return (
    <>
      <div class="card">
        <div class="health">
          <HealthRing score={insights.score} grade={grade} />
          <div class="health-meta">
            <div class="grade">Architecture health</div>
            <p>{verdict}</p>
          </div>
        </div>
        {insights.breakdown.length > 0 && (
          <div class="breakdown">
            {insights.breakdown.map((b) => (
              <div key={b.label} title={b.detail}>
                <span>{b.label}</span>
                <span>−{b.penalty}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div class="stats">
        <div class="stat"><b>{fmt(graph.stats.files)}</b><span>Files</span></div>
        <div class="stat"><b>{fmt(insights.totalLines)}</b><span>Lines of code</span></div>
        <div class="stat"><b>{graph.components.length}</b><span>Components</span></div>
        <div class="stat"><b>{fmt(graph.fileEdges.length)}</b><span>Internal imports</span></div>
        <div class={`stat ${graph.fileCycles.length ? 'bad' : 'good'}`}><b>{graph.fileCycles.length}</b><span>Import cycles</span></div>
        <div class="stat"><b>{graph.externals.filter((x) => x.kind === 'package').length}</b><span>Packages</span></div>
      </div>

      <div>
        <div class="section-title">Languages</div>
        <div class="langbar">
          {insights.languages.map((l) => (
            <div key={l.language} style={{ width: `${(l.lines / langTotal) * 100}%`, background: LANG_META[l.language].color }} />
          ))}
        </div>
        <div class="legend-rows">
          {insights.languages.map((l) => (
            <div key={l.language}>
              <span class="dot" style={{ background: LANG_META[l.language].color }} />
              {LANG_META[l.language].label}
              <span class="n">{l.files} files · {Math.round((l.lines / langTotal) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      {(system.frameworks.length > 0 || system.techs.length > 0) && (
        <div>
          <div class="section-title">Tech stack</div>
          <div class="chips">
            {system.frameworks.map((f) => <span key={f.id} class="chip accent">{f.name}</span>)}
            {system.techs.map((t) => (
              <span key={t.id} class="chip" title={TECH_META[t.category].label}>
                <span class="dot" style={{ background: TECH_META[t.category].color }} />
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div class="section-title">
          <GitCompareArrows size={13} /> Drift
        </div>
        {d ? (
          <div class="card" style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
              Since snapshot of {new Date(d.savedAt).toLocaleString()}
            </div>
            <div class="chips" style={{ marginBottom: '10px' }}>
              <span class="chip ok">+{d.addedFiles.length} files</span>
              <span class="chip danger">−{d.removedFiles.length} files</span>
              <span class="chip ok">+{d.addedFileEdges.length} imports</span>
              <span class="chip danger">−{d.removedFileEdges.length} imports</span>
            </div>
            <label class="toggle-row" onClick={() => setShowDiff(!showDiff)}>
              <span>Highlight changes in diagram</span>
              <span class={`switch ${showDiff ? 'on' : ''}`} />
            </label>
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
              <button class="btn" style={{ flex: 1 }} onClick={() => post({ type: 'saveSnapshot' })}><Camera size={13} /> Update</button>
              <button class="btn" onClick={() => post({ type: 'clearSnapshot' })} title="Remove snapshot"><Trash2 size={13} /></button>
            </div>
            {changes === 0 && <div class="empty good" style={{ marginTop: '6px' }}><CheckCircle2 size={13} /> No structural changes</div>}
          </div>
        ) : (
          <div class="callout">
            <Camera size={16} style={{ flex: 'none', marginTop: '1px' }} />
            <div>
              <p>Save a snapshot to track how your architecture changes over time. New and removed dependencies will be highlighted.</p>
              <button class="btn primary" onClick={() => post({ type: 'saveSnapshot' })}>Save snapshot</button>
            </div>
          </div>
        )}
      </div>

      {topPkgs.length > 0 && (
        <div>
          <div class="section-title">Most used packages</div>
          <div class="list">
            {topPkgs.map((t) => (
              <div class="row" key={t.name} style={{ cursor: 'default' }}>
                <div class="main">
                  <span class="title">{t.name}</span>
                  <div class="bar" style={{ width: `${(t.n / maxPkg) * 100}%` }} />
                </div>
                <span class="metric">{t.n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ color: 'var(--muted)', fontSize: '11px' }}>
        Analyzed in {(graph.stats.durationMs / 1000).toFixed(1)}s · {graph.stats.imports} imports · {graph.stats.unresolved} unresolved
        {ix.p.scope ? ` · scoped to ${ix.p.scope}` : ''}
      </div>
    </>
  );
}

function Section({ icon, title, count, tone, children, initiallyOpen = true }: any) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div>
      <button class="section-title" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', width: '100%' }} onClick={() => setOpen(!open)}>
        {icon} {title}
        <span class={`chip ${count ? tone : 'ok'} right`} style={{ padding: '0 7px' }}>{count}</span>
      </button>
      {open && children}
    </div>
  );
}

function InsightsTab({ p, ix, actions }: Props) {
  const { graph, insights } = p;
  const byRule = new Map<string, typeof insights.ruleViolations>();
  for (const v of insights.ruleViolations) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
  const maxHot = Math.max(1, ...insights.hotspots.map((h) => h.fanIn));
  const compLabel = (id: string) => ix.comp.get(id)?.label ?? id;

  return (
    <>
      <Section icon={<Repeat size={13} />} title="Import cycles" count={graph.fileCycles.length} tone="danger">
        {graph.fileCycles.length === 0 ? (
          <div class="empty good"><CheckCircle2 size={13} /> No import cycles</div>
        ) : (
          <div class="list">
            {graph.fileCycles.map((c, i) => {
              const comps = new Set(c.map((f) => ix.fileComp.get(f)!));
              return (
                <button class="row" key={i} onClick={() => actions.showCycle(i)}>
                  <Repeat size={14} color="var(--danger)" />
                  <div class="main">
                    <span class="title">{c.length === 1 ? `${basename(c[0])} imports itself` : c.slice(0, 3).map(basename).join(' → ') + (c.length > 3 ? ` +${c.length - 3}` : '')}</span>
                    <span class="sub">{c.length} files · {[...comps].map(compLabel).join(', ')}</span>
                  </div>
                  <ArrowRight size={13} color="var(--muted)" />
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section icon={<ShieldAlert size={13} />} title="Rule violations" count={insights.ruleViolations.length} tone="danger">
        {!p.hasRulesFile ? (
          <div class="callout">
            <Lightbulb size={16} style={{ flex: 'none', marginTop: '1px' }} />
            <div>
              <p>Define rules like “UI must not import the database”. Violations show up here and in VS Code's Problems panel.</p>
              <button class="btn primary" onClick={() => post({ type: 'createRules' })}>Create rules file</button>
            </div>
          </div>
        ) : insights.ruleViolations.length === 0 ? (
          <div class="empty good">
            <CheckCircle2 size={13} /> All rules pass ·{' '}
            <a style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => post({ type: 'openRules' })}>edit rules</a>
          </div>
        ) : (
          <div class="list">
            {[...byRule].map(([rule, vs]) => (
              <div key={rule} style={{ marginBottom: '6px' }}>
                <div class="sub" style={{ padding: '2px 8px', fontWeight: 600, color: vs[0].severity === 'error' ? 'var(--danger)' : 'var(--warn)' }}>{rule}</div>
                {vs.slice(0, 20).map((v, i) => (
                  <button class="row" key={i} onClick={() => actions.openFile(v.from, v.line)}>
                    <FileWarning size={14} color={v.severity === 'error' ? 'var(--danger)' : 'var(--warn)'} />
                    <div class="main">
                      <span class="title">{basename(v.from)}:{v.line}</span>
                      <span class="sub">imports {v.to}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<TriangleAlert size={13} />} title="Layering issues" count={insights.layerWarnings.length} tone="warn">
        {insights.layerWarnings.length === 0 ? (
          <div class="empty good"><CheckCircle2 size={13} /> Dependencies flow in the right direction</div>
        ) : (
          <div class="list">
            {insights.layerWarnings.map((w, i) => (
              <button class="row" key={i} onClick={() => actions.showLayerWarning(i)}>
                <TriangleAlert size={14} color="var(--warn)" />
                <div class="main">
                  <span class="title">{compLabel(w.from)} → {compLabel(w.to)}</span>
                  <span class="sub">{LAYER_LABELS[w.fromLayer]} depends on {LAYER_LABELS[w.toLayer]} · {w.count} import{w.count === 1 ? '' : 's'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<Flame size={13} />} title="Hotspots (most imported)" count={insights.hotspots.length} tone="accent">
        <div class="list">
          {insights.hotspots.map((h) => (
            <button class="row" key={h.path} onClick={() => actions.revealFile(h.path)}>
              <div class="main">
                <span class="title">{basename(h.path)}</span>
                <span class="sub">{dirname(h.path)}</span>
                <div class="bar" style={{ width: `${(h.fanIn / maxHot) * 100}%`, background: 'var(--warn)' }} />
              </div>
              <span class="metric">{h.fanIn}</span>
            </button>
          ))}
          {!insights.hotspots.length && <div class="empty">Nothing stands out</div>}
        </div>
      </Section>

      <Section icon={<Share2 size={13} />} title="Highest fan-out" count={insights.fanOutHeavy.length} tone="accent" initiallyOpen={false}>
        <div class="list">
          {insights.fanOutHeavy.map((h) => (
            <button class="row" key={h.path} onClick={() => actions.revealFile(h.path)}>
              <div class="main">
                <span class="title">{basename(h.path)}</span>
                <span class="sub">{dirname(h.path)}</span>
              </div>
              <span class="metric">{h.fanOut} imports</span>
            </button>
          ))}
          {!insights.fanOutHeavy.length && <div class="empty">No file imports more than 8 others</div>}
        </div>
      </Section>

      <Section icon={<Ghost size={13} />} title="Possibly unused files" count={insights.orphans.length} tone="warn" initiallyOpen={false}>
        <div class="list">
          {insights.orphans.slice(0, 60).map((f) => (
            <button class="row" key={f} onClick={() => actions.openFile(f)}>
              <Ghost size={13} color="var(--muted)" />
              <div class="main">
                <span class="title">{basename(f)}</span>
                <span class="sub">{dirname(f)}</span>
              </div>
            </button>
          ))}
          {insights.orphans.length > 60 && <div class="empty">+{insights.orphans.length - 60} more</div>}
          {!insights.orphans.length && <div class="empty good"><CheckCircle2 size={13} /> Every file is imported somewhere</div>}
        </div>
      </Section>
    </>
  );
}

function LayersTab({ p, ix, hiddenLayers, toggleLayer, showTests, setShowTests, showPackages, setShowPackages, actions }: Props) {
  const layers = [...new Set(p.graph.components.map((c) => c.layer))];
  return (
    <>
      <div>
        <div class="section-title"><Layers size={13} /> Layers</div>
        <div class="list">
          {layers.map((l) => {
            const comps = p.graph.components.filter((c) => c.layer === l);
            const hidden = hiddenLayers.includes(l);
            return (
              <div key={l}>
                <button class="row" onClick={() => toggleLayer(l)} style={{ opacity: hidden ? 0.5 : 1 }}>
                  <span class="dot" style={{ background: LAYER_COLORS[l], width: '11px', height: '11px' }} />
                  <div class="main">
                    <span class="title">{LAYER_LABELS[l]}</span>
                    <span class="sub">{comps.map((c) => c.label).join(', ')}</span>
                  </div>
                  {hidden ? <EyeOff size={14} color="var(--muted)" /> : <Eye size={14} color="var(--muted)" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div class="card" style={{ padding: '6px 12px' }}>
        <label class="toggle-row" onClick={() => setShowTests(!showTests)}>
          <span>Show tests</span>
          <span class={`switch ${showTests ? 'on' : ''}`} />
        </label>
        <label class="toggle-row" onClick={() => setShowPackages(!showPackages)}>
          <span>Show third-party packages</span>
          <span class={`switch ${showPackages ? 'on' : ''}`} />
        </label>
      </div>
      <div>
        <div class="section-title">Components</div>
        <div class="list">
          {p.graph.components.map((c) => (
            <button class="row" key={c.id} onClick={() => actions.selectComponent(c.id)}>
              <span class="dot" style={{ background: LAYER_COLORS[c.layer] }} />
              <div class="main">
                <span class="title">{c.label}</span>
              </div>
              <span class="metric">{c.files.length} files · {fmt(ix.compLines.get(c.id) ?? 0)}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: '11.5px' }}>
        Layers are guessed from folder names (components, routes, services, models, utils, …). Hide a layer to declutter the diagram.
      </div>
    </>
  );
}
