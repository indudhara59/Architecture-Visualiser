import * as fs from 'node:fs';
import * as path from 'node:path';
import { builtinModules } from 'node:module';
import { RawImport, ResolvedImport, SourceFile } from './types';
import { PYTHON_STDLIB } from './pythonStdlib';

const JS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const NODE_BUILTINS = new Set(builtinModules);

interface PathAlias {
  /** Pattern prefix before `*` (or whole pattern when no wildcard). */
  prefix: string;
  suffix: string;
  wildcard: boolean;
  /** Workspace-relative target patterns. */
  targets: string[];
}

interface TsConfigInfo {
  /** Workspace-relative dir containing the config. */
  dir: string;
  baseUrl?: string;
  aliases: PathAlias[];
}

interface WorkspacePackage {
  name: string;
  dir: string;
  entries: string[];
  /** package.json "exports" subpaths ('./cors', './*') → workspace-relative targets. */
  exports: Map<string, string[]>;
}

/** All string targets of an exports condition object, in preference order. */
function exportTargets(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(exportTargets);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = ['source', 'development', 'import', 'module', 'default', 'require', 'node', 'types'];
    return [...keys.filter((k) => k in o), ...Object.keys(o).filter((k) => !keys.includes(k))].flatMap((k) => exportTargets(o[k]));
  }
  return [];
}

/** Build output paths usually mirror sources: dist/cjs/foo.js → src/foo, dist/types/foo.d.ts → src/foo. */
function sourceCandidates(p: string): string[] {
  const stripped = p.replace(/\.d\.[mc]?ts$/, '');
  const mapped = stripped.replace(/(^|\/)(dist|lib|build|out)\/((cjs|esm|mjs|es|umd|types|module|commonjs)\/)?/, '$1src/');
  return [...new Set([p, stripped, mapped])];
}

/** Read JSON that may contain comments and trailing commas (tsconfig style). */
export function parseJsonc(text: string): any {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function joinRel(...parts: string[]): string {
  const j = path.posix.normalize(path.posix.join(...parts.filter((p) => p !== '')));
  return j === '.' ? '' : j.replace(/\/$/, '');
}

export function packageNameOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
}

export class Resolver {
  private readonly fileSet: Set<string>;
  private readonly dirSet = new Set<string>();
  private tsconfigs: TsConfigInfo[] = [];
  private packages = new Map<string, WorkspacePackage>();
  private pythonRoots: string[] = [''];

  constructor(
    private readonly root: string,
    files: SourceFile[],
    configFiles: string[],
  ) {
    this.fileSet = new Set(files.map((f) => f.path));
    for (const f of this.fileSet) {
      let d = path.posix.dirname(f);
      while (d !== '.' && !this.dirSet.has(d)) {
        this.dirSet.add(d);
        d = path.posix.dirname(d);
      }
    }
    this.loadConfigs(configFiles);
  }

  // ---------------------------------------------------------------- configs

  private readJson(rel: string): any | undefined {
    try {
      return parseJsonc(fs.readFileSync(path.join(this.root, rel), 'utf8'));
    } catch {
      return undefined;
    }
  }

  /** Follows relative `extends` chains to collect compilerOptions. */
  private loadCompilerOptions(rel: string, depth = 0): { opts: any; dirOf: Record<string, string> } {
    const json = this.readJson(rel);
    const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    if (!json) return { opts: {}, dirOf: {} };
    let base = { opts: {} as any, dirOf: {} as Record<string, string> };
    const ext = typeof json.extends === 'string' ? json.extends : undefined;
    if (ext && ext.startsWith('.') && depth < 5) {
      const target = joinRel(dir, ext.endsWith('.json') ? ext : ext + '.json');
      base = this.loadCompilerOptions(target, depth + 1);
    }
    const own = json.compilerOptions ?? {};
    const opts = { ...base.opts, ...own };
    const dirOf = { ...base.dirOf };
    // baseUrl/paths are relative to the config that declares them.
    if ('baseUrl' in own) dirOf.baseUrl = dir;
    if ('paths' in own) dirOf.paths = dir;
    return { opts, dirOf };
  }

  private loadConfigs(configFiles: string[]): void {
    for (const rel of configFiles) {
      const name = path.posix.basename(rel);
      const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
      if (name === 'tsconfig.json' || name === 'jsconfig.json') {
        const { opts, dirOf } = this.loadCompilerOptions(rel);
        const info: TsConfigInfo = { dir, aliases: [] };
        if (typeof opts.baseUrl === 'string') info.baseUrl = joinRel(dirOf.baseUrl ?? dir, opts.baseUrl);
        if (opts.paths && typeof opts.paths === 'object') {
          const pathsBase = info.baseUrl ?? dirOf.paths ?? dir;
          for (const [pattern, targets] of Object.entries(opts.paths as Record<string, string[]>)) {
            if (!Array.isArray(targets)) continue;
            const star = pattern.indexOf('*');
            info.aliases.push({
              prefix: star >= 0 ? pattern.slice(0, star) : pattern,
              suffix: star >= 0 ? pattern.slice(star + 1) : '',
              wildcard: star >= 0,
              targets: targets.map((t) => joinRel(pathsBase, t)),
            });
          }
          // Longest prefix first, as TypeScript does.
          info.aliases.sort((a, b) => b.prefix.length - a.prefix.length);
        }
        // Prefer tsconfig over jsconfig in the same dir.
        const existing = this.tsconfigs.findIndex((t) => t.dir === dir);
        if (existing >= 0) {
          if (name === 'tsconfig.json') this.tsconfigs[existing] = info;
        } else this.tsconfigs.push(info);
      } else if (name === 'package.json') {
        const json = this.readJson(rel);
        if (json && typeof json.name === 'string') {
          const exportsMap = new Map<string, string[]>();
          const ex = json.exports;
          const isSubpathMap = ex && typeof ex === 'object' && !Array.isArray(ex) && Object.keys(ex).some((k) => k.startsWith('.'));
          if (isSubpathMap) {
            for (const [k, v] of Object.entries(ex)) exportsMap.set(k, exportTargets(v).map((t) => joinRel(dir, t)));
          } else if (ex) exportsMap.set('.', exportTargets(ex).map((t) => joinRel(dir, t)));
          const fields = [json.source, json.types, json.module, json.main].filter((e): e is string => typeof e === 'string');
          const entries = [
            ...(exportsMap.get('.') ?? []),
            ...fields.map((e) => joinRel(dir, e)),
            joinRel(dir, 'src/index'),
            joinRel(dir, 'index'),
          ];
          // Nested packages win over the root package if names clash.
          if (!this.packages.has(json.name) || dir !== '') {
            this.packages.set(json.name, { name: json.name, dir, entries, exports: exportsMap });
          }
        }
      } else if (name === 'pyproject.toml' || name === 'setup.py' || name === 'setup.cfg') {
        this.addPythonRoot(dir);
        this.addPythonRoot(joinRel(dir, 'src'));
      }
    }
    this.addPythonRoot('src');
    // Deepest config first so nested projects win.
    this.tsconfigs.sort((a, b) => b.dir.length - a.dir.length);
  }

  private addPythonRoot(dir: string): void {
    if ((dir === '' || this.dirSet.has(dir)) && !this.pythonRoots.includes(dir)) this.pythonRoots.push(dir);
  }

  // ---------------------------------------------------------------- resolve

  resolve(fromFile: string, imp: RawImport, isPython: boolean): ResolvedImport {
    return isPython ? this.resolvePython(fromFile, imp) : this.resolveJs(fromFile, imp);
  }

  private tryFile(candidate: string): string | undefined {
    if (this.fileSet.has(candidate)) return candidate;
    // ESM TypeScript: import './a.js' → a.ts
    const ext = path.posix.extname(candidate);
    const stem = ext ? candidate.slice(0, -ext.length) : candidate;
    if (ext && ['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      for (const e of JS_EXTS) if (this.fileSet.has(stem + e)) return stem + e;
    }
    for (const e of JS_EXTS) if (this.fileSet.has(candidate + e)) return candidate + e;
    for (const e of JS_EXTS) if (this.fileSet.has(`${candidate}/index${e}`)) return `${candidate}/index${e}`;
    return undefined;
  }

  private resolveJs(fromFile: string, imp: RawImport): ResolvedImport {
    const spec = imp.specifier.split('?')[0];
    const fromDir = path.posix.dirname(fromFile) === '.' ? '' : path.posix.dirname(fromFile);

    if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = this.tryFile(spec.startsWith('/') ? joinRel(spec.slice(1)) : joinRel(fromDir, spec));
      return { raw: imp, targets: target ? [target] : [] };
    }

    if (spec.startsWith('node:') || NODE_BUILTINS.has(spec) || NODE_BUILTINS.has(spec.split('/')[0])) {
      return { raw: imp, targets: [], external: { name: spec.replace(/^node:/, '').split('/')[0], kind: 'builtin' } };
    }

    // tsconfig/jsconfig: nearest config that contains this file.
    const cfg = this.tsconfigs.find((t) => t.dir === '' || fromFile.startsWith(t.dir + '/'));
    if (cfg) {
      for (const a of cfg.aliases) {
        let rest: string | undefined;
        if (a.wildcard) {
          if (spec.startsWith(a.prefix) && spec.endsWith(a.suffix) && spec.length >= a.prefix.length + a.suffix.length) {
            rest = spec.slice(a.prefix.length, spec.length - a.suffix.length);
          }
        } else if (spec === a.prefix) rest = '';
        if (rest === undefined) continue;
        for (const t of a.targets) {
          const hit = this.tryFile(t.replace('*', rest));
          if (hit) return { raw: imp, targets: [hit] };
        }
      }
      if (cfg.baseUrl !== undefined) {
        const hit = this.tryFile(joinRel(cfg.baseUrl, spec));
        if (hit) return { raw: imp, targets: [hit] };
      }
    }

    // Monorepo workspace packages.
    const pkgName = packageNameOf(spec);
    const pkg = this.packages.get(pkgName);
    if (pkg) {
      const sub = spec.slice(pkgName.length).replace(/^\//, '');
      const candidates: string[] = [];
      if (!sub) candidates.push(...pkg.entries);
      else {
        const key = `./${sub}`;
        const exact = pkg.exports.get(key);
        if (exact) candidates.push(...exact);
        for (const [pattern, targets] of pkg.exports) {
          const star = pattern.indexOf('*');
          if (star < 0) continue;
          const pre = pattern.slice(0, star);
          const post = pattern.slice(star + 1);
          if (key.startsWith(pre) && key.endsWith(post)) {
            const mid = key.slice(pre.length, key.length - post.length);
            candidates.push(...targets.map((t) => t.replace('*', mid)));
          }
        }
        candidates.push(joinRel(pkg.dir, sub), joinRel(pkg.dir, 'src', sub));
      }
      for (const c of candidates) {
        for (const sc of sourceCandidates(c)) {
          const hit = this.tryFile(sc);
          if (hit) return { raw: imp, targets: [hit] };
        }
      }
    }

    return { raw: imp, targets: [], external: { name: pkgName, kind: 'package' } };
  }

  private tryPyModule(baseDir: string, dotted: string): string | undefined {
    const rel = joinRel(baseDir, dotted.split('.').join('/'));
    if (this.fileSet.has(rel + '.py')) return rel + '.py';
    if (this.fileSet.has(rel + '/__init__.py')) return rel + '/__init__.py';
    return undefined;
  }

  private isPyPackageDir(baseDir: string, dotted: string): boolean {
    return this.dirSet.has(joinRel(baseDir, dotted.split('.').join('/')));
  }

  private resolvePython(fromFile: string, imp: RawImport): ResolvedImport {
    const spec = imp.specifier;
    const names = imp.names ?? [];
    const fromDir = path.posix.dirname(fromFile) === '.' ? '' : path.posix.dirname(fromFile);

    const resolveIn = (baseDir: string, mod: string): string[] | undefined => {
      const targets: string[] = [];
      // `from pkg import sub` – sub may be a submodule.
      for (const n of names) {
        const sub = this.tryPyModule(baseDir, mod ? `${mod}.${n}` : n);
        if (sub) targets.push(sub);
      }
      const pkgInit = joinRel(baseDir, '__init__.py');
      const modFile = mod ? this.tryPyModule(baseDir, mod) : this.fileSet.has(pkgInit) ? pkgInit : undefined;
      if (modFile && targets.length < Math.max(names.length, 1)) targets.push(modFile);
      if (targets.length) return [...new Set(targets)];
      // Namespace package (no __init__.py) that exists as a folder.
      if (mod && this.isPyPackageDir(baseDir, mod)) return [];
      return undefined;
    };

    if (spec.startsWith('.')) {
      const dots = spec.match(/^\.+/)![0].length;
      let base = fromDir;
      for (let i = 1; i < dots; i++) base = path.posix.dirname(base) === '.' ? '' : path.posix.dirname(base);
      const mod = spec.slice(dots);
      const targets = resolveIn(base, mod) ?? [];
      return { raw: imp, targets: targets.filter((t) => t !== fromFile) };
    }

    // Absolute import: try each source root.
    const top = spec.split('.')[0];
    for (const r of this.pythonRoots) {
      const t = resolveIn(r, spec)?.filter((x) => x !== fromFile);
      if (t?.length) return { raw: imp, targets: t };
    }
    if (PYTHON_STDLIB.has(top)) return { raw: imp, targets: [], external: { name: top, kind: 'builtin' } };
    // Scripts outside packages can import siblings (sys.path[0] is the script's folder).
    // Python 3 has no implicit relative imports, so this never applies inside a package.
    if (!this.fileSet.has(joinRel(fromDir, '__init__.py'))) {
      const t = resolveIn(fromDir, spec)?.filter((x) => x !== fromFile);
      if (t?.length) return { raw: imp, targets: t };
    }
    return { raw: imp, targets: [], external: { name: top, kind: 'package' } };
  }
}
