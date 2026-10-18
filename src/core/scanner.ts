import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ignore, { Ignore } from 'ignore';
import { Language, SourceFile } from './types';

const EXTENSIONS: Record<string, Language> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

/** Directories that are never source code worth diagramming. */
export const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  '.svelte-kit', '.turbo', '.cache', '.parcel-cache', '.vercel', '.output', 'vendor',
  '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'site-packages', '.eggs', '.idea', '.vscode-test', 'bower_components', 'jspm_packages',
]);

/** Config files the resolver needs (tsconfig paths, workspace packages, Python roots). */
const CONFIG_FILES = new Set(['tsconfig.json', 'jsconfig.json', 'package.json', 'pyproject.toml', 'setup.py', 'setup.cfg']);

const MAX_FILE_BYTES = 1024 * 1024;

export interface ScanOptions {
  exclude?: string[];
  maxFiles?: number;
}

export interface ScanResult {
  files: SourceFile[];
  /** Workspace-relative paths of config files found. */
  configFiles: string[];
  truncated: boolean;
}

interface IgnoreScope {
  /** Workspace-relative directory the .gitignore lives in ('' for root). */
  base: string;
  ig: Ignore;
}

export async function scanWorkspace(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const maxFiles = opts.maxFiles ?? 5000;
  const files: SourceFile[] = [];
  const configFiles: string[] = [];
  let truncated = false;

  const userIgnore = ignore().add(opts.exclude ?? []);

  async function loadGitignore(relDir: string): Promise<IgnoreScope | undefined> {
    try {
      const text = await fs.readFile(path.join(root, relDir, '.gitignore'), 'utf8');
      return { base: relDir, ig: ignore().add(text) };
    } catch {
      return undefined;
    }
  }

  function isIgnored(rel: string, isDir: boolean, scopes: IgnoreScope[]): boolean {
    const probe = isDir ? rel + '/' : rel;
    if (userIgnore.ignores(probe)) return true;
    for (const s of scopes) {
      const sub = s.base ? probe.slice(s.base.length + 1) : probe;
      if (sub && s.ig.ignores(sub)) return true;
    }
    return false;
  }

  async function walk(relDir: string, scopes: IgnoreScope[]): Promise<void> {
    if (truncated) return;
    const own = await loadGitignore(relDir);
    const active = own ? [...scopes, own] : scopes;

    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(path.join(root, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const subdirs: string[] = [];
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        if (isIgnored(rel, true, active)) continue;
        subdirs.push(rel);
      } else if (e.isFile()) {
        if (CONFIG_FILES.has(e.name)) {
          configFiles.push(rel);
          continue;
        }
        const ext = path.extname(e.name).toLowerCase();
        const language = EXTENSIONS[ext];
        if (!language || e.name.endsWith('.d.ts') || e.name.endsWith('.min.js')) continue;
        if (isIgnored(rel, false, active)) continue;
        const abs = path.join(root, rel);
        let st: import('node:fs').Stats;
        try {
          st = await fs.stat(abs);
        } catch {
          continue;
        }
        if (st.size > MAX_FILE_BYTES) continue;
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        files.push({ path: rel, absPath: abs, language, mtimeMs: st.mtimeMs, size: st.size });
      }
    }
    for (const d of subdirs) await walk(d, active);
  }

  await walk('', []);
  return { files, configFiles, truncated };
}

export function languageForPath(p: string): Language | undefined {
  if (p.endsWith('.d.ts')) return undefined;
  return EXTENSIONS[path.extname(p).toLowerCase()];
}
