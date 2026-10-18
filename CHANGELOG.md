# Changelog

## 0.2.0

- New UI: custom canvas with card nodes, routed edges, minimap, zoom controls, ⌘K palette, sidebar and inspector; light and dark themes.
- System view: databases, caches, queues and external services detected from imports, docker-compose, .env.example and dependencies.
- Insights: health score, cycles, layering issues, hotspots, unused files.
- Architecture rules file with Problems-panel diagnostics and JSON schema.
- Snapshots and drift highlighting.
- Folder-scoped diagrams from the Explorer context menu; status bar summary.

## 0.1.0

- Component view (folders grouped into components, colored by guessed layer) and module view (files of one component, with neighboring components collapsed).
- TypeScript / JavaScript / Python import parsing with tree-sitter.
- Resolves relative imports, tsconfig/jsconfig `paths` + `baseUrl`, ESM `.js` → `.ts`, monorepo workspace packages (including `exports` maps), Python src-layout and relative imports.
- Import-cycle detection (Tarjan SCC); `import type` and `if TYPE_CHECKING:` imports don't count.
- Live refresh on save, click-to-open files, filter, export to SVG / PNG / Mermaid.
