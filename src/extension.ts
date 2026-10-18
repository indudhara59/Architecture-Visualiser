import * as path from 'node:path';
import * as vscode from 'vscode';
import { Analyzer } from './core/analyze';
import { computeInsights, sampleRules } from './core/insights';
import { toMermaid } from './core/mermaid';
import { parseJsonc } from './core/resolver';
import { languageForPath } from './core/scanner';
import { diffSnapshot, toSnapshot } from './core/snapshot';
import { detectSystem } from './core/system';
import { Payload, RulesConfig, Snapshot } from './core/types';

const RULES_FILE = 'architecture-visualiser.json';
const SNAPSHOT_FILE = '.architecture-visualiser/snapshot.json';

/** Messages the webview sends to the extension. */
type FromWebview =
  | { type: 'ready' }
  | { type: 'openFile'; path: string; line?: number }
  | { type: 'refresh' }
  | { type: 'exportMermaid' }
  | { type: 'saveImage'; format: 'svg' | 'png'; data: string }
  | { type: 'saveSnapshot' }
  | { type: 'clearSnapshot' }
  | { type: 'createRules' }
  | { type: 'openRules' }
  | { type: 'copyText'; text: string; label?: string };

let analyzer: Analyzer | undefined;
let panel: ArchPanel | undefined;
let diagnostics: vscode.DiagnosticCollection;
let statusItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  analyzer = new Analyzer(vscode.Uri.joinPath(context.extensionUri, 'dist', 'wasm').fsPath);
  diagnostics = vscode.languages.createDiagnosticCollection('architecture-visualiser');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = 'architectureVisualiser.generate';
  context.subscriptions.push(diagnostics, statusItem);

  const open = async (folder: vscode.WorkspaceFolder, scope?: string) => {
    if (panel && panel.folder.uri.toString() === folder.uri.toString() && panel.scope === scope) panel.reveal();
    else {
      panel?.dispose();
      panel = new ArchPanel(context, folder, scope);
      panel.onDidDispose(() => (panel = undefined));
    }
    await panel.refresh();
    return panel.payload?.graph;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('architectureVisualiser.generate', async () => {
      const folder = await pickFolder();
      // Returned for tests and other extensions that want the analysis.
      return folder ? open(folder) : undefined;
    }),
    vscode.commands.registerCommand('architectureVisualiser.generateForFolder', async (uri?: vscode.Uri) => {
      const target = uri ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false }))?.[0];
      if (!target) return undefined;
      const folder = vscode.workspace.getWorkspaceFolder(target);
      if (!folder) {
        vscode.window.showWarningMessage('Architecture-Visualiser: that folder is not part of the open workspace.');
        return undefined;
      }
      const rel = path.relative(folder.uri.fsPath, target.fsPath).split(path.sep).join('/');
      return open(folder, rel || undefined);
    }),
    vscode.commands.registerCommand('architectureVisualiser.exportMermaid', () => withPanel((p) => p.exportMermaid())),
    vscode.commands.registerCommand('architectureVisualiser.saveSnapshot', () => withPanel((p) => p.saveSnapshot())),
    vscode.commands.registerCommand('architectureVisualiser.clearSnapshot', () => withPanel((p) => p.clearSnapshot())),
    vscode.commands.registerCommand('architectureVisualiser.createRules', () => withPanel((p) => p.createRules())),
  );
}

async function withPanel(fn: (p: ArchPanel) => Promise<void>): Promise<void> {
  if (!panel?.payload) {
    vscode.window.showInformationMessage('Architecture-Visualiser: generate a diagram first.');
    return;
  }
  await fn(panel);
}

export function deactivate(): void {
  panel?.dispose();
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) {
    vscode.window.showWarningMessage('Architecture-Visualiser: open a folder first.');
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Folder to diagram' });
}

class ArchPanel {
  payload?: Payload;
  private readonly webview: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly disposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposeEmitter.event;
  private ready = false;
  private running?: Promise<void>;
  private rerunRequested = false;
  private debounce?: NodeJS.Timeout;

  constructor(
    context: vscode.ExtensionContext,
    readonly folder: vscode.WorkspaceFolder,
    readonly scope?: string,
  ) {
    const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
    const title = scope ? `Architecture: ${path.posix.basename(scope)}` : `Architecture: ${folder.name}`;
    this.webview = vscode.window.createWebviewPanel('architectureVisualiser', title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [distUri],
    });
    this.webview.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    this.webview.webview.html = this.html(this.webview.webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js')));

    this.webview.onDidDispose(() => this.dispose(), null, this.disposables);
    this.webview.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m), null, this.disposables);

    // Live updates: re-analyze (debounced) when source files or the rules file change.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, `**/{*.ts,*.tsx,*.mts,*.cts,*.js,*.jsx,*.mjs,*.cjs,*.py,${RULES_FILE},tsconfig.json,package.json}`),
    );
    const onChange = (uri: vscode.Uri) => {
      if (uri.fsPath.includes(`${path.sep}node_modules${path.sep}`)) return;
      if (languageForPath(uri.fsPath)) analyzer?.invalidate(this.rel(uri));
      this.scheduleRefresh();
    };
    watcher.onDidChange(onChange, null, this.disposables);
    watcher.onDidCreate(onChange, null, this.disposables);
    watcher.onDidDelete(onChange, null, this.disposables);
    this.disposables.push(watcher);

    vscode.workspace.onDidChangeConfiguration(
      (e) => e.affectsConfiguration('architectureVisualiser') && this.scheduleRefresh(),
      null,
      this.disposables,
    );
  }

  private rel(uri: vscode.Uri): string {
    return path.relative(this.folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
  }

  private uri(rel: string): vscode.Uri {
    return vscode.Uri.joinPath(this.folder.uri, rel);
  }

  reveal(): void {
    this.webview.reveal();
  }

  dispose(): void {
    clearTimeout(this.debounce);
    this.webview.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
    diagnostics.clear();
    statusItem.hide();
    this.disposeEmitter.fire();
    this.disposeEmitter.dispose();
  }

  private scheduleRefresh(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.refresh(true), 700);
  }

  /** Runs analysis; if one is already running, queues exactly one more run. */
  async refresh(silent = false): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return this.running;
    }
    this.running = this.run(silent).finally(() => {
      this.running = undefined;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.refresh(true);
      }
    });
    return this.running;
  }

  private async readJson<T>(rel: string): Promise<T | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.uri(rel));
      return parseJsonc(Buffer.from(bytes).toString('utf8')) as T;
    } catch {
      return undefined;
    }
  }

  private async run(silent: boolean): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('architectureVisualiser', this.folder.uri);
    const task = async (progress?: vscode.Progress<{ message?: string }>) => {
      try {
        const root = this.folder.uri.fsPath;
        const graph = await analyzer!.analyze(root, {
          exclude: cfg.get<string[]>('exclude', []),
          maxFiles: cfg.get<number>('maxFiles', 5000),
          groupingDepth: cfg.get<number>('groupingDepth', 0),
          scope: this.scope,
          onProgress: (done, total) => progress?.report({ message: `Parsing ${done}/${total} files` }),
        });
        const rules = await this.readJson<RulesConfig>(RULES_FILE);
        const snapshot = await this.readJson<Snapshot>(SNAPSHOT_FILE);
        this.payload = {
          graph,
          insights: computeInsights(graph, rules),
          system: detectSystem(root, graph),
          diff: snapshot?.files ? diffSnapshot(snapshot, graph) : undefined,
          scope: this.scope,
          hasRulesFile: !!rules,
        };
        this.post();
        this.updateDiagnostics(cfg.get<boolean>('diagnostics.cycles', true));
        this.updateStatus();
        if (graph.stats.truncated) {
          vscode.window.showWarningMessage(
            `Architecture-Visualiser: stopped at ${graph.stats.files} files (architectureVisualiser.maxFiles). Add excludes or raise the limit.`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Architecture-Visualiser: analysis failed — ${msg}`);
        void this.webview.webview.postMessage({ type: 'error', message: msg });
      }
    };
    if (silent) await task();
    else
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Architecture-Visualiser: analyzing workspace' },
        task,
      );
  }

  private updateDiagnostics(includeCycles: boolean): void {
    diagnostics.clear();
    if (!this.payload) return;
    const { graph, insights } = this.payload;
    const byFile = new Map<string, vscode.Diagnostic[]>();
    const push = (file: string, d: vscode.Diagnostic) => byFile.set(file, [...(byFile.get(file) ?? []), d]);
    const range = (line: number) => new vscode.Range(line - 1, 0, line - 1, 1000);

    for (const v of insights.ruleViolations) {
      const d = new vscode.Diagnostic(
        range(v.line),
        `${v.rule}: imports ${v.to}`,
        v.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
      );
      d.source = 'Architecture-Visualiser';
      d.code = 'rule';
      push(v.from, d);
    }
    if (includeCycles) {
      const cycleOf = new Map<string, number>();
      graph.fileCycles.forEach((c, i) => c.forEach((f) => cycleOf.set(f, i)));
      for (const e of graph.fileEdges) {
        if (e.typeOnly || !cycleOf.has(e.from) || cycleOf.get(e.from) !== cycleOf.get(e.to)) continue;
        const size = graph.fileCycles[cycleOf.get(e.from)!].length;
        for (const line of e.lines) {
          const d = new vscode.Diagnostic(
            range(line),
            size === 1 ? 'This file imports itself' : `Import cycle: ${e.to} leads back to this file (${size} files in the cycle)`,
            vscode.DiagnosticSeverity.Information,
          );
          d.source = 'Architecture-Visualiser';
          d.code = 'cycle';
          push(e.from, d);
        }
      }
    }
    for (const [file, ds] of byFile) diagnostics.set(this.uri(file), ds);
  }

  private updateStatus(): void {
    if (!this.payload) return;
    const { graph, insights } = this.payload;
    const cycles = graph.fileCycles.length;
    const violations = insights.ruleViolations.length;
    statusItem.text = `$(type-hierarchy) ${insights.grade} · ${cycles} cycle${cycles === 1 ? '' : 's'}${violations ? ` · ${violations} violations` : ''}`;
    statusItem.tooltip = new vscode.MarkdownString(
      `**Architecture health: ${insights.score}/100 (${insights.grade})**\n\n` +
        `${graph.stats.files} files · ${graph.components.length} components\n\n` +
        insights.breakdown.map((b) => `- ${b.label}: −${b.penalty} (${b.detail})`).join('\n') +
        '\n\nClick to open the diagram',
    );
    statusItem.backgroundColor = insights.grade === 'D' || insights.grade === 'F' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    statusItem.show();
  }

  private post(): void {
    if (this.ready && this.payload) void this.webview.webview.postMessage({ type: 'payload', payload: this.payload });
  }

  private async onMessage(m: FromWebview): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.ready = true;
        this.post();
        break;
      case 'refresh':
        await this.refresh();
        break;
      case 'openFile': {
        const line = Math.max(0, (m.line ?? 1) - 1);
        await vscode.window.showTextDocument(this.uri(m.path), {
          viewColumn: vscode.ViewColumn.Beside,
          selection: new vscode.Range(line, 0, line, 0),
          preview: true,
        });
        break;
      }
      case 'exportMermaid':
        await this.exportMermaid();
        break;
      case 'saveImage': {
        const target = await vscode.window.showSaveDialog({
          defaultUri: this.uri(`architecture.${m.format}`),
          filters: m.format === 'svg' ? { SVG: ['svg'] } : { PNG: ['png'] },
        });
        if (!target) return;
        const bytes = m.format === 'svg' ? Buffer.from(m.data, 'utf8') : Buffer.from(m.data, 'base64');
        await vscode.workspace.fs.writeFile(target, bytes);
        vscode.window.showInformationMessage(`Architecture-Visualiser: saved ${vscode.workspace.asRelativePath(target)}`);
        break;
      }
      case 'saveSnapshot':
        await this.saveSnapshot();
        break;
      case 'clearSnapshot':
        await this.clearSnapshot();
        break;
      case 'createRules':
        await this.createRules();
        break;
      case 'openRules':
        await vscode.window.showTextDocument(this.uri(RULES_FILE), { viewColumn: vscode.ViewColumn.Beside });
        break;
      case 'copyText':
        await vscode.env.clipboard.writeText(m.text);
        vscode.window.showInformationMessage(`Architecture-Visualiser: copied ${m.label ?? 'to clipboard'}.`);
        break;
    }
  }

  async saveSnapshot(): Promise<void> {
    if (!this.payload) return;
    const data = JSON.stringify(toSnapshot(this.payload.graph), null, 2);
    await vscode.workspace.fs.writeFile(this.uri(SNAPSHOT_FILE), Buffer.from(data, 'utf8'));
    vscode.window.showInformationMessage(
      `Architecture-Visualiser: snapshot saved to ${SNAPSHOT_FILE}. New dependencies will be highlighted from now on.`,
    );
    await this.refresh(true);
  }

  async clearSnapshot(): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.uri(SNAPSHOT_FILE));
    } catch {
      // already gone
    }
    await this.refresh(true);
  }

  async createRules(): Promise<void> {
    if (!this.payload) return;
    const target = this.uri(RULES_FILE);
    try {
      await vscode.workspace.fs.stat(target);
    } catch {
      const text = JSON.stringify(sampleRules(this.payload.graph), null, 2) + '\n';
      await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
    }
    await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.Beside });
    await this.refresh(true);
  }

  async exportMermaid(): Promise<void> {
    if (!this.payload) return;
    const text = toMermaid(this.payload.graph, { includeExternals: true });
    const choice = await vscode.window.showQuickPick(['Copy to clipboard', 'Save as .mmd file', 'Open in editor'], {
      placeHolder: 'Export Mermaid diagram',
    });
    if (choice === 'Copy to clipboard') {
      await vscode.env.clipboard.writeText('```mermaid\n' + text + '```\n');
      vscode.window.showInformationMessage('Architecture-Visualiser: Mermaid diagram copied (ready to paste into a README).');
    } else if (choice === 'Save as .mmd file') {
      const target = await vscode.window.showSaveDialog({
        defaultUri: this.uri('architecture.mmd'),
        filters: { Mermaid: ['mmd', 'md'] },
      });
      if (target) await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
    } else if (choice === 'Open in editor') {
      const doc = await vscode.workspace.openTextDocument({ content: text, language: 'mermaid' });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }
  }

  private html(scriptUri: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const csp = [
      "default-src 'none'",
      `img-src ${this.webview.webview.cspSource} data: blob:`,
      `style-src ${this.webview.webview.cspSource} 'unsafe-inline'`,
      `font-src ${this.webview.webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Architecture</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
