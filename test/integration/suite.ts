import * as assert from 'node:assert';
import * as vscode from 'vscode';
import type { ArchGraph } from '../../src/core/types';

/** Runs inside the VS Code extension host. */
export async function run(): Promise<void> {
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'architecture-visualiser');
  assert.ok(ext, 'extension not found');

  const graph = (await vscode.commands.executeCommand('architectureVisualiser.generate')) as ArchGraph | undefined;
  assert.ok(ext.isActive, 'extension did not activate');
  assert.ok(graph, 'command returned no graph');
  assert.strictEqual(graph.stats.files, 10);
  assert.strictEqual(graph.fileCycles.length, 1);
  assert.ok(graph.componentEdges.some((e) => e.from === 'c:src/ui' && e.to === 'c:src/data'));

  const webviewTab = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .find((t) => t.input instanceof vscode.TabInputWebview && t.label.startsWith('Architecture'));
  assert.ok(webviewTab, 'architecture webview tab not open');
  // Cycle diagnostics land in the Problems panel.
  await new Promise((r) => setTimeout(r, 300));
  const diags = vscode.languages.getDiagnostics().filter(([, ds]) => ds.some((d) => d.source === 'Architecture-Visualiser'));
  assert.ok(diags.length >= 2, `expected cycle diagnostics, got ${diags.length}`);

  // Folder-scoped diagram.
  const scoped = (await vscode.commands.executeCommand(
    'architectureVisualiser.generateForFolder',
    vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'src/services'),
  )) as ArchGraph | undefined;
  assert.strictEqual(scoped?.stats.files, 2);
  console.log(`[architecture-visualiser] integration OK: ${graph.stats.files} files, ${graph.components.length} components`);
}
