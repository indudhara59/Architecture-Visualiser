import * as path from 'node:path';
import Parser from 'web-tree-sitter';
import { Language, RawImport } from './types';

type SyntaxNode = Parser.SyntaxNode;

/**
 * Extracts import statements from source files using tree-sitter grammars.
 * Grammars are loaded lazily from `wasmDir`, which must contain tree-sitter.wasm
 * and tree-sitter-<lang>.wasm for each supported language.
 */
export class ImportParser {
  private parser?: Parser;
  private languages = new Map<Language, Parser.Language>();
  private initPromise?: Promise<void>;

  constructor(private readonly wasmDir: string) {}

  private init(): Promise<void> {
    this.initPromise ??= (async () => {
      await Parser.init({ locateFile: (name: string) => path.join(this.wasmDir, name) });
      this.parser = new Parser();
    })();
    return this.initPromise;
  }

  private async language(lang: Language): Promise<Parser.Language> {
    let l = this.languages.get(lang);
    if (!l) {
      l = await Parser.Language.load(path.join(this.wasmDir, `tree-sitter-${lang}.wasm`));
      this.languages.set(lang, l);
    }
    return l;
  }

  async parse(source: string, lang: Language): Promise<RawImport[]> {
    await this.init();
    const parser = this.parser!;
    parser.setLanguage(await this.language(lang));
    const tree = parser.parse(source);
    try {
      return lang === 'python' ? extractPython(tree.rootNode) : extractJs(tree.rootNode);
    } finally {
      tree.delete();
    }
  }
}

function stringValue(node: SyntaxNode | null | undefined): string | undefined {
  if (!node || node.type !== 'string') return undefined;
  // `string` contains quote tokens plus an optional string_fragment.
  const frag = node.namedChildren.find((c) => c.type === 'string_fragment');
  if (frag) return frag.text;
  const t = node.text;
  return t.length >= 2 ? t.slice(1, -1) : undefined;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  // Iterative pre-order traversal; `visit` returns false to skip children.
  const cursor = node.walk();
  let descend = true;
  for (;;) {
    if (descend) {
      const keepGoing = visit(cursor.currentNode());
      if (keepGoing !== false && cursor.gotoFirstChild()) continue;
    }
    if (cursor.gotoNextSibling()) {
      descend = true;
      continue;
    }
    if (!cursor.gotoParent()) break;
    descend = false;
  }
  cursor.delete();
}

export function extractJs(root: SyntaxNode): RawImport[] {
  const out: RawImport[] = [];
  walk(root, (n) => {
    switch (n.type) {
      case 'import_statement': {
        const src = stringValue(n.childForFieldName('source'));
        if (src !== undefined) {
          // `import type {X} from` → the `type` keyword is an anonymous child.
          const typeOnly = n.children.some((c) => c.type === 'type');
          out.push({ specifier: src, line: n.startPosition.row + 1, typeOnly });
        } else {
          // TS: import x = require('y')
          const req = n.namedChildren.find((c) => c.type === 'import_require_clause');
          const s = req && stringValue(req.namedChildren.find((c) => c.type === 'string'));
          if (s !== undefined) out.push({ specifier: s, line: n.startPosition.row + 1 });
        }
        return false;
      }
      case 'export_statement': {
        const src = stringValue(n.childForFieldName('source'));
        if (src !== undefined) {
          const typeOnly = n.children.some((c) => c.type === 'type');
          out.push({ specifier: src, line: n.startPosition.row + 1, typeOnly });
          return false;
        }
        return;
      }
      case 'call_expression': {
        const fn = n.childForFieldName('function');
        if (fn && (fn.type === 'import' || (fn.type === 'identifier' && fn.text === 'require'))) {
          const args = n.childForFieldName('arguments');
          const first = args?.namedChildren[0];
          const s = stringValue(first);
          if (s !== undefined) out.push({ specifier: s, line: n.startPosition.row + 1 });
        }
        return;
      }
    }
  });
  return out;
}

export function extractPython(root: SyntaxNode): RawImport[] {
  const out: RawImport[] = [];
  walk(root, (n) => {
    if (n.type === 'import_statement') {
      // import a.b, c as d
      const typeOnly = underTypeChecking(n);
      for (const c of importedNames(n)) {
        out.push({ specifier: c, line: n.startPosition.row + 1, typeOnly });
      }
      return false;
    }
    if (n.type === 'import_from_statement') {
      const mod = n.childForFieldName('module_name');
      if (!mod) return false;
      const names = importedNames(n, mod);
      // `from x import *` has a wildcard_import child instead of names.
      out.push({ specifier: mod.text.replace(/\s+/g, ''), names, line: n.startPosition.row + 1, typeOnly: underTypeChecking(n) });
      return false;
    }
    if (n.type === 'future_import_statement') return false;
  });
  return out;
}

/** Names in `import a.b, c as d` / `from x import a, b as c`, skipping the `from` module itself. */
function importedNames(stmt: SyntaxNode, skip?: SyntaxNode): string[] {
  const names: string[] = [];
  for (const c of stmt.namedChildren) {
    if (skip && c.startIndex === skip.startIndex && c.endIndex === skip.endIndex) continue;
    if (c.type === 'dotted_name') names.push(c.text);
    else if (c.type === 'aliased_import') {
      const name = c.childForFieldName('name');
      if (name) names.push(name.text);
    }
  }
  return names;
}

/** True inside `if TYPE_CHECKING:` / `if typing.TYPE_CHECKING:` (not in its else branch). */
function underTypeChecking(n: SyntaxNode): boolean {
  let child = n;
  for (let p = n.parent; p; child = p, p = p.parent) {
    if (p.type === 'if_statement') {
      const cond = p.childForFieldName('condition')?.text.replace(/\s+/g, '');
      const body = p.childForFieldName('consequence');
      if (cond && /^(typing\.|t\.)?TYPE_CHECKING$/.test(cond) && body && child.startIndex === body.startIndex && child.endIndex === body.endIndex) {
        return true;
      }
    }
  }
  return false;
}
