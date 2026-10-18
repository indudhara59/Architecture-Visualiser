import type { Layout } from './layout';
import { edgePath } from './layout';
import { nodeColor } from './nodes';
import { LANG_META, LAYER_LABELS, TECH_META } from './theme';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Resolves a CSS expression (custom properties, color-mix) to a concrete color. */
function resolve(expr: string): string {
  const probe = document.createElement('div');
  probe.style.color = expr;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return toRgba(c) || '#888';
}

/** color-mix() computes to `color(srgb r g b / a)`, which many SVG viewers don't understand. */
function toRgba(c: string): string {
  const m = c.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\)$/);
  if (!m) return c;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(Math.min(1, Math.max(0, Number(v))) * 255));
  return `rgba(${r}, ${g}, ${b}, ${m[4] ?? 1})`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Standalone SVG of the current layout (no external CSS needed). */
export function layoutToSvg(layout: Layout, title: string): string {
  const bg = resolve('var(--bg)');
  const fg = resolve('var(--fg)');
  const muted = resolve('var(--muted)');
  const surface = resolve('var(--surface)');
  const border = resolve('var(--border-strong)');
  const edgeColor = resolve('color-mix(in srgb, var(--fg) 35%, transparent)');
  const colors = { danger: '#f2555a', warn: '#f5a524', ok: '#2fbf71', tech: '#22c3e6' };
  const font = getComputedStyle(document.body).fontFamily.replace(/"/g, "'");
  const pad = 24;
  const W = Math.ceil(layout.width + pad * 2);
  const H = Math.ceil(layout.height + pad * 2 + 30);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">`);
  out.push('<defs>');
  for (const [id, c] of Object.entries({ def: edgeColor, ...colors })) {
    out.push(`<marker id="a-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="${c}"/></marker>`);
  }
  out.push('</defs>');
  out.push(`<rect width="100%" height="100%" fill="${bg}"/>`);
  out.push(`<text x="${pad}" y="${pad + 4}" font-size="15" font-weight="700" fill="${fg}">${esc(title)}</text>`);
  out.push(`<g transform="translate(${pad},${pad + 22})">`);

  for (const n of layout.nodes.filter((n) => n.kind === 'group')) {
    const c = nodeColor(n);
    out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="18" fill="${c}" fill-opacity="0.05" stroke="${c}" stroke-opacity="0.6" stroke-width="1.5"${n.data.kind === 'tech' ? ' stroke-dasharray="6 4"' : ''}/>`);
    out.push(`<text x="${n.x + 16}" y="${n.y + 28}" font-size="13" font-weight="650" fill="${c}">${esc(n.data.label)}</text>`);
  }

  for (const e of layout.edges) {
    const cls = e.classes;
    const kind = cls.includes('cycle') || cls.includes('removed') ? 'danger' : cls.includes('violation') ? 'warn' : cls.includes('added') ? 'ok' : cls.includes('tech') ? 'tech' : 'def';
    const stroke = kind === 'def' ? edgeColor : colors[kind as keyof typeof colors];
    const dash = cls.includes('cycle') ? ' stroke-dasharray="7 5"' : cls.includes('type-only') || cls.includes('package') ? ' stroke-dasharray="4 4"' : '';
    const op = cls.includes('neighbor') || cls.includes('package') ? ' stroke-opacity="0.55"' : '';
    out.push(`<path d="${edgePath(e)}" fill="none" stroke="${stroke}" stroke-width="${e.weight}"${dash}${op} marker-end="url(#a-${kind})"/>`);
  }

  for (const n of layout.nodes.filter((n) => n.kind !== 'group')) {
    const c = nodeColor(n);
    const d = n.data;
    const dashed = n.kind === 'neighbor' || n.kind === 'package' || d.declared ? ' stroke-dasharray="5 4"' : '';
    const rx = n.kind === 'package' ? n.h / 2 : 11;
    const stroke = d.cycle ? colors.danger : d.violation ? colors.warn : border;
    out.push(`<g transform="translate(${n.x},${n.y})">`);
    out.push(`<rect width="${n.w}" height="${n.h}" rx="${rx}" fill="${surface}" stroke="${stroke}"${dashed}/>`);
    if (n.kind === 'component') {
      const clip = `clip-${layout.nodes.indexOf(n)}`;
      out.push(`<clipPath id="${clip}"><rect width="${n.w}" height="${n.h}" rx="${rx}"/></clipPath>`);
      out.push(`<rect width="5" height="${n.h}" fill="${c}" clip-path="url(#${clip})"/>`);
      out.push(`<rect x="16" y="12" width="28" height="28" rx="8" fill="${c}" fill-opacity="0.18"/>`);
      out.push(`<text x="30" y="31" font-size="11" font-weight="800" text-anchor="middle" fill="${c}">${esc(d.c.label.slice(0, 2).toUpperCase())}</text>`);
      out.push(`<text x="54" y="25" font-size="13.5" font-weight="650" fill="${fg}">${esc(truncate(d.c.label, 22))}</text>`);
      out.push(`<text x="54" y="40" font-size="11" fill="${muted}">${esc(truncate(LAYER_LABELS[d.c.layer as keyof typeof LAYER_LABELS] + (d.c.folder ? ' · ' + d.c.folder : ''), 28))}</text>`);
      if (!d.compact) out.push(`<text x="16" y="${n.h - 14}" font-size="11" fill="${muted}">${d.files} file${d.files === 1 ? '' : 's'} · ${d.lines} lines · ↗${d.fanOut} ↙${d.fanIn}</text>`);
    } else if (n.kind === 'file') {
      const lang = LANG_META[d.lang as keyof typeof LANG_META];
      out.push(`<rect x="10" y="${n.h / 2 - 13}" width="26" height="26" rx="7" fill="${lang?.color ?? c}" fill-opacity="0.2"/>`);
      out.push(`<text x="23" y="${n.h / 2 + 3.5}" font-size="9" font-weight="800" text-anchor="middle" fill="${lang?.color ?? c}">${lang?.short ?? ''}</text>`);
      out.push(`<text x="45" y="${d.sub ? n.h / 2 - 2 : n.h / 2 + 4}" font-size="12.5" font-weight="650" fill="${fg}">${esc(truncate(d.name, 22))}</text>`);
      if (d.sub) out.push(`<text x="45" y="${n.h / 2 + 13}" font-size="11" fill="${muted}">${esc(truncate(d.sub, 26))}</text>`);
    } else if (n.kind === 'tech' || n.kind === 'neighbor') {
      const label = n.kind === 'tech' ? d.t.name : d.c.label;
      const sub = n.kind === 'tech' ? TECH_META[d.t.category as keyof typeof TECH_META].label : `${d.linked} linked files`;
      out.push(`<rect x="12" y="${n.h / 2 - 14}" width="28" height="28" rx="8" fill="${c}" fill-opacity="0.18"/>`);
      out.push(`<text x="50" y="${n.h / 2 - 2}" font-size="13" font-weight="650" fill="${fg}">${esc(truncate(label, 20))}</text>`);
      out.push(`<text x="50" y="${n.h / 2 + 13}" font-size="11" fill="${muted}">${esc(sub)}</text>`);
    } else if (n.kind === 'package') {
      out.push(`<text x="14" y="${n.h / 2 + 4}" font-size="12" fill="${fg}">${esc(truncate(d.name, 18))}</text>`);
    }
    out.push('</g>');
  }
  out.push('</g></svg>');
  return out.join('\n');
}

export async function svgToPngBase64(svg: string, scale = 2): Promise<string> {
  const img = new Image();
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Could not render SVG'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}
