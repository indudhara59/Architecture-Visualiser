import type { LucideIcon } from 'lucide-preact';
import { Plus } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export interface QuickAction {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Tile color for the icon. */
  color: string;
  section: string;
  /** Short hint on the right, e.g. "PNG". */
  badge?: string;
  run(): void;
}

/**
 * Round "+" button that opens a menu of actions (like the attach/tools menu in chat apps).
 * Keyboard: ↑/↓ to move, Enter to run, Esc to close.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    listRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const run = (a: QuickAction) => {
    setOpen(false);
    a.run();
  };

  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % actions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + actions.length) % actions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(actions[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  let lastSection = '';
  return (
    <div class="qa" ref={wrapRef}>
      <button
        class={`qa-trigger ${open ? 'open' : ''}`}
        title="Create & tools"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={18} strokeWidth={2.4} />
      </button>
      {open && (
        <div class="qa-menu" role="menu" tabIndex={-1} ref={listRef} onKeyDown={onKey}>
          {actions.map((a, i) => {
            const header = a.section !== lastSection ? <div class="qa-section">{a.section}</div> : null;
            lastSection = a.section;
            const Icon = a.icon;
            return (
              <div key={a.id}>
                {header}
                <button
                  role="menuitem"
                  class={`qa-item ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(a)}
                >
                  <span class="qa-icon" style={{ '--qc': a.color }}>
                    <Icon size={17} strokeWidth={2.1} />
                  </span>
                  <span class="qa-text">
                    <span class="qa-title">{a.title}</span>
                    <span class="qa-desc">{a.description}</span>
                  </span>
                  {a.badge && <span class="qa-badge">{a.badge}</span>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
