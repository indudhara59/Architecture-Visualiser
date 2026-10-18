import { ArrowDownLeft, ArrowUpRight, Copy, ExternalLink, FileCode2, Repeat, ShieldAlert, Telescope, X } from 'lucide-preact';
import type { TechNode } from '../core/types';
import { post } from './api';
import type { Index } from './model';
import { basename, dirname, fmt, LANG_META, LAYER_COLORS, LAYER_ICONS, LAYER_LABELS, TECH_META } from './theme';

export interface InspectorActions {
  close(): void;
  openModule(compId: string, select?: string): void;
  selectNode(id: string): void;
  revealFile(path: string): void;
  showCycleOf(path: string): void;
  selectTech(id: string): void;
  selectComponent(id: string): void;
}

interface Props {
  ix: Index;
  id: string;
  inModuleView: boolean;
  actions: InspectorActions;
}

function Bars({ items, onClick }: { items: { id: string; label: string; sub?: string; n: number; color?: string }[]; onClick(id: string): void }) {
  if (!items.length) return <div class="empty">None</div>;
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div class="list">
      {items.map((i) => (
        <button class="row" key={i.id} onClick={() => onClick(i.id)}>
          {i.color && <span class="dot" style={{ background: i.color }} />}
          <div class="main">
            <span class="title">{i.label}</span>
            {i.sub && <span class="sub">{i.sub}</span>}
            <div class="bar" style={{ width: `${(i.n / max) * 100}%`, background: i.color ?? 'var(--accent)' }} />
          </div>
          <span class="metric">{i.n}</span>
        </button>
      ))}
    </div>
  );
}

export function Inspector({ ix, id, inModuleView, actions }: Props) {
  const p = ix.p;
  let body: preact.JSX.Element | null = null;

  const compId = id.startsWith('n:') ? id.slice(2) : id;
  if (ix.comp.has(compId)) {
    const c = ix.comp.get(compId)!;
    const color = LAYER_COLORS[c.layer];
    const Icon = LAYER_ICONS[c.layer];
    const out = p.graph.componentEdges.filter((e) => e.from === c.id).sort((a, b) => b.count - a.count);
    const inc = p.graph.componentEdges.filter((e) => e.to === c.id).sort((a, b) => b.count - a.count);
    const techs = p.system.techs.filter((t) => t.usedBy[c.id]);
    const pkgs = p.graph.externals.filter((x) => x.kind === 'package' && x.usedBy[c.id]).sort((a, b) => b.usedBy[c.id] - a.usedBy[c.id]);
    const biggest = [...c.files].sort((a, b) => (ix.fileLines.get(b) ?? 0) - (ix.fileLines.get(a) ?? 0)).slice(0, 6);
    const cycles = p.graph.fileCycles.filter((cy) => cy.some((f) => ix.fileComp.get(f) === c.id));
    const violations = p.insights.ruleViolations.filter((v) => ix.fileComp.get(v.from) === c.id);
    body = (
      <>
        <header>
          <button class="btn icon ghost close" onClick={actions.close}><X size={15} /></button>
          <div class="kicker">Component</div>
          <h2>
            <span class="icon-tile" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}><Icon size={17} /></span>
            {c.label}
          </h2>
          <div class="path">{c.folder || '/'}</div>
          <div class="chips" style={{ marginTop: '10px' }}>
            <span class="chip"><span class="dot" style={{ background: color }} />{LAYER_LABELS[c.layer]}</span>
            {cycles.length > 0 && <span class="chip danger"><Repeat size={11} />{cycles.length} cycle{cycles.length === 1 ? '' : 's'}</span>}
            {violations.length > 0 && <span class="chip warn"><ShieldAlert size={11} />{violations.length} violations</span>}
          </div>
          <div class="kpis">
            <div class="kpi"><b>{c.files.length}</b><span>files</span></div>
            <div class="kpi"><b>{fmt(ix.compLines.get(c.id) ?? 0)}</b><span>lines</span></div>
            <div class="kpi"><b>{out.length}</b><span>depends on</span></div>
            <div class="kpi"><b>{inc.length}</b><span>used by</span></div>
          </div>
        </header>
        <div class="panel-scroll">
          <div>
            <div class="section-title"><ArrowUpRight size={13} /> Depends on</div>
            <Bars
              items={out.map((e) => ({ id: e.to, label: ix.comp.get(e.to)?.label ?? e.to, n: e.count, color: e.cyclic ? 'var(--danger)' : LAYER_COLORS[ix.comp.get(e.to)!.layer] }))}
              onClick={actions.selectComponent}
            />
          </div>
          <div>
            <div class="section-title"><ArrowDownLeft size={13} /> Used by</div>
            <Bars
              items={inc.map((e) => ({ id: e.from, label: ix.comp.get(e.from)?.label ?? e.from, n: e.count, color: e.cyclic ? 'var(--danger)' : LAYER_COLORS[ix.comp.get(e.from)!.layer] }))}
              onClick={actions.selectComponent}
            />
          </div>
          {(techs.length > 0 || pkgs.length > 0) && (
            <div>
              <div class="section-title">Services & packages</div>
              <div class="chips">
                {techs.map((t) => (
                  <span key={t.id} class="chip accent" style={{ cursor: 'pointer' }} onClick={() => actions.selectTech(t.id)}>
                    <span class="dot" style={{ background: TECH_META[t.category].color }} />
                    {t.name}
                  </span>
                ))}
                {pkgs.slice(0, 16).map((x) => <span key={x.name} class="chip">{x.name}</span>)}
              </div>
            </div>
          )}
          <div>
            <div class="section-title">Largest files</div>
            <Bars
              items={biggest.map((f) => ({ id: f, label: basename(f), sub: dirname(f).slice(c.folder.length + 1) || undefined, n: ix.fileLines.get(f) ?? 0 }))}
              onClick={(f) => actions.openModule(c.id, f)}
            />
          </div>
        </div>
        <div class="actions">
          <button class="btn primary" onClick={() => actions.openModule(c.id)}><Telescope size={14} /> Explore files</button>
          <button class="btn" onClick={() => post({ type: 'copyText', text: c.folder, label: 'folder path' })}><Copy size={14} /> Copy path</button>
        </div>
      </>
    );
  } else if (id.startsWith('tech:')) {
    const t = p.system.techs.find((x) => x.id === id) as TechNode | undefined;
    if (t) {
      const meta = TECH_META[t.category];
      const Icon = meta.icon;
      const total = Object.values(t.usedBy).reduce((a, b) => a + b, 0);
      body = (
        <>
          <header>
            <button class="btn icon ghost close" onClick={actions.close}><X size={15} /></button>
            <div class="kicker">{meta.label}</div>
            <h2>
              <span class="icon-tile" style={{ background: `color-mix(in srgb, ${meta.color} 18%, transparent)`, color: meta.color }}><Icon size={17} /></span>
              {t.name}
            </h2>
            <div class="chips" style={{ marginTop: '10px' }}>
              {t.sources.map((s) => (
                <span class="chip" key={s}>
                  {s === 'import' ? 'imported in code' : s === 'compose' ? 'docker-compose' : s === 'env' ? '.env example' : 'declared dependency'}
                </span>
              ))}
            </div>
            <div class="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div class="kpi"><b>{total}</b><span>imports</span></div>
              <div class="kpi"><b>{Object.keys(t.usedBy).length}</b><span>components</span></div>
              <div class="kpi"><b>{t.packages.length}</b><span>packages</span></div>
            </div>
          </header>
          <div class="panel-scroll">
            {t.packages.length > 0 && (
              <div>
                <div class="section-title">Packages</div>
                <div class="chips">{t.packages.map((x) => <span class="chip" key={x}>{x}</span>)}</div>
              </div>
            )}
            <div>
              <div class="section-title">Used by</div>
              <Bars
                items={Object.entries(t.usedBy)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cid, n]) => ({ id: cid, label: ix.comp.get(cid)?.label ?? cid, n, color: LAYER_COLORS[ix.comp.get(cid)?.layer ?? 'other'] }))}
                onClick={actions.selectComponent}
              />
            </div>
          </div>
        </>
      );
    }
  } else if (id.startsWith('pkg:')) {
    const name = id.slice(4);
    const x = p.graph.externals.find((e) => e.name === name);
    body = (
      <>
        <header>
          <button class="btn icon ghost close" onClick={actions.close}><X size={15} /></button>
          <div class="kicker">Third-party package</div>
          <h2>{name}</h2>
        </header>
        <div class="panel-scroll">
          <div>
            <div class="section-title">Used by</div>
            <Bars
              items={Object.entries(x?.usedBy ?? {}).map(([cid, n]) => ({ id: cid, label: ix.comp.get(cid)?.label ?? cid, n, color: LAYER_COLORS[ix.comp.get(cid)?.layer ?? 'other'] }))}
              onClick={actions.selectComponent}
            />
          </div>
        </div>
      </>
    );
  } else if (ix.fileComp.has(id)) {
    const f = id;
    const lang = LANG_META[ix.fileLang.get(f) as keyof typeof LANG_META];
    const out = p.graph.fileEdges.filter((e) => e.from === f);
    const inc = p.graph.fileEdges.filter((e) => e.to === f);
    const cycle = ix.cycleOf.has(f) ? p.graph.fileCycles[ix.cycleOf.get(f)!] : undefined;
    const violations = p.insights.ruleViolations.filter((v) => v.from === f);
    const comp = ix.comp.get(ix.fileComp.get(f)!)!;
    const fileRow = (path: string, line?: number) => (
      <button class="row" key={path} onClick={() => actions.revealFile(path)} onDblClick={() => post({ type: 'openFile', path, line })}>
        <FileCode2 size={13} color={LANG_META[ix.fileLang.get(path) as keyof typeof LANG_META]?.color} />
        <div class="main">
          <span class="title">{basename(path)}</span>
          <span class="sub">{dirname(path)}</span>
        </div>
        {ix.fileCyclic(f, path) && <Repeat size={12} color="var(--danger)" />}
      </button>
    );
    body = (
      <>
        <header>
          <button class="btn icon ghost close" onClick={actions.close}><X size={15} /></button>
          <div class="kicker">File · {comp.label}</div>
          <h2>
            <span class="icon-tile" style={{ background: `color-mix(in srgb, ${lang?.color} 18%, transparent)`, color: lang?.color, fontSize: '10px', fontWeight: 800 }}>{lang?.short}</span>
            {basename(f)}
          </h2>
          <div class="path">{f}</div>
          <div class="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div class="kpi"><b>{fmt(ix.fileLines.get(f) ?? 0)}</b><span>lines</span></div>
            <div class="kpi"><b>{out.length}</b><span>imports</span></div>
            <div class="kpi"><b>{inc.length}</b><span>imported by</span></div>
          </div>
        </header>
        <div class="panel-scroll">
          {cycle && (
            <div class="callout danger">
              <Repeat size={16} style={{ flex: 'none', marginTop: '1px' }} color="var(--danger)" />
              <div>
                <p>{cycle.length === 1 ? 'This file imports itself.' : `Part of an import cycle with ${cycle.length - 1} other file${cycle.length === 2 ? '' : 's'}.`}</p>
                <button class="btn" onClick={() => actions.showCycleOf(f)}>Highlight cycle</button>
              </div>
            </div>
          )}
          {violations.length > 0 && (
            <div>
              <div class="section-title" style={{ color: 'var(--warn)' }}><ShieldAlert size={13} /> Rule violations</div>
              <div class="list">
                {violations.map((v, i) => (
                  <button class="row" key={i} onClick={() => post({ type: 'openFile', path: v.from, line: v.line })}>
                    <div class="main">
                      <span class="title">Line {v.line}: {basename(v.to)}</span>
                      <span class="sub">{v.rule}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div class="section-title"><ArrowUpRight size={13} /> Imports ({out.length})</div>
            <div class="list">{out.length ? out.map((e) => fileRow(e.to, e.lines[0])) : <div class="empty">None</div>}</div>
          </div>
          <div>
            <div class="section-title"><ArrowDownLeft size={13} /> Imported by ({inc.length})</div>
            <div class="list">{inc.length ? inc.map((e) => fileRow(e.from)) : <div class="empty">Nothing imports this file</div>}</div>
          </div>
        </div>
        <div class="actions">
          <button class="btn primary" onClick={() => post({ type: 'openFile', path: f })}><ExternalLink size={14} /> Open file</button>
          {!inModuleView && <button class="btn" onClick={() => actions.openModule(comp.id, f)}><Telescope size={14} /> Show in graph</button>}
          <button class="btn icon" title="Copy path" onClick={() => post({ type: 'copyText', text: f, label: 'file path' })}><Copy size={14} /></button>
        </div>
      </>
    );
  }

  if (!body) return null;
  return <aside class="inspector" key={id}>{body}</aside>;
}
