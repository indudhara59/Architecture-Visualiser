import { Boxes, CornerDownLeft, FileCode2, Search, Terminal } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Index } from './model';
import { basename, dirname, LANG_META, LAYER_COLORS, TECH_META } from './theme';

export interface PaletteItem {
  id: string;
  group: 'Components' | 'Files' | 'Services' | 'Commands';
  title: string;
  sub?: string;
  color?: string;
  run(): void;
}

/** Subsequence match; consecutive and word-start hits score higher. Returns matched indexes. */
function score(q: string, text: string): { s: number; hits: number[] } | null {
  if (!q) return { s: 0, hits: [] };
  const t = text.toLowerCase();
  const hits: number[] = [];
  let s = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q.toLowerCase()) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return null;
    hits.push(i);
    s += i === prev + 1 ? 6 : 1;
    if (i === 0 || /[\/._\-\s]/.test(t[i - 1])) s += 4;
    prev = i;
    ti = i + 1;
  }
  return { s: s - t.length * 0.02, hits };
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return <>{[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : ch))}</>;
}

export function buildItems(ix: Index, act: { component(id: string): void; file(p: string): void; tech(id: string): void }, commands: PaletteItem[]): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const c of ix.p.graph.components) {
    items.push({ id: c.id, group: 'Components', title: c.label, sub: `${c.files.length} files · ${c.folder || '/'}`, color: LAYER_COLORS[c.layer], run: () => act.component(c.id) });
  }
  for (const t of ix.p.system.techs) {
    items.push({ id: t.id, group: 'Services', title: t.name, sub: TECH_META[t.category].label, color: TECH_META[t.category].color, run: () => act.tech(t.id) });
  }
  for (const f of ix.p.graph.files) {
    items.push({ id: f.path, group: 'Files', title: basename(f.path), sub: dirname(f.path), color: LANG_META[f.language].color, run: () => act.file(f.path) });
  }
  return [...commands, ...items];
}

export function Palette({ items, onClose }: { items: PaletteItem[]; onClose(): void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const scored = items
      .map((it) => {
        const m = score(q, it.title) ?? (q.includes('/') ? score(q, `${it.sub}/${it.title}`) : null);
        return m ? { it, ...m } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (q) scored.sort((a, b) => b.s - a.s);
    const order = ['Commands', 'Components', 'Services', 'Files'];
    const limited = q ? scored.slice(0, 40) : scored.filter((r) => r.it.group !== 'Files').slice(0, 40);
    return q ? limited : limited.sort((a, b) => order.indexOf(a.it.group) - order.indexOf(b.it.group));
  }, [q, items]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (i: number) => {
    const r = results[i];
    if (!r) return;
    onClose();
    r.it.run();
  };

  let lastGroup = '';
  return (
    <div class="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="palette">
        <div class="input">
          <Search size={17} color="var(--muted)" />
          <input
            ref={inputRef}
            value={q}
            placeholder="Jump to a component, file or service, or run a command…"
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') run(active);
              else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div class="results" ref={listRef}>
          {results.map((r, i) => {
            const header = r.it.group !== lastGroup ? <div class="group-title">{r.it.group}</div> : null;
            lastGroup = r.it.group;
            const Icon = r.it.group === 'Files' ? FileCode2 : r.it.group === 'Commands' ? Terminal : Boxes;
            return (
              <div key={r.it.group + r.it.id}>
                {header}
                <div class={`item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => run(i)}>
                  <Icon size={15} color={r.it.color ?? 'var(--muted)'} />
                  <span class="t"><Highlight text={r.it.title} hits={r.hits} /></span>
                  {r.it.sub && <span class="s">{r.it.sub}</span>}
                </div>
              </div>
            );
          })}
          {!results.length && <div class="empty" style={{ padding: '16px' }}>No matches</div>}
        </div>
        <footer>
          <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
          <span><kbd><CornerDownLeft size={9} /></kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}
