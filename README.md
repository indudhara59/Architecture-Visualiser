# Architecture-Visualiser

An interactive architecture map of your codebase, right inside VS Code. Open a folder, run **Architecture-Visualiser: Generate Architecture Diagram**, and explore.

## Three levels of zoom

| View | What you see |
|---|---|
| **System** | Your app next to the databases, caches, queues, cloud and AI/payment APIs it talks to. These are detected from imports, `docker-compose.yml`, `.env.example` and declared dependencies. |
| **Components** | Folders grouped into components and colored by layer (UI, API, services, data, utilities). Arrow thickness shows how many imports flow between them. |
| **Modules** | The files inside one component. Components that import it sit above, and the ones it depends on sit below. |

Double-click to drill down, press `Esc` to go back up, and double-click a file to open it.

## Insights

- **Architecture health score (0–100, A–F)** with a breakdown of what costs points
- **Import cycles**, drawn as animated red edges. Click one to highlight every file in it. `import type` and Python `if TYPE_CHECKING:` imports don't count.
- **Layering issues**, where lower layers import higher ones (e.g. the data layer importing UI)
- **Hotspots**, the most-imported files, plus the files with the highest fan-out
- **Possibly unused files**, which nothing imports and which aren't entry points

## Architecture rules

Create `architecture-visualiser.json` with the button in the Insights tab or the **Create Architecture Rules File** command:

```json
{
  "rules": [
    { "name": "UI must not access the data layer", "from": "src/ui/**", "to": "src/data/**", "severity": "error" }
  ],
  "ignore": ["**/*.test.*"]
}
```

Violations appear as amber edges in the diagram and as errors or warnings in VS Code's **Problems** panel, at the offending import line. The file has JSON-schema autocompletion.

## Drift tracking

**Save snapshot** records the current structure in `.architecture-visualiser/snapshot.json`; you can commit it. After that, new dependencies are highlighted in green, removed ones in red, and new files get a NEW badge. This is useful for spotting architecture changes in a PR.

## Working with the diagram

- **⌘K / Ctrl+K**: jump to any component, file or service, or run a command
- **Hover** a node to trace its dependencies. **Click** it to open the inspector, which shows depends-on and used-by lists, packages and largest files.
- **Minimap**, zoom controls, and automatic left-to-right or top-to-bottom layout that fits the panel
- Keyboard: `1` `2` `3` switch views, `F` fits the diagram, `T` changes the theme, `[` toggles the sidebar, `/` opens search
- **Live updates** on save. Only changed files are re-parsed.
- **Right-click a folder** in the Explorer and choose **Visualise Architecture of Folder** to diagram just that folder
- **Status bar** summary with the health grade and cycle count
- **Export** as SVG, PNG (2×) or Mermaid, ready for a README
- **Light and dark themes**: match VS Code automatically or pick Light or Dark from the toolbar (or press `T`). Exports use the chosen theme.

Supports **TypeScript, JavaScript (JSX/TSX, ESM/CJS) and Python**. Everything runs locally. No code leaves your machine.

## How it works

1. **Scan** the folder. It honors `.gitignore` (including nested ones) and skips `node_modules`, `dist`, virtualenvs and similar folders.
2. **Parse** imports with [tree-sitter](https://tree-sitter.github.io/) (WASM).
3. **Resolve** each import to a file: relative paths, `tsconfig`/`jsconfig` `paths` and `baseUrl`, ESM `.js` → `.ts`, monorepo packages (including `exports` maps), and Python `src/` layouts and relative imports.
4. **Group** files into components by folder. The biggest folder keeps being split until no single box dominates.
5. **Analyze** cycles (Tarjan's strongly-connected components), layering, rules and drift, and detect infrastructure from a catalog of about 90 technologies.
6. **Render** with a custom canvas: ELK layered layout, HTML cards and SVG edges.

## Settings

| Setting | Default | |
|---|---|---|
| `architectureVisualiser.exclude` | `[]` | Extra gitignore-style patterns to skip |
| `architectureVisualiser.groupingDepth` | `0` | Folder depth for components (`0` = automatic) |
| `architectureVisualiser.maxFiles` | `5000` | Stop after this many source files |
| `architectureVisualiser.diagnostics.cycles` | `true` | Show import cycles in the Problems panel |

## Development

```bash
npm install
npm run build              # bundles dist/extension.js + dist/webview.js and copies grammars
npm test                   # unit tests (vitest)
npm run test:integration   # launches VS Code and runs the commands end to end
npm run package            # builds a .vsix
```

Press **F5** in VS Code to start an Extension Development Host.
