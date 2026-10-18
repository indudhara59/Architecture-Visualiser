import { ArrowDownLeft, ArrowUpRight, FileCode2, Files, Repeat, ShieldAlert, Text } from 'lucide-preact';
import type { LaidNode } from './layout';
import { fmt, LANG_META, LAYER_COLORS, LAYER_ICONS, LAYER_LABELS, TECH_META } from './theme';
import type { TechNode } from '../core/types';

export function nodeColor(n: LaidNode): string {
  switch (n.kind) {
    case 'component':
    case 'neighbor':
      return LAYER_COLORS[n.data.c.layer as keyof typeof LAYER_COLORS];
    case 'tech':
      return TECH_META[(n.data.t as TechNode).category].color;
    case 'file':
      return LANG_META[n.data.lang as keyof typeof LANG_META]?.color ?? '#888';
    case 'group':
      return n.data.kind === 'focus' ? LAYER_COLORS[n.data.layer as keyof typeof LAYER_COLORS] : n.data.kind === 'app' ? '#7c5cff' : '#8b93a7';
    default:
      return '#8b93a7';
  }
}

export function NodeBody({ n }: { n: LaidNode }) {
  const d = n.data;
  switch (n.kind) {
    case 'component': {
      const Icon = LAYER_ICONS[d.c.layer as keyof typeof LAYER_ICONS];
      return (
        <>
          <div class="accent" />
          <div class="content">
            <div class="head">
              <div class="tile">
                <Icon size={15} strokeWidth={2.2} />
              </div>
              <div class="names">
                <div class="title">{d.c.label}</div>
                <div class="sub">{LAYER_LABELS[d.c.layer as keyof typeof LAYER_LABELS]}{d.c.folder ? ` · ${d.c.folder}` : ''}</div>
              </div>
            </div>
            {!d.compact && (
              <div class="metrics">
                <span title="Files"><Files size={12} />{d.files}</span>
                <span title="Lines of code"><Text size={12} />{fmt(d.lines)}</span>
                <span title="Components it depends on"><ArrowUpRight size={12} />{d.fanOut}</span>
                <span title="Components that depend on it"><ArrowDownLeft size={12} />{d.fanIn}</span>
                <span class="flag">
                  {d.added > 0 && <span class="chip ok">+{d.added}</span>}
                  {d.cycle && <span class="chip danger" title="Contains files in an import cycle"><Repeat size={10} /></span>}
                  {d.violation && <span class="chip warn" title="Breaks an architecture rule"><ShieldAlert size={10} /></span>}
                </span>
              </div>
            )}
          </div>
        </>
      );
    }
    case 'file': {
      const lang = LANG_META[d.lang as keyof typeof LANG_META];
      return (
        <>
          <div class="lang" style={{ background: `color-mix(in srgb, ${lang?.color ?? '#888'} 20%, transparent)`, color: lang?.color }}>
            {lang?.short ?? <FileCode2 size={13} />}
          </div>
          <div class="names" style={{ minWidth: 0, flex: 1 }}>
            <div class="title" style={{ fontSize: '12.5px' }}>{d.name}</div>
            {d.sub && <div class="sub">{d.sub}</div>}
          </div>
          <span class="badge" title={`Imported by ${d.fanIn} files · imports ${d.fanOut}`}>
            <ArrowDownLeft size={11} />
            {d.fanIn}
          </span>
        </>
      );
    }
    case 'neighbor': {
      const Icon = LAYER_ICONS[d.c.layer as keyof typeof LAYER_ICONS];
      return (
        <>
          <div class="tile">
            <Icon size={14} />
          </div>
          <div class="names">
            <div class="title" style={{ fontSize: '12.5px' }}>{d.c.label}</div>
            <div class="sub">{d.linked} linked file{d.linked === 1 ? '' : 's'}</div>
          </div>
        </>
      );
    }
    case 'tech': {
      const t = d.t as TechNode;
      const meta = TECH_META[t.category];
      const Icon = meta.icon;
      const uses = Object.values(t.usedBy).reduce((a, b) => a + b, 0);
      return (
        <>
          <div class="tile">
            <Icon size={15} strokeWidth={2.2} />
          </div>
          <div class="names">
            <div class="title">{t.name}</div>
            <div class="sub">{meta.label}{uses ? ` · ${uses} import${uses === 1 ? '' : 's'}` : ` · ${t.sources.join(', ')}`}</div>
          </div>
        </>
      );
    }
    case 'package':
      return (
        <>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{d.name}</span>
          <span style={{ color: 'var(--muted)', fontSize: '11px' }}>{d.count}</span>
        </>
      );
    default:
      return null;
  }
}
