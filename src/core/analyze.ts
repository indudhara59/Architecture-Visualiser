import * as fs from 'node:fs/promises';
import { ImportParser } from './parser';
import { Resolver } from './resolver';
import { scanWorkspace, ScanOptions } from './scanner';
import { aggregateComponentEdges, buildComponents, findCycles, markCyclicComponentEdges } from './graph';
import { ArchGraph, ExternalDep, FileEdge, RawImport } from './types';

export interface AnalyzeOptions extends ScanOptions {
  groupingDepth?: number;
  /** Only diagram files under this workspace-relative folder (imports still resolve workspace-wide). */
  scope?: string;
  onProgress?: (done: number, total: number) => void;
}

/** Imports of non-code files (JSON, styles, images) are not counted as unresolved. */
const ASSET_RE = /\.(json|css|scss|sass|less|svg|png|jpe?g|gif|webp|wasm|html?|md|txt|ya?ml)(\?.*)?$/i;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  imports: RawImport[];
  lines: number;
}

/**
 * Runs scan → parse → resolve → graph. Keeps parsed imports cached by mtime/size,
 * so re-running after a save only re-parses the files that changed.
 */
export class Analyzer {
  private readonly parser: ImportParser;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(wasmDir: string) {
    this.parser = new ImportParser(wasmDir);
  }

  invalidate(relPath: string): void {
    this.cache.delete(relPath);
  }

  async analyze(root: string, opts: AnalyzeOptions = {}): Promise<ArchGraph> {
    const started = Date.now();
    const scan = await scanWorkspace(root, opts);
    const resolver = new Resolver(root, scan.files, scan.configFiles);

    const importsByFile = new Map<string, RawImport[]>();
    const linesByFile = new Map<string, number>();
    let done = 0;
    for (const f of scan.files) {
      let entry = this.cache.get(f.path);
      if (!entry || entry.mtimeMs !== f.mtimeMs || entry.size !== f.size) {
        let imports: RawImport[] = [];
        let lines = 0;
        try {
          const text = await fs.readFile(f.absPath, 'utf8');
          lines = text.split('\n').length;
          imports = await this.parser.parse(text, f.language);
        } catch {
          // Unreadable or unparsable file: keep it as a node without edges.
        }
        entry = { mtimeMs: f.mtimeMs, size: f.size, imports, lines };
        this.cache.set(f.path, entry);
      }
      importsByFile.set(f.path, entry.imports);
      linesByFile.set(f.path, entry.lines);
      if (++done % 50 === 0) opts.onProgress?.(done, scan.files.length);
    }
    const present = new Set(scan.files.map((f) => f.path));
    for (const k of this.cache.keys()) if (!present.has(k)) this.cache.delete(k);

    const inScope = (p: string) => !opts.scope || p === opts.scope || p.startsWith(opts.scope + '/');
    const edgeMap = new Map<string, FileEdge>();
    const externalHits: { file: string; name: string; kind: ExternalDep['kind'] }[] = [];
    let importCount = 0;
    let unresolved = 0;
    for (const f of scan.files) {
      for (const imp of importsByFile.get(f.path) ?? []) {
        const r = resolver.resolve(f.path, imp, f.language === 'python');
        if (inScope(f.path)) {
          importCount++;
          if (!r.external && !r.targets.length && !ASSET_RE.test(imp.specifier)) unresolved++;
        }
        if (r.external) externalHits.push({ file: f.path, ...r.external });
        for (const t of r.targets) {
          const key = `${f.path}\u0000${t}`;
          const cur = edgeMap.get(key);
          if (cur) {
            cur.count++;
            cur.typeOnly &&= !!imp.typeOnly;
            if (!cur.lines.includes(imp.line)) cur.lines.push(imp.line);
          } else edgeMap.set(key, { from: f.path, to: t, count: 1, typeOnly: !!imp.typeOnly, lines: [imp.line] });
        }
      }
    }
    const files = scan.files.filter((f) => inScope(f.path));
    const fileEdges = [...edgeMap.values()].filter((e) => inScope(e.from) && inScope(e.to));

    const paths = files.map((f) => f.path);
    const components = buildComponents(paths, opts.groupingDepth ?? 0);
    const componentOf = new Map<string, string>();
    for (const c of components) for (const f of c.files) componentOf.set(f, c.id);
    const componentEdges = aggregateComponentEdges(fileEdges, componentOf);
    const fileCycles = findCycles(paths, fileEdges.filter((e) => !e.typeOnly));
    markCyclicComponentEdges(fileCycles, fileEdges, componentOf, componentEdges);

    const externals = new Map<string, ExternalDep>();
    for (const h of externalHits) {
      if (!inScope(h.file)) continue;
      const key = `${h.kind}:${h.name}`;
      let dep = externals.get(key);
      if (!dep) externals.set(key, (dep = { name: h.name, kind: h.kind, usedBy: {} }));
      const comp = componentOf.get(h.file)!;
      dep.usedBy[comp] = (dep.usedBy[comp] ?? 0) + 1;
    }

    return {
      root,
      generatedAt: new Date().toISOString(),
      files: files.map((f) => ({
        path: f.path,
        language: f.language,
        component: componentOf.get(f.path)!,
        lines: linesByFile.get(f.path),
      })),
      fileEdges,
      components,
      componentEdges,
      externals: [...externals.values()].sort((a, b) => a.name.localeCompare(b.name)),
      fileCycles,
      componentCycles: findCycles(
        components.map((c) => c.id),
        componentEdges,
      ),
      stats: {
        files: files.length,
        imports: importCount,
        unresolved,
        durationMs: Date.now() - started,
        truncated: scan.truncated,
      },
    };
  }
}
