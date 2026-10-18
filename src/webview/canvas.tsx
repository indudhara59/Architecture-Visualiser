import { Maximize, Minus, Plus, Map as MapIcon } from 'lucide-preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Layout, LaidEdge, LaidNode } from './layout';
import { edgePath, midpoint } from './layout';
import { NodeBody, nodeColor } from './nodes';
import { fmt } from './theme';

export interface Focus {
  nodes: Set<string>;
  edges: Set<string>;
}

export interface CanvasApi {
  fit(ids?: string[], animate?: boolean): void;
  zoomBy(f: number): void;
  getLayout(): Layout | undefined;
}

interface Camera {
  x: number;
  y: number;
  k: number;
}

interface Props {
  layout?: Layout;
  layoutKey: string;
  selected?: string;
  focus?: Focus | null;
  onSelect(n: LaidNode | null): void;
  onActivate(n: LaidNode): void;
  apiRef: { current?: CanvasApi };
  hint?: string;
  /** Pixels on the right covered by an overlay (inspector). */
  rightInset?: number;
}

const MIN_K = 0.08;
const MAX_K = 2.5;

function markerFor(e: LaidEdge, lit: boolean): string {
  if (e.classes.includes('cycle') || e.classes.includes('removed')) return 'm-danger';
  if (e.classes.includes('violation')) return 'm-warn';
  if (e.classes.includes('added')) return 'm-ok';
  if (lit) return 'm-accent';
  if (e.classes.includes('tech')) return 'm-tech';
  if (e.classes.includes('package') || e.classes.includes('neighbor')) return 'm-faint';
  return 'm-default';
}

export function Canvas({ layout, layoutKey, selected, focus, onSelect, onActivate, apiRef, hint, rightInset = 0 }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: 0, y: 0, k: 1 });
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub?: string } | null>(null);
  const [showMap, setShowMap] = useState(true);
  const clickTimer = useRef<number>();

  const apply = (animate = false) => {
    const w = worldRef.current;
    if (!w) return;
    w.classList.toggle('animate', animate);
    const { x, y, k } = cam.current;
    w.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    rootRef.current?.classList.toggle('lod-low', k < 0.5);
    // Re-render overlays (zoom %, minimap). Preact batches these, so rapid wheel events stay cheap.
    setTick((t) => t + 1);
  };

  const fit = (ids?: string[], animate = true) => {
    const root = rootRef.current;
    if (!root || !layout || !layout.nodes.length) return;
    const pool = ids?.length ? layout.nodes.filter((n) => ids.includes(n.id)) : layout.nodes;
    if (!pool.length) return;
    const minX = Math.min(...pool.map((n) => n.x));
    const minY = Math.min(...pool.map((n) => n.y));
    const maxX = Math.max(...pool.map((n) => n.x + n.w));
    const maxY = Math.max(...pool.map((n) => n.y + n.h));
    // Leave room for the hint pill on top and the controls on the right.
    const padX = 64;
    const padTop = 64;
    const padBottom = 32;
    const cw = root.clientWidth - 56 - (ids?.length ? rightInset : 0);
    const ch = root.clientHeight;
    const k = Math.max(MIN_K, Math.min(ids?.length ? 1.3 : 1.1, (cw - padX * 2) / (maxX - minX || 1), (ch - padTop - padBottom) / (maxY - minY || 1)));
    cam.current = { k, x: cw / 2 - ((minX + maxX) / 2) * k, y: padTop + (ch - padTop - padBottom) / 2 - ((minY + maxY) / 2) * k };
    apply(animate);
  };

  const zoomAt = (f: number, cx: number, cy: number, animate = false) => {
    const c = cam.current;
    const k = Math.max(MIN_K, Math.min(MAX_K, c.k * f));
    cam.current = { k, x: cx - ((cx - c.x) * k) / c.k, y: cy - ((cy - c.y) * k) / c.k };
    apply(animate);
  };

  apiRef.current = {
    fit,
    zoomBy: (f) => {
      const r = rootRef.current!;
      zoomAt(f, r.clientWidth / 2, r.clientHeight / 2, true);
    },
    getLayout: () => layout,
  };

  // Fit whenever a new layout arrives for a different view; keep the camera on live refreshes.
  const lastKey = useRef('');
  useLayoutEffect(() => {
    if (!layout) return;
    setTip(null);
    if (lastKey.current !== layoutKey) {
      setHover(null);
      lastKey.current = layoutKey;
      fit(undefined, false);
    } else apply();
  }, [layout, layoutKey]);

  useEffect(() => {
    const r = rootRef.current!;
    const ro = new ResizeObserver(() => apply());
    ro.observe(r);
    return () => ro.disconnect();
  }, []);

  // Wheel: pinch / ctrl / mouse wheel zooms, trackpad scroll pans.
  useEffect(() => {
    const r = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = r.getBoundingClientRect();
      const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
        zoomAt(f, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        cam.current = { ...cam.current, x: cam.current.x - e.deltaX, y: cam.current.y - e.deltaY };
        apply();
      }
    };
    r.addEventListener('wheel', onWheel, { passive: false });
    return () => r.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.node, .controls, .minimap')) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
    rootRef.current!.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      d.moved = true;
      rootRef.current!.classList.add('panning');
    }
    cam.current = { ...cam.current, x: d.cx + dx, y: d.cy + dy };
    apply();
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    rootRef.current!.classList.remove('panning');
    if (d && !d.moved && !(e.target as HTMLElement).closest('.node')) onSelect(null);
  };

  // Hover / focus highlighting.
  const lit = useMemo(() => {
    if (!layout) return null;
    // Hover wins; otherwise a focus set (cycle, warning); otherwise the selected node's neighbourhood.
    const hoverValid = hover && layout.nodes.some((n) => n.id === hover);
    const anchor = hoverValid ? hover : !focus && selected && layout.nodes.some((n) => n.id === selected && n.kind !== 'group') ? selected : null;
    if (anchor) {
      const nodes = new Set([anchor]);
      const edges = new Set<string>();
      for (const e of layout.edges) {
        if (e.source === anchor || e.target === anchor) {
          edges.add(e.id);
          nodes.add(e.source);
          nodes.add(e.target);
        }
      }
      for (const n of layout.nodes) if (nodes.has(n.id) && n.parent) nodes.add(n.parent);
      return { nodes, edges };
    }
    if (focus) {
      const nodes = new Set(focus.nodes);
      for (const n of layout.nodes) if (nodes.has(n.id) && n.parent) nodes.add(n.parent);
      return { nodes, edges: focus.edges };
    }
    return null;
  }, [layout, hover, focus, selected]);

  const nodeEls = useMemo(() => {
    if (!layout) return null;
    return layout.nodes.map((n, i) => {
      const color = nodeColor(n);
      if (n.kind === 'group') {
        const d = n.data;
        return (
          <div
            key={n.id}
            class={`group ${d.kind === 'tech' ? 'dashed' : ''} ${lit?.nodes.has(n.id) ? 'lit' : ''}`}
            style={{ left: n.x, top: n.y, width: n.w, height: n.h, '--gc': color }}
          >
            <div class="group-label">
              <span style={{ color }}>{d.label}</span>
              {d.sub && <span class="sub">{d.sub}</span>}
              {d.chips?.length ? (
                <span class="chips" style={{ marginLeft: 'auto' }}>
                  {d.chips.slice(0, 5).map((c: string) => (
                    <span class="chip accent" key={c}>{c}</span>
                  ))}
                </span>
              ) : null}
            </div>
          </div>
        );
      }
      const cls = [
        'node',
        n.kind,
        n.data.cycle ? 'in-cycle' : '',
        n.data.violation ? 'violation' : '',
        n.data.isNew ? 'new' : '',
        n.data.declared ? 'declared' : '',
        selected === n.id ? 'selected' : '',
        lit?.nodes.has(n.id) ? 'lit' : '',
      ].join(' ');
      return (
        <div
          key={n.id}
          class={cls}
          data-id={n.id}
          style={{ left: n.x, top: n.y, width: n.w, height: n.h, '--nc': color, animationDelay: `${Math.min(i * 6, 240)}ms` }}
          onMouseEnter={() => setHover(n.id)}
          onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
          onClick={(e) => {
            e.stopPropagation();
            clearTimeout(clickTimer.current);
            clickTimer.current = window.setTimeout(() => onSelect(n), 200);
          }}
          onDblClick={(e) => {
            e.stopPropagation();
            clearTimeout(clickTimer.current);
            onActivate(n);
          }}
        >
          <NodeBody n={n} />
        </div>
      );
    });
  }, [layout, selected, lit]);

  const edgeEls = useMemo(() => {
    if (!layout) return null;
    const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
    const label = (id: string) => {
      const n = nodeById.get(id);
      return n?.data?.c?.label ?? n?.data?.t?.name ?? n?.data?.name ?? n?.data?.path ?? id;
    };
    return layout.edges.map((e) => {
      const isLit = !!lit?.edges.has(e.id);
      const d = edgePath(e);
      return (
        <g key={e.id}>
          <path
            d={d}
            class={`edge ${e.classes.join(' ')} ${isLit ? 'lit' : ''}`}
            style={{ strokeWidth: e.weight }}
            marker-end={`url(#${markerFor(e, isLit && !!lit)})`}
          />
          <path
            d={d}
            class="edge-hit"
            onMouseMove={(ev: MouseEvent) =>
              setTip({
                x: ev.clientX + 14,
                y: ev.clientY + 14,
                title: `${label(e.source)} → ${label(e.target)}`,
                sub: [
                  e.count ? `${e.count} import${e.count === 1 ? '' : 's'}` : '',
                  e.classes.includes('cycle') ? 'part of an import cycle' : '',
                  e.classes.includes('violation') ? 'breaks an architecture rule / layering' : '',
                  e.classes.includes('added') ? 'new since snapshot' : '',
                  e.classes.includes('removed') ? 'removed since snapshot' : '',
                  e.classes.includes('type-only') ? 'type-only' : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
              })
            }
            onMouseLeave={() => setTip(null)}
          />
        </g>
      );
    });
  }, [layout, lit]);

  const labels = useMemo(() => {
    if (!layout || !lit) return null;
    return layout.edges
      .filter((e) => lit.edges.has(e.id) && e.count > 1)
      .slice(0, 60)
      .map((e) => {
        const m = midpoint(e.points);
        return (
          <div key={e.id} class="edge-label" style={{ left: m.x, top: m.y }}>
            {fmt(e.count)}
          </div>
        );
      });
  }, [layout, lit]);

  const c = cam.current;
  const root = rootRef.current;

  return (
    <div
      ref={rootRef}
      class="canvas"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div ref={worldRef} class={`world ${lit ? 'dimming' : ''} ${layout && layout.edges.length > 50 ? 'dense' : ''}`}>
        <svg class="edges" width={layout?.width ?? 0} height={layout?.height ?? 0}>
          <defs>
            {[
              ['m-default', 'color-mix(in srgb, var(--fg) 40%, transparent)'],
              ['m-faint', 'color-mix(in srgb, var(--fg) 25%, transparent)'],
              ['m-accent', 'var(--accent)'],
              ['m-danger', 'var(--danger)'],
              ['m-warn', 'var(--warn)'],
              ['m-ok', 'var(--ok)'],
              ['m-tech', 'color-mix(in srgb, var(--accent-2) 70%, transparent)'],
            ].map(([id, fill]) => (
              <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" style={{ fill }} />
              </marker>
            ))}
          </defs>
          {edgeEls}
        </svg>
        {nodeEls}
        {labels}
      </div>

      {hint && <div class="view-hint">{hint}</div>}

      <div class="controls">
        <button class="btn icon ghost" title="Zoom in" onClick={() => apiRef.current!.zoomBy(1.25)}>
          <Plus size={15} />
        </button>
        <div class="zoom">{Math.round(c.k * 100)}%</div>
        <button class="btn icon ghost" title="Zoom out" onClick={() => apiRef.current!.zoomBy(0.8)}>
          <Minus size={15} />
        </button>
        <button class="btn icon ghost" title="Fit to screen (F)" onClick={() => fit()}>
          <Maximize size={14} />
        </button>
        <button class={`btn icon ghost ${showMap ? 'active' : ''}`} title="Toggle minimap" onClick={() => setShowMap((s) => !s)}>
          <MapIcon size={14} />
        </button>
      </div>

      {showMap && layout && root && layout.nodes.length > 0 && !allVisible(layout, c, root.clientWidth, root.clientHeight) && (
        <Minimap layout={layout} cam={c} vw={root.clientWidth} vh={root.clientHeight} onCenter={(x, y) => {
          cam.current = { ...cam.current, x: root.clientWidth / 2 - x * cam.current.k, y: root.clientHeight / 2 - y * cam.current.k };
          apply(true);
        }} />
      )}

      {tip && (
        <div class="tooltip" style={{ left: tip.x, top: tip.y }}>
          <div>{tip.title}</div>
          {tip.sub && <div class="sub">{tip.sub}</div>}
        </div>
      )}
    </div>
  );
}

/** True when every node is inside the viewport, so a minimap adds nothing. */
function allVisible(l: Layout, c: Camera, vw: number, vh: number): boolean {
  const x0 = -c.x / c.k;
  const y0 = -c.y / c.k;
  return l.nodes.every((n) => n.x >= x0 && n.y >= y0 && n.x + n.w <= x0 + vw / c.k && n.y + n.h <= y0 + vh / c.k);
}

function Minimap({ layout, cam, vw, vh, onCenter }: { layout: Layout; cam: Camera; vw: number; vh: number; onCenter(x: number, y: number): void }) {
  const W = 168;
  const H = Math.max(60, Math.min(112, (W * layout.height) / Math.max(1, layout.width)));
  const s = Math.min(W / layout.width, H / layout.height);
  const ox = (W - layout.width * s) / 2;
  const oy = (H - layout.height * s) / 2;
  const toWorld = (e: MouseEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
  };
  const dragging = useRef(false);
  return (
    <div class="minimap">
      <svg
        width={W}
        height={H}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
          const p = toWorld(e);
          onCenter(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const p = toWorld(e);
          onCenter(p.x, p.y);
        }}
        onPointerUp={() => (dragging.current = false)}
      >
        <g transform={`translate(${ox},${oy}) scale(${s})`}>
          {layout.nodes.map((n) =>
            n.kind === 'group' ? (
              <rect key={n.id} x={n.x} y={n.y} width={n.w} height={n.h} rx={14} style={{ fill: 'none', stroke: nodeColor(n), strokeOpacity: 0.5, strokeWidth: 2 / s }} />
            ) : (
              <rect key={n.id} x={n.x} y={n.y} width={n.w} height={n.h} rx={8} style={{ fill: nodeColor(n), fillOpacity: 0.75 }} />
            ),
          )}
          <rect class="vp" x={-cam.x / cam.k} y={-cam.y / cam.k} width={vw / cam.k} height={vh / cam.k} rx={6} style={{ strokeWidth: 1.5 / s }} />
        </g>
      </svg>
    </div>
  );
}
