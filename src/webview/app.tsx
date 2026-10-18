import {
  ArrowDownUp, ArrowLeftRight, Boxes, Camera, ChevronRight, FileCode2, FolderSearch, GitBranch, ImagePlus, PenTool,
  Check, Monitor, Moon, Network, PanelLeft, RefreshCw, Search, ShieldCheck, Sun, Workflow,
} from 'lucide-preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LayerTag, Payload } from '../core/types';
import { loadState, post, saveState } from './api';
import { QuickActions, QuickAction } from './actions';
import { Canvas, CanvasApi, Focus } from './canvas';
import { layoutToSvg, svgToPngBase64 } from './export';
import { Inspector } from './inspector';
import { Layout, layoutView } from './layout';
import { buildView, Index, ViewKind } from './model';
import { buildItems, Palette, PaletteItem } from './palette';
import { Sidebar, SidebarTab } from './sidebar';
import { basename } from './theme';

interface UiState {
  view: ViewKind;
  focus?: string;
  showPackages: boolean;
  showTests: boolean;
  hiddenLayers: LayerTag[];
  showDiff: boolean;
  direction: 'AUTO' | 'RIGHT' | 'DOWN';
  sidebarOpen: boolean;
  tab: SidebarTab;
  theme: ThemeMode;
}

type ThemeMode = 'auto' | 'light' | 'dark';

const THEMES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'auto', label: 'Match VS Code', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

const DEFAULTS: UiState = {
  view: 'components',
  showPackages: false,
  showTests: true,
  hiddenLayers: [],
  showDiff: true,
  direction: 'AUTO',
  sidebarOpen: true,
  tab: 'overview',
  theme: 'auto',
};

interface Pending {
  select?: string;
  focus?: Focus;
  fit?: string[];
}

export function App() {
  const [payload, setPayload] = useState<Payload>();
  const [error, setError] = useState<string>();
  const [ui, setUi] = useState<UiState>({ ...DEFAULTS, ...loadState<UiState>() });
  const [layout, setLayout] = useState<Layout>();
  const [layoutKey, setLayoutKey] = useState('');
  const [selected, setSelected] = useState<string>();
  const [focus, setFocus] = useState<Focus | null>(null);
  const [palette, setPalette] = useState(false);
  const [themeMenu, setThemeMenu] = useState(false);
  const [toast, setToast] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<Pending | null>(null);
  const api = useRef<CanvasApi>();

  const patch = useCallback((p: Partial<UiState>) => setUi((u) => ({ ...u, ...p })), []);
  useEffect(() => saveState(ui), [ui]);
  useEffect(() => {
    if (ui.theme === 'auto') delete document.body.dataset.theme;
    else document.body.dataset.theme = ui.theme;
  }, [ui.theme]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === 'payload') {
        setPayload(m.payload);
        setError(undefined);
        setBusy(false);
      } else if (m?.type === 'error') {
        setError(m.message);
        setBusy(false);
      }
    };
    window.addEventListener('message', onMsg);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const ix = useMemo(() => (payload ? new Index(payload) : undefined), [payload]);
  const view: ViewKind = ui.view === 'modules' && (!ui.focus || !ix?.comp.has(ui.focus)) ? 'components' : ui.view;
  const [wide, setWide] = useState(() => window.innerWidth - 300 > window.innerHeight * 1.15);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth - (ui.sidebarOpen ? 300 : 0) > window.innerHeight * 1.15);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ui.sidebarOpen]);
  const direction: 'RIGHT' | 'DOWN' = ui.direction === 'AUTO' ? (wide ? 'RIGHT' : 'DOWN') : ui.direction;
  const viewKey = `${view}|${view === 'modules' ? ui.focus : ''}|${direction}`;

  // Build + lay out the current view whenever inputs change.
  useEffect(() => {
    if (!ix) return;
    let cancelled = false;
    const vm = buildView(ix, { view, focus: ui.focus, showPackages: ui.showPackages, showTests: ui.showTests, hiddenLayers: ui.hiddenLayers, showDiff: ui.showDiff && !!ix.p.diff });
    layoutView(vm, view, direction)
      .then((l) => {
        if (cancelled) return;
        setLayout(l);
        setLayoutKey(viewKey);
      })
      .catch((err) => setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [ix, view, ui.focus, ui.showPackages, ui.showTests, ui.hiddenLayers, ui.showDiff, direction]);

  // Apply selection / focus requested before the view switched, once its layout exists.
  useEffect(() => {
    const p = pending.current;
    if (!p || !layout || layoutKey !== viewKey) return;
    pending.current = null;
    if (p.select) setSelected(p.select);
    setFocus(p.focus ?? null);
    setTimeout(() => api.current?.fit(p.fit ?? (p.select ? [p.select] : undefined), true), 0);
  }, [layout, layoutKey]);

  const go = (v: ViewKind, focusComp?: string, next?: Pending) => {
    pending.current = next ?? null;
    if (!next) {
      setSelected(undefined);
      setFocus(null);
    }
    const sameView = v === view && (v !== 'modules' || focusComp === ui.focus);
    patch({ view: v, focus: focusComp ?? ui.focus });
    if (sameView && next) {
      // No relayout will happen; apply immediately.
      pending.current = null;
      if (next.select) setSelected(next.select);
      setFocus(next.focus ?? null);
      setTimeout(() => api.current?.fit(next.fit ?? (next.select ? [next.select] : undefined), true), 0);
    }
  };

  const openModule = (compId: string, select?: string) => go('modules', compId, { select, fit: select ? [select] : undefined });
  const selectComponent = (id: string) => (view === 'components' ? go('components', undefined, { select: id }) : view === 'system' ? go('system', undefined, { select: id }) : go('components', undefined, { select: id }));
  const revealFile = (path: string) => {
    if (!ix) return;
    const comp = ix.fileComp.get(path);
    if (comp) openModule(comp, path);
  };
  const selectTech = (id: string) => go('system', undefined, { select: id });

  const showCycle = (i: number) => {
    if (!ix) return;
    const cyc = ix.p.graph.fileCycles[i];
    const comps = new Set(cyc.map((f) => ix.fileComp.get(f)!));
    const set = new Set(cyc);
    if (comps.size === 1) {
      const edges = new Set(ix.p.graph.fileEdges.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => `${e.from}->${e.to}`));
      go('modules', [...comps][0], { focus: { nodes: set, edges }, fit: cyc });
    } else {
      const edges = new Set(ix.p.graph.componentEdges.filter((e) => e.cyclic && comps.has(e.from) && comps.has(e.to)).map((e) => `${e.from}->${e.to}`));
      go('components', undefined, { focus: { nodes: comps, edges }, fit: [...comps] });
      setToast(`Cycle spans ${comps.size} components — open one to see the files`);
    }
  };
  const showCycleOf = (path: string) => {
    if (!ix || !ix.cycleOf.has(path)) return;
    showCycle(ix.cycleOf.get(path)!);
  };
  const showLayerWarning = (i: number) => {
    if (!ix) return;
    const w = ix.p.insights.layerWarnings[i];
    go('components', undefined, { focus: { nodes: new Set([w.from, w.to]), edges: new Set([`${w.from}->${w.to}`]) }, fit: [w.from, w.to], select: w.from });
  };

  const exportImage = async (format: 'svg' | 'png') => {
    const l = api.current?.getLayout();
    if (!l || !ix) return;
    const title = `${basename(ix.p.graph.root)} — ${view === 'modules' ? ix.comp.get(ui.focus!)?.label : view === 'system' ? 'System' : 'Components'}`;
    const svg = layoutToSvg(l, title);
    if (format === 'svg') post({ type: 'saveImage', format, data: svg });
    else post({ type: 'saveImage', format, data: await svgToPngBase64(svg) });
  };

  const refresh = () => {
    setBusy(true);
    post({ type: 'refresh' });
  };

  const commands: PaletteItem[] = useMemo(
    () => [
      { id: 'v-system', group: 'Commands', title: 'Go to System view', run: () => go('system') },
      { id: 'v-comp', group: 'Commands', title: 'Go to Components view', run: () => go('components') },
      { id: 'refresh', group: 'Commands', title: 'Re-analyze workspace', run: refresh },
      { id: 'svg', group: 'Commands', title: 'Export as SVG', run: () => exportImage('svg') },
      { id: 'png', group: 'Commands', title: 'Export as PNG', run: () => exportImage('png') },
      { id: 'mmd', group: 'Commands', title: 'Export as Mermaid', run: () => post({ type: 'exportMermaid' }) },
      { id: 'snap', group: 'Commands', title: 'Save architecture snapshot', run: () => post({ type: 'saveSnapshot' }) },
      { id: 'rules', group: 'Commands', title: payload?.hasRulesFile ? 'Open rules file' : 'Create rules file', run: () => post({ type: payload?.hasRulesFile ? 'openRules' : 'createRules' }) },
      { id: 'dir', group: 'Commands', title: 'Toggle layout direction', run: () => patch({ direction: direction === 'RIGHT' ? 'DOWN' : 'RIGHT' }) },
      { id: 'dir-auto', group: 'Commands', title: 'Automatic layout direction', run: () => patch({ direction: 'AUTO' }) },
      { id: 'theme-light', group: 'Commands', title: 'Theme: Light', run: () => patch({ theme: 'light' }) },
      { id: 'theme-dark', group: 'Commands', title: 'Theme: Dark', run: () => patch({ theme: 'dark' }) },
      { id: 'theme-auto', group: 'Commands', title: 'Theme: Match VS Code', run: () => patch({ theme: 'auto' }) },
    ],
    [payload, view, direction, ui.focus],
  );
  const viewName = view === 'system' ? 'System' : view === 'modules' ? 'Modules' : 'Components';
  const quickActions: QuickAction[] = [
    { id: 'png', section: 'Create', title: 'Generate image', description: `PNG of the ${viewName} view, ready to share`, icon: ImagePlus, color: '#7c5cff', badge: 'PNG', run: () => exportImage('png') },
    { id: 'svg', section: 'Create', title: 'Vector image', description: 'Crisp SVG for docs and slides', icon: PenTool, color: '#22c3e6', badge: 'SVG', run: () => exportImage('svg') },
    { id: 'mmd', section: 'Create', title: 'Mermaid diagram', description: 'Paste straight into a README', icon: GitBranch, color: '#1fb47a', badge: 'MD', run: () => post({ type: 'exportMermaid' }) },
    { id: 'snap', section: 'Analyze', title: payload?.diff ? 'Update snapshot' : 'Save snapshot', description: 'Track how the architecture changes', icon: Camera, color: '#f0a020', run: () => post({ type: 'saveSnapshot' }) },
    { id: 'rules', section: 'Analyze', title: payload?.hasRulesFile ? 'Edit rules' : 'Create rules', description: 'Flag imports that break your layering', icon: ShieldCheck, color: '#ef4f6b', run: () => post({ type: payload?.hasRulesFile ? 'openRules' : 'createRules' }) },
    { id: 'folder', section: 'Analyze', title: 'Diagram a folder', description: 'Focus on one part of the codebase', icon: FolderSearch, color: '#4f8cff', run: () => post({ type: 'pickFolder' }) },
    { id: 'refresh', section: 'Analyze', title: 'Re-analyze', description: 'Rescan the workspace now', icon: RefreshCw, color: '#8b93a7', run: refresh },
  ];
  const paletteItems = useMemo(
    () => (ix && palette ? buildItems(ix, { component: selectComponent, file: revealFile, tech: selectTech }, commands) : []),
    [ix, palette, commands],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement | null)?.closest?.('input, textarea');
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'p' || e.key === 'f')) {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (inInput || palette) return;
      if (e.key === '/') {
        e.preventDefault();
        setPalette(true);
      } else if (e.key === 'Escape') {
        if (selected || focus) {
          setSelected(undefined);
          setFocus(null);
        } else if (view === 'modules') go('components', undefined, ui.focus ? { select: ui.focus } : undefined);
        setThemeMenu(false);
      } else if (e.key === 'f' || e.key === 'F') api.current?.fit();
      else if (e.key === '1') go('system');
      else if (e.key === '2') go('components');
      else if (e.key === '3' && ui.focus) go('modules', ui.focus);
      else if (e.key === '+' || e.key === '=') api.current?.zoomBy(1.2);
      else if (e.key === '-') api.current?.zoomBy(0.83);
      else if (e.key === '[') patch({ sidebarOpen: !ui.sidebarOpen });
      else if (e.key === 't' || e.key === 'T') patch({ theme: ui.theme === 'dark' ? 'light' : ui.theme === 'light' ? 'auto' : 'dark' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const close = () => setThemeMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  if (!payload || !ix) {
    return (
      <div class="center-msg">
        {error ? (
          <div>Analysis failed: {error}</div>
        ) : (
          <div>
            <div class="spinner" />
            Analyzing your workspace…
          </div>
        )}
      </div>
    );
  }

  const focusComp = ui.focus ? ix.comp.get(ui.focus) : undefined;
  const rootName = payload.scope ? basename(payload.scope) : basename(payload.graph.root) || 'Project';
  const hint =
    view === 'system'
      ? payload.system.techs.length
        ? 'Your code and the services it talks to · double-click a component to explore'
        : 'No databases, queues or external services detected'
      : view === 'components'
        ? 'Double-click a component to explore its files · ⌘K to search'
        : 'Double-click a file to open it · Esc to go back';

  return (
    <div class="shell">
      <header class="topbar">
        <button class="btn icon ghost" title="Toggle sidebar ([)" onClick={() => patch({ sidebarOpen: !ui.sidebarOpen })}>
          <PanelLeft size={16} />
        </button>
        <div class="brand">
          <div class="brand-mark"><Network size={15} strokeWidth={2.4} /></div>
          <span>
            Architecture <small>Visualiser</small>
          </span>
        </div>
        <nav class="crumbs">
          <ChevronRight size={14} />
          <button onClick={() => go('components')}>{rootName}</button>
          {view === 'modules' && focusComp && (
            <>
              <ChevronRight size={14} />
              <span class="current">{focusComp.label}</span>
            </>
          )}
        </nav>
        <div class="spacer" />
        <div class="segmented" role="tablist">
          <button class={view === 'system' ? 'active' : ''} onClick={() => go('system')} title="System view (1)">
            <Boxes size={14} /> <span class="label">System</span>
          </button>
          <button class={view === 'components' ? 'active' : ''} onClick={() => go('components')} title="Components view (2)">
            <Workflow size={14} /> <span class="label">Components</span>
          </button>
          <button class={view === 'modules' ? 'active' : ''} disabled={!focusComp} onClick={() => focusComp && go('modules', focusComp.id)} title="Modules view (3)">
            <FileCode2 size={14} /> <span class="label">Modules</span>
          </button>
        </div>
        <div class="spacer" />
        <button class="btn search-trigger" onClick={() => setPalette(true)}>
          <Search size={14} /> <span class="label">Search…</span> <kbd>⌘K</kbd>
        </button>
        <button
          class={`btn icon ${ui.direction !== 'AUTO' ? 'active' : ''}`}
          title={`Layout: ${ui.direction === 'AUTO' ? 'automatic' : direction === 'RIGHT' ? 'left → right' : 'top → bottom'} (click to switch)`}
          onClick={() => patch({ direction: direction === 'RIGHT' ? 'DOWN' : 'RIGHT' })}
        >
          {direction === 'RIGHT' ? <ArrowDownUp size={15} /> : <ArrowLeftRight size={15} />}
        </button>
        <div class="menu-wrap">
          <button
            class="btn icon"
            title={`Theme: ${THEMES.find((t) => t.id === ui.theme)!.label} (T)`}
            onClick={(e) => {
              e.stopPropagation();
              setThemeMenu(!themeMenu);
            }}
          >
            {(() => {
              const Icon = THEMES.find((t) => t.id === ui.theme)!.icon;
              return <Icon size={15} />;
            })()}
          </button>
          {themeMenu && (
            <div class="menu" style={{ minWidth: '180px' }} onClick={(e) => e.stopPropagation()}>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    patch({ theme: t.id });
                    setThemeMenu(false);
                  }}
                >
                  <t.icon size={15} /> {t.label}
                  {ui.theme === t.id && <Check size={14} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button class="btn icon" title="Re-analyze" onClick={refresh}>
          <RefreshCw size={15} style={busy ? { animation: 'spin 0.8s linear infinite' } : undefined} />
        </button>
        <QuickActions actions={quickActions} />
      </header>

      <div class="body">
        <Sidebar
          p={payload}
          ix={ix}
          tab={ui.tab}
          setTab={(tab) => patch({ tab, sidebarOpen: true })}
          open={ui.sidebarOpen}
          hiddenLayers={ui.hiddenLayers}
          toggleLayer={(l) => patch({ hiddenLayers: ui.hiddenLayers.includes(l) ? ui.hiddenLayers.filter((x) => x !== l) : [...ui.hiddenLayers, l] })}
          showTests={ui.showTests}
          setShowTests={(v) => patch({ showTests: v })}
          showPackages={ui.showPackages}
          setShowPackages={(v) => patch({ showPackages: v })}
          showDiff={ui.showDiff}
          setShowDiff={(v) => patch({ showDiff: v })}
          actions={{
            showCycle,
            showLayerWarning,
            revealFile,
            openFile: (path, line) => post({ type: 'openFile', path, line }),
            selectComponent,
            selectTech,
          }}
        />
        <Canvas
          layout={layout}
          layoutKey={layoutKey}
          selected={selected}
          focus={focus}
          apiRef={api}
          hint={hint}
          rightInset={selected ? 360 : 0}
          onSelect={(n) => {
            setSelected(n?.id);
            if (!n) setFocus(null);
          }}
          onActivate={(n) => {
            if (n.kind === 'component') openModule(n.id);
            else if (n.kind === 'neighbor') openModule(n.data.c.id);
            else if (n.kind === 'file') post({ type: 'openFile', path: n.data.path });
            else if (n.kind === 'tech') setSelected(n.id);
          }}
        />
        {selected && (
          <Inspector
            ix={ix}
            id={selected}
            inModuleView={view === 'modules'}
            actions={{
              close: () => setSelected(undefined),
              openModule,
              selectNode: setSelected,
              revealFile: (p) => (layout?.nodes.some((n) => n.id === p) ? (setSelected(p), api.current?.fit([p], true)) : revealFile(p)),
              showCycleOf,
              selectTech,
              selectComponent: (id) => (layout?.nodes.some((n) => n.id === id) ? (setSelected(id), api.current?.fit([id], true)) : selectComponent(id)),
            }}
          />
        )}
      </div>

      {palette && <Palette items={paletteItems} onClose={() => setPalette(false)} />}
      {toast && <div class="toast">{toast}</div>}
    </div>
  );
}
