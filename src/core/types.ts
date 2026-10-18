export type Language = 'typescript' | 'tsx' | 'javascript' | 'python';

export interface SourceFile {
  /** Workspace-relative path using forward slashes. */
  path: string;
  absPath: string;
  language: Language;
  mtimeMs: number;
  size: number;
}

export interface RawImport {
  /** Module specifier as written: './a', 'react', '..models', 'os.path'. */
  specifier: string;
  /** Python `from X import a, b` — names that may themselves be submodules. */
  names?: string[];
  line: number;
  typeOnly?: boolean;
}

export type ExternalKind = 'package' | 'builtin';

export interface ResolvedImport {
  raw: RawImport;
  /** Workspace-relative target file paths (Python `from pkg import a, b` can hit several). */
  targets: string[];
  external?: { name: string; kind: ExternalKind };
}

export interface FileEdge {
  from: string;
  to: string;
  /** Number of import statements creating this edge. */
  count: number;
  typeOnly: boolean;
  /** 1-based source lines of the import statements. */
  lines: number[];
}

export type LayerTag = 'ui' | 'api' | 'service' | 'data' | 'util' | 'config' | 'test' | 'other';

export interface Component {
  id: string;
  /** Folder path this component represents ('' for the project root). */
  folder: string;
  label: string;
  layer: LayerTag;
  files: string[];
}

export interface ComponentEdge {
  from: string;
  to: string;
  count: number;
  /** True when a file-level import cycle runs along this edge. */
  cyclic?: boolean;
}

export interface ExternalDep {
  name: string;
  kind: ExternalKind;
  /** Component ids that use it. */
  usedBy: Record<string, number>;
}

export interface ArchGraph {
  root: string;
  generatedAt: string;
  files: { path: string; language: Language; component: string; lines?: number }[];
  fileEdges: FileEdge[];
  components: Component[];
  componentEdges: ComponentEdge[];
  externals: ExternalDep[];
  /** Strongly connected file groups (size > 1, or a self-import). */
  fileCycles: string[][];
  /** Component SCCs (folder-level coupling); usually broader than real file cycles. */
  componentCycles: string[][];
  stats: { files: number; imports: number; unresolved: number; durationMs: number; truncated: boolean };
}

// ------------------------------------------------------------------ insights

export interface FileMetric {
  path: string;
  fanIn: number;
  fanOut: number;
}

export interface LayerWarning {
  from: string;
  to: string;
  fromLayer: LayerTag;
  toLayer: LayerTag;
  /** Example file edge causing it. */
  example: { from: string; to: string; line: number };
  count: number;
}

export interface RuleViolation {
  rule: string;
  severity: 'error' | 'warning';
  from: string;
  to: string;
  line: number;
}

export interface HealthBreakdown {
  label: string;
  penalty: number;
  detail: string;
}

export interface Insights {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: HealthBreakdown[];
  totalLines: number;
  languages: { language: Language; files: number; lines: number }[];
  hotspots: FileMetric[];
  fanOutHeavy: FileMetric[];
  orphans: string[];
  layerWarnings: LayerWarning[];
  ruleViolations: RuleViolation[];
  /** Per-file fan-in/out for the UI. */
  metrics: Record<string, { fanIn: number; fanOut: number }>;
}

// ------------------------------------------------------------------ system view

export type TechCategory =
  | 'database' | 'cache' | 'queue' | 'storage' | 'cloud' | 'payment' | 'ai' | 'auth'
  | 'messaging' | 'search' | 'observability' | 'http' | 'framework' | 'service';

export interface TechNode {
  id: string;
  name: string;
  category: TechCategory;
  /** How it was detected. */
  sources: ('import' | 'compose' | 'env' | 'dependency')[];
  /** Package names that matched. */
  packages: string[];
  /** Component id → import count. */
  usedBy: Record<string, number>;
}

export interface SystemView {
  techs: TechNode[];
  frameworks: TechNode[];
  composeServices: { name: string; image?: string }[];
}

// ------------------------------------------------------------------ snapshots

export interface Snapshot {
  savedAt: string;
  files: string[];
  componentEdges: { from: string; to: string; count: number }[];
  fileEdges: { from: string; to: string }[];
}

export interface SnapshotDiff {
  savedAt: string;
  addedFiles: string[];
  removedFiles: string[];
  addedFileEdges: { from: string; to: string }[];
  removedFileEdges: { from: string; to: string }[];
  addedComponentEdges: { from: string; to: string }[];
  removedComponentEdges: { from: string; to: string }[];
}

export interface RulesConfig {
  rules?: { name?: string; from: string | string[]; to: string | string[]; severity?: 'error' | 'warning'; except?: string | string[] }[];
  ignore?: string[];
}

/** Everything the webview needs. */
export interface Payload {
  graph: ArchGraph;
  insights: Insights;
  system: SystemView;
  diff?: SnapshotDiff;
  scope?: string;
  hasRulesFile: boolean;
}
