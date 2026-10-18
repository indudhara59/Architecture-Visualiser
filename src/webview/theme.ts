import {
  type LucideIcon,
  Activity, Boxes, Cloud, CreditCard, Database, FlaskConical, Folder, Globe, HardDrive, KeyRound, Layers, Mail,
  Monitor, Route, Search, Server, Settings2, Sparkles, Workflow, Wrench, Zap,
} from 'lucide-preact';
import type { Language, LayerTag, TechCategory } from '../core/types';

export const LAYER_COLORS: Record<LayerTag, string> = {
  ui: '#4f8cff',
  api: '#a66cff',
  service: '#1fb47a',
  data: '#f0a020',
  util: '#8b93a7',
  config: '#6f7a8f',
  test: '#ec6a3c',
  other: '#3fb3c9',
};

export const LAYER_LABELS: Record<LayerTag, string> = {
  ui: 'UI',
  api: 'API / entry',
  service: 'Services',
  data: 'Data',
  util: 'Utilities',
  config: 'Config',
  test: 'Tests',
  other: 'Other',
};

type Icon = LucideIcon;

export const LAYER_ICONS: Record<LayerTag, Icon> = {
  ui: Monitor,
  api: Route,
  service: Workflow,
  data: Database,
  util: Wrench,
  config: Settings2,
  test: FlaskConical,
  other: Folder,
};

export const TECH_META: Record<TechCategory, { label: string; color: string; icon: Icon }> = {
  database: { label: 'Database', color: '#f0a020', icon: Database },
  cache: { label: 'Cache', color: '#ef4f6b', icon: Zap },
  queue: { label: 'Queue', color: '#a66cff', icon: Layers },
  storage: { label: 'Storage', color: '#d98b2b', icon: HardDrive },
  cloud: { label: 'Cloud', color: '#3a9cf5', icon: Cloud },
  payment: { label: 'Payments', color: '#635bff', icon: CreditCard },
  ai: { label: 'AI', color: '#d16cf0', icon: Sparkles },
  auth: { label: 'Auth', color: '#1fb47a', icon: KeyRound },
  messaging: { label: 'Messaging', color: '#25b0c9', icon: Mail },
  search: { label: 'Search', color: '#e8b31a', icon: Search },
  observability: { label: 'Observability', color: '#8b93a7', icon: Activity },
  http: { label: 'APIs', color: '#4f8cff', icon: Globe },
  framework: { label: 'Framework', color: '#7c5cff', icon: Boxes },
  service: { label: 'Service', color: '#3fb3c9', icon: Server },
};

/** Groups of tech categories used as boxes in the system view. */
export const TECH_GROUPS: { id: string; label: string; categories: TechCategory[] }[] = [
  { id: 'data', label: 'Data stores', categories: ['database', 'cache', 'storage', 'search'] },
  { id: 'events', label: 'Messaging & events', categories: ['queue', 'messaging'] },
  { id: 'external', label: 'External services', categories: ['payment', 'ai', 'auth', 'cloud', 'http', 'observability', 'service'] },
];

export const LANG_META: Record<Language, { label: string; short: string; color: string }> = {
  typescript: { label: 'TypeScript', short: 'TS', color: '#3178c6' },
  tsx: { label: 'TSX', short: 'TSX', color: '#2f9fd8' },
  javascript: { label: 'JavaScript', short: 'JS', color: '#e5c02b' },
  python: { label: 'Python', short: 'PY', color: '#3d7fbf' },
};

export function fmt(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
